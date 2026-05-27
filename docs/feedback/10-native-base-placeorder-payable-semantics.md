# Feedback Report 10 — `placeTakerOrderWithoutVault` Payable Semantics For Native-Base Pools

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-28
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

## Type
**Smart Contract Function Semantics / Docs Gap**

## Severity
**High** — Wrong `msg.value` on the SOMI/USDso pool causes silent failure or "InsufficientBalance"-class reverts. The relationship between `quantity`, `isBid`, and `msg.value` is non-obvious and undocumented for pools where the base token is the chain's native asset.

## Environment
- **Network:** Somnia mainnet (chainId 5031)
- **Affected pool:** SOMI:USDso (`0x035De7403eac6872787779CCA7CCF1b4CDb61379`)
- **Affected function:** `SpotPool.placeTakerOrderWithoutVault(...)` (and presumably `placeOrder(...)` too)
- **Framework:** ethers v6 (v6.16.0)
- **Docs referenced:** Contracts > placeOrder section — no native-base callout

---

## Steps to Reproduce

Set up: registered wallet with 8 SOMI native + $24 USDso. We want to SELL 1 native SOMI for USDso via an IOC taker order at limit price $0.10 (very low, ensures fill at market ~$0.16):

### Attempt 1 — Try the "obvious" non-payable call (matches WETH/USDso pattern)

```typescript
const args = [
  false,           // isBid (SELL)
  0n,              // tickIndex (unused for IOC)
  parseUnits("0.10", 18),  // priceRaw (limit)
  parseUnits("1", 18),     // qty (1 SOMI)
  futureNs,        // expireNs
  2,               // IOC orderType
  0,               // selfMatchProtection
  ZERO,            // builder
  0n               // builderFeeBpsTimes1k
];
await pool.placeTakerOrderWithoutVault(...args);
// → reverts. Symptoms: similar to "insufficient balance"
```

Cause: with no `msg.value` attached, the contract sees zero native SOMI sent — but the SELL leg requires the taker to deliver the qty in base token (which is native SOMI for this pool).

### Attempt 2 — Discover via trial that the call must be payable

```typescript
await pool.placeTakerOrderWithoutVault(...args, { value: parseUnits("1", 18) });
// ↑ msg.value matches qty
// → tx succeeds
```

The pool contract pulls the 1 native SOMI from `msg.value` to deliver as the base side of the taker SELL.

### Attempt 3 — Confirm the inverse direction does NOT need msg.value

```typescript
// IOC BUY 1 SOMI with USDso (no native SOMI needed)
const buyArgs = [true /* isBid */, ...rest];
await pool.placeTakerOrderWithoutVault(...buyArgs);
// → tx succeeds without msg.value, USDso is pulled via the prior approve() call
```

So the rule is asymmetric: **SELL on a native-base pool requires `msg.value === qtyRaw`**. BUY does not.

The docs do not call out this asymmetry for pools where `baseToken == native`.

## Expected Behavior

The Contracts docs page should include a "Native Base Token Pools" callout under the placeOrder/placeTakerOrderWithoutVault sections. Specifically:

```markdown
### Native Base Token Pools

For pools where the base token is the chain's native asset (e.g. SOMI:USDso on Somnia
mainnet), the SELL leg of any `placeOrder` / `placeTakerOrderWithoutVault` call
requires `msg.value === qtyRaw`:

```solidity
pool.placeTakerOrderWithoutVault{value: qtyRaw}(
  /* isBid: */ false,
  /* ...rest of args */
);
```

The BUY leg does NOT need msg.value — the quote token (USDso) is pulled via
the pool's standard ERC20 transferFrom flow.
```

Plus a code snippet in the integrator example showing both directions side-by-side.

## Actual Behavior

The docs treat all pools uniformly. No callout for native-base pools. The function is implicitly payable, but this is only visible in the ABI's `stateMutability: "payable"` field (which most integrators don't read).

DreamTend hit this during early experimentation on SOMI:USDso self-cross: the first IOC SELL attempt reverted, and the diagnosis took ~40 minutes to identify that `msg.value` had to be attached. The fix in `scripts/ioc-loop.ts` and `scripts/cross-loop.ts` is straightforward once known:

```typescript
const txOpts = (isNativeBase && !isBid) ? { value: qtyRaw } : {};
await pool.placeTakerOrderWithoutVault(...args, txOpts);
```

But every integrator must rediscover this independently.

## Logs / Evidence

### Successful SELL on SOMI:USDso (post-fix)
- Date: 2026-05-27 16:30 UTC
- Bot: DreamTend cross-loop
- Pool: SOMI:USDso (`0x035De7403eac6872787779CCA7CCF1b4CDb61379`)
- `msg.value`: 1.0 SOMI (= `parseEther("1")`)
- Filled against W3's PostOnly maker BID
- TX value column on explorer shows `1 SOMI` — visible signal that the call was payable

### Failed SELL attempt (pre-fix)
- The early failed attempt did not produce a clean error; ethers reported simulation failure. After adding `{ value }`, the same args succeeded.

## Impact

- **Onboarding cost:** First-time SOMI:USDso integrators lose 30-60 minutes diagnosing the payable requirement.
- **Strategy gaps:** Bots that don't realize they need `msg.value` may abandon native-base pools entirely, missing the volume opportunity.
- **Generalization risk:** As DreamDEX adds more pools where the base is native (or where base is a token requiring special handling), this pattern compounds — each new pool brings the same asymmetric semantics for new integrators.

## Suggested Fix

In order of preference:

1. **Add "Native Base Token Pools" callout to docs.** One paragraph + code snippet covers it.

2. **Update ABI/SDK to embed the rule.** Generate helper wrappers like `placeTakerSellNative(qty, price, ...)` that automatically attach `msg.value`. Hides the asymmetry behind a clean API surface.

3. **Surface in `getPoolParams()`** with an `isNativeBase` boolean. So bots can branch on the field at startup and choose the right payment path without per-pool hardcoding.

4. **Symmetric contract design:** wrap native SOMI in a WSOMI-style ERC20 internally and treat all pools the same way at the SpotPool surface. This is the most invasive but eliminates the asymmetry entirely.

## Acceptance Criteria

This report would be resolved when:
- [ ] Docs include explicit "Native Base Token Pools" section with code snippet showing payable SELL pattern.
- [ ] A new integrator can place a SELL on SOMI/USDso on their first attempt by following docs.
- [ ] OR the ABI/SDK exposes an `isNativeBase` query so bots can detect the requirement programmatically.

---

*Reported in good faith. See `scripts/cross-loop.ts` and `scripts/ioc-loop.ts` in the reference repo for working examples of the payable SELL pattern.*
