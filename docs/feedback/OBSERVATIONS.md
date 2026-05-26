# Live Sanity-Check Observations

> Running log of issues discovered during DreamTend implementation against the real DreamDEX testnet/mainnet. Each entry will be polished into a final feedback report at the end of the competition (Day 7 submission).

---

## Obs-001: `getPoolParams()` returns 7 fields, not 8

**Discovered:** 2026-05-26, Phase 2 sanity-check on testnet (chainId 50312)
**Pool tested:** SOMI:USDso testnet (`0x259fD6559214dd5aD3752322426eA9F9fABEFff4`)
**Severity:** High (silent decoding bug)
**Type:** Doc gap + ABI mismatch

### What docs say
The DreamDEX docs and SKILL.md §6 reference 8-field return tuple including a leading `poolToken` field:

```solidity
function getPoolParams() returns (
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

### What actually returns
7 fields — `poolToken` is absent:

```solidity
function getPoolParams() returns (
  address baseToken,
  address quoteToken,
  uint256 makerFeeBpsTimes1k,
  uint256 takerFeeBpsTimes1k,
  uint256 tickSize,
  uint256 lotSize,
  uint256 minQuantity
);
```

### Reproduction
1. Configure ethers.js Contract with the 8-field ABI from docs
2. Call `getPoolParams()` against any spot pool (e.g. testnet `0x259fD6559214dd5aD3752322426eA9F9fABEFff4`)
3. ethers throws `BAD_DATA` decode error: returndata length matches 7×32 bytes, not 8×32

### Impact
- Silent failure for any integrator following the docs verbatim
- Workaround required: remove `poolToken` from ABI before calling
- Affects: ethers, viem, web3.js, any strict ABI decoder

### Suggested fix
- **Either** update contract to actually return 8 fields (add `poolToken` field) — most consistent with docs
- **Or** update docs to match deployed contract (remove `poolToken` from signature)
- Add a `Returns 7 fields, not 8 — docs being updated` callout to the docs page in the meantime

---

## Obs-002: Testnet REST base URL inconsistency

**Discovered:** 2026-05-26, Phase 2 sanity-check
**Severity:** High (onboarding blocker)
**Type:** Doc gap

### What docs say
Per Emre and SKILL.md §5, the testnet REST base URL is:

```
Base URL: https://stg.api.dreamdex.io
```

(no `/v0` path component, in contrast to mainnet's `https://api.dreamdex.io/v0`)

### What actually works
`/v0` path component is **required** on testnet too:

```
HTTP 404 — https://stg.api.dreamdex.io/markets
HTTP 200 — https://stg.api.dreamdex.io/v0/markets
```

### Reproduction
1. `curl https://stg.api.dreamdex.io/markets` → returns `404 page not found`
2. `curl https://stg.api.dreamdex.io/v0/markets` → returns 200 with markets list

### Impact
- First-time testnet integrator follows docs, gets 404 on every endpoint, assumes API is down
- "Same paths/payloads as mainnet, only the host changes" — but the actual difference is `/v0` is part of mainnet base URL while docs omit it from testnet
- Loses ~15-30 minutes of debugging for each new integrator

### Suggested fix
- Update testnet docs base URL to `https://stg.api.dreamdex.io/v0`
- Or clarify that `/v0` is part of the path, not the base URL, on BOTH networks

---

## Obs-003: `getBookLevels` reverts with `require(false)` on empty book

**Discovered:** 2026-05-26, Phase 2 sanity-check on testnet SOMI:USDso
**Severity:** Medium (DX issue, not a security bug)
**Type:** Smart contract UX

### What happens
Calling `getBookLevels(true, 3)` against a pool with zero resting bid liquidity reverts with `require(false)` (no revert string).

### Reproduction
1. Find a pool with empty book (testnet SOMI:USDso during off-hours)
2. Call `getBookLevels(true, 3)` via `eth_call`
3. RPC returns `0x` revert, ethers throws `CALL_EXCEPTION` with `require(false)`

### Expected behavior
- Return `([], [])` for an empty book — caller can `length === 0` check
- OR return as many levels as exist (e.g. if depth=3 but only 1 level exists, return that 1)
- OR revert with descriptive string: `revert EmptyBook()` so callers can catch by name

### Impact
- Any pre-trade `getBookLevels` check (recommended pattern in SKILL.md §12 #10) becomes brittle
- Forces every caller to wrap in try/catch and assume "any revert = empty book"
- A revert without selector also blocks decoded error handling

### Suggested fix
Change view function semantics to return empty arrays instead of reverting. Reverts in view functions should only occur for invalid args (e.g. depth > some hard cap), not for sparse-data scenarios that the caller wants to inspect.
