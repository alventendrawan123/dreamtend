# Feedback Report 14 — Yield Algorithm Parameters Undocumented (σ, Cadence, Eligibility)

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-29
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

## Type
**Docs Gap / Incentive Mechanism**

## Severity
**High** — The yield (maker rewards) mechanism is the core economic incentive for providing liquidity, but the parameters needed to model it are missing. An integrator cannot estimate APR, size positions, or design a rational market-making strategy without them.

## Environment
- **Docs page:** `trading/common/yield-algorithm.md` (https://docs.dreamdex.io/ld25g222WKDrLlJMcR41/trading/common/yield-algorithm)
- **Network:** Somnia mainnet (chainId 5031)

---

## Steps to Reproduce

1. Open the Yield Algorithm docs page.
2. Read the reward formula and weighting factors:
   ```
   W = e^(-(P_order - P_mid)^2 / 2σ^2)   (Gaussian proximity weight)
   Weighting factors: Notional Value + Time in Book + Proximity to Mid-price
   Book state tracked "in real-time (i.e. on each block)"; yield "periodically
   settled to the user's margin sub-account."
   ```
3. Try to compute the expected yield for a concrete maker order (e.g., 100 USDso resting 5 ticks from mid for 10 minutes). **You cannot** — the required parameters are absent:
   - **σ** is described only qualitatively ("how quickly yield rewards drop off") with **no numeric value**.
   - **"Periodically settled"** gives **no interval** (per block? per hour? per epoch?).
   - **Eligibility** is unspecified: must the order be PostOnly? Is there a minimum size or minimum time-in-book? Is there an early-cancel penalty / clawback?

## Expected Behavior

The yield page should publish the concrete parameters needed to model rewards:
- The deployed **σ** value (or per-pool σ table).
- The **settlement cadence** (e.g., "settled every N blocks / every epoch of T seconds").
- **Eligibility rules**: order types that qualify (PostOnly only? any maker?), minimum notional / minimum time-in-book, and any early-cancel penalty.
- A **worked example**: "a 100-USDso order resting X ticks from mid for T minutes earns ≈ Y USDso," so integrators can sanity-check their own math.

## Actual Behavior

The formula and the three qualitative factors are given, but every quantitative input (σ, cadence, eligibility thresholds, penalties) is omitted. Integrators must reverse-engineer rewards from on-chain settlement observations over days, or avoid maker strategies entirely (which is what DreamTend did — we ran taker-only IOC partly because the maker-yield economics were unmodelable from docs).

## Logs / Evidence

Direct from the yield page (paraphrased from current docs): the σ term is explained as controlling "how quickly yield rewards drop off as your order moves away from the mid-price," with no value attached; settlement is "periodic" to the margin sub-account with no stated interval; no eligibility or penalty section exists.

## Impact

- **Maker strategies are undesignable.** Without σ and cadence, no one can compute expected APR or compare resting at 2 ticks vs 10 ticks from mid.
- **Pushes integrators toward taker-only strategies** (or off the platform), reducing the resting liquidity the yield program is meant to attract — self-defeating.
- **Trust gap.** A core incentive described only with a formula but no parameters reads as incomplete.

## Suggested Fix

1. Publish σ (global or per-pool), the settlement interval, and eligibility/penalty rules on the yield page.
2. Add one fully worked numeric example.
3. (Bonus) Expose a read function or REST endpoint returning the live yield params so bots can adapt programmatically.

## Acceptance Criteria

- [ ] σ, settlement cadence, and eligibility rules are documented with concrete values.
- [ ] A worked example lets an integrator reproduce an expected-yield figure.
- [ ] (Optional) yield params are queryable on-chain or via REST.

---

*Reported in good faith. DreamTend ran taker-only partly because maker-yield economics were unmodelable from the current docs — documenting these params would let future testers run informed market-making strategies.*
