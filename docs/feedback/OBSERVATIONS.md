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

---

## Obs-004: Testnet USDso onboarding undocumented + chronic liquidity gap

**Discovered:** 2026-05-26→27, Phase 3 testnet validation attempts
**Severity:** High (blocks testnet validation pre-mainnet)
**Type:** Doc gap + testnet liquidity

### What docs say
Quick Start, Roadmap, Spot Overview, and Contract Specifications pages do not mention how to acquire **testnet USDso** for the Shannon network. Only after escalating to DevRel did we learn (via Telegram group, Emre 2026-05-25):

> *"You can swap STT [via testnet SOMI/USDso pool]"*

with a link to the contract-specifications page — but that page lists addresses, not a how-to.

### What actually happens
Even with the swap-via-pool path known, **the testnet SOMI/USDso book is chronically empty**:

- `getBookLevels(true, 5)` returns `([], [])` on 10 consecutive attempts over 2.5 minutes (verified 2026-05-27 00:19–00:21 UTC).
- Emre observed a `bestBid=0.1744` on 2026-05-25, indicating intermittent liquidity, but no consistent flow.
- A taker `placeTakerOrderWithoutVault(isBid=false)` cannot fill if no bids rest.

So the documented swap path requires you to either (a) wait indefinitely for someone else to post a bid, or (b) post a maker order yourself and hope someone takes it — neither of which is "swap."

### Impact
- New testers cannot acquire USDso testnet on demand.
- Full bid+ask MM strategies cannot be validated on testnet (single-sided ask-only is the only feasible test).
- Forces premature mainnet validation, increasing risk for testers learning the API.

### Suggested fix (any one is sufficient)
1. **Dedicated faucet** at e.g. `https://testnet.somnia.network/faucet/usdso` that issues 100 USDso testnet per wallet per day.
2. **Public `mint()` on testnet USDso contract** (`0x9c32F38…`) gated by per-address rate limit. Standard pattern for testnet stablecoins.
3. **Seeded baseline liquidity** in testnet pools by the DreamDEX team (e.g. one DevRel-funded wallet posting wide bids+asks 24/7 — same role Anjali plays for kick-off).
4. **Document the swap path** explicitly: a "Acquiring testnet USDso" page in Quick Start with copy-paste curl/ethers snippets and a warning that liquidity is intermittent.

### Workaround (DreamTend bot ships with)
Bot validates code paths via typecheck + dry-run (`npm start -- --dry-run`). Real on-chain validation deferred to mainnet with reduced notional (e.g. $0.5 per leg) and tight stop-loss until pipeline is confirmed working.
