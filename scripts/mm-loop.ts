import "dotenv/config";
import { ethers } from "ethers";
import { getActiveNetwork } from "../src/config/network.js";
import { getPool } from "../src/config/pairs.js";
import { getToken } from "../src/config/tokens.js";
import { SPOTPOOL_ABI } from "../src/dex/abi/spotpool.js";
import type { SpotPoolContract } from "../src/dex/abi/types.js";
import { buildExpireNs } from "../src/utils/gotchas.js";
import { ORDER_TYPE, SELF_MATCH, MS_PER_HOUR } from "../src/config/constants.js";
import { logger } from "../src/utils/logger.js";

// ============================================================================
//  mm-loop — two-sided PostOnly market-maker for DreamDEX cohort 2.
//
//  Ranking is PnL-WEIGHTED effective volume:
//      Effective Volume = Raw Volume × (usdsoBalance / 150)
//  So bleeding capital (taker churn) is suicidal. The winning move is to be a
//  MAKER: rest two-sided PostOnly orders tight to mid → earn collateral YIELD
//  (open-interest reward, proximity×size×time) which lifts PnL above 0
//  (multiplier > 1), AND capture taker flow as maker fills (volume at OUR
//  price, 0 fee, no spread paid). Fees are 0%/0%, so the only cost of any
//  taker leg is the spread itself.
//
//  Funding: placeOrder AUTO-PULLS principal from the wallet (ERC-20 approve
//  once) and AUTO-DELIVERS proceeds back — no manual vault deposit needed.
//
//  Usage:
//    NETWORK=mainnet npx tsx scripts/mm-loop.ts <pool> <halfSpreadTicks> \
//        <pollMs> <maxCycles> <gasReserveSomi> <useFrac> <requoteBps> <forceRequoteSec>
//    e.g. NETWORK=mainnet npx tsx scripts/mm-loop.ts WETH:USDso 2 15000 100000 1 0.9 8 14400
// ============================================================================

const POOL_SYMBOL = process.argv[2] ?? "WETH:USDso";
const HALF_SPREAD_TICKS = BigInt(process.argv[3] ?? "2"); // distance from mid each side, in ticks
const POLL_MS = Number(process.argv[4] ?? "15000");
const MAX_CYCLES = Number(process.argv[5] ?? "100000");
const GAS_RESERVE_SOMI = process.argv[6] ?? "1";
const USE_FRAC = Number(process.argv[7] ?? "0.9"); // fraction of each side's balance to quote
const REQUOTE_BPS = Number(process.argv[8] ?? "8"); // re-quote when mid moves > this (bps)
const FORCE_REQUOTE_SEC = Number(process.argv[9] ?? "14400"); // force a re-quote ≥ this often (anti-DQ; default 4h)
// Inventory caps (fraction of total portfolio value held as BASE). Keeps the
// book two-sided in the neutral band; when skewed past a cap we quote ONE side
// only to rebalance (prevents the MM-v1 runaway-skew / directional blowup).
const MIN_INV = Number(process.argv[10] ?? "0.35");
const MAX_INV = Number(process.argv[11] ?? "0.65");

const ORDER_PLACED_TOPIC = "0xd90f62f61ee2f606b132cfdfd883ddd079228b6fd6bffd9d7cf848daf824639d";
// CORRECT OrderFilled signature has SIX trailing uints (incl fillPrice). The
// old ioc-loop used a 5-uint hash and never matched — that was the bug.
const ORDER_FILLED_TOPIC = ethers.id("OrderFilled(uint128,uint128,uint256,uint256,uint256,uint256)");

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

interface Book { bid: number; ask: number; mid: number }

async function fetchBook(symbol: string): Promise<Book | null> {
  try {
    const url = `https://api.dreamdex.io/v0/orderbooks?symbols=${encodeURIComponent(symbol)}&depth=1`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { orderbooks?: Array<{ bids: Array<{ price: string }>; asks: Array<{ price: string }> }> };
    const ob = j.orderbooks?.[0];
    if (!ob || !ob.bids?.[0] || !ob.asks?.[0]) return null;
    const bid = Number(ob.bids[0].price);
    const ask = Number(ob.asks[0].price);
    if (!(bid > 0) || !(ask > 0) || ask < bid) return null;
    return { bid, ask, mid: (bid + ask) / 2 };
  } catch { return null; }
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

async function main(): Promise<void> {
  const net = getActiveNetwork();
  const provider = new ethers.JsonRpcProvider(net.rpc, { chainId: net.chainId, name: net.name });
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  const pool = getPool(net.name, POOL_SYMBOL);
  const baseTok = getToken(net.name, pool.base);
  const quoteTok = getToken(net.name, pool.quote);
  const c = new ethers.Contract(pool.poolAddress, SPOTPOOL_ABI, wallet) as SpotPoolContract;
  const baseErc = new ethers.Contract(baseTok.address, ERC20_ABI, wallet);
  const quoteErc = new ethers.Contract(quoteTok.address, ERC20_ABI, wallet);

  const params = await (c.getPoolParams as ethers.BaseContractMethod<[], unknown[], unknown[]>)();
  const tickRaw = params[4] as bigint;
  const minQtyRaw = params[5] as bigint; // getPoolParams tail = (tickSize, minQuantity, lotSize)
  const lotRaw = params[6] as bigint;
  const gasReserveRaw = ethers.parseUnits(GAS_RESERVE_SOMI, 18);

  const alignTick = (p: bigint): bigint => (p / tickRaw) * tickRaw;
  const alignLot = (q: bigint): bigint => (q / lotRaw) * lotRaw;
  const toRawPrice = (human: number): bigint => alignTick(ethers.parseUnits(human.toFixed(quoteTok.decimals), quoteTok.decimals));

  logger.info(
    { pool: POOL_SYMBOL, wallet: wallet.address, halfSpreadTicks: HALF_SPREAD_TICKS.toString(),
      tick: ethers.formatUnits(tickRaw, quoteTok.decimals), lot: ethers.formatUnits(lotRaw, baseTok.decimals),
      minQty: ethers.formatUnits(minQtyRaw, baseTok.decimals), useFrac: USE_FRAC, pollMs: POLL_MS },
    "mm-loop starting — two-sided PostOnly maker (PnL-weighted comp)",
  );

  // One-time max approvals so placeOrder auto-pull works for both legs.
  for (const [erc, tok, label] of [[quoteErc, quoteTok, "USDso"], [baseErc, baseTok, baseTok.symbol]] as const) {
    const allow: bigint = await (erc.allowance as ethers.BaseContractMethod<[string, string], bigint, bigint>)(wallet.address, pool.poolAddress);
    if (allow < ethers.MaxUint256 / 2n) {
      logger.info({ token: label }, "approving max to pool");
      const tx = await (erc.approve as ethers.BaseContractMethod<[string, bigint], boolean, ethers.ContractTransactionResponse>)(pool.poolAddress, ethers.MaxUint256);
      await tx.wait();
    }
  }

  const bal = async (): Promise<{ usdso: bigint; base: bigint; somi: bigint }> => ({
    usdso: await (quoteErc.balanceOf as ethers.BaseContractMethod<[string], bigint, bigint>)(wallet.address),
    base: await (baseErc.balanceOf as ethers.BaseContractMethod<[string], bigint, bigint>)(wallet.address),
    somi: await provider.getBalance(wallet.address),
  });

  const placeOrder = async (isBid: boolean, priceRaw: bigint, qtyRaw: bigint): Promise<bigint | null> => {
    const args: [boolean, bigint, bigint, bigint, bigint, number, number, string, bigint] = [
      isBid, 0n, priceRaw, qtyRaw, buildExpireNs(MS_PER_HOUR),
      ORDER_TYPE.PostOnly, SELF_MATCH.CancelTaker, ethers.ZeroAddress, 0n,
    ];
    try {
      const placeStatic = c.placeOrder as unknown as ethers.BaseContractMethod<typeof args, [boolean, bigint], [boolean, bigint]>;
      const [simOk] = await placeStatic.staticCall(...args, { value: 0n });
      if (!simOk) { logger.warn({ side: isBid ? "bid" : "ask", price: Number(ethers.formatUnits(priceRaw, quoteTok.decimals)) }, "PostOnly sim false (would cross?) — skip"); return null; }
      const tx = await (c.placeOrder as ethers.BaseContractMethod<typeof args, unknown, ethers.ContractTransactionResponse>)(...args, { value: 0n });
      const r = await tx.wait();
      let oid: bigint | null = null;
      for (const log of r!.logs) {
        if (log.topics[0] === ORDER_PLACED_TOPIC && log.topics[1]) { oid = BigInt(log.topics[1]); break; }
      }
      logger.info({ side: isBid ? "BID" : "ASK", price: Number(ethers.formatUnits(priceRaw, quoteTok.decimals)), qty: ethers.formatUnits(qtyRaw, baseTok.decimals), orderId: oid?.toString() ?? "filled/none", tx: tx.hash }, "maker order placed");
      return oid;
    } catch (err) {
      logger.error({ side: isBid ? "bid" : "ask", err: (err as Error).message.slice(0, 120) }, "placeOrder failed");
      return null;
    }
  };

  const cancel = async (oid: bigint): Promise<void> => {
    try {
      const tx = await (c.cancelOrder as ethers.BaseContractMethod<[bigint], unknown, ethers.ContractTransactionResponse>)(oid);
      await tx.wait();
    } catch (err) { logger.warn({ orderId: oid.toString(), err: (err as Error).message.slice(0, 80) }, "cancel failed (maybe filled/expired)"); }
  };

  let stopped = false;
  process.on("SIGINT", () => { stopped = true; });
  process.on("SIGTERM", () => { stopped = true; });

  let openBid: bigint | null = null;
  let openAsk: bigint | null = null;
  let lastQuoteMid = 0;
  let lastRequoteTs = 0;
  let lastQuoteBaseRaw = 0n; // base balance snapshot at last quote — a change ⇒ a fill happened

  // ---- Bootstrap inventory: need BOTH USDso (for bid) and base (for ask) to
  //      quote two-sided (one-sided book earns ZERO yield). If base-light, do
  //      one IOC taker buy to reach ~50/50.
  {
    const b = await bal();
    const book = await fetchBook(POOL_SYMBOL);
    if (book) {
      const baseHuman = Number(ethers.formatUnits(b.base, baseTok.decimals));
      const usdsoHuman = Number(ethers.formatUnits(b.usdso, quoteTok.decimals));
      const baseValue = baseHuman * book.mid;
      const total = baseValue + usdsoHuman;
      if (total > 0 && baseValue < 0.4 * total) {
        const targetBaseValue = 0.5 * total;
        const buyQtyHuman = (targetBaseValue - baseValue) / book.mid;
        const qtyRaw = alignLot(ethers.parseUnits(buyQtyHuman.toFixed(baseTok.decimals), baseTok.decimals));
        if (qtyRaw >= minQtyRaw) {
          const buyPx = toRawPrice(book.ask * 1.02); // aggressive IOC to fill
          logger.info({ buyQty: ethers.formatUnits(qtyRaw, baseTok.decimals), atAbout: book.ask }, "bootstrap: IOC taker buy to ~50/50 inventory");
          const args: [boolean, bigint, bigint, bigint, bigint, number, number, string, bigint] = [
            true, 0n, buyPx, qtyRaw, buildExpireNs(MS_PER_HOUR), ORDER_TYPE.ImmediateOrCancel, SELF_MATCH.CancelTaker, ethers.ZeroAddress, 0n,
          ];
          try { const tx = await (c.placeOrder as ethers.BaseContractMethod<typeof args, unknown, ethers.ContractTransactionResponse>)(...args, { value: 0n }); await tx.wait(); }
          catch (err) { logger.warn({ err: (err as Error).message.slice(0, 100) }, "bootstrap buy failed (continuing)"); }
        }
      }
    }
  }

  for (let cycle = 1; cycle <= MAX_CYCLES && !stopped; cycle += 1) {
    const b = await bal();
    if (b.somi < gasReserveRaw) {
      logger.error({ somi: ethers.formatUnits(b.somi, 18) }, `Gas SOMI critical (<${GAS_RESERVE_SOMI}) — cancelling + aborting, refuel needed`);
      break;
    }
    const book = await fetchBook(POOL_SYMBOL);
    if (!book) { logger.warn("no book (REST) — retry"); await sleep(POLL_MS); continue; }

    const nowSec = Math.floor(Date.now() / 1000);
    const driftBps = lastQuoteMid > 0 ? Math.abs(book.mid - lastQuoteMid) / lastQuoteMid * 1e4 : 1e9;
    const noOrders = openBid === null && openAsk === null;
    // Fill detection: base inventory moved ≥ half a lot since last quote ⇒ an
    // order filled → re-quote to restore a two-sided book (one-sided = 0 yield).
    const filled = !noOrders && (b.base > lastQuoteBaseRaw ? b.base - lastQuoteBaseRaw : lastQuoteBaseRaw - b.base) >= lotRaw / 2n;
    const forced = (nowSec - lastRequoteTs) >= FORCE_REQUOTE_SEC;
    const needRequote = driftBps >= REQUOTE_BPS || filled || forced || noOrders;

    if (!needRequote) {
      logger.info({ cycle, mid: book.mid, driftBps: Number(driftBps.toFixed(1)), restingBid: openBid?.toString(), restingAsk: openAsk?.toString() }, "♥ resting — accruing yield");
      await sleep(POLL_MS);
      continue;
    }

    // Re-quote: cancel existing, place fresh two-sided near mid.
    if (openBid !== null) { await cancel(openBid); openBid = null; }
    if (openAsk !== null) { await cancel(openAsk); openAsk = null; }

    // Prices: mid ± halfSpread ticks, kept strictly inside the touch so PostOnly rests.
    let bidPx = alignTick(toRawPrice(book.mid) - HALF_SPREAD_TICKS * tickRaw);
    let askPx = alignTick(toRawPrice(book.mid) + HALF_SPREAD_TICKS * tickRaw);
    const bestAskRaw = toRawPrice(book.ask);
    const bestBidRaw = toRawPrice(book.bid);
    if (bidPx >= bestAskRaw) bidPx = bestAskRaw - tickRaw;       // never cross the ask
    if (askPx <= bestBidRaw) askPx = bestBidRaw + tickRaw;       // never cross the bid

    // Re-read balances post-cancel (funds released back to wallet).
    const b2 = await bal();
    const bidPxHuman = Number(ethers.formatUnits(bidPx, quoteTok.decimals));
    const qtyBid = alignLot(ethers.parseUnits(((Number(ethers.formatUnits(b2.usdso, quoteTok.decimals)) * USE_FRAC) / bidPxHuman).toFixed(baseTok.decimals), baseTok.decimals));
    const qtyAsk = alignLot(ethers.parseUnits((Number(ethers.formatUnits(b2.base, baseTok.decimals)) * USE_FRAC).toFixed(baseTok.decimals), baseTok.decimals));

    // Inventory skew gate: baseFrac = base value / total portfolio value.
    // Too base-heavy → ASK only (sell down). Too USDso-heavy → BID only (buy up).
    // In the neutral band → quote BOTH (two-sided earns yield).
    const usdsoHuman2 = Number(ethers.formatUnits(b2.usdso, quoteTok.decimals));
    const baseHuman2 = Number(ethers.formatUnits(b2.base, baseTok.decimals));
    const baseValue2 = baseHuman2 * book.mid;
    const total2 = baseValue2 + usdsoHuman2;
    const baseFrac = total2 > 0 ? baseValue2 / total2 : 0.5;
    const allowBid = baseFrac < MAX_INV; // don't add base if already base-heavy
    const allowAsk = baseFrac > MIN_INV; // don't sell base if already base-light

    if (allowBid && qtyBid >= minQtyRaw) openBid = await placeOrder(true, bidPx, qtyBid);
    if (allowAsk && qtyAsk >= minQtyRaw) openAsk = await placeOrder(false, askPx, qtyAsk);
    lastQuoteMid = book.mid;
    lastRequoteTs = nowSec;
    lastQuoteBaseRaw = b2.base;

    logger.info(
      { cycle, mid: book.mid, bid: bidPxHuman, ask: Number(ethers.formatUnits(askPx, quoteTok.decimals)),
        qtyBid: ethers.formatUnits(qtyBid, baseTok.decimals), qtyAsk: ethers.formatUnits(qtyAsk, baseTok.decimals),
        usdso: Number(ethers.formatUnits(b2.usdso, quoteTok.decimals)).toFixed(2),
        base: Number(ethers.formatUnits(b2.base, baseTok.decimals)),
        reason: forced ? "forced" : filled ? "filled" : "drift",
        baseFrac: Number(baseFrac.toFixed(2)),
        sides: `${allowBid ? "BID" : "—"}/${allowAsk ? "ASK" : "—"}` },
      "re-quoted",
    );
    await sleep(POLL_MS);
  }

  // Cleanup
  if (openBid !== null) await cancel(openBid);
  if (openAsk !== null) await cancel(openAsk);
  logger.info("mm-loop finished — orders cancelled");
}

main().catch((err) => { logger.fatal({ err: err.message ?? err }); process.exit(1); });
