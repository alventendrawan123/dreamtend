# Feedback Report 08 — Custom Error Registry Not Published

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-28
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

## Type
**Smart Contract DX / ABI Publishing**

## Severity
**High** — Every revert from a SpotPool contract that doesn't use a string reason returns an opaque 4-byte selector + args. Without a published error registry, integrators cannot decode reverts programmatically; they fall back to substring-matching on raw hex which is brittle and impossible to maintain across contract upgrades.

## Environment
- **Network:** Somnia mainnet (chainId 5031) + testnet (chainId 50312)
- **Affected contracts:** all SpotPool deployments
- **Framework:** ethers v6 (v6.16.0), viem, web3.js — any client expecting ABI-decoded errors
- **Docs referenced:** Contracts page — has no "Errors" section

---

## Steps to Reproduce

1. Trigger any revert from a SpotPool contract via a deliberately malformed call. Easy reproductions:

   **A. `cancelOrder` on a filled order** (selector `0xf5e39c1f`):
   ```typescript
   await pool.cancelOrder(alreadyFilledOrderId);
   // → revert with selector 0xf5e39c1f + 2 uint256 args
   ```

   **B. `placeOrder` with qty not multiple of `lotSize`** (selector `0xcf479181`):
   ```typescript
   await pool.placeOrder({ quantity: 1.05e6, ... });  // lot is 1.0 USDC.e
   // → revert with selector 0xcf479181 + 2 uint256 args
   ```

   **C. `getBookLevels` on empty book** (no selector, bare `require(false)`):
   ```typescript
   await pool.getBookLevels(true, 5);  // empty BID side
   // → revert with data="0x" — entirely opaque
   ```

2. Inspect the revert data:
   ```
   $ ethers.parseTransaction(receipt.data)
   // No decoder available — selector is not in any published ABI
   ```

3. Search the Contracts docs page for "Errors", "Custom Error", or the specific selectors. **No matches.**

4. Conclude: the only way to identify what each selector means is to (a) cause it deliberately under varied conditions and pattern-match the trigger, or (b) ask the team in chat.

## Expected Behavior

A "Custom Errors" section in the Contracts docs (or an authoritative ABI JSON file) listing every revert error from each contract, with:

- **Error name** (Solidity declaration)
- **4-byte selector** (`keccak256(signature)[:4]`)
- **Args** with types and meanings
- **Common triggers** so integrators know which scenarios produce which error

Example:
```
SpotPool Custom Errors:

error OrderNotFound(address pool, uint256 orderId);
  selector: 0xf5e39c1f
  triggers: cancelOrder on a filled or non-existent orderId

error InvalidQuantity(uint256 provided, uint256 lotSize);
  selector: 0xcf479181
  triggers: placeOrder qty not a multiple of pool's lotSize

error EmptyBook(bool isBid);
  selector: 0xXXXXXXXX
  triggers: getBookLevels on an empty side  (currently uses bare require(false))
```

## Actual Behavior

The Contracts page has no Errors section. The ABI export (if any exists) does not include error definitions. Integrators see bare selectors in receipts and must reverse-engineer meanings via trial-and-error.

DreamTend's reference repo currently maintains a manual `CUSTOM_ERRORS.md` mapping (workaround):

```
0xf5e39c1f — likely OrderNotFound (cancelOrder filled/missing order)
0xcf479181 — likely InvalidQuantity (lot multiple violation)
0xab12...   — TBD (have not triggered yet)
```

Each entry is annotated with the conditions we triggered it under, but the actual error names + arg semantics are guesses based on context.

## Logs / Evidence

### Selector `0xf5e39c1f` — cancelOrder on filled order
- Bot: DreamTend
- Date: 2026-05-27 01:14:08 UTC
- Pool: USDC.e:USDso mainnet (`0x47fD2f18426f67106DBaC82F6d21D446c5F2120b`)
- Orderid attempted: `0x080000000000185d2f`
- Tx: reverted with selector `0xf5e39c1f`
- See Feedback Report 07 for full incident.

### Selector `0xcf479181` — qty/lot mismatch
- Bot: DreamTend
- Date: 2026-05-27 02:02 UTC
- Pool: USDC.e:USDso mainnet
- Attempted qty: 1.05 USDC.e (= `1050000` raw) — not multiple of on-chain lot `1000000`
- Tx: reverted with selector `0xcf479181` + args
- See Feedback Report 03 for full incident (lotSize docs/chain mismatch).

### `0x` bare revert — getBookLevels on empty book
- See Feedback Report 05.

## Impact

- **Brittle revert handling** in every integrator's code. Any error path that needs to distinguish between "already filled" vs "permission denied" vs "paused" is impossible without ABI.
- **Cross-version drift risk.** If contract gets upgraded and a selector changes meaning (or new selectors are added), every integrator's hardcoded selector-string matching silently breaks.
- **Maintenance burden** shifts to every integrator independently. Each team rediscovers the same selectors over time.
- **No-tooling friction** for popular Solidity development tools: Tenderly, Foundry's `decode-error`, ethers' `Interface.parseError()` — all rely on having the error ABI.

## Suggested Fix

In order of preference:

1. **Ship a complete `SpotPool.json` ABI file** including error definitions (in addition to function & event ABIs):
   ```
   https://docs.dreamdex.io/abi/SpotPool.json
   ```
   Solidity 0.8.x compilers already emit error ABIs by default; this is just publishing what's already generated.

2. **Add a "Custom Errors" section to the Contracts docs page** listing every error name + selector + args, organized by which function emits them. Provides human-readable reference even for teams that don't import ABI files.

3. **Tag selectors with deprecation policy.** Document that any selector listed will not change meaning across contract upgrades; new errors get new selectors. Gives integrators confidence to pattern-match safely.

## Acceptance Criteria

This report would be resolved when:
- [ ] An authoritative ABI artifact for SpotPool (and any sibling contracts) is published at a stable URL.
- [ ] The Contracts docs page lists every custom error with selector + args.
- [ ] At least one code example in docs shows: catch revert → decode via Interface.parseError → branch on error name (not on hex string).

---

*Reported in good faith. Bot's manual selector mapping is in the reference repo at `src/utils/custom-errors.ts` (if it ends up being formally maintained); otherwise commentary lives in the source as TODO comments where each selector is matched.*
