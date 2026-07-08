import "dotenv/config";
import { ethers } from "ethers";
import { getActiveNetwork } from "../src/config/network.js";
import { getPool } from "../src/config/pairs.js";
import { getToken } from "../src/config/tokens.js";
import { SPOTPOOL_ABI } from "../src/dex/abi/spotpool.js";
import type { SpotPoolContract } from "../src/dex/abi/types.js";
import { DreamDexWsClient } from "../src/dex/websocket.js";
import { buildExpireNs } from "../src/utils/gotchas.js";
import { ORDER_TYPE, SELF_MATCH, MS_PER_HOUR } from "../src/config/constants.js";
import { logger } from "../src/utils/logger.js";
import fs from "node:fs";

// ============================================================================
//  mm-pullonmove — WS-driven adverse-selection-AVOIDANCE maker (pull-on-move).
//
//  Event-driven on the WS orderbook (~100ms detection vs 12s REST). On each
//  mid move it PULLS the exposed side BEFORE it gets adversely filled, and keeps
//  the favorable side. Asymmetric: mid UP → cancel ASK (we'd sell too cheap),
//  keep BID (a fill there = we bought cheap = favorable). mid DOWN → mirror.
//  Re-posts a side only when the mid is calm. Goal: only let FAVORABLE fills
//  through. Honest limit: our cancel lands ~600ms after the move, so it beats
//  SLOW takers but not co-located arbs — test settles how much it helps.
//
//  Usage: NETWORK=mainnet npx tsx scripts/mm-pullonmove.ts <pool> <halfSpreadTicks> \
//      <pullTicks> <repostCalmMs> <useFrac> <maxRunMs> <gasReserveSomi> <MIN_INV> <MAX_INV> [logPath]
//  e.g. NETWORK=mainnet npx tsx scripts/mm-pullonmove.ts WETH:USDso 10 4 2500 0.5 5400000 2 0.3 0.7
// ============================================================================

const POOL_SYMBOL = process.argv[2] ?? "WETH:USDso";
const HALF_SPREAD = BigInt(process.argv[3] ?? "10");
const PULL_TICKS = Number(process.argv[4] ?? "4");
const REPOST_CALM_MS = Number(process.argv[5] ?? "2500");
const USE_FRAC = Number(process.argv[6] ?? "0.5");
const MAX_RUN_MS = Number(process.argv[7] ?? "5400000"); // 90 min
const GAS_RESERVE = process.argv[8] ?? "2";
const MIN_INV = Number(process.argv[9] ?? "0.3");
const MAX_INV = Number(process.argv[10] ?? "0.7");
const LOG = process.argv[11] ?? "d:/tmp/pullonmove.jsonl";
const FORCE_REQUOTE_MS = Number(process.argv[12] ?? "60000"); // anti-stuck: re-center resting quotes if idle this long (also = anti-DQ heartbeat)
const RESERVE_BASE = Number(process.argv[13] ?? "0"); // base (WETH) the maker must NEVER sell — a protected HOLD sleeve; only base above this is tradeable

const ERC20 = ["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)", "function balanceOf(address) view returns (uint256)"];
const ORDER_PLACED_TOPIC = "0xd90f62f61ee2f606b132cfdfd883ddd079228b6fd6bffd9d7cf848daf824639d";
const append = (o: unknown): void => fs.appendFileSync(LOG, JSON.stringify(o) + "\n");
// guard EVERY RPC/tx await so a stalled call can never freeze the loop (the hang bug)
const withTimeout = <T>(pr: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([pr, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout:${label}`)), ms))]);

interface Side { id: bigint; priceRaw: bigint; refMid: number; ts: number } // refMid/ts = mid/time when posted

async function main(): Promise<void> {
  const net = getActiveNetwork();
  const provider = new ethers.JsonRpcProvider(net.rpc, { chainId: net.chainId, name: net.name });
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  const pool = getPool(net.name, POOL_SYMBOL);
  const baseTok = getToken(net.name, pool.base), quoteTok = getToken(net.name, pool.quote);
  const c = new ethers.Contract(pool.poolAddress, SPOTPOOL_ABI, wallet) as SpotPoolContract;
  const baseErc = new ethers.Contract(baseTok.address, ERC20, wallet), quoteErc = new ethers.Contract(quoteTok.address, ERC20, wallet);
  const params = await (c.getPoolParams as ethers.BaseContractMethod<[], unknown[], unknown[]>)();
  const tickRaw = params[4] as bigint, minQtyRaw = params[5] as bigint, lotRaw = params[6] as bigint;
  const tickHuman = Number(ethers.formatUnits(tickRaw, quoteTok.decimals));
  const gasReserveRaw = ethers.parseUnits(GAS_RESERVE, 18);
  const alignTick = (p: bigint): bigint => (p / tickRaw) * tickRaw;
  const alignLot = (q: bigint): bigint => (q / lotRaw) * lotRaw;
  const toRaw = (h: number): bigint => alignTick(ethers.parseUnits(h.toFixed(quoteTok.decimals), quoteTok.decimals));

  for (const [erc, label] of [[quoteErc, "USDso"], [baseErc, baseTok.symbol]] as const) {
    const al: bigint = await (erc.allowance as ethers.BaseContractMethod<[string, string], bigint, bigint>)(wallet.address, pool.poolAddress);
    if (al < ethers.MaxUint256 / 2n) { const tx = await (erc.approve as ethers.BaseContractMethod<[string, bigint], boolean, ethers.ContractTransactionResponse>)(pool.poolAddress, ethers.MaxUint256); await tx.wait(); }
  }
  const bal = async (): Promise<{ usdso: number; base: number; somi: bigint }> => ({
    usdso: Number(ethers.formatUnits(await (quoteErc.balanceOf as ethers.BaseContractMethod<[string], bigint, bigint>)(wallet.address), quoteTok.decimals)),
    base: Number(ethers.formatUnits(await (baseErc.balanceOf as ethers.BaseContractMethod<[string], bigint, bigint>)(wallet.address), baseTok.decimals)),
    somi: await provider.getBalance(wallet.address),
  });

  // --- live book from WS ---
  const bids = new Map<number, number>(), asks = new Map<number, number>();
  let bestBid = 0, bestAsk = 0, mid = 0, lastBookTs = 0;
  const recompute = (): void => {
    let bb = 0, ba = Infinity;
    for (const [p, q] of bids) if (q > 0 && p > bb) bb = p;
    for (const [p, q] of asks) if (q > 0 && p < ba) ba = p;
    if (bb > 0 && ba < Infinity && ba >= bb) { bestBid = bb; bestAsk = ba; mid = (bb + ba) / 2; lastBookTs = Date.now(); }
  };
  const applyLevels = (arr: unknown, m: Map<number, number>, replace: boolean): void => {
    if (replace) m.clear();
    if (!Array.isArray(arr)) return;
    for (const lv of arr as Array<{ price?: string; quantity?: string }>) {
      const p = Number(lv.price), q = Number(lv.quantity);
      if (!(p > 0)) continue;
      if (q > 0) m.set(p, q); else m.delete(p);
    }
  };

  let stopped = false;
  const ws = new DreamDexWsClient();
  let openBid: Side | null = null, openAsk: Side | null = null;
  let lastMoveTs = Date.now();
  let pulls = 0, reposts = 0, fills = 0;
  let lastBase = (await bal()).base;

  // tx helpers (sequential await — broadcast is immediate; await only blocks on receipt)
  const cancel = async (id: bigint): Promise<void> => { try { const tx = await withTimeout((c.cancelOrder as ethers.BaseContractMethod<[bigint], unknown, ethers.ContractTransactionResponse>)(id), 12000, "cancel-send"); await withTimeout(tx.wait(), 15000, "cancel-wait"); } catch { /* filled/expired/stalled */ } };
  const place = async (isBid: boolean, priceRaw: bigint, qtyRaw: bigint): Promise<Side | null> => {
    const args: [boolean, bigint, bigint, bigint, bigint, number, number, string, bigint] = [isBid, 0n, priceRaw, qtyRaw, buildExpireNs(MS_PER_HOUR), ORDER_TYPE.PostOnly, SELF_MATCH.CancelTaker, ethers.ZeroAddress, 0n];
    try {
      const ps = c.placeOrder as unknown as ethers.BaseContractMethod<typeof args, [boolean, bigint], [boolean, bigint]>;
      const [ok] = await withTimeout(ps.staticCall(...args, { value: 0n }), 10000, "place-sim");
      if (!ok) return null;
      const tx = await withTimeout((c.placeOrder as ethers.BaseContractMethod<typeof args, unknown, ethers.ContractTransactionResponse>)(...args, { value: 0n }), 12000, "place-send");
      const r = await withTimeout(tx.wait(), 15000, "place-wait");
      let id: bigint | null = null;
      for (const lg of r!.logs) if (lg.topics[0] === ORDER_PLACED_TOPIC && lg.topics[1]) { id = BigInt(lg.topics[1]); break; }
      return id !== null ? { id, priceRaw, refMid: mid, ts: Date.now() } : null;
    } catch (e) { append({ t: "place_err", ts: Date.now(), isBid, err: String((e as Error).message).slice(0, 90) }); return null; }
  };

  // RECONCILER (fixes the order-leak): a fire-and-forget pull-cancel that fails/times-out
  // leaves an order resting but untracked (orphan). Periodically fetch the COMPLETE open
  // set and cancel anything not in {openBid,openAsk}.
  const reconcile = async (): Promise<void> => {
    try {
      const open = await withTimeout((c.getOwnOpenOrders as unknown as (o: { from: string }) => Promise<bigint[]>)({ from: wallet.address }), 12000, "reconcile");
      const tracked = new Set<string>();
      if (openBid) tracked.add(openBid.id.toString());
      if (openAsk) tracked.add(openAsk.id.toString());
      for (const id of open) if (!tracked.has(id.toString())) { append({ t: "orphan_cancel", ts: Date.now(), id: id.toString() }); await cancel(id); }
    } catch (e) { append({ t: "reconcile_err", ts: Date.now(), err: String((e as Error).message).slice(0, 60) }); }
  };

  // re-quote a side (called when absent + calm + inventory allows)
  let busy = false;
  const maybeRepost = async (): Promise<void> => {
    if (busy || stopped) return;
    if (Date.now() - lastMoveTs < REPOST_CALM_MS) return; // not calm yet
    if (mid <= 0) return;
    busy = true;
    try {
      const b = await withTimeout(bal(), 12000, "bal-repost");
      if (b.somi < gasReserveRaw) { stopped = true; append({ t: "gas_abort", ts: Date.now(), somi: ethers.formatUnits(b.somi, 18) }); return; }
      // tradeBase = only WETH ABOVE the protected reserve sleeve; the maker never sells below RESERVE_BASE
      const tradeBase = Math.max(0, b.base - RESERVE_BASE);
      const baseVal = tradeBase * mid, total = baseVal + b.usdso, baseFrac = total > 0 ? baseVal / total : 0.5;
      if (!openBid && baseFrac < MAX_INV) {
        const px = alignTick(toRaw(mid) - HALF_SPREAD * tickRaw);
        const pxH = Number(ethers.formatUnits(px, quoteTok.decimals));
        const qty = alignLot(ethers.parseUnits(((b.usdso * USE_FRAC) / pxH).toFixed(baseTok.decimals), baseTok.decimals));
        if (qty >= minQtyRaw && px < toRaw(bestAsk)) { openBid = await place(true, px, qty); if (openBid) { reposts++; append({ t: "post", ts: Date.now(), side: "bid", price: pxH, mid }); } }
      }
      if (!openAsk && baseFrac > MIN_INV) {
        const px = alignTick(toRaw(mid) + HALF_SPREAD * tickRaw);
        const qty = alignLot(ethers.parseUnits((tradeBase * USE_FRAC).toFixed(baseTok.decimals), baseTok.decimals));
        if (qty >= minQtyRaw && px > toRaw(bestBid)) { openAsk = await place(false, px, qty); if (openAsk) { reposts++; append({ t: "post", ts: Date.now(), side: "ask", price: Number(ethers.formatUnits(px, quoteTok.decimals)), mid }); } }
      }
    } finally { busy = false; }
  };

  // PULL on move: cancel the EXPOSED side immediately (async, non-blocking the WS loop)
  const onMove = (): void => {
    if (stopped) return;
    // mid rose toward/through our ASK → toxic → pull ask (keep bid: now safer/favorable)
    if (openAsk && mid - openAsk.refMid > PULL_TICKS * tickHuman) {
      const { id, refMid } = openAsk; openAsk = null; pulls++; lastMoveTs = Date.now();
      append({ t: "pull", ts: Date.now(), side: "ask", mid, refMid, moveTicks: Math.round((mid - refMid) / tickHuman) });
      void cancel(id);
    }
    // mid fell toward/through our BID → toxic → pull bid (keep ask)
    if (openBid && openBid.refMid - mid > PULL_TICKS * tickHuman) {
      const { id, refMid } = openBid; openBid = null; pulls++; lastMoveTs = Date.now();
      append({ t: "pull", ts: Date.now(), side: "bid", mid, refMid, moveTicks: Math.round((refMid - mid) / tickHuman) });
      void cancel(id);
    }
  };

  ws.onMessage((raw) => {
    const m = raw as { channel?: string; type?: string; bids?: unknown; asks?: unknown };
    if (m?.channel !== "orderbook") return;
    const replace = m.type === "snapshot";
    if (m.bids !== undefined) applyLevels(m.bids, bids, replace);
    if (m.asks !== undefined) applyLevels(m.asks, asks, replace);
    const prevMid = mid; recompute();
    if (mid > 0 && mid !== prevMid) onMove();
  });

  await ws.connect();
  ws.subscribe("orderbook", { symbols: [POOL_SYMBOL] });
  append({ t: "start", ts: Date.now(), pool: POOL_SYMBOL, halfSpread: HALF_SPREAD.toString(), pullTicks: PULL_TICKS, repostCalmMs: REPOST_CALM_MS });
  logger.info({ pool: POOL_SYMBOL, pullTicks: PULL_TICKS }, "mm-pullonmove started (WS pull-on-move)");

  process.on("SIGINT", () => { stopped = true; });
  process.on("SIGTERM", () => { stopped = true; });

  const t0 = Date.now();
  // control loop: repost when calm + detect fills; WS handler does the fast pulls
  let lastHeartbeat = Date.now(), lastReconcile = Date.now();
  while (!stopped && Date.now() - t0 < MAX_RUN_MS) {
    try {
      // ANTI-STUCK: if a resting order sat idle (no re-quote) for FORCE_REQUOTE_MS, cancel it so
      // maybeRepost re-centers it to current mid — keeps tx flowing (anti-DQ) + improves fills,
      // so the maker never idles when one-sided/skewed in a calm or trending market.
      const nowF = Date.now();
      const obF = openBid as Side | null, oaF = openAsk as Side | null;
      if (obF && nowF - obF.ts > FORCE_REQUOTE_MS) { openBid = null; lastMoveTs = 0; append({ t: "force_requote", ts: nowF, side: "bid" }); await cancel(obF.id); }
      if (oaF && nowF - oaF.ts > FORCE_REQUOTE_MS) { openAsk = null; lastMoveTs = 0; append({ t: "force_requote", ts: nowF, side: "ask" }); await cancel(oaF.id); }
      await maybeRepost();
      if (Date.now() - lastReconcile > 20000) { await reconcile(); lastReconcile = Date.now(); }
      // fill detection via base-balance delta
      const b = await withTimeout(bal(), 12000, "bal-loop");
      const delta = b.base - lastBase;
      if (Math.abs(delta) >= Number(ethers.formatUnits(lotRaw, baseTok.decimals)) / 2) {
        fills++;
        append({ t: "fill", ts: Date.now(), baseDelta: Number(delta.toFixed(6)), favorable: delta > 0 ? "bought" : "sold", mid, bestBid, bestAsk });
        if (delta > 0) openBid = null; else openAsk = null;
        lastBase = b.base;
      }
      if (Date.now() - lastHeartbeat > 60000) { append({ t: "hb", ts: Date.now(), mid, bookAgeMs: Date.now() - lastBookTs, openBid: openBid !== null, openAsk: openAsk !== null, pulls, reposts, fills }); lastHeartbeat = Date.now(); }
    } catch (e) { append({ t: "loop_err", ts: Date.now(), err: String((e as Error).message).slice(0, 80) }); }
    await new Promise((r) => setTimeout(r, 1500));
  }

  // cleanup
  ws.close();
  const fb = openBid as Side | null, fa = openAsk as Side | null;
  if (fb) await cancel(fb.id);
  if (fa) await cancel(fa.id);
  append({ t: "stop", ts: Date.now(), pulls, reposts, fills, lastBookTs });
  logger.info({ pulls, reposts, fills }, "mm-pullonmove finished — orders cancelled");
}
main().catch((e) => { append({ t: "fatal", ts: Date.now(), err: String((e as Error).message ?? e) }); logger.fatal({ e: (e as Error).message ?? e }); process.exit(1); });
