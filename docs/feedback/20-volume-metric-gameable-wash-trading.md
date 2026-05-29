# Feedback Report 20 — Volume Metric Inflatable via Cross-Wallet Self-Dealing

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-29
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

## Type
**Competition Mechanics / Protocol Metric Integrity**

## Severity
**High** — The headline competition KPI (trading volume) can be inflated arbitrarily via self-dealing between an operator's own wallets, with no on-chain or leaderboard distinction from genuine, counterparty-diverse volume. This rewards wash trading over real liquidity provision and undermines the metric the competition is built on.

## Environment
- **Leaderboard:** https://dreamdex-leaderboard-super-cool.vercel.app/ (KPI = on-chain trading volume)
- **Network:** Somnia mainnet (chainId 5031)
- **Relevant contract feature:** `SelfMatchingOption` (`cancelTaker` / `cancelMaker`)

---

## Observation (from our own implementation)

DreamTend built a **self-cross** mechanism early in the competition (`scripts/cross-loop.ts`): one of our own wallets posts a PostOnly maker order and another of our wallets takes it via IOC. Both transactions are real and on-chain, and the resulting `OrderFilled` volume counts toward the leaderboard — **but there is no genuine counterparty, no price discovery, and no economic risk transfer.** It is, in substance, wash trading.

We deliberately kept this minimal (~$5-30) and pivoted to genuine taker trading against real external liquidity, because we wanted clean, defensible volume. But the mechanism works precisely because the metric cannot tell self-dealing apart from genuine flow.

## The gap

1. The on-chain **`SelfMatchingOption`** prevents a *single wallet* from matching its own resting order. This is good — but it only covers the single-wallet case.
2. **Cross-wallet self-dealing is undetected.** Wallet A (maker) + Wallet B (taker), both controlled and funded by the same operator, can churn volume indefinitely. `SelfMatchingOption` does not fire (different addresses), and the leaderboard counts every fill.
3. Multi-wallet operation is explicitly permitted (per DevRel guidance on AI-agent wallets), which is reasonable — but combined with (2), it makes the volume KPI **fully gameable**: an operator can post-and-take their own orders across N wallets to manufacture arbitrary volume with zero genuine market participation.

## Expected Behavior

The competition's volume metric should reward **genuine** liquidity/flow, not self-dealing. Options:
- **Detect linked wallets:** discount or flag volume where maker and taker wallets are funded from / sweep back to a common source (an on-chain funding-graph heuristic).
- **Counterparty-diversity weighting:** weight a wallet's volume by the diversity of distinct counterparties it traded against (self-dealing collapses to near-zero weight).
- **Net-flow / inventory-turnover metric:** reward volume that actually moves inventory between independent parties, not round-trips within one operator's wallet set.

## Actual Behavior

All fills count equally. A genuine taker that depends on external liquidity (and therefore stalls when the book is empty — see Feedback Report 21) is out-competed on the leaderboard by self-dealers who manufacture volume independent of real market conditions. The metric inverts the intended incentive: it rewards manufacturing volume over providing real liquidity.

## Logs / Evidence

- Our own `scripts/cross-loop.ts` demonstrates the mechanism: W3 maker + registered-wallet taker on SOMI:USDso, generating on-chain `OrderFilled` volume with no external counterparty.
- The on-chain `SelfMatchingOption` enum (cancelTaker/cancelMaker) confirms single-wallet self-match is guarded — but nothing guards the cross-wallet case.

## Impact

- **The headline KPI is gameable**, so the leaderboard may not reflect genuine trading skill or real liquidity contribution.
- **Perverse incentive:** rational competitors are pushed toward wash trading (it's the highest-volume-per-unit-effort strategy, and unbounded by real liquidity), away from genuine market-making/taking.
- **Audit burden:** distinguishing genuine from manufactured volume after the fact (which the team has indicated it intends to do for capital-rule compliance) is far harder than building the distinction into the metric up front.

## Suggested Fix

1. Add a self-dealing discount to the leaderboard: detect maker/taker wallet linkage via on-chain funding graph and down-weight intra-operator volume.
2. Publish the rule so competitors know genuine flow is what's rewarded.
3. (Longer term) consider a counterparty-diversity or net-inventory-turnover metric alongside raw volume.

## Acceptance Criteria

- [ ] Leaderboard volume distinguishes (or discounts) self-dealing / cross-wallet wash volume from genuine counterparty-diverse flow.
- [ ] The rule is documented in the competition guidelines.

---

*Reported in good faith. DreamTend chose to compete on genuine taker volume rather than maximize via self-cross — we'd rather the metric rewarded that choice. Multi-wallet operation itself is legitimate and useful (we use it); the gap is specifically that the volume metric can't tell self-dealing from genuine flow.*
