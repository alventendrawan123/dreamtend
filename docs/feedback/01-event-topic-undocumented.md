# Feedback Report 01 — `OrderPlaced` Event Signature Undocumented

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-27
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

## Type
**Smart Contract / Docs Gap**

## Severity
**Critical** — Causes "silent rejection" pattern: orders succeed on chain but client code believes they failed, leading to unrecoverable orphan orders and locked vault balances.

## Environment
- **Network:** Somnia mainnet
- **Chain ID:** 5031
- **RPC:** `https://api.infra.mainnet.somnia.network`
- **Framework:** ethers v6 (v6.16.0), TypeScript 5.7, Node 22.13
- **Pool:** USDC.e:USDso (`0x47fD2f18426f67106DBaC82F6d21D446c5F2120b`)
- **Docs referenced:** https://docs.dreamdex.io/ld25g222WKDrLlJMcR41/ → "Trading > Spot > Contracts" section

---

## Steps to Reproduce

1. Compute the `OrderPlaced` event topic from a guess based on docs:
   ```typescript
   const topic = ethers.id(
     "OrderPlaced(uint128,address,bool,uint8,uint256,uint256,uint64)"
   );
   // → 0xab3b34d17edf17a0ae16689862fd0c473a207b199178b96f0bf71cd63a55edfa
   ```
2. Sign and broadcast a `placeOrder(...)` call against a SpotPool contract.
3. After the tx is mined (`status=1`, confirmed), inspect `receipt.logs[].topics[0]`:
   ```
   0xd90f62f61ee2f606b132cfdfd883ddd079228b6fd6bffd9d7cf848daf824639d
   ```
4. Topic from step 1 does **not** match the topic from step 3, so any event verification check (`receipt.logs.some(l => l.topics[0] === guess)`) returns `false`.
5. Client code that uses this pattern (recommended in the "Silent Rejection" guidance from documentation) throws an error and treats the broadcast as failed, even though the order is actually resting on the book.

## Expected Behavior

Either:
- (A) The docs/Contracts page publishes the **exact Solidity event signature** (struct field order + types) so the topic can be computed deterministically, OR
- (B) The docs publish the topic hash directly alongside the event description, with a copy-pasteable example.

Ideally **both** — plus a Hardhat/Foundry test or ethers snippet in the docs showing end-to-end "place order + verify event" decode.

## Actual Behavior

The "Event Schema" reference (and matching section in SKILL.md notes shared in the alpha group) lists `OrderPlaced` with only the indexed `orderId` and a `placedOrder` "struct" parameter without expanding the struct's fields, types, or order. No topic hash is published.

The actual on-chain topic must be reverse-engineered by:
1. Broadcasting a real `placeOrder` tx
2. Fetching the receipt via `eth_getTransactionReceipt`
3. Reading `logs[0].topics[0]` and using that as the hard-coded constant

This works for those who know to do it, but it is **silently wrong** for first-time integrators. The DreamTend bot lost 1.5 USDso of vault liquidity to "phantom orders" before this was diagnosed — funds that had to be manually recovered by scanning blocks with `eth_getLogs` (filter by `topic[0]`) and calling `cancelOrder` against each discovered ID.

## Logs / Evidence

### On-chain proof
Two successful `placeOrder` transactions on Somnia mainnet:

| Tx hash | Block | Status | OrderId emitted |
|---|---|---|---|
| `0x79d4b340ad448571a5b7ea461d33ebff81128c67e124700cff636bfd08157dcf` | 317034820 | 1 (ok) | `0x080000000000185d2f` |
| `0x53a7018b7985157ea9dcc697592e6888f142f91744ad8303e864368c25c4d0e0` | 317035239 | 1 (ok) | `0x0a0000000000185d73` |

Both txs emitted 2 events at the pool address:
- `topics[0]=0xd90f62f6…` — actual OrderPlaced
- `topics[0]=0xcdd45acd…` — likely OrderRested (also undocumented)

### Client-side incident log
```
[2026-05-27 00:32:22] INFO    placeOrder simulation passed, broadcasting
[2026-05-27 00:32:24] INFO    tx mined status=1 hash=0x79d4b340…
[2026-05-27 00:32:24] ERROR   GotchaError: [SILENT_REJECTION] Tx mined but
                              OrderPlaced event missing — silent rejection.
                              (← false positive: event WAS there,
                                 topic just didn't match guess)
[2026-05-27 00:32:24] INFO    Strategy error recorded; myBid stays undefined
…
[2026-05-27 00:36:50] SIGTERM received → cancelAll() → no orders to cancel
                       (1.5 USDso silently locked in resting bids)
```

### Recovery
A manual recovery script (`scripts/recover-orders.ts` in the reference repo) had to be written:
1. `eth_getLogs` with `topics[0] = 0xd90f62f6…` over recent blocks
2. Extract `orderId` from `topics[1]`
3. Call `cancelOrder(orderId)` for each — partially worked (one had filled in the meantime, returning `OrderNotFound`)

## Suggested Fix

Three changes, in priority order:

1. **Publish exact event ABI on the Contracts page.** A code block like:
   ```solidity
   event OrderPlaced(
     uint128 indexed orderId,
     // struct PlacedOrder { ... }
     address owner,
     bool isBid,
     uint8 orderType,
     uint256 price,
     uint256 quantity,
     uint64 expireTimestampNs
   );
   // topic[0] = 0xd90f62f61ee2f606b132cfdfd883ddd079228b6fd6bffd9d7cf848daf824639d
   ```
   removes the entire class of "wrong topic" bugs across every language.

2. **Ship typed ABI artifacts** alongside the docs:
   - A `.json` ABI file for ethers / viem / web3.js consumers
   - Typechain `.ts` declarations
   - viem `parseAbi` strings
   These eliminate the reverse-engineering step entirely.

3. **Add a "Common pitfalls" callout** under the Event Schema section linking to a self-contained "verify event in receipt" example. The current "Silent Rejection" guidance is a footgun *without* the topic hash.

---

## Impact Summary

- **Real loss in this case:** ~$0 (recovered via manual script after ~15 minutes)
- **Time cost:** ~45 minutes diagnosing + 30 minutes building recovery tooling
- **Latent risk:** any integrator using the documented "verify event topic" pattern from a fresh ABI guess will believe their orders failed, retry them (doubling exposure), or write code that drifts apart from on-chain state silently. Risk grows with bot uptime.

## Verification — Fix Acceptance Criteria

This report would be resolved when:
- [ ] The Contracts docs page lists every event's exact signature **and** its `keccak256` topic hash
- [ ] A working ethers/viem snippet demonstrates `receipt.logs.find(l => l.topics[0] === ORDER_PLACED_TOPIC)` decoding the `orderId` and remaining fields
- [ ] Optional: published `dreamdex-abi` npm package or equivalent for type-safe integration

---

*Reported in good faith as a contributor to the DreamDEX Alpha Testing programme. Bot source code, full incident logs, and recovery scripts are available in the public reference repository above.*
