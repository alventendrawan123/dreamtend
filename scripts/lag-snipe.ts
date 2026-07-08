import "dotenv/config";
import fs from "node:fs";

// ============================================================================
//  lag-snipe (SHADOW MODE) — NO TRADING, NO ORDERS, NO CAPITAL AT RISK.
//
//  Tests whether a TRANSIENT, mean-reverting cross-venue lag exists between a
//  deep CEX (Binance ETHUSDT) and DreamDEX WETH:USDso — as opposed to the
//  PERSISTENT ~10 bps structural basis the research already measured (which is
//  NOT tradeable directionally).
//
//  Each poll: oracle mid (Binance) vs DreamDEX book mid → gapBps. Maintain a
//  rolling-median "basis"; the tradeable signal is the EXCESS over that basis
//  during a FRESH CEX move. Simulate a would-be IOC round-trip and book a
//  MODELED PnL = gap-closure − round-trip cost. Append everything to JSONL.
//
//  GO/NO-GO (analyze the log later): proceed to a tiny live probe ONLY if
//  >=30 simulated qualifying trips net POSITIVE after cost AND hit-rate >52%.
//  Expected outcome: mostly basis (no reversion) → net<=0 → shelve, $0 spent.
//
//  Usage:
//    NETWORK=mainnet npx tsx scripts/lag-snipe.ts [logPath] [pollMs] [costBps] \
//        [entryExcessBps] [cexMoveBps] [exitRevertBps] [timeStopMs]
//    default: d:/tmp/lag-shadow.jsonl 1500 4 12 5 4 15000
// ============================================================================

const CEX_URL = "https://data-api.binance.vision/api/v3/ticker/bookTicker?symbol=ETHUSDT";
const DEX_URL = "https://api.dreamdex.io/v0/orderbooks?symbols=WETH:USDso&depth=1";
const LOG = process.argv[2] ?? "d:/tmp/lag-shadow.jsonl";
const POLL_MS = Number(process.argv[3] ?? "1500");
const COST_BPS = Number(process.argv[4] ?? "4");          // modeled round-trip spread + gas
const ENTRY_EXCESS_BPS = Number(process.argv[5] ?? "12"); // |gap − basis| must exceed this
const CEX_MOVE_BPS = Number(process.argv[6] ?? "5");      // CEX moved this much in ~2s = fresh lag
const EXIT_REVERT_BPS = Number(process.argv[7] ?? "4");   // exit when |gap − basis| < this
const TIME_STOP_MS = Number(process.argv[8] ?? "15000");
const WINDOW_MS = 30000;                                   // rolling basis window
const MIN_HIST = 10;                                       // samples before any signal
const SAMPLE_EVERY = 20;                                   // log a raw tick every N polls

interface Tick { ts: number; cexMid: number; dexMid: number; dexBid: number; dexAsk: number; gapBps: number }

async function fetchCex(): Promise<{ mid: number } | null> {
  try {
    const r = await fetch(CEX_URL, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { bidPrice: string; askPrice: string };
    const mid = (Number(j.bidPrice) + Number(j.askPrice)) / 2;
    return mid > 0 ? { mid } : null;
  } catch { return null; }
}
async function fetchDex(): Promise<{ bid: number; ask: number; mid: number } | null> {
  try {
    const r = await fetch(DEX_URL, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { orderbooks?: Array<{ bids: Array<{ price: string }>; asks: Array<{ price: string }> }> };
    const ob = j.orderbooks?.[0];
    if (!ob?.bids?.[0] || !ob?.asks?.[0]) return null;
    const bid = Number(ob.bids[0].price), ask = Number(ob.asks[0].price);
    if (!(bid > 0) || !(ask > 0) || ask < bid) return null;
    return { bid, ask, mid: (bid + ask) / 2 };
  } catch { return null; }
}
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
function append(obj: unknown): void { fs.appendFileSync(LOG, JSON.stringify(obj) + "\n"); }
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const r2 = (x: number): number => Number(x.toFixed(2));

async function main(): Promise<void> {
  append({ t: "start", ts: Date.now(), params: { POLL_MS, COST_BPS, ENTRY_EXCESS_BPS, CEX_MOVE_BPS, EXIT_REVERT_BPS, TIME_STOP_MS } });
  const hist: Tick[] = [];
  let stopped = false;
  process.on("SIGINT", () => { stopped = true; });
  process.on("SIGTERM", () => { stopped = true; });
  let open: null | { entryTs: number; dir: "buy" | "sell"; entryGapBps: number; entryDexMid: number; entryCexMid: number } = null;
  let nSig = 0, nWin = 0, nLoss = 0, cumPnlBps = 0, poll = 0;

  while (!stopped) {
    poll += 1;
    const [cex, dex] = await Promise.all([fetchCex(), fetchDex()]);
    const ts = Date.now();
    if (!cex || !dex) { append({ t: "miss", ts, cex: !!cex, dex: !!dex }); await sleep(POLL_MS); continue; }

    const gapBps = 1e4 * (cex.mid - dex.mid) / cex.mid;
    const tick: Tick = { ts, cexMid: cex.mid, dexMid: dex.mid, dexBid: dex.bid, dexAsk: dex.ask, gapBps };
    hist.push(tick);
    while (hist.length && ts - hist[0]!.ts > WINDOW_MS) hist.shift();
    const basis = median(hist.map((h) => h.gapBps));
    const excess = gapBps - basis; // + ⇒ dex extra-cheap vs its own basis
    const ref = hist.find((h) => ts - h.ts >= 1800 && ts - h.ts <= 2500) ?? hist[0]!;
    const cexMoveBps = 1e4 * (cex.mid - ref.cexMid) / cex.mid;

    if (poll % SAMPLE_EVERY === 0) {
      append({ t: "tick", ts, cexMid: r2(cex.mid), dexMid: r2(dex.mid), gapBps: r2(gapBps), basis: r2(basis), excess: r2(excess), cexMoveBps: r2(cexMoveBps) });
    }

    if (open) {
      const elapsed = ts - open.entryTs;
      const gapClosedBps = open.dir === "buy" ? (open.entryGapBps - gapBps) : (gapBps - open.entryGapBps);
      const reverted = Math.abs(gapBps - basis) < EXIT_REVERT_BPS;
      if (reverted || elapsed >= TIME_STOP_MS) {
        const pnlBps = gapClosedBps - COST_BPS;
        cumPnlBps += pnlBps; if (pnlBps > 0) nWin += 1; else nLoss += 1;
        append({ t: "exit", ts, dir: open.dir, elapsedMs: elapsed, reason: reverted ? "revert" : "timestop", entryGapBps: r2(open.entryGapBps), exitGapBps: r2(gapBps), gapClosedBps: r2(gapClosedBps), pnlBps: r2(pnlBps), cumPnlBps: r2(cumPnlBps), nWin, nLoss });
        open = null;
      }
    } else if (hist.length >= MIN_HIST && Math.abs(excess) >= ENTRY_EXCESS_BPS && Math.abs(cexMoveBps) >= CEX_MOVE_BPS) {
      const dir: "buy" | "sell" = excess > 0 ? "buy" : "sell";
      // trade WITH the fresh CEX move only (buy when CEX ripped up, sell when it dropped)
      if ((dir === "buy" && cexMoveBps > 0) || (dir === "sell" && cexMoveBps < 0)) {
        open = { entryTs: ts, dir, entryGapBps: gapBps, entryDexMid: dex.mid, entryCexMid: cex.mid };
        nSig += 1;
        append({ t: "entry", ts, dir, gapBps: r2(gapBps), basis: r2(basis), excess: r2(excess), cexMoveBps: r2(cexMoveBps), nSig });
      }
    }
    await sleep(POLL_MS);
  }
  append({ t: "stop", ts: Date.now(), nSig, nWin, nLoss, cumPnlBps: r2(cumPnlBps) });
}
main().catch((e) => { append({ t: "fatal", ts: Date.now(), err: String((e as Error).message ?? e) }); process.exit(1); });
