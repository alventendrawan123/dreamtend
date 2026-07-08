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
import fs from "node:fs";

// ============================================================================
//  make-take — single-process ALTERNATING maker + taker for a DreamDEX CLOB.
//
//  ONE loop alternates two phases so the maker and the taker NEVER compete for
//  funds and NEVER self-match:
//
//   MAKER phase: post a PostOnly BID + PostOnly ASK straddling mid, sleep the
//     maker-fill window so EXTERNAL takers can hit them, detect maker fills via
//     base-balance delta.
//   TAKE phase: cancel our own resting quotes FIRST (frees all funds + removes
//     our maker orders, so the IOC taker cannot self-match), then fire a few
//     IOC BUY->SELL round-trips against external liquidity (sim staticCall then
//     broadcast). Guarded by capital-floor + gas-reserve.
//
//  Book source: REST orderbooks?symbols=<sym>&depth=1 (same fetchBook shape as
//  mm-tuned.ts). PostOnly place() / IOC placeOrder() patterns copied verbatim
//  from mm-pullonmove.ts and ioc-loop.ts respectively.
//
//  Usage: NETWORK=mainnet npx tsx scripts/make-take.ts <pool> <halfSpreadTicks> \
//    <makerMs> <takerRounds> <takerQty> <capFloor> <gasReserve> <maxRunMs> \
//    [logPath] <takerBuyLimit> <takerSellLimit> <useFrac>
//  e.g. NETWORK=mainnet npx tsx scripts/make-take.ts WETH:USDso 5 20000 3 0.02 \
//    20 2 86400000 d:/tmp/make-take.jsonl 1650 1500 0.6
// ============================================================================

const POOL_SYMBOL = process.argv[2] ?? "WETH:USDso";
const HALF_SPREAD_TICKS = BigInt(process.argv[3] ?? "5");
const MAKER_MS = Number(process.argv[4] ?? "20000");
const TAKER_ROUNDS = Number(process.argv[5] ?? "3");
const TAKER_QTY = process.argv[6] ?? "0.02";
const CAP_FLOOR = Number(process.argv[7] ?? "20");
const GAS_RESERVE = process.argv[8] ?? "2";
const MAX_RUN_MS = Number(process.argv[9] ?? "86400000"); // 24h
const LOG = process.argv[10] ?? "d:/tmp/make-take.jsonl";
const TAKER_BUY_LIMIT = process.argv[11] ?? "1650"; // wide upper bound; fill happens at touch (ask)
const TAKER_SELL_LIMIT = process.argv[12] ?? "1500"; // wide lower bound; fill happens at touch (bid)
const USE_FRAC = Number(process.argv[13] ?? "0.6");
// SPREAD-GATE: fire taker rounds only when the live book spread is at/below this.
// Median spread ~2.04 bps, p10 ~0.62 — gating at ~1.2 halves the cost per
// round-trip (we only ever cross a tight book) at a modest throughput cost.
const SPREAD_GATE_BPS = Number(process.argv[14] ?? "1.2");

const ERC20 = [
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];
const ORDER_PLACED_TOPIC = "0xd90f62f61ee2f606b132cfdfd883ddd079228b6fd6bffd9d7cf848daf824639d";
const ORDER_FILLED_TOPIC = ethers.id("OrderFilled(uint128,uint128,uint256,uint256,uint256,uint256)");

const append = (o: unknown): void => fs.appendFileSync(LOG, JSON.stringify(o) + "\n");
// guard EVERY RPC/tx await so a stalled call can never freeze the loop
const withTimeout = <T>(pr: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([pr, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout:${label}`)), ms))]);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Book { bid: number; ask: number; mid: number }

// REST book — same shape/parse as mm-tuned.ts fetchBook()
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

interface Side { id: bigint; priceRaw: bigint }

async function main(): Promise<void> {
  const net = getActiveNetwork();
  const provider = new ethers.JsonRpcProvider(net.rpc, { chainId: net.chainId, name: net.name });
  // Somnia blocks are ~0.1s; ethers-v6 default 4s pollingInterval adds ~2s dead
  // time to EVERY tx.wait(). 200ms cuts confirm 2.65s -> ~0.8s (measured).
  provider.pollingInterval = 200;
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  const pool = getPool(net.name, POOL_SYMBOL);
  const baseTok = getToken(net.name, pool.base), quoteTok = getToken(net.name, pool.quote);
  const c = new ethers.Contract(pool.poolAddress, SPOTPOOL_ABI, wallet) as SpotPoolContract;
  const baseErc = new ethers.Contract(baseTok.address, ERC20, wallet);
  const quoteErc = new ethers.Contract(quoteTok.address, ERC20, wallet);

  const params = await (c.getPoolParams as ethers.BaseContractMethod<[], unknown[], unknown[]>)();
  const tickRaw = params[4] as bigint, minQtyRaw = params[5] as bigint, lotRaw = params[6] as bigint;
  const gasReserveRaw = ethers.parseUnits(GAS_RESERVE, 18);
  const takerQtyRaw = ethers.parseUnits(TAKER_QTY, baseTok.decimals);
  const takerBuyLimitRaw = ethers.parseUnits(TAKER_BUY_LIMIT, quoteTok.decimals);
  const takerSellLimitRaw = ethers.parseUnits(TAKER_SELL_LIMIT, quoteTok.decimals);
  const alignTick = (p: bigint): bigint => (p / tickRaw) * tickRaw;
  const alignLot = (q: bigint): bigint => (q / lotRaw) * lotRaw;
  const toRaw = (h: number): bigint => alignTick(ethers.parseUnits(h.toFixed(quoteTok.decimals), quoteTok.decimals));
  const lotHuman = Number(ethers.formatUnits(lotRaw, baseTok.decimals));

  // APPROVALS: approve USDso (quote) AND base (WETH) generously to the pool so
  // both maker-post and taker legs work (like ioc-loop approves both).
  for (const [erc, label] of [[quoteErc, quoteTok.symbol], [baseErc, baseTok.symbol]] as const) {
    const al: bigint = await (erc.allowance as ethers.BaseContractMethod<[string, string], bigint, bigint>)(wallet.address, pool.poolAddress);
    if (al < ethers.MaxUint256 / 2n) {
      logger.info({ token: label }, "Approving to pool (MaxUint256)");
      const tx = await (erc.approve as ethers.BaseContractMethod<[string, bigint], boolean, ethers.ContractTransactionResponse>)(pool.poolAddress, ethers.MaxUint256);
      await tx.wait();
    }
  }

  const bal = async (): Promise<{ usdso: number; base: number; somi: bigint }> => ({
    usdso: Number(ethers.formatUnits(await (quoteErc.balanceOf as ethers.BaseContractMethod<[string], bigint, bigint>)(wallet.address), quoteTok.decimals)),
    base: Number(ethers.formatUnits(await (baseErc.balanceOf as ethers.BaseContractMethod<[string], bigint, bigint>)(wallet.address), baseTok.decimals)),
    somi: await provider.getBalance(wallet.address),
  });

  let stopped = false;
  process.on("SIGINT", () => { stopped = true; logger.warn("SIGINT received — will stop after phase"); });
  process.on("SIGTERM", () => { stopped = true; logger.warn("SIGTERM received — will stop after phase"); });

  // --- maker order tracking (we cancel our own quotes by ID; getOwnOpenOrders is unreliable) ---
  let openBid: Side | null = null, openAsk: Side | null = null;

  const cancel = async (id: bigint): Promise<void> => {
    try {
      const tx = await withTimeout((c.cancelOrder as ethers.BaseContractMethod<[bigint], unknown, ethers.ContractTransactionResponse>)(id, { gasLimit: 3_000_000 }), 12000, "cancel-send");
      await withTimeout(tx.wait(), 15000, "cancel-wait");
    } catch { /* filled/expired/stalled — the order is gone or will be reconciled */ }
  };

  // PostOnly maker place — verbatim shape from mm-pullonmove place()
  const place = async (isBid: boolean, priceRaw: bigint, qtyRaw: bigint): Promise<Side | null> => {
    const args: [boolean, bigint, bigint, bigint, bigint, number, number, string, bigint] = [isBid, 0n, priceRaw, qtyRaw, buildExpireNs(MS_PER_HOUR), ORDER_TYPE.PostOnly, SELF_MATCH.CancelTaker, ethers.ZeroAddress, 0n];
    try {
      const ps = c.placeOrder as unknown as ethers.BaseContractMethod<typeof args, [boolean, bigint], [boolean, bigint]>;
      const [ok] = await withTimeout(ps.staticCall(...args, { value: 0n }), 10000, "place-sim");
      if (!ok) return null;
      const tx = await withTimeout((c.placeOrder as ethers.BaseContractMethod<typeof args, unknown, ethers.ContractTransactionResponse>)(...args, { value: 0n, gasLimit: 3_000_000 }), 12000, "place-send");
      const r = await withTimeout(tx.wait(), 15000, "place-wait");
      let id: bigint | null = null;
      for (const lg of r!.logs) if (lg.topics[0] === ORDER_PLACED_TOPIC && lg.topics[1]) { id = BigInt(lg.topics[1]); break; }
      return id !== null ? { id, priceRaw } : null;
    } catch (e) { append({ t: "place_err", ts: Date.now(), isBid, err: String((e as Error).message).slice(0, 90) }); return null; }
  };

  // IOC taker leg — sim staticCall then broadcast, OrderFilled parse (from ioc-loop)
  // returns { filledBase, volumeQuote, filledQtyRaw } — filledQtyRaw is the exact
  // on-chain bigint so the paired SELL can reuse it without float rounding
  const takerLeg = async (isBid: boolean, priceRaw: bigint, qtyRaw: bigint): Promise<{ filledBase: number; volumeQuote: number; filledQtyRaw: bigint } | null> => {
    const args: [boolean, bigint, bigint, bigint, bigint, number, number, string, bigint] = [isBid, 0n, priceRaw, qtyRaw, buildExpireNs(MS_PER_HOUR), ORDER_TYPE.ImmediateOrCancel, SELF_MATCH.CancelTaker, ethers.ZeroAddress, 0n];
    try {
      const [simOk] = await withTimeout(c.placeOrder.staticCall(...args, { value: 0n }), 15000, "taker-sim");
      if (!simOk) return { filledBase: 0, volumeQuote: 0, filledQtyRaw: 0n }; // no external liquidity to cross
      const tx = await withTimeout(c.placeOrder(...args, { value: 0n, gasLimit: 3_000_000 }), 30000, "taker-broadcast");
      const receipt = await withTimeout(tx.wait(), 60000, "taker-wait");
      if (!receipt) return null;
      let filledQty = 0n, volRaw = 0n;
      for (const log of receipt.logs) {
        if (log.topics[0] === ORDER_FILLED_TOPIC) {
          const dataHex = log.data.replace(/^0x/, "");
          // both uint128 orderIds are INDEXED (topics), so data has 4 uint256 words:
          // [0]=quantityFilled [1]=takerRemaining [2]=makerRemaining [3]=fillPrice
          const qtyFilled = BigInt("0x" + dataHex.slice(0, 64));
          const fillPrice = BigInt("0x" + dataHex.slice(3 * 64, 4 * 64));
          filledQty += qtyFilled;
          volRaw += (qtyFilled * fillPrice) / 10n ** BigInt(baseTok.decimals);
        }
      }
      return {
        filledBase: Number(ethers.formatUnits(filledQty, baseTok.decimals)),
        volumeQuote: Number(ethers.formatUnits(volRaw, quoteTok.decimals)),
        filledQtyRaw: filledQty,
      };
    } catch (e) { append({ t: "taker_err", ts: Date.now(), isBid, err: String((e as Error).message).slice(0, 90) }); return null; }
  };

  append({ t: "start", ts: Date.now(), pool: POOL_SYMBOL, halfSpreadTicks: HALF_SPREAD_TICKS.toString(), makerMs: MAKER_MS, takerRounds: TAKER_ROUNDS, takerQty: TAKER_QTY, capFloor: CAP_FLOOR, gasReserve: GAS_RESERVE, maxRunMs: MAX_RUN_MS, takerBuyLimit: TAKER_BUY_LIMIT, takerSellLimit: TAKER_SELL_LIMIT, useFrac: USE_FRAC, spreadGateBps: SPREAD_GATE_BPS });
  logger.info({ pool: POOL_SYMBOL, makerMs: MAKER_MS, takerRounds: TAKER_ROUNDS }, "make-take started (alternating maker/taker)");

  const t0 = Date.now();
  let makerVol = 0, takerVol = 0, cycles = 0, makerFills = 0, takerFills = 0;
  let netBase = 0; // DRIFT GUARD: cumulative taker base position (buys +, sells -); must stay ~0
  let lastBase = (await bal()).base;
  let lastHeartbeat = Date.now();

  const heartbeat = (): void => {
    if (Date.now() - lastHeartbeat > 60000) {
      append({ t: "hb", ts: Date.now(), cycles, makerVol: Number(makerVol.toFixed(4)), takerVol: Number(takerVol.toFixed(4)), makerFills, takerFills, netBase: Number(netBase.toFixed(6)) });
      lastHeartbeat = Date.now();
    }
  };

  while (!stopped && Date.now() - t0 < MAX_RUN_MS) {
    cycles += 1;

    // ==================== MAKER PHASE ====================
    try {
      const book = await fetchBook(POOL_SYMBOL);
      const b = await withTimeout(bal(), 12000, "bal-maker");
      lastBase = b.base; // re-baseline before we open the fill window
      if (book && book.mid > 0) {
        // BID at mid - HALF_SPREAD_TICKS*tick ; ASK at mid + HALF_SPREAD_TICKS*tick
        const bidPx = alignTick(toRaw(book.mid) - HALF_SPREAD_TICKS * tickRaw);
        const askPx = alignTick(toRaw(book.mid) + HALF_SPREAD_TICKS * tickRaw);
        const bidPxHuman = Number(ethers.formatUnits(bidPx, quoteTok.decimals));
        // sizing formula copied from mm-pullonmove: bid qty from free USDso / price, ask qty from free base
        const bidQty = alignLot(ethers.parseUnits(((b.usdso * USE_FRAC) / bidPxHuman).toFixed(baseTok.decimals), baseTok.decimals));
        const askQty = alignLot(ethers.parseUnits((b.base * USE_FRAC).toFixed(baseTok.decimals), baseTok.decimals));
        // never cross the resting book (PostOnly would reject) — guard against ask/bid
        if (bidQty >= minQtyRaw && bidPx > 0n && bidPx < toRaw(book.ask)) {
          openBid = await place(true, bidPx, bidQty);
          if (openBid) append({ t: "post", ts: Date.now(), side: "bid", price: bidPxHuman, qty: Number(ethers.formatUnits(bidQty, baseTok.decimals)), mid: book.mid });
        }
        if (askQty >= minQtyRaw && askPx > toRaw(book.bid)) {
          openAsk = await place(false, askPx, askQty);
          if (openAsk) append({ t: "post", ts: Date.now(), side: "ask", price: Number(ethers.formatUnits(askPx, quoteTok.decimals)), qty: Number(ethers.formatUnits(askQty, baseTok.decimals)), mid: book.mid });
        }
      } else {
        append({ t: "maker_skip", ts: Date.now(), reason: "no_book" });
      }

      // maker-fill window: let EXTERNAL takers hit our resting quotes
      await sleep(MAKER_MS);

      // detect maker fills via base-balance delta (like mm-pullonmove)
      const after = await withTimeout(bal(), 12000, "bal-maker-after");
      const delta = after.base - lastBase;
      if (Math.abs(delta) >= lotHuman / 2) {
        makerFills += 1;
        const bookNow = await fetchBook(POOL_SYMBOL);
        const px = bookNow?.mid ?? 0;
        const vol = Math.abs(delta) * px;
        makerVol += vol;
        append({ t: "maker_fill", ts: Date.now(), baseDelta: Number(delta.toFixed(6)), side: delta > 0 ? "bought" : "sold", price: px, vol: Number(vol.toFixed(4)) });
      }
      lastBase = after.base;
    } catch (e) { append({ t: "maker_err", ts: Date.now(), err: String((e as Error).message).slice(0, 80) }); }

    heartbeat();
    if (stopped || Date.now() - t0 >= MAX_RUN_MS) break;

    // ==================== TAKE PHASE ====================
    // Cancel our own resting quotes FIRST: frees ALL funds + removes our quotes
    // so the IOC taker below cannot self-match.
    if (openBid) { await cancel(openBid.id); openBid = null; }
    if (openAsk) { await cancel(openAsk.id); openAsk = null; }

    try {
      const book = await fetchBook(POOL_SYMBOL);
      const b = await withTimeout(bal(), 12000, "bal-take");
      const mid = book?.mid ?? 0;
      const totalCap = b.usdso + b.base * mid;

      // GUARDS: protect capital + gas
      if (mid <= 0) {
        append({ t: "take_skip", ts: Date.now(), reason: "no_book" });
      } else if (totalCap < CAP_FLOOR) {
        append({ t: "take_skip", ts: Date.now(), reason: "cap_floor", totalCap: Number(totalCap.toFixed(2)), floor: CAP_FLOOR });
      } else if (b.somi < gasReserveRaw) {
        append({ t: "take_skip", ts: Date.now(), reason: "gas_reserve", somi: ethers.formatUnits(b.somi, 18), reserve: GAS_RESERVE });
        stopped = true; // out of gas — nothing productive left to do
      } else {
        // INVENTORY AUTO-REBALANCE: in a trend the maker BID fills faster than the
        // ask (drift-kill only pairs the TAKER legs), so USDso slowly converts to
        // base and the taker starves. When USDso runs dry, sell surplus base back
        // via IOC — restores buy ammo, and the sell itself counts as raw volume.
        // NOT added to netBase: it corrects maker-side drift, not taker pairing.
        if (b.usdso < 15 && b.base * mid > 25) {
          const sellW = Math.min((30 - b.usdso) / mid, b.base * 0.8);
          const rebalRaw = alignLot(ethers.parseUnits(sellW.toFixed(baseTok.decimals), baseTok.decimals));
          if (rebalRaw >= minQtyRaw) {
            const res = await takerLeg(false, takerSellLimitRaw, rebalRaw);
            if (res && res.filledBase > 0) {
              takerFills += 1; takerVol += res.volumeQuote;
              append({ t: "rebal_sell", ts: Date.now(), qty: Number(res.filledBase.toFixed(6)), vol: Number(res.volumeQuote.toFixed(4)), usdsoBefore: Number(b.usdso.toFixed(2)) });
            }
          }
        }
        for (let round = 0; round < TAKER_ROUNDS && !stopped; round += 1) {
          // SPREAD-GATE: only cross a tight book — halves cost per round-trip.
          // Cheap check (one REST fetch) before any balance polls.
          const bkNow = await fetchBook(POOL_SYMBOL);
          if (!bkNow) { append({ t: "take_skip", ts: Date.now(), reason: "no_book_round", round }); continue; }
          const spreadBps = ((bkNow.ask - bkNow.bid) / bkNow.mid) * 10000;
          if (spreadBps > SPREAD_GATE_BPS) {
            append({ t: "take_skip", ts: Date.now(), reason: "spread_gate", spreadBps: Number(spreadBps.toFixed(2)), round });
            continue;
          }
          // refresh free balances each leg (each fill moves funds)
          const bb = await withTimeout(bal(), 12000, "bal-round");

          // IOC BUY (isBid=true, limit ABOVE ask to cross).
          // DYNAMIC QTY: size the buy to what free USDso can actually fund right now
          // (capped at TAKER_QTY). A smaller round-trip beats a skipped one — this
          // permanently kills the buy_insufficient_usdso starvation that appeared
          // whenever the maker bid locked most of the USDso pool.
          const affordable = (bb.usdso * 0.9) / Number(TAKER_BUY_LIMIT);
          const buyQtyH = Math.min(Number(TAKER_QTY), affordable);
          const buyQtyRaw = alignLot(ethers.parseUnits(buyQtyH.toFixed(baseTok.decimals), baseTok.decimals));
          let boughtBase = 0; // how much base this round's BUY actually filled
          let boughtRaw = 0n; // exact on-chain fill qty — reused as the SELL qty (no float rounding)
          if (buyQtyRaw >= minQtyRaw) {
            const res = await takerLeg(true, takerBuyLimitRaw, buyQtyRaw);
            if (res && res.filledBase > 0) {
              boughtBase = res.filledBase;
              boughtRaw = res.filledQtyRaw;
              takerFills += 1; takerVol += res.volumeQuote; netBase += res.filledBase;
              append({ t: "taker_fill", ts: Date.now(), side: "buy", qty: Number(res.filledBase.toFixed(6)), price: res.volumeQuote / res.filledBase, vol: Number(res.volumeQuote.toFixed(4)), round, netBase: Number(netBase.toFixed(6)) });
            }
          } else {
            // even the dynamic qty fell below minQty — truly no USDso to work with
            append({ t: "take_skip", ts: Date.now(), reason: "buy_insufficient_usdso", usdso: Number(bb.usdso.toFixed(2)), minQty: Number(ethers.formatUnits(minQtyRaw, baseTok.decimals)), round });
          }

          if (stopped) break;

          // DRIFT-KILL: SELL only what this round's BUY actually bought, so buys==sells
          // and no net directional (short) position ever accrues. If the BUY was
          // skipped or 0-filled, SKIP the sell entirely (this is what fixes the -8 bps
          // drift: the old code sold on a bare base-balance check even when the buy
          // was skipped, forcing an accidental net-short into the trend).
          if (boughtBase <= 0) {
            append({ t: "take_skip", ts: Date.now(), reason: "skip_sell_unbalanced", round });
            continue;
          }
          // FLOAT-LEAK FIX: reuse the buy's exact on-chain fill qty. The old path
          // (boughtBase.toFixed(18) -> parseUnits -> alignLot) floored 0.015 to
          // 0.0149 (float renders 0.014999...), leaking +0.0001 WETH per round and
          // draining ~$0.16 USDso/round, which re-starved the buy leg.
          const sellQtyRaw = alignLot(boughtRaw);
          if (sellQtyRaw < minQtyRaw) {
            append({ t: "take_skip", ts: Date.now(), reason: "sell_below_min", boughtBase: Number(boughtBase.toFixed(6)), round });
            continue;
          }
          const needBase = Number(ethers.formatUnits(sellQtyRaw, baseTok.decimals));
          const bs = await withTimeout(bal(), 12000, "bal-sell");
          if (bs.base >= needBase) {
            const res = await takerLeg(false, takerSellLimitRaw, sellQtyRaw);
            if (res && res.filledBase > 0) {
              takerFills += 1; takerVol += res.volumeQuote; netBase -= res.filledBase;
              append({ t: "taker_fill", ts: Date.now(), side: "sell", qty: Number(res.filledBase.toFixed(6)), price: res.volumeQuote / res.filledBase, vol: Number(res.volumeQuote.toFixed(4)), round, netBase: Number(netBase.toFixed(6)) });
            }
          } else {
            append({ t: "take_skip", ts: Date.now(), reason: "sell_insufficient_base", base: Number(bs.base.toFixed(6)), need: Number(needBase.toFixed(6)), round });
          }
        }
      }
    } catch (e) { append({ t: "take_err", ts: Date.now(), err: String((e as Error).message).slice(0, 80) }); }

    heartbeat();
    // re-baseline maker fill detector after taker phase moved balances
    try { lastBase = (await withTimeout(bal(), 12000, "bal-rebase")).base; } catch { /* keep prior */ }
  }

  // cleanup: cancel any resting quotes we left open
  if (openBid) await cancel(openBid.id);
  if (openAsk) await cancel(openAsk.id);
  append({ t: "stop", ts: Date.now(), cycles, makerVol: Number(makerVol.toFixed(4)), takerVol: Number(takerVol.toFixed(4)), makerFills, takerFills });
  logger.info({ cycles, makerVol, takerVol, makerFills, takerFills }, "make-take finished — orders cancelled");
}

main().catch((e) => { append({ t: "fatal", ts: Date.now(), err: String((e as Error).message ?? e) }); logger.fatal({ e: (e as Error).message ?? e }); process.exit(1); });
