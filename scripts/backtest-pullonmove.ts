import "dotenv/config";

// ============================================================================
//  backtest-pullonmove — backtests the ACTUAL pull-on-move maker logic
//  (scripts/mm-pullonmove.ts), not the cost-basis grid. The pull-on-move edge:
//  post bid+ask around mid, and when price moves THROUGH a quote, PULL (cancel)
//  the toxic side instead of letting it fill adversely — so we fill on
//  REVERSALS (price touches our quote then comes back) and avoid BREAKOUTS
//  (price blows through → we'd have pulled).
//
//  KLINE MODEL (honest caveat): pull-on-move is a sub-second mechanic; 1m bars
//  can't show the intra-bar path. We model the IDEALIZED pull via each bar's
//  reversal-vs-breakout outcome (using the bar close as the "did it revert or
//  break through" proxy):
//    BID @ bid:  low<=bid  → FILL if close>=bid (reverted up = bought the dip),
//                            PULLED if close<bid (broke down = avoided knife)
//    ASK @ ask:  high>=ask → FILL if close<=ask (reverted down = sold the spike),
//                            PULLED if close>ask (broke up = avoided cheap sell)
//  This is an OPTIMISTIC (perfect-pull) upper bound — real pull has latency, so
//  it captures LESS. The true validation is the LIVE maker markout (+0.06bps avg,
//  +1.0bps in ranging windows). Use this for BTC *regime behavior*, not absolutes.
//
//  Usage: npx tsx scripts/backtest-pullonmove.ts [interval=1m] [bars=20000] [halfSpreadBps=0.65] [fillHaircut=0.5] [SYMBOL=BTCUSDT]
// ============================================================================

const INTERVAL = process.argv[2] ?? "1m";
const BARS = Number(process.argv[3] ?? "20000");
const HALF_SPREAD_BPS = Number(process.argv[4] ?? "0.65"); // WETH-10-tick equiv
const FILL_HAIRCUT = Number(process.argv[5] ?? "0.5");
const SYMBOL = process.argv[6] ?? "BTCUSDT";
const START_BASE_FRAC = Number(process.argv[7] ?? "0.5"); // 0.84 = match our WETH-heavy position
const START_USD = 150;
const LOT_USD = 10;
const MIN_INV = 0.3, MAX_INV = 0.7;      // inventory gate (same as live bot)

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

function lands(state: { n: number }, h: number): boolean {
  if (h >= 1) return true;
  const prev = Math.floor(state.n * h);
  state.n += 1;
  return Math.floor(state.n * h) > prev;
}

interface Result {
  realized: number; unrealizedEnd: number; terminal: number; volume: number;
  buys: number; sells: number; pulls: number;
  markoutBps: number; favPct: number; markoutN: number; maxDDpct: number; finalPx: number;
  endTotal: number; endFrac: number; holdTotal: number;
}

function simulate(k: Kline[], from: number, to: number, hsBps: number): Result {
  const hs = hsBps / 1e4;
  let usdso = START_USD * (1 - START_BASE_FRAC);
  let baseQty = (START_USD * START_BASE_FRAC) / k[from]!.c;
  let avgCost = k[from]!.c;
  let realized = 0, volume = 0, buys = 0, sells = 0, pulls = 0;
  let mkSum = 0, mkN = 0, fav = 0;
  let peakEq = START_USD, maxDD = 0;
  const buyCtr = { n: 0 }, sellCtr = { n: 0 };

  for (let i = from + 1; i < to; i++) {
    const prevMid = k[i - 1]!.c, bar = k[i]!;
    const bid = prevMid * (1 - hs), ask = prevMid * (1 + hs);
    const nextClose = i + 1 < to ? k[i + 1]!.c : bar.c; // post-fill markout reference (~next bar)

    const baseVal = baseQty * prevMid, total = baseVal + usdso, baseFrac = total > 0 ? baseVal / total : 0.5;
    const allowBid = baseFrac < MAX_INV && usdso >= LOT_USD;
    const allowAsk = baseFrac > MIN_INV && baseQty * ask >= LOT_USD;

    // BID (buy): price dipped to our bid
    if (allowBid && bar.l <= bid) {
      if (bar.c >= bid) {           // reverted up → FILL (bought the dip)
        if (lands(buyCtr, FILL_HAIRCUT)) {
          const q = LOT_USD / bid;
          avgCost = (avgCost * baseQty + bid * q) / (baseQty + q);
          baseQty += q; usdso -= LOT_USD; volume += LOT_USD; buys++;
          const mk = (nextClose - bid) / bid * 1e4; mkSum += mk; mkN++; if (mk > 0) fav++;
        }
      } else pulls++;               // broke down → PULLED (avoided the knife)
    }
    // ASK (sell): price spiked to our ask
    if (allowAsk && bar.h >= ask) {
      if (bar.c <= ask) {           // reverted down → FILL (sold the spike)
        if (lands(sellCtr, FILL_HAIRCUT)) {
          const q = Math.min(baseQty, LOT_USD / ask);
          realized += q * (ask - avgCost);
          baseQty -= q; usdso += q * ask; volume += q * ask; sells++;
          const mk = (ask - nextClose) / ask * 1e4; mkSum += mk; mkN++; if (mk > 0) fav++;
        }
      } else pulls++;               // broke up → PULLED (avoided cheap sell)
    }

    const eq = usdso + baseQty * bar.c;
    peakEq = Math.max(peakEq, eq);
    maxDD = Math.max(maxDD, (peakEq - eq) / peakEq);
  }

  const finalPx = k[to - 1]!.c;
  const unrealizedEnd = baseQty * finalPx - baseQty * avgCost;
  const endTotal = usdso + baseQty * finalPx;
  const endFrac = endTotal > 0 ? (baseQty * finalPx) / endTotal : 0;
  // HOLD benchmark: keep the initial split static to the end (no trading)
  const startPx = k[from]!.c;
  const holdTotal = START_USD * (1 - START_BASE_FRAC) + (START_USD * START_BASE_FRAC / startPx) * finalPx;
  return {
    realized, unrealizedEnd, terminal: realized + unrealizedEnd, volume,
    buys, sells, pulls, markoutBps: mkN ? mkSum / mkN : 0, favPct: mkN ? 100 * fav / mkN : 0,
    markoutN: mkN, maxDDpct: maxDD * 100, finalPx, endTotal, endFrac, holdTotal,
  };
}

function regimeLabel(k: Kline[], from: number, to: number): string {
  const r = (k[to - 1]!.c - k[from]!.c) / k[from]!.c * 100;
  return `${r > 8 ? "UP" : r < -8 ? "DOWN" : "FLAT"}(${r >= 0 ? "+" : ""}${r.toFixed(1)}%)`;
}

async function main(): Promise<void> {
  console.log(`Fetching ${BARS} ${INTERVAL} ${SYMBOL}...`);
  const k = await fetchKlines(SYMBOL, INTERVAL, BARS);
  if (k.length < 300) { console.log(`only ${k.length} bars — abort`); return; }
  const days = ((k[k.length - 1]!.t - k[0]!.t) / 86400000);
  console.log(`Got ${k.length} bars (${days.toFixed(1)} days) ${SYMBOL}. startBaseFrac=${START_BASE_FRAC} halfSpread=${HALF_SPREAD_BPS}bps haircut=${FILL_HAIRCUT} (PULL-ON-MOVE)\n`);
  const fmt = (n: number, d = 2) => (n >= 0 ? "+" : "") + n.toFixed(d);

  // split into 6 segments; show MAKER-ACTIVE vs HOLD-static per regime (focus UP)
  console.log("=".repeat(112));
  console.log(`MAKER-ACTIVE vs HOLD-STATIC per regime — start ${(START_BASE_FRAC * 100).toFixed(0)}% base (matches our WETH-heavy ${SYMBOL.replace("USDT", "")} position)`);
  console.log("=".repeat(112));
  console.log("segment                 | maker$  hold$   Δ(maker-hold) | volume   endFrac  markout  | price move");
  const N = 6, q = Math.floor(k.length / N);
  for (let s = 0; s < N; s++) {
    const a = s * q, b = s === N - 1 ? k.length : (s + 1) * q;
    const r = simulate(k, a, b, HALF_SPREAD_BPS);
    const reg = regimeLabel(k, a, b);
    const move = `$${k[a]!.c.toFixed(0)}→$${k[b - 1]!.c.toFixed(0)}`;
    console.log(
      `seg${s + 1} ${reg.padEnd(14)} | ${r.endTotal.toFixed(1).padStart(6)} ${r.holdTotal.toFixed(1).padStart(6)} ${fmt(r.endTotal - r.holdTotal).padStart(6)}       | $${r.volume.toFixed(0).padStart(6)}  ${(r.endFrac * 100).toFixed(0).padStart(3)}%   ${fmt(r.markoutBps)}bps | ${move}`
    );
  }
  console.log("\nKEY: in UP segments, HOLD usually > maker$ (maker sells into the rally = misses upside),");
  console.log("BUT maker generates VOLUME (hold = $0 volume). For comp effVol = rawVol × total/150, the volume wins.");
  console.log(`\nNOTE: perfect-pull (optimistic $/markout). Volume scale is 1m-bar-limited (real maker trades more).`);
  console.log(`Use the DIRECTION: maker sells WETH into uptrends (endFrac drops) + makes volume; hold keeps full upside.`);
}
main().catch((e) => { console.error((e as Error).message ?? e); process.exit(1); });
