import "dotenv/config";
import fs from "node:fs";
import { ethers } from "ethers";
import { getActiveNetwork } from "../src/config/network.js";
import { getPool } from "../src/config/pairs.js";
import { getToken } from "../src/config/tokens.js";
import { SPOTPOOL_ABI } from "../src/dex/abi/spotpool.js";
import type { SpotPoolContract } from "../src/dex/abi/types.js";
import { buildExpireNs } from "../src/utils/gotchas.js";
import { ORDER_TYPE, SELF_MATCH, MS_PER_HOUR } from "../src/config/constants.js";

// ============================================================================
//  breakout-bot — directional LONG/FLAT bot on DreamDEX WETH:USDso, signal from
//  Binance ETHUSDT 1h Bollinger-breakout + volume (the ONE edge that survived
//  out-of-sample param-robustness in backtest: 24/27 combos OOS-positive on ETH,
//  Sharpe ~2 over 333d incl. a bear market). LONG-only (spot: hold WETH or USDso).
//
//  SHADOW mode = NO orders, paper-fills at live DreamDEX prices → forward-test.
//  LIVE mode   = real IOC taker via placeOrder, with hard risk caps.
//
//  Signal (on each newly-CLOSED Binance 1h bar):
//    LONG  if close > BB_upper(bbN,std)  AND vol > volMult * volMA(20)
//    else FLAT.  Hard stop: exit if price drops stopPct% below entry.
//
//  Usage:
//    NETWORK=mainnet npx tsx scripts/breakout-bot.ts <shadow|live> [pollSec] \
//      [bbN] [std] [volMult] [stopPct] [clipUsd] [dailyStopUsd] [lifeStopUsd] [logPath]
//    default: shadow 300 20 2 1.2 2 5 3 10 d:/tmp/breakout.jsonl
// ============================================================================

const MODE = (process.argv[2] ?? "shadow") as "shadow" | "live" | "test";
const POLL_SEC = Number(process.argv[3] ?? "300");
const BB_N = Number(process.argv[4] ?? "20");
const STD_MULT = Number(process.argv[5] ?? "2");
const VOL_MULT = Number(process.argv[6] ?? "1.2");
const STOP_PCT = Number(process.argv[7] ?? "2");
const CLIP_USD = Number(process.argv[8] ?? "5");
const DAILY_STOP_USD = Number(process.argv[9] ?? "3");
const LIFE_STOP_USD = Number(process.argv[10] ?? "10");
const LOG = process.argv[11] ?? "d:/tmp/breakout.jsonl";
const CEX = "https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1h&limit=60";
const POOL_SYMBOL = "WETH:USDso";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const append = (o: unknown): void => fs.appendFileSync(LOG, JSON.stringify(o) + "\n");
const r4 = (x: number): number => Number(x.toFixed(4));

async function klines(): Promise<{ c: number[]; v: number[]; t: number[] } | null> {
  try {
    const r = await fetch(CEX, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const raw = (await r.json()) as unknown[][];
    return { t: raw.map((k) => k[0] as number), c: raw.map((k) => +(k[4] as string)), v: raw.map((k) => +(k[5] as string)) };
  } catch { return null; }
}
async function dexBook(): Promise<{ bid: number; ask: number; mid: number } | null> {
  try {
    const r = await fetch(`https://api.dreamdex.io/v0/orderbooks?symbols=${POOL_SYMBOL}&depth=1`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { orderbooks?: Array<{ bids: Array<{ price: string }>; asks: Array<{ price: string }> }> };
    const ob = j.orderbooks?.[0];
    if (!ob?.bids?.[0] || !ob?.asks?.[0]) return null;
    const bid = +ob.bids[0].price, ask = +ob.asks[0].price;
    return bid > 0 && ask > 0 && ask >= bid ? { bid, ask, mid: (bid + ask) / 2 } : null;
  } catch { return null; }
}
function sma(xs: number[], n: number): number { const s = xs.slice(-n); return s.reduce((a, b) => a + b, 0) / s.length; }
function std(xs: number[], n: number, m: number): number { const s = xs.slice(-n); return Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / s.length); }

interface Live {
  c: SpotPoolContract; baseTok: ReturnType<typeof getToken>; quoteTok: ReturnType<typeof getToken>;
  wallet: ethers.Wallet; baseErc: ethers.Contract; tickRaw: bigint; lotRaw: bigint;
}
async function baseBal(L: Live): Promise<number> {
  const raw: bigint = await (L.baseErc.balanceOf as ethers.BaseContractMethod<[string], bigint, bigint>)(L.wallet.address);
  return Number(ethers.formatUnits(raw, L.baseTok.decimals));
}
async function setupLive(): Promise<Live> {
  const net = getActiveNetwork();
  const provider = new ethers.JsonRpcProvider(net.rpc, { chainId: net.chainId, name: net.name });
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  const pool = getPool(net.name, POOL_SYMBOL);
  const baseTok = getToken(net.name, pool.base), quoteTok = getToken(net.name, pool.quote);
  const c = new ethers.Contract(pool.poolAddress, SPOTPOOL_ABI, wallet) as SpotPoolContract;
  const erc = ["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)", "function balanceOf(address) view returns (uint256)"];
  const baseErc = new ethers.Contract(baseTok.address, erc, wallet);
  for (const tok of [baseTok, quoteTok]) {
    const e = new ethers.Contract(tok.address, erc, wallet);
    const al: bigint = await (e.allowance as ethers.BaseContractMethod<[string, string], bigint, bigint>)(wallet.address, pool.poolAddress);
    if (al < ethers.MaxUint256 / 2n) { const tx = await (e.approve as ethers.BaseContractMethod<[string, bigint], boolean, ethers.ContractTransactionResponse>)(pool.poolAddress, ethers.MaxUint256); await tx.wait(); }
  }
  const params = await (c.getPoolParams as ethers.BaseContractMethod<[], unknown[], unknown[]>)();
  return { c, baseTok, quoteTok, wallet, baseErc, tickRaw: params[4] as bigint, lotRaw: params[6] as bigint }; // idx6 = lotSize (idx5 = minQuantity)
}
// IOC taker via placeOrder (proven non-deprecated path). isBid=true buys base.
// Returns the ACTUAL base filled, measured by wallet balance delta (NOT assumed)
// + a staticCall pre-check so a would-revert order is skipped, never sent.
async function iocTake(L: Live, isBid: boolean, priceHuman: number, qtyBase: number): Promise<{ ok: boolean; filledBase: number }> {
  const pool = getPool(getActiveNetwork().name, POOL_SYMBOL);
  const priceRaw = (ethers.parseUnits(priceHuman.toFixed(L.quoteTok.decimals), L.quoteTok.decimals) / L.tickRaw) * L.tickRaw;
  const qtyRaw = (ethers.parseUnits(qtyBase.toFixed(L.baseTok.decimals), L.baseTok.decimals) / L.lotRaw) * L.lotRaw;
  if (qtyRaw <= 0n) return { ok: false, filledBase: 0 };
  const args: [boolean, bigint, bigint, bigint, bigint, number, number, string, bigint] = [
    isBid, 0n, priceRaw, qtyRaw, buildExpireNs(MS_PER_HOUR), ORDER_TYPE.ImmediateOrCancel, SELF_MATCH.CancelTaker, ethers.ZeroAddress, 0n,
  ];
  const before = await baseBal(L);
  try {
    // pre-check: simulate; if it reverts/returns not-ok, skip sending (saves gas, avoids blind send)
    try {
      const placeStatic = L.c.placeOrder as unknown as ethers.BaseContractMethod<typeof args, [boolean, bigint], [boolean, bigint]>;
      const [simOk] = await placeStatic.staticCall(...args, { value: 0n });
      if (!simOk) { append({ t: "live_skip", ts: Date.now(), side: isBid ? "buy" : "sell", reason: "sim_false" }); return { ok: false, filledBase: 0 }; }
    } catch (se) { append({ t: "live_skip", ts: Date.now(), side: isBid ? "buy" : "sell", reason: "sim_revert", err: String((se as Error).message ?? se).slice(0, 100) }); return { ok: false, filledBase: 0 }; }
    const tx = await (L.c.placeOrder as ethers.BaseContractMethod<typeof args, unknown, ethers.ContractTransactionResponse>)(...args, { value: 0n, gasLimit: 5_000_000n });
    await tx.wait();
    const after = await baseBal(L);
    const filledBase = Math.abs(after - before);
    return { ok: filledBase > 0, filledBase };
  } catch (e) {
    append({ t: "live_err", ts: Date.now(), side: isBid ? "buy" : "sell", err: String((e as Error).message ?? e).slice(0, 120) });
    const after = await baseBal(L).catch(() => before);
    const filledBase = Math.abs(after - before);
    return { ok: filledBase > 0, filledBase }; // tx may have partially landed despite throw — trust balance delta
  }
}

async function main(): Promise<void> {
  append({ t: "start", ts: Date.now(), mode: MODE, params: { POLL_SEC, BB_N, STD_MULT, VOL_MULT, STOP_PCT, CLIP_USD, DAILY_STOP_USD, LIFE_STOP_USD } });

  // TEST mode: one real buy+sell round-trip to verify the live path end-to-end
  // (staticCall pre-check + balance-delta fill verification). No strategy, exits.
  if (MODE === "test") {
    const L = await setupLive();
    const bk = await dexBook();
    if (!bk) { console.log("TEST: no book"); append({ t: "test_err", ts: Date.now(), note: "no book" }); return; }
    const before = await baseBal(L);
    console.log(`TEST: book bid ${bk.bid} ask ${bk.ask}. baseBefore=${before}. Buying ~$${CLIP_USD}...`);
    const buy = await iocTake(L, true, bk.ask * 1.001, CLIP_USD / bk.ask);
    console.log("BUY result:", JSON.stringify(buy));
    append({ t: "test_buy", ts: Date.now(), ...buy });
    if (buy.ok && buy.filledBase > 0) {
      await sleep(2000);
      const bk2 = await dexBook();
      console.log(`Selling back ${buy.filledBase} WETH @~${bk2?.bid ?? bk.bid}...`);
      const sell = await iocTake(L, false, (bk2?.bid ?? bk.bid) * 0.999, buy.filledBase);
      console.log("SELL result:", JSON.stringify(sell));
      append({ t: "test_sell", ts: Date.now(), ...sell });
    } else {
      console.log("BUY did not fill — nothing to sell. (sim_false/skip is SAFE behavior)");
    }
    const after = await baseBal(L);
    console.log(`baseAfter=${after} (net WETH change ${(after - before).toFixed(6)} — should be ~0 after round-trip)`);
    return;
  }

  const L = MODE === "live" ? await setupLive() : null;
  let stopped = false;
  process.on("SIGINT", () => { stopped = true; }); process.on("SIGTERM", () => { stopped = true; });

  let pos: 0 | 1 = 0;             // flat or long
  let entryPx = 0, entryTs = 0, qty = 0;
  let lastBarT = 0;              // last CLOSED bar acted on
  let cumPnl = 0, trades = 0, wins = 0;
  let dayKey = "", dayPnl = 0, halted = false;

  // Exit helper: in LIVE, only mark FLAT if the sell actually filled (verified
  // by balance delta inside iocTake). If it didn't, stay LONG and retry — never
  // book a phantom-flat while still holding WETH.
  const tryExit = async (reason: string, bid0: number, now: number): Promise<void> => {
    if (!(MODE === "live" && L)) { // shadow paper exit (assume full fill at bid)
      const pnl = (bid0 - entryPx) * qty;
      cumPnl += pnl; dayPnl += pnl; trades++; if (pnl > 0) wins++; pos = 0;
      append({ t: "exit", ts: now, reason, entryPx: r4(entryPx), exitPx: r4(bid0), qty: r4(qty), pnl: r4(pnl), cumPnl: r4(cumPnl), trades, wins, heldMs: now - entryTs });
      return;
    }
    // LIVE: the DreamDEX book is thin → IOC sells PARTIAL-fill. Retry the
    // remainder up to 5×; only mark FLAT once we're down to sub-lot dust.
    const lotHuman = Number(ethers.formatUnits(L.lotRaw, L.baseTok.decimals));
    let remaining = qty, soldTotal = 0, pnlTotal = 0;
    for (let att = 0; att < 5 && remaining >= lotHuman; att++) {
      const bk = await dexBook(); if (!bk) break;
      const r = await iocTake(L, false, bk.bid * 0.999, remaining);
      if (r.filledBase > 0) { soldTotal += r.filledBase; pnlTotal += (bk.bid - entryPx) * r.filledBase; remaining = Math.max(0, remaining - r.filledBase); }
      else break; // no liquidity / sim_false this round — bail, retry on next poll
      if (remaining >= lotHuman) await sleep(1500);
    }
    cumPnl += pnlTotal; dayPnl += pnlTotal; qty = remaining;
    if (remaining >= lotHuman) { append({ t: "exit_partial", ts: now, reason, sold: r4(soldTotal), remaining: r4(remaining), pnlSoFar: r4(pnlTotal), note: "STILL HOLDING remainder — retry next poll (pos stays LONG)" }); return; }
    trades++; if (pnlTotal > 0) wins++; pos = 0;
    append({ t: "exit", ts: now, reason, entryPx: r4(entryPx), soldQty: r4(soldTotal), dust: r4(remaining), pnl: r4(pnlTotal), cumPnl: r4(cumPnl), trades, wins, heldMs: now - entryTs });
  };

  while (!stopped) {
    const [kl, bk] = await Promise.all([klines(), dexBook()]);
    const ts = Date.now();
    if (!kl || !bk) { append({ t: "miss", ts, kl: !!kl, bk: !!bk }); await sleep(POLL_SEC * 1000); continue; }

    // last fully-closed 1h bar = index length-2 (length-1 is the still-forming bar)
    const n = kl.c.length, closedIdx = n - 2;
    const closes = kl.c.slice(0, closedIdx + 1), vols = kl.v.slice(0, closedIdx + 1);
    const barT = kl.t[closedIdx]!;
    const m = sma(closes, BB_N), sd = std(closes, BB_N, m), upper = m + STD_MULT * sd, vMa = sma(vols, 20);
    const cl = closes[closes.length - 1]!, vol = vols[vols.length - 1]!;
    const wantLong = cl > upper && vol > VOL_MULT * vMa;

    const dk = new Date(ts).toISOString().slice(0, 10);
    if (dk !== dayKey) { dayKey = dk; dayPnl = 0; halted = false; }

    // --- hard stop (check every poll, intra-bar) ---
    if (pos === 1 && bk.mid < entryPx * (1 - STOP_PCT / 100)) {
      await tryExit("stop", bk.bid, ts);
    }

    // --- per-bar signal action (once per new closed bar) ---
    if (barT !== lastBarT) {
      lastBarT = barT;
      const lossHalt = -dayPnl >= DAILY_STOP_USD || -cumPnl >= LIFE_STOP_USD;
      if (lossHalt) halted = true;
      append({ t: "bar", ts, barT, cl: r4(cl), upper: r4(upper), vol: r4(vol), volMa: r4(vMa), wantLong, pos, dexMid: r4(bk.mid), cumPnl: r4(cumPnl), dayPnl: r4(dayPnl), halted });

      if (wantLong && pos === 0 && !halted) {
        const px = bk.ask, wantQty = CLIP_USD / px;
        if (MODE === "live" && L) {
          const r = await iocTake(L, true, px * 1.001, wantQty);
          if (!r.ok) { append({ t: "entry_fail", ts, note: "buy did not fill", px: r4(px) }); }
          else { entryPx = px; entryTs = ts; qty = r.filledBase; pos = 1; append({ t: "entry", ts, entryPx: r4(px), qty: r4(r.filledBase), clipUsd: CLIP_USD }); }
        } else { entryPx = px; entryTs = ts; qty = wantQty; pos = 1; append({ t: "entry", ts, entryPx: r4(px), qty: r4(wantQty), clipUsd: CLIP_USD }); }
      } else if (!wantLong && pos === 1) {
        await tryExit("signal", bk.bid, ts);
      }
    }
    await sleep(POLL_SEC * 1000);
  }
  append({ t: "stop", ts: Date.now(), pos, cumPnl: r4(cumPnl), trades, wins });
}
main().catch((e) => { append({ t: "fatal", ts: Date.now(), err: String((e as Error).message ?? e) }); process.exit(1); });
