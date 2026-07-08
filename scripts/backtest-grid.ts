import "dotenv/config";

// ============================================================================
//  backtest-grid — honest backtester for a GRID / cost-basis-floored MAKER on
//  BTC (Binance BTCUSDT klines as the price series; we'd execute on DreamDEX
//  WBTC:USDso which tracks BTC). Tests the user's idea: buy small lots passively,
//  sell each lot ONLY above its own cost + margin ("never sell a lot at a loss").
//
//  The KEY honest metric is TERMINAL PnL = realized (closed green lots) +
//  unrealized (open inventory marked at the FINAL price, i.e. force-liquidated
//  like the Day-14 competition snapshot). "Closed lots are always green" is true
//  and meaningless on its own — held underwater lots are the real cost.
//
//  Two buy modes:
//    time : DCA — buy a lot every `buyEveryBars` bars (the "beli tiap N menit")
//    grid : buy a lot whenever price falls `gridBps` below the last buy (ladder)
//  Both buy PASSIVELY (bid `halfSpreadBps` below mid) for the maker edge, and
//  only fill if the bar actually trades down to the bid (bar.low <= bid).
//
//  FILL REALISM CAVEAT: a maker fills only with queue priority + a crossing
//  taker. This sim fills whenever price TOUCHES the level → it OVERSTATES fill
//  rate (upper bound). Real fills are lower. Treat results as optimistic.
//
//  Usage: npx tsx scripts/backtest-grid.ts [interval=15m] [bars=4000] [mode=both]
// ============================================================================

const INTERVAL = process.argv[2] ?? "15m";
const BARS = Number(process.argv[3] ?? "4000");
const MODE_ARG = process.argv[4] ?? "both"; // time | grid | both
// FILL_HAIRCUT: fraction of touch-fillable opportunities that actually land,
// modelling queue competition + needing a crossing taker. 1.0 = optimistic
// ceiling (every touch fills); 0.3 ≈ realistic maker. Thins buys AND sells.
const FILL_HAIRCUT = Number(process.argv[5] ?? "1.0");
const SYMBOL = process.argv[6] ?? "BTCUSDT"; // e.g. BTCUSDT | SOMIUSDT | ETHUSDT
const GRID_OVERRIDE = process.argv[7]; // optional comma-sep gridBps list (each-side), overrides default sweep
const START_USD = 150;
const LOT_USD = 10;            // $ per buy lot (=> up to ~15 lots at $150)
const HALF_SPREAD_BPS = 5;     // passive bid sits this far below mid

// deterministic thinning: returns true for ~haircut fraction of calls
function lands(state: { n: number }, h: number): boolean {
  if (h >= 1) return true;
  const prev = Math.floor(state.n * h);
  state.n += 1;
  return Math.floor(state.n * h) > prev;
}

interface Kline { t: number; o: number; h: number; l: number; c: number; v: number }

async function fetchKlines(symbol: string, interval: string, total: number): Promise<Kline[]> {
  const out: Kline[] = [];
  let endTime: number | null = null;
  while (out.length < total) {
    const lim = Math.min(1000, total - out.length);
    let url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${lim}`;
    if (endTime) url += `&endTime=${endTime}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`klines ${r.status}`);
    const raw = (await r.json()) as unknown[][];
    if (!raw.length) break;
    const chunk = raw.map((k) => ({ t: k[0] as number, o: +(k[1] as string), h: +(k[2] as string), l: +(k[3] as string), c: +(k[4] as string), v: +(k[5] as string) }));
    out.unshift(...chunk);
    endTime = chunk[0]!.t - 1;
    if (raw.length < lim) break;
  }
  const seen = new Set<number>();
  return out.filter((k) => (seen.has(k.t) ? false : (seen.add(k.t), true))).sort((a, b) => a.t - b.t);
}

interface GridParams {
  mode: "time" | "grid";
  buyEveryBars: number; // time mode
  gridBps: number;      // grid mode
  sellMarginBps: number;
  maxInvUsd: number;    // inventory cap (Infinity = no cap = full bag-hold)
}
interface Lot { qty: number; cost: number }
interface Result {
  realized: number; unrealizedEnd: number; terminal: number; volume: number;
  closedLots: number; openLots: number; maxInvUsd: number; maxDDpct: number;
  pctTimeCapped: number; usdsoEnd: number; invEndUsd: number; finalPx: number;
  buys: number; bars: number;
}

// Simulate over bars [from,to). Buys passive (bid = mid*(1-hs)); a bid fills if
// bar.low <= bid. Sell each lot at cost*(1+margin); fills if bar.high >= ask.
// SELL pass runs before BUY pass so a lot can't round-trip within its own bar.
function simulate(k: Kline[], from: number, to: number, p: GridParams): Result {
  const hs = HALF_SPREAD_BPS / 1e4, margin = p.sellMarginBps / 1e4;
  let usdso = START_USD;
  let lots: Lot[] = [];
  let realized = 0, volume = 0, closedLots = 0, buys = 0;
  let maxInvUsd = 0, peakEq = START_USD, maxDD = 0, cappedBars = 0;
  let lastBuyBar = -1e9, lastBuyPrice = Infinity;
  const sellCtr = { n: 0 }, buyCtr = { n: 0 };

  const invValue = (px: number): number => lots.reduce((s, l) => s + l.qty * px, 0);

  for (let i = from; i < to; i++) {
    const bar = k[i]!;
    const mid = bar.c;

    // ---- SELL pass: close any lot whose ask is reached by this bar's high ----
    const keep: Lot[] = [];
    for (const lot of lots) {
      const askP = lot.cost * (1 + margin);
      if (bar.h >= askP && lands(sellCtr, FILL_HAIRCUT)) {
        usdso += lot.qty * askP;
        realized += lot.qty * (askP - lot.cost);
        volume += lot.qty * askP;
        closedLots += 1;
      } else keep.push(lot);
    }
    lots = keep;

    // ---- BUY pass: passive bid, gated by mode trigger + cap + cash ----
    const invUsdNow = invValue(mid);
    const capped = invUsdNow >= p.maxInvUsd;
    if (capped) cappedBars += 1;
    const trigger = p.mode === "time"
      ? (i - lastBuyBar >= p.buyEveryBars)
      : (lots.length === 0 || mid <= lastBuyPrice * (1 - p.gridBps / 1e4));
    const bidP = mid * (1 - hs);
    if (!capped && usdso >= LOT_USD && trigger && bar.l <= bidP && lands(buyCtr, FILL_HAIRCUT)) {
      const qty = LOT_USD / bidP;
      lots.push({ qty, cost: bidP });
      usdso -= LOT_USD;
      volume += LOT_USD; buys += 1;
      lastBuyBar = i; lastBuyPrice = bidP;
    }

    // equity mark-to-market for drawdown
    const eq = usdso + invValue(mid);
    maxInvUsd = Math.max(maxInvUsd, invValue(mid));
    peakEq = Math.max(peakEq, eq);
    maxDD = Math.max(maxDD, (peakEq - eq) / peakEq);
  }

  const finalPx = k[to - 1]!.c;
  const unrealizedEnd = lots.reduce((s, l) => s + l.qty * (finalPx - l.cost), 0);
  const invEndUsd = lots.reduce((s, l) => s + l.qty * finalPx, 0);
  return {
    realized, unrealizedEnd, terminal: realized + unrealizedEnd, volume,
    closedLots, openLots: lots.length, maxInvUsd, maxDDpct: maxDD * 100,
    pctTimeCapped: (100 * cappedBars) / (to - from), usdsoEnd: usdso, invEndUsd, finalPx,
    buys, bars: to - from,
  };
}

// TWO-SIDED grid maker (the "Alven" scheme): start 50/50, quote bid `gridBps`
// below mid AND ask `gridBps` above mid, re-centered to mid each bar. SELL oldest
// lot when high>=ask (cost-basis floor: only if ask>=cost*(1+margin)); BUY a lot
// when low<=bid (capped). Profits when price OSCILLATES; drifts in TRENDS (sells
// out in uptrend → misses run / buys down in downtrend → underwater). Terminal
// PnL marks remaining inventory at final price (Day-14 forced-liquidation).
interface TsParams { gridBps: number; sellMarginBps: number; startBaseFrac: number; maxInvUsd: number; trendN: number; trendBandBps: number }
function simulateTwoSided(k: Kline[], from: number, to: number, p: TsParams): Result {
  const g = p.gridBps / 1e4, margin = p.sellMarginBps / 1e4;
  const p0 = k[from]!.c;
  let usdso = START_USD * (1 - p.startBaseFrac);
  let lots: Lot[] = [];
  const seedUsd = START_USD * p.startBaseFrac;
  // seed N equal lots whose TOTAL cost == seedUsd exactly (not rounded up to
  // whole $LOT_USD lots) so start equity == exactly $150 — keeps the head-to-head
  // vs the $150 hold-50/50 benchmark fair (audit HIGH #2 fix).
  const nSeed = Math.max(1, Math.round(seedUsd / LOT_USD));
  for (let s = 0; s < nSeed; s++) lots.push({ qty: (seedUsd / nSeed) / p0, cost: p0 });
  let realized = 0, volume = 0, closedLots = 0, buys = 0;
  let maxInvUsd = 0, peakEq = START_USD, maxDD = 0, cappedBars = 0;
  const sellCtr = { n: 0 }, buyCtr = { n: 0 };
  let smaSum = 0; const smaWin: number[] = []; // trailing SMA window for the trend filter
  const invValue = (px: number) => lots.reduce((s, l) => s + l.qty * px, 0);

  for (let i = from; i < to; i++) {
    const bar = k[i]!, mid = bar.c;
    const bid = mid * (1 - g), ask = mid * (1 + g);

    // SELL oldest lot if ask reached AND clears cost-basis floor
    if (lots.length && bar.h >= ask && ask >= lots[0]!.cost * (1 + margin) && lands(sellCtr, FILL_HAIRCUT)) {
      const lot = lots.shift()!;
      usdso += lot.qty * ask;
      realized += lot.qty * (ask - lot.cost);
      volume += lot.qty * ask;
      closedLots += 1;
    }
    // TREND FILTER: block BUYS when price is in a confirmed downtrend (mid well
    // below trailing SMA) — stops catching the falling knife = kills the bag-hold.
    const sma = (p.trendN > 0 && smaWin.length >= p.trendN) ? smaSum / p.trendN : mid;
    const buyAllowed = p.trendN <= 0 || mid >= sma * (1 - p.trendBandBps / 1e4);
    // BUY a lot if bid reached, under cap, have cash, trend OK
    const invUsdNow = invValue(mid);
    const capped = invUsdNow >= p.maxInvUsd;
    if (capped) cappedBars += 1;
    if (!capped && usdso >= LOT_USD && bar.l <= bid && buyAllowed && lands(buyCtr, FILL_HAIRCUT)) {
      lots.push({ qty: LOT_USD / bid, cost: bid });
      usdso -= LOT_USD;
      volume += LOT_USD; buys += 1;
    }
    if (p.trendN > 0) { smaWin.push(mid); smaSum += mid; if (smaWin.length > p.trendN) smaSum -= smaWin.shift()!; }
    const eq = usdso + invValue(mid);
    maxInvUsd = Math.max(maxInvUsd, invValue(mid));
    peakEq = Math.max(peakEq, eq);
    maxDD = Math.max(maxDD, (peakEq - eq) / peakEq);
  }
  const finalPx = k[to - 1]!.c;
  const unrealizedEnd = lots.reduce((s, l) => s + l.qty * (finalPx - l.cost), 0);
  const invEndUsd = lots.reduce((s, l) => s + l.qty * finalPx, 0);
  return { realized, unrealizedEnd, terminal: realized + unrealizedEnd, volume, closedLots, openLots: lots.length, maxInvUsd, maxDDpct: maxDD * 100, pctTimeCapped: (100 * cappedBars) / (to - from), usdsoEnd: usdso, invEndUsd, finalPx, buys, bars: to - from };
}

function regimeLabel(k: Kline[], from: number, to: number): string {
  const r = (k[to - 1]!.c - k[from]!.c) / k[from]!.c * 100;
  const tag = r > 8 ? "UP" : r < -8 ? "DOWN" : "FLAT";
  return `${tag}(${r >= 0 ? "+" : ""}${r.toFixed(1)}%)`;
}

async function main(): Promise<void> {
  console.log(`Fetching ${BARS} ${INTERVAL} ${SYMBOL} klines...`);
  const k = await fetchKlines(SYMBOL, INTERVAL, BARS);
  if (k.length < 300) { console.log(`only ${k.length} bars — abort`); return; }
  const days = ((k[k.length - 1]!.t - k[0]!.t) / 86400000).toFixed(1);
  console.log(`Got ${k.length} bars spanning ${days} days. start=$${START_USD} lot=$${LOT_USD} halfSpread=${HALF_SPREAD_BPS}bps fillHaircut=${FILL_HAIRCUT}\n`);

  // split into 4 regime segments for per-regime behavior
  const segs: Array<[string, number, number]> = [];
  const q = Math.floor(k.length / 4);
  for (let s = 0; s < 4; s++) { const a = s * q, b = s === 3 ? k.length : (s + 1) * q; segs.push([`seg${s + 1} ${regimeLabel(k, a, b)}`, a, b]); }
  segs.push([`FULL ${regimeLabel(k, 0, k.length)}`, 0, k.length]);

  const fmt = (n: number, d = 2) => (n >= 0 ? "+" : "") + n.toFixed(d);
  const capS = (c: number) => (c === Infinity ? "∞" : `$${c}`);

  // ---- TWO-SIDED grid sweep (the "Alven" scheme) ----
  if (MODE_ARG === "ts") {
    const gridArr = GRID_OVERRIDE ? GRID_OVERRIDE.split(",").map(Number) : [5, 25, 50];   // each-side distance from mid (bps)
    const margins = [0, 5];
    const baseFracs = [0.5];
    const caps = [150];
    const trendNs = [0, 120, 480];   // SMA period (bars); 0 = filter OFF
    const trendBands = [0, 50, 200]; // bps below SMA before buys blocked
    interface TR { p: TsParams; full: Result }
    const trows: TR[] = [];
    for (const gb of gridArr) for (const sm of margins) for (const bf of baseFracs) for (const cap of caps)
      for (const tn of trendNs) for (const tb of trendBands) {
        if (tn === 0 && tb !== trendBands[0]) continue; // band irrelevant when filter off
        const p: TsParams = { gridBps: gb, sellMarginBps: sm, startBaseFrac: bf, maxInvUsd: cap, trendN: tn, trendBandBps: tb };
        trows.push({ p, full: simulateTwoSided(k, 0, k.length, p) });
      }
    trows.sort((a, b) => b.full.terminal - a.full.terminal);
    const tS = (p: TsParams) => `±${p.gridBps}bps m${p.sellMarginBps} trend${p.trendN > 0 ? `N${p.trendN}/b${p.trendBandBps}` : "OFF"}`;
    console.log("=".repeat(112));
    console.log("TWO-SIDED grid — TOP 12 by TERMINAL PnL (vs buy&hold benchmark below)");
    console.log("=".repeat(112));
    console.log("grid               cap    | termPnL  realized  unreal   volume   closed maxInv maxDD%");
    for (const r of trows.slice(0, 12)) {
      const f = r.full;
      console.log(`${tS(r.p).padEnd(18)} ${capS(r.p.maxInvUsd).padEnd(6)} | ${fmt(f.terminal).padStart(7)} ${fmt(f.realized).padStart(8)} ${fmt(f.unrealizedEnd).padStart(8)} $${f.volume.toFixed(0).padStart(7)} ${String(f.closedLots).padStart(5)} $${f.maxInvUsd.toFixed(0).padStart(4)} ${f.maxDDpct.toFixed(1).padStart(5)}`);
    }
    // benchmark: just hold 50/50 (no trading) and buy&hold 100%
    const bh = (START_USD * (k[k.length - 1]!.c / k[0]!.c)) - START_USD;
    const hold5050 = (START_USD * 0.5 * (k[k.length - 1]!.c / k[0]!.c) + START_USD * 0.5) - START_USD;
    console.log(`\nBENCHMARK (no maker): buy&hold 100% = ${fmt(bh)} | hold 50/50 = ${fmt(hold5050)}  ← beat THESE to justify trading`);
    console.log("\n" + "=".repeat(112));
    console.log(`BEST two-sided per-regime: ${tS(trows[0]!.p)} cap${capS(trows[0]!.p.maxInvUsd)}`);
    console.log("=".repeat(112));
    console.log("segment              | termPnL  realized  unreal   volume   maxInv  maxDD%");
    for (const [name, a, b] of segs) {
      const f = simulateTwoSided(k, a, b, trows[0]!.p);
      console.log(`${name.padEnd(20)} | ${fmt(f.terminal).padStart(7)} ${fmt(f.realized).padStart(8)} ${fmt(f.unrealizedEnd).padStart(8)} $${f.volume.toFixed(0).padStart(7)} $${f.maxInvUsd.toFixed(0).padStart(4)} ${f.maxDDpct.toFixed(1).padStart(5)}`);
    }
    const daysN = (k[k.length - 1]!.t - k[0]!.t) / 86400000;
    const txDay = (f: Result) => (f.buys + f.closedLots) / daysN;
    const bestF = trows[0]!.full;
    const maxTx = [...trows].sort((a, b) => txDay(b.full) - txDay(a.full))[0]!;
    console.log("\n" + "=".repeat(112));
    console.log("ACTIVITY / TX-FREQUENCY (answers: how many buys+sells per day?)");
    console.log("=".repeat(112));
    console.log(`best-PnL config : ${bestF.buys} buys + ${bestF.closedLots} sells = ${bestF.buys + bestF.closedLots} tx / ${daysN.toFixed(1)}d = ${txDay(bestF).toFixed(0)} tx/day | vol $${bestF.volume.toFixed(0)} = $${(bestF.volume / daysN).toFixed(0)}/day | termPnL ${fmt(bestF.terminal)}`);
    console.log(`MAX-TX config   : ${tS(maxTx.p)} cap${capS(maxTx.p.maxInvUsd)} → ${maxTx.full.buys + maxTx.full.closedLots} tx / ${daysN.toFixed(1)}d = ${txDay(maxTx.full).toFixed(0)} tx/day | vol $${maxTx.full.volume.toFixed(0)} = $${(maxTx.full.volume / daysN).toFixed(0)}/day | termPnL ${fmt(maxTx.full.terminal)}`);
    console.log(`(theoretical ceiling: 1 buy+1 sell every bar = ${(2 * (bestF.bars / daysN)).toFixed(0)} tx/day at this interval; fillHaircut=${FILL_HAIRCUT} thins it)`);
    console.log(`\nNOTE: fills OPTIMISTIC (touch=fill). fillHaircut=${FILL_HAIRCUT}. Two-sided profits in OSCILLATION, drifts in TREND (terminal captures it).`);
    return;
  }

  // param sweep
  const modes: Array<"time" | "grid"> = MODE_ARG === "both" ? ["time", "grid"] : [MODE_ARG as "time" | "grid"];
  const sellMargins = [5, 10, 20, 40, 80];
  const buyEvery = [1, 3, 10, 30];   // time mode
  const gridBpsArr = [10, 25, 50, 100]; // grid mode
  const caps = [30, 75, 150, Infinity];

  interface Row { p: GridParams; full: Result; }
  const rows: Row[] = [];
  for (const mode of modes) {
    const triggers = mode === "time" ? buyEvery : gridBpsArr;
    for (const trig of triggers) for (const sm of sellMargins) for (const cap of caps) {
      const p: GridParams = { mode, buyEveryBars: mode === "time" ? trig : 0, gridBps: mode === "grid" ? trig : 0, sellMarginBps: sm, maxInvUsd: cap };
      rows.push({ p, full: simulate(k, 0, k.length, p) });
    }
  }

  // rank by terminal PnL (honest), show volume
  rows.sort((a, b) => b.full.terminal - a.full.terminal);
  const trigS = (p: GridParams) => p.mode === "time" ? `every${p.buyEveryBars}b` : `dip${p.gridBps}bps`;

  console.log("=".repeat(112));
  console.log("TOP 12 by TERMINAL PnL (realized + unrealized@final = Day-14 forced-liquidation reality)");
  console.log("=".repeat(112));
  console.log("mode  trigger    margin  cap    | termPnL  realized  unreal   volume   closed open maxInv maxDD% capped%");
  for (const r of rows.slice(0, 12)) {
    const f = r.full, p = r.p;
    console.log(
      `${p.mode.padEnd(5)} ${trigS(p).padEnd(10)} ${(p.sellMarginBps + "bps").padEnd(7)} ${capS(p.maxInvUsd).padEnd(6)} | ` +
      `${fmt(f.terminal).padStart(7)} ${fmt(f.realized).padStart(8)} ${fmt(f.unrealizedEnd).padStart(8)} ` +
      `$${f.volume.toFixed(0).padStart(7)} ${String(f.closedLots).padStart(5)} ${String(f.openLots).padStart(4)} ` +
      `$${f.maxInvUsd.toFixed(0).padStart(4)} ${f.maxDDpct.toFixed(1).padStart(5)} ${f.pctTimeCapped.toFixed(0).padStart(5)}`
    );
  }

  console.log("\n" + "=".repeat(112));
  console.log("WORST 6 by TERMINAL PnL (the bag-hold trap)");
  console.log("=".repeat(112));
  for (const r of rows.slice(-6).reverse()) {
    const f = r.full, p = r.p;
    console.log(
      `${p.mode.padEnd(5)} ${trigS(p).padEnd(10)} ${(p.sellMarginBps + "bps").padEnd(7)} ${capS(p.maxInvUsd).padEnd(6)} | ` +
      `${fmt(f.terminal).padStart(7)} ${fmt(f.realized).padStart(8)} ${fmt(f.unrealizedEnd).padStart(8)} $${f.volume.toFixed(0).padStart(7)} maxInv $${f.maxInvUsd.toFixed(0)}`
    );
  }

  // best config → per-regime breakdown
  const best = rows[0]!;
  console.log("\n" + "=".repeat(112));
  console.log(`BEST config per-regime: ${best.p.mode} ${trigS(best.p)} margin${best.p.sellMarginBps}bps cap${capS(best.p.maxInvUsd)}`);
  console.log("=".repeat(112));
  console.log("segment              | termPnL  realized  unreal   volume   maxInv  maxDD%");
  for (const [name, a, b] of segs) {
    const f = simulate(k, a, b, best.p);
    console.log(`${name.padEnd(20)} | ${fmt(f.terminal).padStart(7)} ${fmt(f.realized).padStart(8)} ${fmt(f.unrealizedEnd).padStart(8)} $${f.volume.toFixed(0).padStart(7)} $${f.maxInvUsd.toFixed(0).padStart(4)} ${f.maxDDpct.toFixed(1).padStart(5)}`);
  }

  console.log(`\nNOTE: fills are OPTIMISTIC (price-touch = fill; real maker needs queue + crossing taker → fewer fills).`);
  console.log(`The honest read: terminal PnL > 0 across UP/FLAT/DOWN segments = robust. Negative in DOWN = bag-hold trap.`);
}
main().catch((e) => { console.error((e as Error).message ?? e); process.exit(1); });
