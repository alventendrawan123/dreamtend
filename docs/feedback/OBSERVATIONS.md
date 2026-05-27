# Live Sanity-Check Observations

> Running log of issues discovered during DreamTend implementation against the real DreamDEX testnet/mainnet. **All 7 observations below have been polished into formal feedback reports**:
>
> | Obs | Promoted to formal report |
> |---|---|
> | Obs-001 | `02-getpoolparams-field-count-mismatch.md` |
> | Obs-002 | `06-testnet-rest-v0-path-undocumented.md` |
> | Obs-003 | `05-getbooklevels-empty-revert.md` |
> | Obs-004 | `04-testnet-usdso-onboarding-gap.md` |
> | Obs-005 | `03-pool-lotsize-docs-mismatch.md` |
> | Obs-006 | `01-event-topic-undocumented.md` |
> | Obs-007 | `07-cancelorder-no-isfillable-view.md` |
>
> Additional formal reports (08-13) cover learnings that did not pass through this notebook: custom error registry, leaderboard PnL formula, native-base payable semantics, WebSocket reconnect, stop order docs, and multi-wallet policy.

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

---

## Obs-005: Pool params in docs (SKILL.md / contract specs page) don't match on-chain reality

**Discovered:** 2026-05-27, Phase 4 mainnet first trial
**Severity:** High (silent revert, wasted gas potential)
**Type:** Doc gap + tick/lot/minQty drift

### What docs say (Contract Specifications page, SKILL.md §4)
USDC.e:USDso mainnet pool: `tickSize=0.0001, lotSize=0.01, minQuantity=1`.

### What `getPoolParams()` returns
`tickRaw=100000000000000` (= 0.0001 USDso ✓), `lotRaw=1000000` (= **1.0 USDC.e**, not 0.01), `minQtyRaw=1000000` (= 1.0 USDC.e ✓).

### Reproduction
```bash
NETWORK=mainnet npx tsx scripts/sanity-check.ts
# Look for "Pool USDC.e:USDso params (RPC)" line: lotRaw=1000000 → lot≈1
```

### Impact
- Bot computes qty from notional/mid using docs lot (0.01), aligns to 0.01 → ends up at e.g. 1.5 USDC.e.
- Tx broadcasts; chain accepts the order (= 1.5 USDC.e is still tradeable, since 1.5 ≥ minQty=1 and contract lot enforcement seems lenient).
- BUT for stricter pools or for tighter alignment intent, behavior diverges from doc-derived expectation.
- Same class of issue as Obs-001 (`getPoolParams` 7 vs 8 fields): docs/code aren't fed from on-chain ground truth.

### Suggested fix
- **Always read `getPoolParams()` at bot startup** and use those values as source of truth (DreamTend now does this — see "Always read pool params on startup" gotcha bake-in).
- Update the Contract Specifications page to either auto-generate from chain or add a "Last verified DD/MM/YYYY" stamp + monitoring script that warns devs when on-chain values drift.

---

## Obs-006: `OrderPlaced` event signature undocumented; topic hash must be reverse-engineered

**Discovered:** 2026-05-27, Phase 4 mainnet first trial
**Severity:** Critical (silent rejection — orders succeed on chain but bot thinks they failed)
**Type:** Doc gap → systemic correctness issue

### What docs say (Contracts page, SKILL.md §8 Event Schema)
> `OrderPlaced` | indexed: `orderId` | non-indexed: `placedOrder struct`

No exact struct layout, no field order, no example. Only a paragraph.

### What integrators must do
Compute the event topic from a guessed Solidity signature. If wrong, `eth_getLogs` filters silently return empty, and any `receipt.logs.some(l => l.topics[0] === guess)` check fails — even though the event WAS emitted by the contract.

### Concrete reproduction (DreamTend bot, 2026-05-27)
1. Bot signed and broadcast `placeOrder(...)` against USDC.e:USDso pool
2. Tx mined with `status=1` (confirmed via Blockscout: `0x79d4b340ad448571a5b7ea461d33ebff81128c67e124700cff636bfd08157dcf`)
3. Receipt contained 2 logs at pool address:
   - `topics[0] = 0xd90f62f61ee2f606b132cfdfd883ddd079228b6fd6bffd9d7cf848daf824639d` (actual OrderPlaced)
   - `topics[0] = 0xcdd45acd62788abc10f79d86fac34df2a63e1a3b20f061c5bcf431ff6a09b866` (likely OrderRested)
4. Bot computed expected topic from guess `OrderPlaced(uint128,address,bool,uint8,uint256,uint256,uint64)` → `0xab3b34d17edf17a0ae16689862fd0c473a207b199178b96f0bf71cd63a55edfa` (different from actual)
5. Verification failed → bot threw SILENT_REJECTION even though the order WAS placed and rested on book
6. Bot lost track of order → couldn't cancel on shutdown → 1.5 USDso locked until manual recovery via `eth_getLogs` + `cancelOrder(orderId)`

### Impact
- ANY integrator using event verification will hit this until they reverse-engineer the topic from a real on-chain receipt
- "Silent rejection" pattern recommended in SKILL.md §12 #9 (and likely in DreamDEX docs) becomes a footgun: returns silent failure where a tx succeeded
- Wasted gas if bot retries because it thinks tx didn't take effect

### Suggested fix
- **Publish the exact Solidity event signatures** on the Contracts page:
  - Field order in `placedOrder` struct
  - Exact ABI tuple notation
  - Sample topic hash + sample event payload
- Add a "Common pitfalls" callout linking to a Hardhat/Foundry test or ethers snippet showing event decoding end-to-end
- (Bonus) Publish Typechain/Wagmi codegen artifacts so integrators don't have to hand-build ABIs

---

## Obs-007: `cancelOrder` may revert with custom error after fill; reverted orderIds need explorer dive

**Discovered:** 2026-05-27, Phase 4 recovery flow
**Severity:** Medium (DX cliff during manual recovery)
**Type:** Smart contract UX

### What happens
After two `placeOrder` calls succeeded on chain (orderIds `0x080…185d2f` and `0x0a0…185d73`), an attempt to `cancelOrder(0x080…185d2f)` reverts with custom selector `0xf5e39c1f` (likely `OrderNotFound(address,uint256)`).

The second orderId (`0x0a0…185d73`) cancelled successfully and returned funds.

### Hypothesis
The first order was fully filled (against an opposing taker) before our cancel attempt; once filled, the orderId no longer maps to a resting position so cancelOrder reverts. This is operationally normal, but the revert reason is opaque without ABI for the custom error.

### Suggested fix
Two small improvements:
1. **Decode and surface** a friendly error name + args via the ABI. The current revert is `0xf5e39c1f` + 2 fields — without a documented error registry, integrators get a hex blob.
2. **Add an `isOrderFillable(orderId)` view** that returns `(exists, filled, remaining)` so cancel-paths can branch without trial reverts.
