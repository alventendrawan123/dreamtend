# Feedback Report 05 — `getBookLevels` Reverts on Empty Book Instead of Returning Empty Arrays

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-27
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

## Type
**Smart Contract UX**

## Severity
**Medium** — Not a correctness bug per se, but a DX cliff that hits every reactive bot. Forces all callers to wrap the view function in try/catch and assume "any revert = empty book", which is brittle.

## Environment
- **Network:** Somnia mainnet (chainId 5031) AND testnet (chainId 50312)
- **RPC:** `https://api.infra.mainnet.somnia.network`, `https://dream-rpc.somnia.network`
- **Framework:** ethers v6 (v6.16.0)
- **Affected contract function:** `SpotPool.getBookLevels(bool isBid, uint8 depth)`
- **Also affects:** `getOwnOpenOrders(address)` exhibits the same pattern

---

## Steps to Reproduce

1. Identify a SpotPool with no resting orders on one side (e.g. testnet SOMI:USDso `0x259fD6559214dd5aD3752322426eA9F9fABEFff4` during off-hours; we observed the book empty for an entire 11-hour overnight window).

2. Call `getBookLevels(true, 5)` to fetch the top 5 BID levels:
   ```typescript
   const c = new ethers.Contract(POOL, [
     "function getBookLevels(bool isBid, uint8 depth) view returns (uint256[] prices, uint256[] sizes)"
   ], provider);
   const [prices, sizes] = await c.getBookLevels(true, 5);
   ```

3. Instead of `([], [])`, the call reverts:
   ```
   CALL_EXCEPTION  (action="call", data="0x", reason="require(false)")
   ```

4. ethers throws because the static call returned `0x` with no revert reason data.

## Expected Behavior

Either:
- (A) Return `([], [])` when the book side is empty — the most natural and informative behavior, OR
- (B) Return a partial fill — if `depth=5` and only 1 level exists, return that 1, OR
- (C) Revert with a named custom error like `error EmptyBook()` so callers can decode and branch deterministically

## Actual Behavior

A bare `require(false)` revert with no decodable selector. Every caller must:
1. Wrap in try/catch
2. Match on the message string `"require(false)"` (brittle across ethers versions and RPC providers)
3. Assume any revert from this view function means "empty book" (which may not be true — could also be invalid args, contract paused, etc.)

## Logs / Evidence

Run of `scripts/probe-pool.ts WETH:USDso` on 2026-05-27 06:36 UTC:

```
[14:36:48.058] WARN  Book empty/revert
  side: "BID"
  err: "execution reverted (no data present; likely require(false) occurred
        (action=\"call\", data=\"0x\", reason=\"require(false)\",
         transaction={
           \"data\": \"0x8be6b9d300000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000005\",
           \"to\": \"0xa936da11B57b50A344e1293AAaE5232885ea2bDE\"
         },
         invocation=null, revert=null, code=CALL_EXCEPTION, version=6.16.0)"

[14:36:48.425] WARN  Book empty/revert
  side: "ASK"
  err: "execution reverted ... \"data\": \"0x8be6b9d30000…000000000000\" …"
```

`0x8be6b9d3` is the `getBookLevels(bool,uint8)` selector. The args after it are isBid=1 (true), depth=5 — perfectly valid input. Yet the call reverts.

## Impact

- **Every reactive bot must wrap in try/catch.** Without the wrap, a transient empty-book moment crashes the bot.
- **Pre-trade safety checks (recommended in SKILL.md §12 #10) become brittle.** "Always check `getBookLevels` first before placing taker orders" is the suggested pattern, but when the check ITSELF reverts, the check is harder to write than the thing it's protecting.
- **Distinguishing genuine errors from empty-book becomes impossible.** If `getBookLevels` reverts because the contract was paused or our address blacklisted, callers can't tell that apart from "book is empty" because both look like `require(false)`.
- **Same applies to `getOwnOpenOrders(address)`.** During incident recovery on 2026-05-27, this revert pattern blocked us from listing our orphan orders — we had to scan `eth_getLogs` for `OrderPlaced` events to recover orderIds.

## Suggested Fix

In order of preference:

1. **Return empty arrays for empty book.** Simplest and most predictable. Solidity supports `uint256[] memory empty;` returns; this is the cleanest fix.
   ```solidity
   function getBookLevels(bool isBid, uint8 depth) external view returns (uint256[] memory prices, uint256[] memory sizes) {
       // Existing logic but instead of require(false), just return what's there
       // (possibly fewer than `depth` levels)
   }
   ```

2. **Named custom error.** If reverting must remain for some reason:
   ```solidity
   error EmptyBook(bool isBid);
   // ...
   if (bookSide.length == 0) revert EmptyBook(isBid);
   ```
   Document the selector in the Contracts docs page so integrators can decode it.

3. **Apply the same fix to `getOwnOpenOrders(address)`.** Same revert pattern when the address has no open orders; same fix should be applied there.

## Acceptance Criteria

- [ ] `getBookLevels(true, N)` on an empty book returns `([], [])` instead of reverting
- [ ] `getOwnOpenOrders(addr)` for an address with no orders returns `[]` instead of reverting
- [ ] If reverts are kept, both errors are named (e.g. `EmptyBook()`, `NoOpenOrders()`) and their selectors are listed in the docs
- [ ] At least one example in the docs shows the correct "check book before taker order" pattern using the updated semantics

---

*DreamTend's `readBookLevels` wrapper in `src/dex/contracts.ts` catches the revert and treats it as empty book — this is the workaround pattern integrators are currently forced into.*
