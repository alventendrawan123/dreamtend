# Feedback Report 22 — `OrderPlaced` Event: `owner` is NOT `indexed` (Docs/ABI Diverges From Deployed Contract)

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-30
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

## Type
**ABI / Docs Mismatch — Event Topic Indexing**

## Severity
**High** — The documented event signature claims `owner` is `indexed`, but the deployed `SpotPool` contract emits `OrderPlaced` with **only one indexed topic** (`orderId`). Any third-party integrator using the documented ABI to query "all orders for wallet X" via `eth_getLogs` with a topic filter on `owner` will receive **zero results**, even when the wallet is actively trading. Same bug class as Report 02 (`getPoolParams` field-count mismatch): silent, hard to diagnose, and only discoverable by reading raw receipt topics.

## Environment
- **Network:** Somnia mainnet (chainId 5031)
- **RPC:** `https://api.infra.mainnet.somnia.network`
- **Framework:** ethers v6 (v6.16.0), TypeScript 5.7
- **Pools verified:** WETH:USDso, SOMI:USDso, USDC.e:USDso, WBTC:USDso (all four mainnet SpotPool deployments)
- **Docs referenced:** https://docs.dreamdex.io/ → "Developers > Contracts" → `SpotPool.OrderPlaced` event signature

---

## Steps to Reproduce

1. Take the documented `OrderPlaced` event signature with **two** indexed parameters:
   ```solidity
   event OrderPlaced(
     uint128 indexed orderId,
     address indexed owner,
     bool   isBid,
     uint8  orderType,
     uint256 price,
     uint256 quantity,
     uint64 expireTimestampNs
   );
   ```

2. Build the standard owner-filter and call `eth_getLogs`:
   ```typescript
   const ORDER_PLACED_TOPIC =
     "0xd90f62f61ee2f606b132cfdfd883ddd079228b6fd6bffd9d7cf848daf824639d";
   const ownerTopic = ethers.zeroPadValue(targetWallet, 32);
   const logs = await provider.getLogs({
     address: SPOTPOOL_ADDRESS,
     fromBlock: lookbackStart,
     toBlock: latest,
     // Per docs: topic1 = orderId, topic2 = owner
     topics: [ORDER_PLACED_TOPIC, null, ownerTopic],
   });
   ```

3. Inspect any real `placeTakerOrderWithoutVault` or `placeOrder` transaction's receipt with `eth_getTransactionReceipt` (no ABI decode — read raw `log.topics[]`).

## Expected Behavior

Either:
- (A) The deployed contract emits `OrderPlaced` with both `orderId` AND `owner` as `indexed` topics (matching the documented signature), so a topic filter on `owner` returns all of that wallet's orders, OR
- (B) The docs reflect the actual on-chain reality: `owner` is **not** indexed and lives in the event's `data` payload.

## Actual Behavior

The deployed contract emits `OrderPlaced` with **only one indexed topic**:
- `topic[0]` = event signature hash (`0xd90f62f6...`)
- `topic[1]` = `orderId` (uint128, packed into 32 bytes)
- **No `topic[2]`** — `owner` is in the `data` payload, not the topic array

A `topics: [ORDER_PLACED_TOPIC, null, ownerTopic]` filter therefore matches **zero events** for any wallet, even one that has placed thousands of orders.

Additionally, the `data` payload contains **8 32-byte slots (256 bytes)**, but the documented non-indexed fields (`isBid, orderType, price, quantity, expireTimestampNs`) account for only 5 slots — suggesting the deployed event has additional undocumented fields, and `slot[0]` of `data` duplicates the `orderId` already present in `topic[1]`.

Empirical data layout we observed:

| `data` slot | Contents (decoded) | Notes |
|---|---|---|
| 0 | `orderId` duplicate | matches `topic[1]` byte-for-byte |
| 1 | `isBid` (bool, lower byte) | `0x01` for BUY, `0x00` for SELL — confirmed across multiple txs |
| 2 | `owner` (address) | bottom 20 bytes — the field that **should have been `topic[2]`** |
| 3 | likely `userData` (uint64) | we observed `0` here for orders placed with `orderType = IOC`, so this slot is **not** `orderType` — the docs ABI position is wrong by at least one slot |
| 4 | `price` (uint256) | raw 18-decimal price — empirically matches the price-leg of the corresponding USDso settlement transfer |
| 5 | `quantity` (uint256) | raw quantity (base-token decimals) — empirically matches the qty-leg |
| 6 | `expireTimestampNs` (uint64, packed) | high confidence |
| 7 | unknown / undocumented | non-zero, content varies per tx (likely `orderType` + packed flags, since the docs would predict `orderType` somewhere in data and we have ruled out slot 3) |

The contract therefore emits at least **one undocumented non-indexed field** beyond the docs signature.

## Logs / Evidence

Live mainnet tx from DreamTend's own genuine IOC engine — `placeTakerOrderWithoutVault` (selector `0x1c792779`) on the WETH:USDso pool. The same shape holds for any other `placeOrder` or `placeTakerOrderWithoutVault` tx we have inspected; this is one concrete reproducer that an auditor can replay end-to-end:

```
tx: 0x16a942045120e485d4aca437eba739c6d76d53349ec80840c632a8f43d1f6435
status: 1   gas: 465565
from:    0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86   (reporter wallet — DreamTend's registered wallet)
log[3] (OrderPlaced):
  address: 0xa936da11B57b50A344e1293AAaE5232885ea2bDE   (WETH:USDso pool)
  topic[0]: 0xd90f62f61ee2f606b132cfdfd883ddd079228b6fd6bffd9d7cf848daf824639d
  topic[1]: 0x00000000000000000000000000000000000000000000000200000000002a8f0b
  (no topic[2] — only TWO topics emitted; docs would predict a 3rd one with the owner)
  data (8 × 32-byte slots, 256 bytes):
    [0] 0x00000000000000000000000000000000000000000000000200000000002a8f0b  ← orderId duplicate
    [1] 0x0000000000000000000000000000000000000000000000000000000000000001  ← isBid = true (BUY)
    [2] 0x0000000000000000000000008f0a24ae910d4b89c4422b6884d71739dbc1ec86  ← owner (== `from`, == reporter wallet)
    [3] ... (orderType or userData — see note below)
    [4] ... (price)
    [5] ... (quantity)
    [6] ... (expireTimestampNs)
    [7] ... (undocumented 8th field)
```

Reproduce with our verification script (works on any `OrderPlaced` tx):

```bash
NETWORK=mainnet npx tsx scripts/dump-tx-topics.ts \
  0x16a942045120e485d4aca437eba739c6d76d53349ec80840c632a8f43d1f6435
```

The same structure (1 indexed topic + owner in data slot 2 + 8 data slots) appears on every other `OrderPlaced` log we have inspected — across all four mainnet pools and across both `placeOrder` (selector `0x4e978373`) AND `placeTakerOrderWithoutVault` (selector `0x1c792779`). The owner-in-data, 8-slot-data layout is **not pool-specific or function-specific** — it is the universal `OrderPlaced` emission shape on the current deployed SpotPool implementation.

## Impact

- **Silent zero-result filter for every owner query.** Any indexer, dashboard, analytics tool, MEV bot, or audit script that wants to list "all orders placed by wallet X" via a topic filter — the canonical, gas-cheap eth_getLogs pattern — gets **zero matches**, with no error. There is no decode failure, no exception, just an empty result set.
- **Forced fallback to full-pool scan + client-side filter.** To find a wallet's orders without the indexed owner, the consumer must `getLogs` for **every** `OrderPlaced` event on the pool, then decode `data[2]` client-side. On an active pool this is **orders of magnitude more bandwidth, RPC load, and CPU**.
- **Breaks docs-driven decoders.** `ethers.Interface.parseLog()` instantiated from the documented ABI will throw or mis-decode, because it expects `owner` at `topic[2]` and the remaining non-indexed fields offset by one slot.
- **Cross-contamination of bug-class.** Combined with the additional undocumented 8th data slot, anyone decoding the event by position (e.g. assuming `price` is at `data[3]`) will be silently off-by-one. This is the same failure mode as Report 02 (where `tickSize` was wrongly read as `lotSize`).
- **Wasted analyst hours during integration / audit work.** Our reference repo initially concluded — incorrectly — that an arbitrary wallet whose orders we were trying to enumerate must be trading through a proxy contract, because the docs-driven owner-filter returned 0 events. Only by reading raw receipt topics did we discover the indexing mismatch. Other integrators (block explorers, dashboards, MEV bots, audit tooling) will hit the same dead-end.

## Suggested Fix

Choose one of three resolutions (in order of preference):

1. **Update the docs** to reflect the deployed event signature exactly:
   ```solidity
   event OrderPlaced(
     uint128 indexed orderId,
     bool   isBid,
     address owner,
     uint8  orderType,
     uint256 price,
     uint256 quantity,
     uint64 expireTimestampNs,
     <undocumented 8th field — please name + describe>
   );
   ```
   Add a callout: "Note: `owner` is **not** indexed. To find a wallet's orders, scan all `OrderPlaced` events on the pool and filter `owner` client-side from `data` slot 2."

2. **Publish a canonical ABI artifact** (JSON or Typechain) alongside the docs, e.g. at `https://docs.dreamdex.io/abi/SpotPool.json`, so integrators can `import` the source-of-truth event signature instead of transcribing it. This would have prevented this issue entirely.

3. **Re-deploy `SpotPool`** with `owner` as `indexed` (matching the documented intent). Highest cost, but restores the natural eth_getLogs ergonomics; integrators expect "find orders by owner" to be a one-call query.

In all cases:
- **Document the 8th data slot.** What is it? `userData`? a sequence number? A maker reference? Without this, any consumer decoding by-position is silently wrong.
- **Add an integration example** to the docs showing the full `OrderPlaced` decode path — including the topic-vs-data layout — end-to-end in ethers v6 or viem.

## Acceptance Criteria

This report would be resolved when:
- [ ] The Contracts docs page's `OrderPlaced` event signature matches the on-chain emission exactly (indexed vs non-indexed parameters AND total field count).
- [ ] A published ABI artifact (JSON or Typechain) is the canonical source consumers can import directly.
- [ ] At least one integration example demonstrates `eth_getLogs` + decode of `OrderPlaced` end-to-end, including how to recover `owner` from the current (or updated) layout.
- [ ] The previously-undocumented 8th `data` slot is named and described.

---

*Reported in good faith. The reference repository's `scripts/research-wallet.ts` initially hit this exact bug — its owner-topic filter returned zero events on every pool for a wallet known to be actively trading. The fix (move owner-filter to client-side data decoding) is now in the repo; this report exists so other integrators do not lose the same hours diagnosing a silent eth_getLogs filter mismatch.*
