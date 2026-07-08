import "dotenv/config";

// Parameter-robustness sweep for the BBbreakout+vol strategy on 1h ETH.
// If only a knife-edge param set is profitable OOS -> overfit. If a whole
// neighborhood is positive OOS -> plausibly real edge.
//   npx tsx scripts/backtest-sweep.ts [bars] [costBps]

const BARS = Number(process.argv[2] ?? "8000");
const COST_BPS = Number(process.argv[3] ?? "5");
const SYMBOL = process.argv[4] ?? "ETHUSDT";
const INTERVAL = "1h";

interface Kline { t: number; c: number; v: number }
async function fetchKlines(total: number): Promise<Kline[]> {
  const out: Kline[] = []; let endTime: number | null = null;
  while (out.length < total) {
    const lim = Math.min(1000, total - out.length);
    let url = `https://data-api.binance.vision/api/v3/klines?symbol=${SYMBOL}&interval=${INTERVAL}&limit=${lim}`;
    if (endTime) url += `&endTime=${endTime}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`klines ${r.status}`);
    const raw = (await r.json()) as unknown[][];
    if (!raw.length) break;
    const chunk = raw.map((k) => ({ t: k[0] as number, c: +(k[4] as string), v: +(k[5] as string) }));
    out.unshift(...chunk); endTime = chunk[0]!.t - 1; if (raw.length < lim) break;
  }
  const seen = new Set<number>();
  return out.filter((k) => (seen.has(k.t) ? false : (seen.add(k.t), true))).sort((a, b) => a.t - b.t);
}
function sma(xs: number[], n: number): number[] { const o: number[] = []; let s = 0; for (let i = 0; i < xs.length; i++) { s += xs[i]!; if (i >= n) s -= xs[i - n]!; o.push(i >= n - 1 ? s / n : NaN); } return o; }
function rollStd(xs: number[], n: number, mean: number[]): number[] { const o: number[] = []; for (let i = 0; i < xs.length; i++) { if (i < n - 1) { o.push(NaN); continue; } let s = 0; for (let j = i - n + 1; j <= i; j++) s += (xs[j]! - mean[i]!) ** 2; o.push(Math.sqrt(s / n)); } return o; }

function bt(c: number[], v: number[], bbN: number, sd: number, vm: number, cost: number, from: number, to: number): { ret: number; sharpe: number; trades: number } {
  const mid = sma(c, bbN), st = rollStd(c, bbN, mid), vMa = sma(v, 20);
  let eq = 1, pos = 0, entry = 0, trades = 0; const rets: number[] = [];
  for (let i = from; i < to; i++) {
    const up = mid[i]! + sd * st[i]!;
    const want = !isNaN(up) && !isNaN(vMa[i]!) && c[i]! > up && v[i]! > vm * vMa[i]! ? 1 : 0;
    if (want !== pos) { eq *= 1 - (cost / 2) / 1e4; if (want === 1) entry = eq; else trades += 1; pos = want; }
    const r = pos === 1 ? (c[i + 1]! - c[i]!) / c[i]! : 0; eq *= 1 + r; rets.push(pos === 1 ? r : 0);
  }
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const s = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / rets.length) || 1e-9;
  return { ret: (eq - 1) * 100, sharpe: (m / s) * Math.sqrt(8760), trades };
}

async function main(): Promise<void> {
  const k = await fetchKlines(BARS);
  const c = k.map((x) => x.c), v = k.map((x) => x.v);
  const split = Math.floor(k.length * 0.7);
  console.log(`1h ETH, ${k.length} bars (${((k[k.length - 1]!.t - k[0]!.t) / 86400000).toFixed(0)}d), cost ${COST_BPS}. OOS=last 30%.`);
  console.log(`bbN  std  volX | TRAIN ret%  sh   | TEST ret%   sh    trades  | OOS+?`);
  let pos = 0, tot = 0;
  for (const bbN of [15, 20, 25]) for (const sd of [1.8, 2.0, 2.2]) for (const vm of [1.2, 1.3, 1.5]) {
    const tr = bt(c, v, bbN, sd, vm, COST_BPS, bbN, split);
    const te = bt(c, v, bbN, sd, vm, COST_BPS, split, k.length - 1);
    tot += 1; if (te.ret > 0) pos += 1;
    const p = (x: number, n: number) => x.toFixed(2).padStart(n);
    console.log(`${String(bbN).padEnd(4)} ${String(sd).padEnd(4)} ${String(vm).padEnd(4)} |${p(tr.ret, 9)} ${p(tr.sharpe, 5)} |${p(te.ret, 9)} ${p(te.sharpe, 6)} ${String(te.trades).padStart(6)}  | ${te.ret > 0 ? "YES" : "no"}`);
  }
  console.log(`\nOOS-positive: ${pos}/${tot} param combos. Robust edge => most combos positive. Overfit => only a few.`);
}
main().catch((e) => { console.error((e as Error).message ?? e); process.exit(1); });
