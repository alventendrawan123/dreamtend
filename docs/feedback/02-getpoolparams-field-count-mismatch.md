# Feedback Report 02 — `getPoolParams()` Returns 7 Fields, Docs Say 8

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-27
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

## Type
**ABI / Docs Mismatch**

## Severity
**High** — Any client following the documented signature will fail to decode the contract response with an opaque `BAD_DATA` error. The on-chain reality has been silently different from the docs since at least mainnet launch.

## Environment
- **Network:** Somnia mainnet (chainId 5031) AND testnet (chainId 50312)
- **RPC:** `https://api.infra.mainnet.somnia.network`, `https://dream-rpc.somnia.network`
- **Framework:** ethers v6 (v6.16.0), TypeScript 5.7
- **Docs referenced:** https://docs.dreamdex.io/ld25g222WKDrLlJMcR41/ → "Developers > Contracts" section, `SpotPool` interface

---

## Steps to Reproduce

1. Define a minimal ABI for `getPoolParams()` per the documented signature with 8 fields:
   ```solidity
   function getPoolParams() external view returns (
     address poolToken,
     address baseToken,
     address quoteToken,
     uint256 makerFeeBpsTimes1k,
     uint256 takerFeeBpsTimes1k,
     uint256 tickSize,
     uint256 lotSize,
     uint256 minQuantity
   );
   ```

2. Call `getPoolParams()` against any SpotPool contract, e.g. SOMI:USDso on testnet `0x259fD6559214dd5aD3752322426eA9F9fABEFff4` or USDC.e:USDso on mainnet `0x47fD2f18426f67106DBaC82F6d21D446c5F2120b`:
   ```typescript
   const c = new ethers.Contract(POOL, [
     "function getPoolParams() view returns (address poolToken, address baseToken, address quoteToken, uint256 makerFeeBpsTimes1k, uint256 takerFeeBpsTimes1k, uint256 tickSize, uint256 lotSize, uint256 minQuantity)"
   ], provider);
   const params = await c.getPoolParams();
   ```

3. ethers throws:
   ```
   BadDataError: could not decode result data
     value: 0x...
     info: { method: "getPoolParams", signature: "getPoolParams()" }
     code: BAD_DATA
   ```

## Expected Behavior

Either:
- (A) The contract returns 8 fields matching the documented signature, OR
- (B) The docs reflect the actual 7-field signature

## Actual Behavior

The contract returns **7 ABI-encoded uint256/address slots** (= 224 raw bytes of returndata), not 8. The first `poolToken` field is missing. Actual on-chain order:

```solidity
function getPoolParams() external view returns (
  address baseToken,
  address quoteToken,
  uint256 makerFeeBpsTimes1k,
  uint256 takerFeeBpsTimes1k,
  uint256 tickSize,
  uint256 lotSize,
  uint256 minQuantity
);
```

Verified empirically on:
- Mainnet USDC.e:USDso (`0x47fD2f18426f67106DBaC82F6d21D446c5F2120b`)
- Mainnet WETH:USDso (`0xa936da11B57b50A344e1293AAaE5232885ea2bDE`)
- Mainnet WBTC:USDso (`0x25bfF6B7B5E2243424F38E75de7ab03C0522a5EA`)
- Mainnet SOMI:USDso (`0x035De7403eac6872787779CCA7CCF1b4CDb61379`)
- Testnet SOMI:USDso (`0x259fD6559214dd5aD3752322426eA9F9fABEFff4`)

All pools return 7 fields in the order above. Sample concrete value from USDC.e:USDso mainnet:

```
baseToken          0x28BEc7E30E6faee657a03e19Bf1128AaD7632A00  (USDC.e)
quoteToken         0x00000022dA000002656c64D9eA6011ea952D008A  (USDso)
makerFeeBpsTimes1k 0
takerFeeBpsTimes1k 0
tickSize           100000000000000     (= 0.0001 USDso at 18 dec)
lotSize            1000000             (= 1.0 USDC.e at 6 dec)
minQuantity        1000000             (= 1.0 USDC.e at 6 dec)
```

## Logs / Evidence

Live tx data from a `getPoolParams()` static call on testnet SOMI:USDso (`0x259fD6559214dd5aD3752322426eA9F9fABEFff4`):

```
Returndata (decoded as 7 × 32-byte slots, 224 bytes total):

[0] 0x00000000000000000000000028f34DeFd2b4CB48d9eE6d89f2Be4Bc601694c00  ← baseToken (SOMI)
[1] 0x0000000000000000000000009c32F3827A1a99f0cf9B213de8b53eC3d57bb171  ← quoteToken (USDso testnet)
[2] 0x0000000000000000000000000000000000000000000000000000000000000000  ← makerFee 0
[3] 0x0000000000000000000000000000000000000000000000000000000000000000  ← takerFee 0
[4] 0x000000000000000000000000000000000000000000000000005af3107a4000     ← tickSize 0.0001
[5] 0x0000000000000000000000000000000000000000000000000de0b6b3a7640000  ← lotSize 1.0
[6] 0x000000000000000000000000000000000000000000000000002386f26fc10000  ← minQty 0.01
```

There is no 8th field. The docs-derived ABI expects one more uint256 slot, and ethers correctly refuses to decode.

## Impact

- **Silent failure for every first-time integrator.** Anyone copying the docs ABI into ethers/viem/web3.js gets `BAD_DATA` on the very first call.
- **Lost developer time.** Diagnosing this requires either:
  - Reading the on-chain return length manually (32-byte alignment + counting)
  - Comparing with a known-good production tool's source
  - Trial-and-error with progressively reduced field counts
- **Loss of confidence.** A docs/contract mismatch on a core view function suggests other parts of the docs may also drift; integrators start distrusting all docs and reverse-engineer from chain instead.
- **Knock-on bugs from wrong field positions.** Some early DreamTend code used `result[5]` as `tickSize` (per the 8-field doc indexing) — which actually returned `lotSize` since `poolToken` is missing — leading to incorrect tick alignment in our market-maker.

## Suggested Fix

Choose one:

1. **Update the docs** (preferred — fastest, no breaking change to integrators)
   - Remove `poolToken` from the documented signature on the Contracts page
   - Add a callout: "Returns 7 fields. The token used as a 'pool token' for LP accounting is internal to the contract and not exposed via this view"
   - Add a fully-encoded sample return value for ONE pool so integrators can sanity-check their decoders

2. **Update the contract** to return 8 fields (preferred for long-term consistency but breaks any current integrator already aware of the 7-field reality)
   - Add `poolToken` as the first return field
   - Requires coordinated rollout + integrator notice

3. **Ship typed artifacts** alongside whichever signature is canonical:
   - Authoritative ABI JSON file at `https://docs.dreamdex.io/abi/SpotPool.json`
   - Typechain definitions for TypeScript consumers
   - viem `parseAbi` strings

The third option in particular would have prevented this issue entirely — type-safe integration depends on the docs and contract being the same source of truth.

## Acceptance Criteria

This report would be resolved when:
- [ ] The Contracts docs page's `getPoolParams()` signature matches the on-chain return tuple exactly (whether 7 or 8 fields after a contract change)
- [ ] A published ABI artifact (JSON or Typechain) is the canonical source consumers can import directly
- [ ] At least one integration example in the docs (ethers v6 or viem) demonstrates `getPoolParams()` + decode end-to-end

---

*Reported in good faith as a contributor to the DreamDEX Alpha Testing programme. Bot source code referencing the corrected 7-field shape is in the public reference repository above (see `src/dex/abi/spotpool.ts` and `src/dex/contracts.ts: readPoolParams`).*
