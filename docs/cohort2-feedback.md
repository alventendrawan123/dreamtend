# DreamDEX Dev Traders Program — Cohort 2 Feedback & Submission Notes

> **Competition ENDED** (Day-14 final snapshot ~2026-07-07). Safe to publish.
> Official results pending from DevRel.

Wallet: `0xba4E595D6C2e655592c86ce29BbAec202d9175E1` (trader-3). Cohort 2 start ~2026-06-24, 14 days.

---

## Rule 4 deliverables checklist
- [x] **API feedback** — comprehensive live stress-test → see **`docs/cohort2-stress-test-report.md`** (Objective 1 + B1–B28 bug table)
- [x] **Documentation feedback** — usability validation → **`docs/cohort2-stress-test-report.md`** (Objective 2 + doc-fix tables; the 2026-07-06 re-validation table is the CURRENT list)
- [x] **Bug reports** — 31 bugs total: the 13 items below + the report's B1–B28 table + B29–B31 in the Days 7–14 addendum below; severities + suggested fixes
- [x] **Trading activity** — Objective 3 in the report (Day-1 snapshot) + Days 7–14 addendum below. **FINAL (leaderboard, 2026-07-08): #3 by raw volume — 945,661 USDso** (t5 1,093,448 / t2 1,086,202 / us 945,661 / t1 923,142), **127,570 txs (highest of the cohort, 1.35× next)**, PnL −146.44 (capital fully spent generating volume), eff.vol 22,420 (#4 by the board's Eff = Raw × (1 + PnL%) ranking) — rewards/winner announcement pending
- [ ] **GitHub repo** — `dreamtend` (comp ended — push cohort-2 work now; add cohort-2 README section)
- [x] **Bot snippets** — `scripts/make-take.ts` (⭐ alternating maker+taker — the final-week volume engine: drift-kill + dynamic sizing), `mm-pullonmove.ts` (near-free pull-on-move maker), `mm-loop.ts`, `mm-tuned.ts` (adverse-aware maker), `ioc-loop.ts` (taker), `breakout-bot.ts` (directional, OOS-validated), `backtest.ts` + `backtest-sweep.ts` (research), `operator-demo.ts` (⭐ non-custodial session-key, live-proven), `cancel-all.ts`, `pnl.ts`
- [x] **Screenshots/videos** — final leaderboard captured 2026-07-08 (`dreamdex-leaderboard-new.vercel.app`, 6 traders, updated-3m-ago); plus bots running, pnl.ts output, fills
- [ ] **Post-comp (optional): testnet end-to-end coverage** of the mutating/auth-gated paths — not completed during the comp window (see report "Coverage gaps")

> **Full stress-test + doc-validation deliverable: [`docs/cohort2-stress-test-report.md`](cohort2-stress-test-report.md)** — covers all 3 program objectives. The 13 items below are the originally-logged subset; the report expands them to 28 bugs (B1–B28) + doc-fix tables, extended here by B29–B31. The report's 2026-07-06 re-validation table is the CURRENT doc-fix list.

---

## Bug reports (discovered live)

1. **`getOwnOpenOrders(account)` reverts** with bare `require(false)` (no data) on the mainnet SpotPools — cannot enumerate one's own resting orders on-chain. Workaround: scan `OrderPlaced` events and decode the `Order` tuple owner. *Impact: makers can't cleanly cancel/manage their book.* **[CORRECTED — see report B1: root cause was OUR ABI's wrong signature `getOwnOpenOrders(address)`; the docs-correct no-arg `getOwnOpenOrders()` (0xe1f57e0c) works live. Residual protocol feedback: a wrong-signature call bare-reverts `0x` with no signal.]**

2. **`getBookLevels(isBid, depth)` reverts even when the book is populated** — on-chain order-book read is unreliable; had to use REST `GET /v0/orderbooks` for mid/touch. *Impact: on-chain bots can't read depth.* **[CORRECTED — see report B2: our ABI used `uint8` for the depth param; the live `getBookLevels(bool,uint64)` works and returns populated levels.]**

3. **Bare `require(false)` reverts with no revert string / custom error** across many failure modes (deprecated function, would-cross PostOnly, etc.) — extremely hard to debug; the `data="0x"` gives no signal. *Suggestion: add named custom errors / revert reasons.* **[REVISED — see report B22: real failure paths DO revert with named errors (e.g. `QuantityBelowMinimum`=`0xeaa68ceb`); most of our bare-`0x` reverts came from calling wrong repo-ABI signatures. The actual gap = no consolidated selector→error catalog in the docs, plus a few genuinely unnamed paths (B14 deprecated fn, B31 spot over-balance).]**

4. **`placeTakerOrderWithoutVault` was deprecated mid-program (cohort 1)** with no in-doc deprecation notice — every taker order suddenly reverted `require(false)` until we migrated to `placeOrder`. *Suggestion: changelog + deprecation warnings; the silent revert cost hours to diagnose.*

11. **Builder codes: docs say DISABLED at v1.0, but they are ENABLED on-chain.** `builder-fees.md` / `contracts/functions.md` state that at v1.0 launch `getMaxBuilderFeeBpsTimes1k()` is `0` and any non-zero builder reverts `BuilderCodesNotSupported` ("ships with v1.1"). Live mainnet (chain 5031) `getMaxBuilderFeeBpsTimes1k()` returns `0x186a0` = `100000` (= **100 bps cap**) on ALL three eligible SpotPools (WETH `0xa936da…`, WBTC `0x25bfF6…`, SOMI `0x035De7…`). So the feature is already live, contradicting the docs. *Suggestion: update the docs to reflect the live 100 bps cap, or set the cap to 0 if it's not meant to be live yet.* **[RESOLVED in docs as of 2026-07-08: `functions.md` now states builder codes are live on mainnet with cap `100000` (100 bps), testnet 0 — the docs↔chain contradiction is closed. Residual: `roadmap.md` still frames builder-codes under "Next".]**

12. **`InsufficientGasForPayout` (`0x782b2567`) under-documented.** Native-base BUY fills revert with this selector unless the tx gas limit is generously high (~5,000,000) — it's a gas-LIMIT requirement at fill time, not an out-of-gas at submission, so naive gas estimation fails. *Suggestion: document the minimum gas limit for native-base order fills / payout path.* **[RESOLVED in docs as of 2026-07-08: `functions.md` now states "Set the tx gas limit ≥ 5,000,000 on native-base BUYs" with the `0x782b2567` selector + simulate-with-broadcast-gas guidance; the prepare-tx OpenAPI schema now documents a recommended `gasLimit` field.]**

## Documentation feedback

5. **Yield algorithm under-specified**: `trading/common/yield-algorithm` gives the formula `score = quantity × W × seconds`, `W = e^(−(P−Pmid)²/2σ²)`, but **σ, the settlement interval, and the yield-pool size are not given numerically** → impossible to estimate maker yield ex-ante or decide maker-vs-taker rationally.

6. **`OrderFilled` event signature clarity**: correct topic is `0xc87f4223…` = `OrderFilled(uint128,uint128,uint256,uint256,uint256,uint256)` (6 trailing uints incl `fillPrice`). A 5-uint variant silently never matches → "no fill events". *Suggestion: make event sigs prominent in `developers/contracts/events`.*

## Documentation feedback (yield)

8. **Yield settlement interval not documented.** `yield-algorithm` says yield is "periodically settled as direct on-chain transfers" but never states the period (per-block? hourly? daily? per-epoch?). Makers can't reason about expected payout cadence or whether short resting bursts earn anything. *Suggestion: state the settlement interval.*

9. **"View historical yield rates via the Developer API" — no such endpoint exists.** The yield-algorithm page claims makers can view yield via the Developer API or Trade Interface, but the HTTP API exposes no yield/rewards/earnings endpoint. Confirmed exhaustively (2026-06): `/v0/yield`, `/v0/yields`, `/v0/rewards`, `/v0/maker-rewards`, `/v0/rebates`, `/v0/yield-rates`, `/v0/yield/history`, `/v0/collateral-yield`, `/v0/incentives`, `/v0/points`, `/v0/settlements` + per-wallet variants ALL return 404 (while `/v0/markets` + `/v0/orderbooks` return 200). No on-chain `claimYield`/`getYield` fn either; yield is described as protocol-push. *Result: the ONLY way to verify maker yield is to watch incoming USDso ERC-20 `Transfer` logs to one's wallet (token `0x00000022dA000002656c64D9eA6011ea952D008A`) across a full settlement epoch.* *Suggestion: ship the endpoint or remove the claim.* (Fees page is also marked Work-in-Progress with the yield rate as a literal `[TODO]`.)

## Documentation feedback (yield, cont.)

10. **Contradiction: is collateral yield LIVE in v1.0 or not?** `welcome/roadmap` lists "Yield-bearing collateral (for traders)" under the **"Later"** stage (idle margin lends via the lending protocol), while `trading/common/yield-algorithm` describes the yield distribution as current behaviour with a precise formula. Empirically a tight two-sided maker netted ~breakeven over 40 min (no observable yield). *Please clarify whether maker collateral yield is active during this alpha; if not-yet-live, the yield-algorithm page should say so.*

## Metric / UX feedback

7. **Leaderboard `usdsoBalance` (→ PnL → effective volume) counts only LIQUID USDso** — excludes base-token inventory AND principal locked in resting orders. For a market-maker this makes the dashboard wildly misleading: it showed `usdsoBalance $1.97 / PnL −$148 / effVol $1.81` while the true mark-to-market portfolio was ~$146 (funds were in WETH + resting orders). *Suggestion: show mark-to-market total (or a locked/available breakdown) so makers aren't penalized/confused mid-cycle; clarify whether the Day-14 snapshot marks inventory to market or only counts liquid USDso.*

## Product / roadmap feedback (market-maker economics in the Spot phase)

13. **[P1]** **Spot-only (no short) + zero observable maker incentive makes sustained two-sided market-making structurally unprofitable in down/trending regimes — which discourages exactly the liquidity the CLOB needs.** As a pure spot CLOB, a maker is always *long-or-flat* (you can only sell inventory you own; you cannot open a short). We validated this exhaustively with a backtester (`scripts/backtest-grid.ts`) over BTC and SOMI Binance klines, sweeping a two-sided cost-basis grid across spacing / margin / inventory-cap / fill-haircut (0.3–1.0) / an EMA trend-filter, at 1m–4h granularity:
    - **Volume is achievable in any regime**, but **terminal PnL is regime-determined**: positive in ranging/up markets (+$36–49 over a 666-day flat window, beating hold-50/50 by ~$48), **negative in sustained downtrends** (−$29 to −$49 per down-segment — the maker can only bag-hold or flatten to cash; it cannot profit from the drop without shorting).
    - A trend-filter only trims the downtrend bleed toward the do-nothing benchmark; it cannot make a long-only spot strategy positive when price falls.
    - With **zero fees, no maker rebate, and no observable yield** (see items 8–10 — the yield endpoint 404s and a tight two-sided maker netted ~breakeven over 40 min with no observable payout), the *only* economic outcome for a passive maker in the current Spot phase is **breakeven-at-best**. That is a weak incentive to provide liquidity.
    - **Constructive asks, tied to your own roadmap:**
      1. **Fee-rebate program ("Next" on the roadmap)** is the single highest-leverage lever to make passive market-making net-positive *during the Spot phase*. Please clarify whether **passive resting makers** earn the rebate, or only builder-code/flow-routing apps — if passive MM qualifies, it directly bootstraps book depth now, before Perpetuals.
      2. **Perpetuals ("Then")** would unlock genuinely two-sided directional MM (profit in both directions). A rough timeline would let market-makers plan capital commitment.
      3. In the interim, **document the maker incentive honestly** — if the expectation in v1.0 Spot is "makers run at breakeven for volume/points, real yield arrives with the rebate/perps phases," say so. Right now the docs imply a live yield that isn't observable, which sets the wrong expectation.

---

## Strategy notes (private — for our README later, frame as own design)
- Effective Volume = raw × (usdsoBalance/150); only the Day-14 snapshot counted. **Executed as planned:** liquidated everything to USDso before the ~2026-07-07 snapshot. (Note: week-2 ranking switched to raw volume only, superseding the effVol formula.)
- Cohort-2 plan (as executed): week-1 PnL/testing, final week volume push via `make-take.ts`; USDso liquid at snapshot.

---

## Days 7–14 addendum (live-verified 2026-07-06; supersedes stale notes above where flagged)

**Verification pass.** Re-checked the report's on-chain claims live on 2026-07-06 (chain 5031) — all still accurate:
- `getPoolParams` **WETH:USDso**: makerFee `0`, takerFee `0`, tickSize `0.01` (raw 1e16), minQuantity `0.001`, lotSize `0.0001`. **SOMI:USDso**: makerFee `0`, takerFee `0`, tickSize `0.0001` (raw 1e14), minQuantity `1.0`, lotSize `0.01`.
- `getMaxBuilderFeeBpsTimes1k` = `100000` (100 bps) on both pools → **builder codes still LIVE** (confirms B8 / item 11; docs since caught up: `builder-fees.md` fixed 2026-07-06, `functions.md` fixed by 2026-07-08 — now states live mainnet cap 100000; residual: `roadmap.md` still frames builder-codes under "Next").
- `OrderFilled` 6-uint w/ `fillPrice` (topic `0xc87f4223…`), `getWithdrawableBalance(account,token)` (vault), and no-arg `getOwnOpenOrders()` all behave as the report states.

### B29 (med) — leaderboard `usdsoBalance`/effVol is NON-DETERMINISTIC for an active bot, not just understated
Extends B21/item 7. While a bot trades, capital fluxes **free ↔ locked-in-resting-orders ↔ pool vault every second**. Measured on our own wallet within minutes: liquid USDso read **$0.32 → $12 → $75** (rest was WETH + open bids + vault), so `usdsoBalance` — hence PnL and effVol — swings wildly depending on the exact snapshot instant. Two snapshots seconds apart give very different effVol. A single `balanceOf` fooled our own monitoring twice. *Fix (as B21): rank on mark-to-market TOTAL = free + locked-in-orders (`getOrder` over `getOwnOpenOrders`) + vault (`getWithdrawableBalance`), valued at mid — deterministic and fair to makers.*

### P2 (product) — passive market-making is breakeven-at-BEST even with a fair-value overlay (strengthens item 13)
We rigorously tested the one remaining "maker can profit" hypothesis: anchor quotes to the **Binance ETHUSDT true price** (not the DreamDEX mid) to harvest DreamDEX book dislocations. Result on **real execution prices**: edge ≈ **0** (Binance-anchored edge on our recorded maker fills = −0.11 bps, 95% CI includes 0 — statistically identical to the uninformed-mid maker's −0.10 bps adverse-selection bleed). Two reasons it collapses: (1) ~half the apparent "dislocation" is a Binance-1m-kline timing artifact, not tradeable; (2) the freeze regimes (below) where dislocation is largest have **~zero taker flow** to monetize. **Conclusion: with 0/0 fees, no maker rebate, and no observable yield, a passive maker on this venue is structurally breakeven-to-slightly-negative regardless of how it's tuned** — only co-located speed (we measured ~0.8 s tx-confirm, 350 ms RPC RTT — too slow vs whoever holds the book at ~2 bps) or a genuine directional edge (our OOS-validated 1h-ETH breakout, but ~0.6 trades/day) can profit. This is the empirical backing for item 13's ask to **ship the maker rebate** or **document the breakeven expectation honestly**.

### P3 (product / stability) — recurring liquidity FREEZE regime; the book is thin + bot-dependent
Observed multiple times over the final days: the **WETH:USDso book periodically loses its LP/maker bots** → touch spread blows from the normal **~2.0–2.1 bps to 48–214 bps for HOURS** (one spike hit 432 bps) → essentially all CLOB round-trip activity stalls (our fill rate collapsed ~13×, on-chain taker flow → ~0) → then revives when a maker returns. Touch depth is thin in normal regime too (~0.03–0.05 WETH ≈ $50–90/side). **Venue liquidity is fragile and depends on a handful of bots** — exactly what a maker-rebate would stabilize. *Suggestion: a passive-maker incentive would directly harden book depth; also worth documenting expected depth/spread so takers can size clips (thin touch = walking the book above ~0.05 WETH).*

### B30 (med) — gas (SOMI) is a material, poorly-surfaced cost at bot frequency; finite-allowance footgun
An active make-take bot burns **~1.5–3 SOMI/hr** (~$3.6–7/day at SOMI ≈ $0.10) — on a fixed-capital comp, gas (bought from USDso via SOMI:USDso) is a real drag on *effective* volume that the leaderboard doesn't reflect. Two footguns hit live: (1) the SOMI:USDso swap started reverting with a bare **"execution reverted (unknown custom error)"** once the wallet's USDso→SOMI-pool **ERC20 allowance silently depleted** (an earlier finite `approve` ran out) — cost time to diagnose; fix = `approve(MaxUint256)`. (2) `ethers-v6` default 4 s `pollingInterval` adds ~2 s dead time to every `tx.wait()` on a 0.1 s-block chain — set `pollingInterval=200` to cut confirm 2.65 s → ~0.8 s (doubles a latency-bound bot's throughput). *Suggestion: name the insufficient-allowance revert; note the sub-block pollingInterval win for high-frequency bots in the docs.*

### B31 (low) — spot no-leverage revert is generic
`placeOrder` with `quantity × price > free quote balance` (or base > held) reverts **"ERC20: transfer amount exceeds balance"** (the pool escrows the full notional at post; there is no margin/leverage on spot). Expected, but a named error (`InsufficientBalanceForOrder`) would beat the raw ERC20 string. (Same family as B22 — reverts ARE named elsewhere; this path isn't.)

### Trading-activity update (final-week evidence)
Volume grew from the report's Day-1 snapshot (`volumeUsdso ≈ 42,829`) to **~875k+ raw USDso by Day-13** via the single-process **alternating maker+taker** engine (`make-take.ts`): PostOnly maker window + IOC taker round-trips on one nonce stream, with a **drift-kill** (sell only what the paired buy filled → no accidental net-short) and **dynamic taker sizing** (size the buy to free USDso → never starves). On-chain audited (Blockscout USDso-transfer sum vs WETH pool) at ~$118k/day — matched the bot log, confirming genuine (non-wash) two-sided flow. Held #1 raw for most of the final week; a tight 3-way race in the closing days. Bleed measured **~1.18 bps of volume = ½ the book spread** (structural spread-crossing cost at 0 fees, drift eliminated) — the honest floor for a volume-generating taker here.

**FINAL LEADERBOARD (2026-07-08, `dreamdex-leaderboard-new.vercel.app`):** finished **#3 by raw volume — 945,661.04 USDso** (trader-5 1,093,447.73 · trader-2 1,086,201.94 · **us 945,661.04** · trader-1 923,141.92) with **127,570 txs — the highest tx count in the cohort** (1.35× the next, 94,424; matches our live on-chain nonce exactly). PnL −146.44 (capital fully converted into volume + stress-test coverage), effective volume 22,420.24 = #4 by the board's Eff-ranking (Eff = Raw × (1 + PnL%) — equivalently raw × usdsoBalance/150). Rewards/winner announcement pending from DevRel.
