# Feedback Report 03 — Pool `lotSize` in Docs Differs From On-Chain Reality

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-27
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

## Type
**Docs Inaccuracy / Smart Contract Param Drift**

## Severity
**High** — Orders sized per documented `lotSize` get rejected by the contract with a custom error during the simulation step, wasting integration time and (without a sim-before-broadcast pattern) wasting gas.

## Environment
- **Network:** Somnia mainnet (chainId 5031)
- **RPC:** `https://api.infra.mainnet.somnia.network`
- **Framework:** ethers v6 (v6.16.0), TypeScript 5.7
- **Docs referenced:** https://docs.dreamdex.io/ld25g222WKDrLlJMcR41/trading/readme-1/contract-specifications#testnet-somnia-shannon-chain-id-50312

---

## Steps to Reproduce

1. Read the documented USDC.e:USDso pool params (or any pool) from the "Contract Specifications" docs page. Example: USDC.e:USDso lists `tickSize=0.0001, lotSize=0.01, minQuantity=1`.

2. Compute an order quantity assuming `lotSize=0.01`:
   ```typescript
   // Bot tries qty = notional / mid, then aligns to docs lot 0.01
   const qty = alignToLot(notional / mid, 0.01);  // e.g. 1.5 USDC.e
   ```

3. Submit the order via `placeOrder(...)` against the actual mainnet contract `0x47fD2f18426f67106DBaC82F6d21D446c5F2120b`.

4. The tx reverts with custom error selector `0xcf479181` and two uint256 args. Without an error registry one cannot decode it, but the symptom is consistent: rejection of any qty whose raw value is not a multiple of the contract's true on-chain `lotSize`.

5. Query the contract for the on-chain lot via `getPoolParams()` (see also Report 02 about the 7-field signature):
   ```
   lotSizeRaw = 1000000 (= 1.0 USDC.e at 6 decimals)
   ```
   NOT `0.01` as docs claim.

## Expected Behavior

Either:
- (A) Docs reflect the on-chain reality (`lotSize=1.0` for USDC.e:USDso), OR
- (B) Contract is redeployed to match the documented `0.01` lot.

## Actual Behavior

The docs and on-chain return drift. Verified divergence on USDC.e:USDso (docs says 0.01, on-chain returns 1.0). Smaller pool-by-pool audit needed to determine which others are correct.

Known good (docs match chain): tickSize on all pools we checked.
Known mismatch: lotSize on USDC.e:USDso (potentially other pools too).

## Logs / Evidence

`scripts/probe-pool.ts` query against mainnet USDC.e:USDso (`0x47fD2f18426f67106DBaC82F6d21D446c5F2120b`) on 2026-05-27 02:02 UTC:

```
Pool params for USDC.e:USDso
  baseToken           0x28BEc7E30E6faee657a03e19Bf1128AaD7632A00
  quoteToken          0x00000022dA000002656c64D9eA6011ea952D008A
  makerFeeBpsTimes1k  0
  takerFeeBpsTimes1k  0
  tickSize            100000000000000     ← 0.0001 USDso  (matches docs)
  lotSize             1000000             ← 1.0 USDC.e   (docs say 0.01 — MISMATCH)
  minQuantity         1000000             ← 1.0 USDC.e   (matches docs)
```

DreamTend bot's first `placeOrder` against mainnet USDC.e:USDso (tx
[`0x79d4b340...`](https://explorer.somnia.network/tx/0x79d4b340ad448571a5b7ea461d33ebff81128c67e124700cff636bfd08157dcf))
sent a qty of 1.5 USDC.e (= 1500000 raw, multiple of docs lot 0.01). It
actually succeeded on chain because 1.5 is also a multiple of 1.0 by
coincidence — but a qty like 1.05 USDC.e would have been rejected.

Subsequent attempts with mismatched qty (e.g. 0.7 USDC.e from a different
notional/mid combination) failed with the `0xcf479181` revert at the
simulation step.

## Impact

- **Wasted onboarding time.** Any integrator reading the docs configures their bot with `lotSize=0.01` and gets confusing reverts on certain qty values.
- **Trust erosion.** When numerical config values in docs are wrong, integrators stop trusting other documented values too.
- **Hidden cost.** Without a sim-before-broadcast pattern (which we ship in DreamTend's `safePlaceOrder`), each failed broadcast burns ~200k gas in fees.

## Suggested Fix

In order of preference:

1. **Authoritative table** under "Contract Specifications" generated from a per-deployment query at docs-build time. Avoids any drift by construction. Each pool table row would include a timestamp of "last on-chain verification" + the actual raw values used.

2. **Read pool params at runtime, treat docs as informational only.** Add a bold callout to the docs: "These values are illustrative. Always call `getPoolParams()` at bot startup; never hard-code lot/tick from these tables." DreamTend now does this — see Obs-005 in our `docs/feedback/OBSERVATIONS.md`.

3. **Custom error registry.** Whatever `0xcf479181` is (presumably `InvalidQuantity` or `InvalidLotMultiple`), publish the error ABI so revert messages decode to human-readable names.

## Acceptance Criteria

This report would be resolved when:
- [ ] All pool lot/tick/minQty values in the docs match `getPoolParams()` output for the same pool on the same network
- [ ] A "last on-chain verification: YYYY-MM-DD" stamp on the pool spec table
- [ ] Or: docs explicitly tell integrators to always query on-chain and treat the table as illustrative

---

*See also feedback report 02 (getPoolParams field-count mismatch) — same root cause: docs and contract drift over time without coordinated updates.*
