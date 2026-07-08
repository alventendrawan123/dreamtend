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
//  mm-tuned — adverse-selection-aware maker. Tries to push the plain mm-loop's
//  ~1.64 bps/volume bleed toward true break-even, via THREE levers:
//
//   1. SLOW RE-QUOTE + DEBOUNCE — raise the drift threshold and enforce a
//      minimum seconds-between-requotes. Plain mm-loop churned 381 tx / 90min
//      chasing a $0.166 mid wiggle; each cancel-replace pays adverse to reprice
//      into the move. Letting a resting order SIT catches uninformed flow.
//
//   2. CONTINUOUS INVENTORY SKEW — instead of a hard one-side gate at the cap,
//      shift the quote CENTER toward the side that rebalances us:
//        base-heavy (baseFrac>0.5) → center DOWN  (ask cheaper → sell faster,
//                                                   bid further → buy less)
//        base-light (baseFrac<0.5) → center UP    (bid richer → buy faster)
//      Keeps inventory near 50/50 → less directional adverse, WITHOUT becoming
//      a price bet. (Hard caps kept as an extreme backstop only.)
//
//   3. CALM-MARKET WIDEN — track recent mid range; when the market is moving
//      fast (informed flow likely) WIDEN the spread (or it implicitly skips, as
//      a wider PostOnly rests further from touch and is hit less). Quote tight
//      only when flat, where capture > adverse.
//
//  Usage:
//    NETWORK=mainnet npx tsx scripts/mm-tuned.ts <pool> <halfSpreadTicks> \
//      <pollMs> <maxCycles> <gasReserveSomi> <useFrac> <requoteBps> \
//      <forceRequoteSec> <skewTicks> <volThreshTicks> <widenFactor> <minRequoteSec>
//    e.g. NETWORK=mainnet npx tsx scripts/mm-tuned.ts WETH:USDso 10 12000 600 2 0.6 4 600 8 20 2 30
// ============================================================================

const POOL_SYMBOL = process.argv[2] ?? "WETH:USDso";
const HALF_SPREAD_TICKS = BigInt(process.argv[3] ?? "10");
const POLL_MS = Number(process.argv[4] ?? "12000");
const MAX_CYCLES = Number(process.argv[5] ?? "600");
const GAS_RESERVE_SOMI = process.argv[6] ?? "2";
const USE_FRAC = Number(process.argv[7] ?? "0.6");
const REQUOTE_BPS = Number(process.argv[8] ?? "4");          // raise vs mm-loop's 1 → slower
const FORCE_REQUOTE_SEC = Number(process.argv[9] ?? "600");
const SKEW_TICKS = Number(process.argv[10] ?? "8");          // max center shift (ticks) at full skew
const VOL_THRESH_TICKS = Number(process.argv[11] ?? "20");   // mid range over lookback > this ⇒ "hot"
const WIDEN_FACTOR = Number(process.argv[12] ?? "2");        // hot ⇒ halfSpread × this
const MIN_REQUOTE_SEC = Number(process.argv[13] ?? "30");    // debounce: never re-quote more often than this
// Extreme-skew backstop only (continuous skew does the main work).
const MIN_INV = Number(process.argv[14] ?? "0.2");
const MAX_INV = Number(process.argv[15] ?? "0.8");
const VOL_LOOKBACK = 5;                                       // samples kept for the volatility window

const ORDER_PLACED_TOPIC = "0xd90f62f61ee2f606b132cfdfd883ddd079228b6fd6bffd9d7cf848daf824639d";

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
  const tickHuman = Number(ethers.formatUnits(tickRaw, quoteTok.decimals));

  const alignTick = (p: bigint): bigint => (p / tickRaw) * tickRaw;
  const alignLot = (q: bigint): bigint => (q / lotRaw) * lotRaw;
  const toRawPrice = (human: number): bigint => alignTick(ethers.parseUnits(human.toFixed(quoteTok.decimals), quoteTok.decimals));

  logger.info(
    { pool: POOL_SYMBOL, wallet: wallet.address, halfSpreadTicks: HALF_SPREAD_TICKS.toString(),
      tick: tickHuman, useFrac: USE_FRAC, requoteBps: REQUOTE_BPS, skewTicks: SKEW_TICKS,
      volThreshTicks: VOL_THRESH_TICKS, widenFactor: WIDEN_FACTOR, minRequoteSec: MIN_REQUOTE_SEC },
    "mm-tuned starting — adverse-aware maker (slow re-quote + inventory skew + calm-gate)",
  );

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
      const placeOrderStatic = c.placeOrder as unknown as ethers.BaseContractMethod<typeof args, [boolean, bigint], [boolean, bigint]>;
      const [simOk] = await placeOrderStatic.staticCall(...args, { value: 0n });
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
  let lastQuoteBaseRaw = 0n;
  const midHist: number[] = [];

  // ---- Bootstrap inventory to ~50/50 so we can quote two-sided immediately.
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
          const buyPx = toRawPrice(book.ask * 1.02);
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

    // Volatility window: keep last VOL_LOOKBACK mids, range in ticks ⇒ "hot".
    midHist.push(book.mid);
    if (midHist.length > VOL_LOOKBACK) midHist.shift();
    const volRangeTicks = midHist.length >= 2 ? (Math.max(...midHist) - Math.min(...midHist)) / tickHuman : 0;
    const hot = volRangeTicks > VOL_THRESH_TICKS;

    const nowSec = Math.floor(Date.now() / 1000);
    const driftBps = lastQuoteMid > 0 ? Math.abs(book.mid - lastQuoteMid) / lastQuoteMid * 1e4 : 1e9;
    const noOrders = openBid === null && openAsk === null;
    const filled = !noOrders && (b.base > lastQuoteBaseRaw ? b.base - lastQuoteBaseRaw : lastQuoteBaseRaw - b.base) >= lotRaw / 2n;
    const forced = (nowSec - lastRequoteTs) >= FORCE_REQUOTE_SEC;
    const debounced = (nowSec - lastRequoteTs) < MIN_REQUOTE_SEC;
    // Debounce: a drift/fill re-quote is suppressed if we re-quoted < MIN_REQUOTE_SEC ago,
    // UNLESS we have no orders resting (must restore a book) or it's a forced refresh.
    const wantRequote = driftBps >= REQUOTE_BPS || filled || forced || noOrders;
    const needRequote = noOrders || forced || (wantRequote && !debounced);

    if (!needRequote) {
      logger.info({ cycle, mid: book.mid, driftBps: Number(driftBps.toFixed(1)), volRangeTicks: Number(volRangeTicks.toFixed(1)), hot, restingBid: openBid?.toString(), restingAsk: openAsk?.toString() }, "♥ resting");
      await sleep(POLL_MS);
      continue;
    }

    if (openBid !== null) { await cancel(openBid); openBid = null; }
    if (openAsk !== null) { await cancel(openAsk); openAsk = null; }

    // Re-read balances post-cancel (funds released).
    const b2 = await bal();
    const usdsoHuman2 = Number(ethers.formatUnits(b2.usdso, quoteTok.decimals));
    const baseHuman2 = Number(ethers.formatUnits(b2.base, baseTok.decimals));
    const baseValue2 = baseHuman2 * book.mid;
    const total2 = baseValue2 + usdsoHuman2;
    const baseFrac = total2 > 0 ? baseValue2 / total2 : 0.5;

    // --- Continuous inventory skew: shift the quote CENTER toward rebalancing.
    //  base-heavy (frac>0.5) ⇒ negative shift (center down → sell faster).
    //  base-light (frac<0.5) ⇒ positive shift (center up → buy faster).
    const skewRaw = -(baseFrac - 0.5) * 2 * SKEW_TICKS;               // ±SKEW_TICKS at frac 1/0
    const skewShiftTicks = Math.max(-SKEW_TICKS, Math.min(SKEW_TICKS, Math.round(skewRaw)));
    const centerHuman = book.mid + skewShiftTicks * tickHuman;

    // --- Calm-market widen: hot market ⇒ rest further from touch (less adverse).
    const effHalf = hot ? HALF_SPREAD_TICKS * BigInt(WIDEN_FACTOR) : HALF_SPREAD_TICKS;

    let bidPx = alignTick(toRawPrice(centerHuman) - effHalf * tickRaw);
    let askPx = alignTick(toRawPrice(centerHuman) + effHalf * tickRaw);
    const bestAskRaw = toRawPrice(book.ask);
    const bestBidRaw = toRawPrice(book.bid);
    if (bidPx >= bestAskRaw) bidPx = bestAskRaw - tickRaw;   // never cross
    if (askPx <= bestBidRaw) askPx = bestBidRaw + tickRaw;

    const bidPxHuman = Number(ethers.formatUnits(bidPx, quoteTok.decimals));
    const qtyBid = alignLot(ethers.parseUnits(((usdsoHuman2 * USE_FRAC) / bidPxHuman).toFixed(baseTok.decimals), baseTok.decimals));
    const qtyAsk = alignLot(ethers.parseUnits((baseHuman2 * USE_FRAC).toFixed(baseTok.decimals), baseTok.decimals));

    // Extreme backstop: continuous skew handles normal drift; hard one-side only past wide caps.
    const allowBid = baseFrac < MAX_INV;
    const allowAsk = baseFrac > MIN_INV;

    if (allowBid && qtyBid >= minQtyRaw) openBid = await placeOrder(true, bidPx, qtyBid);
    if (allowAsk && qtyAsk >= minQtyRaw) openAsk = await placeOrder(false, askPx, qtyAsk);
    lastQuoteMid = book.mid;
    lastRequoteTs = nowSec;
    lastQuoteBaseRaw = b2.base;

    logger.info(
      { cycle, mid: book.mid, center: Number(centerHuman.toFixed(2)), skewTicks: skewShiftTicks,
        bid: bidPxHuman, ask: Number(ethers.formatUnits(askPx, quoteTok.decimals)),
        effHalf: effHalf.toString(), hot, volRangeTicks: Number(volRangeTicks.toFixed(1)),
        baseFrac: Number(baseFrac.toFixed(2)),
        reason: forced ? "forced" : filled ? "filled" : noOrders ? "noOrders" : "drift",
        sides: `${allowBid ? "BID" : "—"}/${allowAsk ? "ASK" : "—"}` },
      "re-quoted",
    );
    await sleep(POLL_MS);
  }

  if (openBid !== null) await cancel(openBid);
  if (openAsk !== null) await cancel(openAsk);
  logger.info("mm-tuned finished — orders cancelled");
}

main().catch((err) => { logger.fatal({ err: err.message ?? err }); process.exit(1); });
