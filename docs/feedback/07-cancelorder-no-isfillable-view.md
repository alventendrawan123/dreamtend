# Feedback Report 07 — `cancelOrder` Custom-Error Revert + Missing `isOrderFillable` View

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-28
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

## Type
**Smart Contract DX / Custom Error Surface**

## Severity
**Medium** — Recovery-flow papercut. Hits any bot trying to cancel orders that may have been filled in the meantime. Opaque revert selector + no introspection view forces trial-and-error.

## Environment
- **Network:** Somnia mainnet (chainId 5031)
- **RPC:** `https://api.infra.mainnet.somnia.network`
- **Affected pools:** all SpotPool contracts (verified on USDC.e:USDso)
- **Framework:** ethers v6 (v6.16.0)
- **Affected functions:** `cancelOrder(uint128 orderId)`

---

## Steps to Reproduce

1. Place two orders on the same pool. Capture the emitted `orderId` from each receipt.
2. Wait long enough for the order book to potentially fill one of them (e.g., 60-300 seconds during active hours).
3. Attempt to cancel both via `cancelOrder(orderId)` without first checking whether each is still active:
   ```typescript
   await pool.cancelOrder(orderId1);  // may or may not still be active
   await pool.cancelOrder(orderId2);
   ```
4. If one order was already filled before the cancel attempt, observe a revert with custom selector:
   ```
   revert data: 0xf5e39c1f...
   ```
   No human-readable error name. No exported ABI for the selector.
5. The other order (still resting) cancels successfully, refunding its locked vault balance.

## Expected Behavior

Either:
- (A) `cancelOrder(filledOrderId)` returns a no-op or boolean `false` instead of reverting (idempotent semantics), OR
- (B) The revert is a named custom error documented in the Contracts page with its ABI, e.g.:
  ```solidity
  error OrderNotFound(address pool, uint256 orderId);
  // selector: 0xf5e39c1f
  ```
  So callers can decode the revert programmatically and branch on it.
- (C) A new view function `isOrderFillable(uint128 orderId) view returns (bool exists, bool filled, uint256 remaining)` so callers can pre-check before cancel.

## Actual Behavior

The pool contract reverts with raw custom-error selector `0xf5e39c1f` followed by 2 uint256 args. The selector is not published in the Contracts docs or the SDK ABI file. Integrators must:

1. Wrap every `cancelOrder` in try/catch.
2. Match on the hex selector string (brittle across ethers versions).
3. Assume any revert means "order already filled" — but it could also be "order belongs to different wallet", "contract paused", "selector matches a different error entirely".

There is also no pre-check view function, so bots cannot determine whether a given orderId is still cancelable without attempting the cancel.

## Logs / Evidence

DreamTend bot incident, 2026-05-27, mainnet USDC.e:USDso (`0x47fD2f18426f67106DBaC82F6d21D446c5F2120b`):

```
[01:14:08] INFO   Cancel attempt 1/2
                  orderId: 0x080000000000185d2f
                  txReceipt:
                    status:   0  (REVERTED)
                    gasUsed:  ~52000
                    revertData: 0xf5e39c1f...
                    decoded:  (unknown custom error)

[01:14:12] INFO   Cancel attempt 2/2
                  orderId: 0x0a0000000000185d73
                  txReceipt:
                    status:   1  (OK)
                    refunded: 1.5 USDso to vault
```

Hypothesis: the first orderId was fully filled by an external taker between our placeOrder and our cancelOrder attempts. Once filled, cancel is impossible because the order no longer exists in the active set. The contract reverts with this case-specific custom error — operationally normal behavior, but the lack of decoding ABI means the bot can't distinguish "already filled" from "permission denied" or "contract paused".

Recovery script (`scripts/recover-orders.ts` in our reference repo) currently:
1. Scans recent `OrderPlaced` events to find our orphan orderIds
2. Attempts `cancelOrder` on each
3. Catches revert as "already filled, no action needed"
4. Logs both success and revert cases for human review

This brittle pattern would be eliminated by either of the suggested fixes below.

## Impact

- **Recovery-flow brittleness:** Every recovery script must blanket-catch reverts. If the contract starts using selector `0xf5e39c1f` for a different error in a future version, recovery silently breaks.
- **Lost diagnostic signal:** When a real "permission denied" or "pool paused" error occurs, it's indistinguishable from the common "already filled" case.
- **Wasted gas:** Each cancel attempt against a filled order burns ~52k gas. A bot trying to clean up 20 orphan IDs after a crash spends ~$0.50 in gas on guaranteed reverts.
- **No pre-check primitive:** A `isOrderFillable` view would let cancel logic branch deterministically, saving gas and giving operators a clear picture of order state.

## Suggested Fix

In order of preference:

1. **Add `isOrderFillable(uint128 orderId)` view function:**
   ```solidity
   function isOrderFillable(uint128 orderId) external view returns (
     bool exists,
     bool filled,
     uint256 remainingQuantity,
     address owner
   );
   ```
   Bots use this before cancel to skip non-cancelable orders. Zero gas, zero ambiguity.

2. **Publish the custom error registry.** Add a "Custom Errors" section to the Contracts docs page listing every error name + selector + args:
   ```
   error OrderNotFound(address pool, uint256 orderId);
     selector: 0xf5e39c1f
   error NotOrderOwner(address caller, address owner);
     selector: 0xXXXXXXXX
   error PoolPaused();
     selector: 0xXXXXXXXX
   ```
   See also Feedback Report 08 (custom error registry — combined treatment).

3. **Make `cancelOrder` idempotent.** For a filled orderId, return without reverting (and emit a `CancelNoOp(orderId)` event for observability). This is the simplest UX win but is a contract-side change that requires coordinated rollout.

## Acceptance Criteria

This report would be resolved when:
- [ ] An `isOrderFillable` view exists OR `cancelOrder` is idempotent on filled orders.
- [ ] The custom error `0xf5e39c1f` (and any sibling errors) is published in the docs with ABI + decoded args.
- [ ] An ethers/viem code example in the docs shows the recommended cancel pattern (pre-check → cancel → handle revert).

---

*Reported in good faith as a contributor to the DreamDEX Alpha Testing programme. Original raw note: `docs/feedback/OBSERVATIONS.md` Obs-007. See also `scripts/recover-orders.ts` in the reference repo for the current workaround.*
