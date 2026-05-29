# Feedback Report 21 — Mainnet Pools Have Extended Dead Periods (No Baseline Liquidity)

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-29
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

## Type
**Liquidity / Competition Fairness / Protocol Design**

## Severity
**Medium** — Mainnet SpotPool books go completely empty for hours at a time, with no seeded baseline liquidity or market-maker-of-last-resort. Genuine taker strategies cannot fill during these windows, while self-dealing strategies (which create their own liquidity) can — pushing rational competitors toward wash trading (see Feedback Report 20).

## Environment
- **Network:** Somnia mainnet (chainId 5031)
- **Pools observed:** all four — SOMI:USDso, USDC.e:USDso, WBTC:USDso, WETH:USDso

---

## Steps to Reproduce

1. During an off-peak window, probe each pool's book:
   ```
   getBookLevels(true, 1)  // BID
   getBookLevels(false, 1) // ASK
   ```
2. Observe that **all four pools** revert (empty book) on both sides simultaneously — no resting orders anywhere.
3. Attempt a genuine IOC taker order: the `staticCall` returns `success=false` (nothing to match), so the order can't fill. Repeat over hours and the books stay empty.

## Expected Behavior

For a live mainnet (and especially a volume-based competition), there should be **baseline liquidity** so genuine takers can always trade:
- A DevRel-funded **market-maker-of-last-resort** posting wide bid/ask on each pool 24/7, OR
- Protocol-incentivized resting liquidity (the yield program is meant to do this — but if yield params are unmodelable, makers don't show up; see Feedback Report 14), OR
- At minimum, **documentation** of expected liquidity hours so integrators know when genuine trading is viable.

## Actual Behavior

We observed **all four mainnet pools empty for multi-hour stretches** (verified by repeated `getBookLevels` probes returning empty on both sides across the period). The docs confirm there is **no seeded baseline liquidity or market-maker-of-last-resort** on mainnet pools. During these windows:
- A genuine taker (our IOC engine) sim-skips every cycle (no liquidity to take) → zero volume.
- A self-dealer (posts its own maker order, then takes it) generates volume regardless → unaffected by the dead book.

So the dead-pool periods **disproportionately advantage wash trading** over genuine flow.

## Logs / Evidence

```
Audit @ ~20:52 mainnet (all 4 pools, both sides):
  WETH:USDso   BID empty / ASK empty
  SOMI:USDso   BID empty / ASK empty
  USDC.e:USDso BID empty / ASK empty
  WBTC:USDso   BID empty / ASK empty
```
Our IOC engine's fill rate dropped from ~100% (active hours) to 0% (dead window) across these probes, with gas barely consumed (sim-skip, no broadcasts). Docs contain no mention of seeded baseline liquidity.

## Impact

- **Genuine takers stall** during dead windows — they literally cannot generate volume, while the competition rewards volume.
- **Pushes competitors toward wash trading** (the only volume source when books are empty), compounding the metric-integrity problem in Feedback Report 20.
- **Poor UX for new integrators:** a tester who connects during a dead window sees "nothing fills" and may conclude the DEX/their integration is broken, when the book is simply empty.

## Suggested Fix

1. Run a DevRel-funded market-maker-of-last-resort posting wide bid/ask on each mainnet pool (especially during the competition) so genuine takers can always fill.
2. Make the yield program's parameters concrete (Feedback Report 14) so third-party makers are incentivized to provide resting liquidity organically.
3. Document expected liquidity windows / current liquidity sources so integrators know what to expect.

## Acceptance Criteria

- [ ] Mainnet pools have non-empty books a strong majority of the time (e.g., ≥90% when probed), OR
- [ ] Docs clearly state the liquidity model and expected active windows.
- [ ] Genuine taker strategies are not structurally disadvantaged vs self-dealers during off-peak.

---

*Reported in good faith. DreamTend's genuine IOC engine idled (safely, no gas waste) through multi-hour dead windows while observing that self-dealing strategies kept generating volume — a baseline-liquidity layer would let genuine takers compete fairly and reduce the wash-trading incentive (see Feedback Report 20).*
