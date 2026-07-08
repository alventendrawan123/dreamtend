import "dotenv/config";

// ============================================================================
//  backtest — honest backtester for DIRECTIONAL (long/flat) strategies on ETH,
//  using real Binance klines as the price series (DreamDEX WETH tracks ETH with
//  a ~stable 10 bps basis, so signals computed on Binance apply to WETH; we
//  execute on DreamDEX). Spot = LONG or FLAT only (no shorting WETH).
//
//  Tests multi-factor TA (Bollinger + RSI + EMA-trend + volume) vs benchmarks,
//  with realistic round-trip cost, a max-drawdown stat, AND a train/test split
//  so we can see if any in-sample edge SURVIVES out-of-sample (the honest test —
//  most TA edge is overfit and vanishes OOS).
//
//  Usage:
//    npx tsx scripts/backtest.ts [interval] [bars] [costBps]
//    e.g. npx tsx scripts/backtest.ts 5m 6000 5
// ============================================================================

const INTERVAL = process.argv[2] ?? "5m";
const BARS = Number(process.argv[3] ?? "6000");
const COST_BPS = Number(process.argv[4] ?? "5"); // round-trip taker spread+slippage+gas on DreamDEX
const SYMBOL = "ETHUSDT";

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
  // de-dup + sort ascending by time
  const seen = new Set<number>();
  return out.filter((k) => (seen.has(k.t) ? false : (seen.add(k.t), true))).sort((a, b) => a.t - b.t);
}

// ---- indicators ----
function ema(xs: number[], n: number): number[] {
  const k = 2 / (n + 1), out: number[] = [];
  let prev = xs[0]!;
  for (let i = 0; i < xs.length; i++) { prev = i === 0 ? xs[0]! : xs[i]! * k + prev * (1 - k); out.push(prev); }
  return out;
}
function sma(xs: number[], n: number): number[] {
  const out: number[] = []; let sum = 0;
  for (let i = 0; i < xs.length; i++) { sum += xs[i]!; if (i >= n) sum -= xs[i - n]!; out.push(i >= n - 1 ? sum / n : NaN); }
  return out;
}
function rollStd(xs: number[], n: number, mean: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (i < n - 1) { out.push(NaN); continue; }
    let s = 0; for (let j = i - n + 1; j <= i; j++) s += (xs[j]! - mean[i]!) ** 2;
    out.push(Math.sqrt(s / n));
  }
  return out;
}
function rsi(xs: number[], n: number): number[] {
  const out: number[] = [NaN]; let ag = 0, al = 0;
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i]! - xs[i - 1]!; const g = Math.max(0, d), l = Math.max(0, -d);
    if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; out.push(100 - 100 / (1 + ag / (al || 1e-9))); } else out.push(NaN); }
    else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; out.push(100 - 100 / (1 + ag / (al || 1e-9))); }
  }
  return out;
}

interface Metrics { ret: number; trades: number; winRate: number; maxDD: number; sharpe: number; expo: number }

// signalFn returns desired position (1 long / 0 flat) for bar i given precomputed indicators.
function runBacktest(k: Kline[], sig: (i: number) => number, costBps: number, from: number, to: number): Metrics {
  let equity = 1, pos = 0, entryEq = 0, trades = 0, wins = 0, peak = 1, maxDD = 0, barsLong = 0;
  const rets: number[] = [];
  for (let i = from; i < to; i++) {
    const want = sig(i);
    if (want !== pos) {
      equity *= 1 - (costBps / 2) / 1e4; // pay half round-trip on each flip
      if (want === 1) entryEq = equity; // entering long
      else { trades += 1; if (equity > entryEq) wins += 1; } // exiting long → realized trip
      pos = want;
    }
    const r = pos === 1 ? (k[i + 1]!.c - k[i]!.c) / k[i]!.c : 0; // hold to next close if long
    equity *= 1 + r; rets.push(pos === 1 ? r : 0); if (pos === 1) barsLong += 1;
    peak = Math.max(peak, equity); maxDD = Math.max(maxDD, (peak - equity) / peak);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length) || 1e-9;
  const barsPerYear = INTERVAL === "5m" ? 105120 : INTERVAL === "1m" ? 525600 : INTERVAL === "15m" ? 35040 : INTERVAL === "1h" ? 8760 : 8760;
  return { ret: (equity - 1) * 100, trades, winRate: trades ? (100 * wins) / trades : 0, maxDD: maxDD * 100, sharpe: (mean / sd) * Math.sqrt(barsPerYear), expo: (100 * barsLong) / (to - from) };
}

async function main(): Promise<void> {
  console.log(`Fetching ${BARS} ${INTERVAL} ${SYMBOL} klines from Binance...`);
  const k = await fetchKlines(SYMBOL, INTERVAL, BARS);
  if (k.length < 300) { console.log(`only ${k.length} bars — abort`); return; }
  const c = k.map((x) => x.c), v = k.map((x) => x.v);
  const days = ((k[k.length - 1]!.t - k[0]!.t) / 86400000).toFixed(1);
  console.log(`Got ${k.length} bars spanning ${days} days. costBps(round-trip)=${COST_BPS}\n`);

  // indicators
  const ema12 = ema(c, 12), ema26 = ema(c, 26), ema50 = ema(c, 50), ema200 = ema(c, 200);
  const bbMid = sma(c, 20), bbStd = rollStd(c, 20, bbMid);
  const r14 = rsi(c, 14);
  const volMa = sma(v, 20);
  const bbUp = bbMid.map((m, i) => m + 2 * bbStd[i]!), bbLo = bbMid.map((m, i) => m - 2 * bbStd[i]!);

  // ---- strategies (long/flat) ----
  const strats: Record<string, (i: number) => number> = {
    "buy&hold": () => 1,
    "EMAcross12/26": (i) => (ema12[i]! > ema26[i]! ? 1 : 0),
    "EMA50>200(trend)": (i) => (ema50[i]! > ema200[i]! ? 1 : 0),
    "BB-meanrev+RSI": (i) => {
      // buy when price dips below lower band AND RSI oversold; exit at mid band
      if (isNaN(bbLo[i]!) || isNaN(r14[i]!)) return 0;
      return 0; // placeholder — replaced by stateful version below
    },
    "BBbreakout+vol": (i) => {
      if (isNaN(bbUp[i]!) || isNaN(volMa[i]!)) return 0;
      return c[i]! > bbUp[i]! && v[i]! > 1.3 * volMa[i]! ? 1 : 0;
    },
    "multi(trend+BB+RSI+vol)": (i) => {
      if (isNaN(ema50[i]!) || isNaN(bbLo[i]!) || isNaN(r14[i]!) || isNaN(volMa[i]!)) return 0;
      const up = ema50[i]! > ema200[i]!;            // trend up
      const dip = c[i]! < bbMid[i]!;                // buy the dip within uptrend
      const rsiOk = r14[i]! > 40 && r14[i]! < 65;   // not overbought, not crashing
      const vol = v[i]! > volMa[i]!;                // volume confirm
      return up && dip && rsiOk && vol ? 1 : 0;
    },
  };

  // BB-meanrev needs stateful exit (hold until mid). Implement with a stateful wrapper.
  const statefulBBmr = (() => {
    let held = 0;
    return (i: number) => {
      if (isNaN(bbLo[i]!) || isNaN(r14[i]!)) return (held = 0);
      if (held === 0 && c[i]! < bbLo[i]! && r14[i]! < 35) return (held = 1);
      if (held === 1 && c[i]! >= bbMid[i]!) return (held = 0);
      return held;
    };
  })();
  strats["BB-meanrev+RSI"] = statefulBBmr;

  const split = Math.floor(k.length * 0.7);
  console.log(`Train=bars[200..${split}]  Test(OOS)=bars[${split}..${k.length - 1}]\n`);
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(pad("strategy", 26) + pad("seg", 6) + pad("ret%", 9) + pad("trades", 8) + pad("win%", 7) + pad("maxDD%", 8) + pad("sharpe", 8) + "expo%");
  for (const [name, fn] of Object.entries(strats)) {
    // reset stateful strat between segments
    for (const [seg, a, b] of [["TRAIN", 200, split], ["TEST", split, k.length - 1]] as const) {
      let f = fn;
      if (name === "BB-meanrev+RSI") { let held = 0; f = (i: number) => { if (isNaN(bbLo[i]!) || isNaN(r14[i]!)) return (held = 0); if (held === 0 && c[i]! < bbLo[i]! && r14[i]! < 35) return (held = 1); if (held === 1 && c[i]! >= bbMid[i]!) return (held = 0); return held; }; }
      const m = runBacktest(k, f, COST_BPS, a, b);
      console.log(pad(seg === "TRAIN" ? name : "", 26) + pad(seg, 6) + pad(m.ret.toFixed(2), 9) + pad(String(m.trades), 8) + pad(m.winRate.toFixed(0), 7) + pad(m.maxDD.toFixed(1), 8) + pad(m.sharpe.toFixed(2), 8) + m.expo.toFixed(0));
    }
  }
  console.log(`\nbuy&hold TEST ret% = the benchmark to beat. A strategy with edge: TEST ret > buy&hold OR much lower maxDD at similar ret, positive sharpe, and TRAIN~TEST consistency (no collapse OOS).`);
}
main().catch((e) => { console.error((e as Error).message ?? e); process.exit(1); });
