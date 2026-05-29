# Feedback Report 18 — Spot Trading Page Is a Stub (No Matching-Engine Walkthrough)

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-29
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

## Type
**Docs Gap / Incomplete Page**

## Severity
**Medium** — The core "Spot" trading page is a short stub with no explanation of the matching engine (price-time priority, order-flow lifecycle, settlement). New integrators have no conceptual on-ramp to how trades actually match.

## Environment
- **Docs page:** `trading/readme-1/spot.md` (https://docs.dreamdex.io/ld25g222WKDrLlJMcR41/trading/readme-1/spot)

---

## Steps to Reproduce

1. Open the Spot trading docs page — the natural starting point for "how does spot trading work here."
2. Read it: ~300-400 words. The matching engine is mentioned exactly once, in passing ("the same matching engine that will power perpetuals in v2.0").
3. Look for: price-time-priority rules, how a taker order walks the book, partial-fill behavior, how PostOnly/IOC/FOK/GTC differ in matching, settlement flow (vault vs wallet). **None are on the Spot page.**

## Expected Behavior

The Spot page should give a conceptual walkthrough:
- **Matching model**: price-time priority (FIFO at a price level?), how a taker order sweeps levels.
- **Order types in matching**: how GTC / IOC / FOK / PostOnly behave when they hit the book.
- **Order lifecycle**: placed → rested → (partially) filled → settled, with the events emitted at each step.
- **Settlement**: where filled funds land (margin sub-account / vault / wallet), referencing the deposit model.
- A simple worked example (one taker order matching one or two resting makers).

## Actual Behavior

The Spot page is a stub. The matching engine — the single most important concept for an order-book DEX — gets one passing clause. Integrators must piece the model together from the Functions reference + event list + trial-and-error, instead of reading one coherent overview.

## Logs / Evidence

`trading/readme-1/spot.md` is ~300-400 words; the only matching-engine reference is the "same matching engine that will power perpetuals in v2.0" mention. No price-time-priority, order-flow, or settlement walkthrough appears on the page.

## Impact

- **No conceptual on-ramp.** First-time integrators (the exact audience of an alpha program) have nowhere to learn how matching works before diving into raw contract functions.
- **Slower, error-prone integration.** Without the matching model, devs make wrong assumptions (e.g., about partial fills, PostOnly crossing, IOC remainder handling) and discover them via failed txs.
- Undersells a genuinely strong feature (on-chain CLOB matching) by not explaining it.

## Suggested Fix

1. Expand the Spot page with a matching-engine section (priority rules, order-type matching behavior, lifecycle, settlement).
2. Add one worked taker-vs-maker example.
3. Cross-link to the Functions and Events references.

## Acceptance Criteria

- [ ] The Spot page explains price-time priority and how each order type matches.
- [ ] A worked example shows a taker order matching resting maker(s).
- [ ] Order lifecycle + settlement flow is described with the corresponding events.

---

*Reported in good faith. DreamTend reverse-engineered the matching behavior from the Functions reference + on-chain event observation (e.g., the `OrderFilled` / `OrderRested` semantics) — a Spot-page walkthrough would have saved that effort.*
