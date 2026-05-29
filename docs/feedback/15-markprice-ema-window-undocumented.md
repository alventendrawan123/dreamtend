# Feedback Report 15 — `markPrice` EMA Window (`updateIntervalSec`) Undocumented

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-29
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

## Type
**Docs Gap / Stop-Order Mechanics**

## Severity
**Medium** — Stop-loss / take-profit triggers fire off the EMA-smoothed `markPrice`, but the smoothing window / update interval is undocumented, so integrators cannot predict trigger latency or how far the trigger price lags the raw market.

## Environment
- **Docs:** `trading/readme-1/stop-orders.md` + the `MarkPriceUpdated` event / types reference
- **Network:** Somnia mainnet (chainId 5031)

---

## Steps to Reproduce

1. Read the stop-order docs: triggers use the **EMA-smoothed midpoint** (`markPrice`), not the raw midpoint.
2. Read the `MarkPriceUpdated(asset, markPrice, rawMidpoint)` event description: `markPrice` "advances at most one step per `updateIntervalSec`."
3. Try to find the deployed `updateIntervalSec` value (and the EMA window length / smoothing factor). The type definition only bounds it generically (`>0 and <=86400`); **no configured value is published.**
4. Conclusion: you cannot predict (a) how quickly a stop will trigger after the raw price crosses your level, or (b) how much `markPrice` lags `rawMidpoint` during a fast move.

## Expected Behavior

Docs should publish:
- The deployed `updateIntervalSec` per pool (or globally).
- The EMA window length / smoothing coefficient used to compute `markPrice` from `rawMidpoint`.
- A note on expected trigger latency (e.g., "a stop may lag the raw price by up to `updateIntervalSec` seconds plus EMA smoothing").

## Actual Behavior

The mechanism is named (EMA-smoothed markPrice, `updateIntervalSec` gated) but the actual deployed values are absent. The type bound (`<=86400`, i.e., up to a day) is uselessly wide — a 1-second interval and a 1-hour interval behave very differently for stop triggering, and integrators can't tell which they're getting.

## Logs / Evidence

From the types/event docs: `markPrice` "advances at most one step per `updateIntervalSec`," with `updateIntervalSec` constrained only to `>0 and <=86400`. No per-pool deployed value or EMA window is given anywhere in the docs.

## Impact

- **Stop-order behavior is unpredictable.** A trader setting a stop can't know whether it triggers near-instantly or lags by seconds/minutes, which matters for risk management.
- **MEV / front-run reasoning impossible.** Whether stops are EMA-lagged affects how exploitable they are; integrators can't assess this.
- Compounds with Feedback Report 12 (stop-order lifecycle undocumented) — together they make on-chain stops hard to adopt confidently.

## Suggested Fix

1. Publish the deployed `updateIntervalSec` and EMA window/coefficient on the stop-orders page.
2. Add a one-line "expected trigger latency" guidance.
3. (Bonus) Expose `updateIntervalSec` via a read function so bots can adapt.

## Acceptance Criteria

- [ ] Deployed `updateIntervalSec` (and EMA window) is documented per pool.
- [ ] Docs state the expected lag between `rawMidpoint` crossing and `markPrice`-based stop trigger.

---

*Reported in good faith. See also Feedback Report 12 (stop-order registry/lifecycle undocumented).*
