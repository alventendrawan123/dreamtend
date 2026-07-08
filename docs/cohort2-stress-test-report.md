# DreamDEX Cohort-2 — API Stress-Test & Developer-Docs Validation Report

> **Competition ENDED** (Day-14 final snapshot ~2026-07-07) — safe to publish. Official results pending.
> Companion to `docs/cohort2-feedback.md`. Wallet `0xba4E595D6C2e655592c86ce29BbAec202d9175E1` (trader-3).
> Method: live probing of mainnet `api.dreamdex.io/v0`, the `wss://api.dreamdex.io/v0/ws/public` feed, and the 3
> SpotPool contracts on Somnia mainnet (chain 5031), cross-checked against the developer docs + this repo's ABI.
> Generated 2026-06-24 from a multi-agent live stress-test sweep (7 surfaces).

This report covers the three program objectives: **(1) stress-test the trading API, (2) validate developer-docs
usability, (3) generate real trading activity** — and lists every bug + doc fix found, with severities and suggested fixes.

---

## Objective 1 — API stress-test summary

DreamDEX's API surface is **broadly robust and healthy** under live stress, with a handful of real footguns and genuine bugs.

**What works well.** All read-only market-data GETs respond sub-second (markets ~185–400 ms, orderbooks ~185–435 ms,
candles ~190–260 ms, volume ~250 ms, tickers ~420 ms); no rate-limit hit during burst probing; no auth needed for
market-data. The full SIWE + JWT auth flow works first-try (ERC-4361 `personal_sign` → ES256 JWT, `sub`/`wallet`
claims, 3600 s TTL). The **prepare-then-sign** trading model is sound: POST/DELETE/PATCH on orders return *unsigned*
txs `{chainId,data,to,value}` (server holds no keys) whose calldata decodes cleanly to on-chain
`placeOrder`(0x4e978373) / `cancelOrder`(0xdbc91396) / `reduceOrder`(0x33407b60). Approval-shortfall detection works
(returns `approval:{token,amount}` only when on-chain allowance is short). Native-base (SOMI) value handling is correct.
The API **self-documents via its own 400 errors** (every validation failure dumps the full JSON-Schema: enums, required
fields, defaults). WS connects in ~200 ms (101, no auth), and subscribe/snapshot/incremental-update/unsubscribe/error
frames all work (`quantity:"0"` = level removal). **Testnet (stg, chain 50312) is at full parity.** `getPoolParams()`
confirms a true **0%-maker / 0%-taker** venue on all 3 pools.

**What breaks / limits.** WS sends **zero** server ws-pings (keepalive is the client's app-level `{operation:ping}`
obligation, and the idle timer resets only on *client→server* frames — an active subscriber that only receives is still
killed); idle close fires at ~66–68 s with code **1006** (abnormal, no frame), not the documented 60 s / 4001; WS
frames carry **no sequence number** (no gap detection / reconnect resync). Two genuine API bugs: `builder/approve`
accepts a fee **over** the protocol cap and returns a guaranteed-to-revert tx; and the SIWE **nonce is replayable**
(not consumed on use). Native-base buys silently hit `InsufficientGasForPayout` unless the client forces `gas ≥ 5M`,
and prepare-tx responses give no gasLimit hint. **Builder codes are LIVE** (cap 100 bps on all pools) despite docs
saying disabled. Reliability/latency: excellent — no flakiness, no 5xx, no hosted OpenAPI spec (`/openapi.json` 404).

**Major correction to a long-standing assumption:** the on-chain getters are **not dead** — this repo's ABI declared
the *wrong signatures*. `getOwnOpenOrders()` (no-arg, 0xe1f57e0c) and `getBookLevels(bool,uint64)` (0x4f1ce9a7) both
work live; the repo's `getOwnOpenOrders(address)` / `getBookLevels(bool,uint8)` are what bare-revert. See B1/B2.

---

## Objective 2 — developer-docs usability summary

**Overall usability: FAIR.** The single best source of truth turned out to be the API's *own* validation errors (every
400 dumps the full JSON-Schema). The hosted docs are browser/cookie-gated (401 to machine fetch). *(SUPERSEDED
2026-07-06: every page serves a token-less `.md` variant with no auth — see the re-validation section below; the 401
affects only the browser HTML render.)*

- **Contracts docs** (functions/events/types): FAIR-to-GOOD on accuracy — notably *more correct than this repo's ABI*
  (docs give the correct no-arg `getOwnOpenOrders()`, `getBookLevels(bool,uint64)`, 6-param `OrderFilled` w/ fillPrice,
  and all 7 event topic0s). POOR on completeness: no custom-error catalog, StopOrder events referenced but unspecified,
  and no page maps `OrderType`/`SelfMatchingOption` enum **names → uint8 integers** (the most safety-critical params).
- **HTTP-API docs**: GOOD structure, live REST matches, but auth scopes are self-contradictory and OHLCV is mis-described.
- **WebSocket docs**: MIXED — `errors.md` excellent/accurate, `real-time-feed.md` matches live, but `operations.md`
  describes a different/empty RPC model and omits subscribe semantics.
- **Trading/common**: `fees.md` openly WIP ([TODO] gas table); `yield-algorithm.md` gives formulas but withholds every
  numeric parameter (sigma, settlement interval) and contradicts the roadmap.
- **Libraries**: POOR — the sole CCXT page is alpha/unpublished and every example uses a non-existent symbol (`SOMI/USDC`).

**Worst gaps:** (1) builder-codes contradiction (docs disabled vs live 100 bps); (2) CCXT examples use `SOMI/USDC`
(real: `SOMI:USDso`) — nothing runs as written; (3) phantom "view yield via Developer API" (all yield/reward routes 404
even with a valid JWT); (4) auth-scope self-contradiction; (5) no contract custom-error catalog with selectors;
(6) no `OrderType`→uint8 mapping; (7) no full SIWE/login example.

---

## Objective 3 — real trading activity (evidence)

Wallet `0xba4E595D6C2e655592c86ce29BbAec202d9175E1` (trader-3) drove **genuine, two-sided** load across all
3 eligible pairs (WETH/WBTC/SOMI vs USDso) — dominant at the Day-1 snapshot below; final-week state in
`cohort2-feedback.md`'s Days 7–14 addendum.

- **Leaderboard — Day-1 snapshot (2026-06-24, updatedAt 1782299648050):** `txCount=2693, fills=1100, volumeUsdso=42,829.1,
  volumeEffective=13,795, usdsoBalance=48.31, pnl=−101.69, allocationUsdso=150`. **#1 by both raw and effective volume
  at that point** — next-best (trader-1) had `volumeUsdso=2,364` (18× less), `fills=213` (5.2× fewer); our raw ≈ **89%
  of all leaderboard volume** then. *(Final — leaderboard 2026-07-08: **#3 by raw volume, 945,661 USDso** — t5
  1,093,448 / t2 1,086,202 / us 945,661 / t1 923,142 — with the cohort's highest tx count, 127,570; eff.vol 22,420
  = #4 by the board's Eff = Raw × (1 + PnL%) ranking. Rewards announcement pending.)*
- **On-chain corroboration** (RPC, chain 5031): `eth_getTransactionCount = 2696` broadcast txs at Day-1 (final nonce
  at comp end: **127,570**, read 2026-07-08); wallet funded as of 2026-06-24 (44.93 SOMI; USDso 60.77, WETH 0.0226,
  WBTC 0.0007) — post-comp after liquidation to USDso (2026-07-08): 3.56 USDso, 0.30 SOMI, 0 WETH/WBTC.
- **Order types exercised** via `placeOrder` (post-migration from deprecated `placeTakerOrderWithoutVault`):
  **IOC taker** (`ImmediateOrCancel=2`, auto-ERC20-pull) and **PostOnly maker** (`=3`, rests + earns maker fills),
  `SelfMatch.CancelTaker=0`, each cycle `staticCall`-simulated then broadcast. `FillOrKill`/`NormalOrder` defined but
  not exercised live.
- **Engines:** IOC takers (`ioc-loop.ts`), two-sided makers with inventory-skew (`mm-loop.ts`, `mm-tuned.ts`),
  directional (`breakout-bot.ts`, Binance-ETH Bollinger breakout, OOS Sharpe ≈ 2). Book sourced from REST `/v0/orderbooks`
  (on-chain getter worked around), fills confirmed via tx receipts + `OrderFilled` (6-uint, topic `0xc87f4223…`) scans.
  Clean trading throughout (genuine fills, not wash inflation). This load (~2.7k tx / 1,100 fills by Day-1, growing to
  ~127.6k broadcast txs by comp end) **doubled as the stress test** that surfaced the bugs below.

---

## Bug table (28)

Severity: **high** = correctness/security/data-loss · **med** = footgun/inconsistency · **low** = minor · **info** = note.
"Repo ABI" bugs are in *our* `src/dex/abi/spotpool.ts` (surfaced by the test; some are worth fixing for cleaner bots).

| # | Sev | Title | Detail / Fix |
|---|-----|-------|--------------|
| B1 | high | `getOwnOpenOrders(address)` (repo ABI) bare-reverts; no-arg `getOwnOpenOrders()` WORKS | Repo declares wrong sig → 0x revert on all pools. Docs-correct no-arg `getOwnOpenOrders()` (0xe1f57e0c) returns the caller's `OrderId[]`. **Fix repo ABI** → read own orders directly (drops the OrderPlaced log-scan workaround). |
| B2 | high | `getBookLevels(bool,uint8)` (repo ABI) bare-reverts; `getBookLevels(bool,uint64)` WORKS | 2nd param is **uint64** and return is `OrderBookLevel[]` (struct, not 2 parallel arrays). Live returns populated levels. **Fix repo ABI**; REST `/v0/orderbooks` stays as convenience. |
| B3 | high | `OrderFilled` ABI wrong (5 vs live 6 uints) → silently drops ALL fill logs | Real `OrderFilled(uint128,uint128,uint256,uint256,uint256,uint256)` topic `0xc87f4223…` (incl `fillPrice`). Repo's 5-field → topic never on chain; `ioc-loop.ts` undercounts its own fills. **Add 6th uint** + fix the topic. |
| B4 | high | `OrderPlaced` ABI wrong shape (flat 7-field vs live `indexed orderId` + Order tuple) | Real `OrderPlaced(uint128 indexed, Order tuple)` topic `0xd90f62f6…`. `cancel-all.ts` already hardcodes the correct topic. **Replace the flat ABI entry**. |
| B5 | high | WS server sends ZERO ws-pings; idle timer resets only on client frames | Active receive-only subscriber is still killed. Only `{operation:ping}`→`pong` keeps alive. **Server should ping or count inbound delivery as liveness; docs must state the client-ping obligation.** |
| B6 | high | WS idle close = code 1006 (abnormal, no frame) at ~66–68 s, not 4001/clean | Indistinguishable from a network blip/deploy. **Emit a clean close frame + code; align documented 60 s with real ~66–68 s.** |
| B7 | high | WS frames carry no sequence number — no gap detection / reconnect resync | **Add a per-channel monotonic seq to every snapshot+update; document a resync protocol** (critical given the 1006 closes). |
| B8 | high | Builder codes LIVE on-chain (cap 100 bps) despite docs "disabled in v1.0" | `getMaxBuilderFeeBpsTimes1k()=100000` on all 3 pools; REST encodes builder into calldata. `functions.md` claims disabled + `BuilderCodesNotSupported` (never produced). **Reconcile docs ↔ live, or set cap=0.** |
| B9 | high | `builder/approve` accepts over-cap fee → returns a guaranteed-revert tx | `maxFeeBpsTimes1k=999999` (> 100000) returns 200 with an `approveBuilder` tx that reverts on-chain with `0xf559e808`. **Server-side validate ≤ protocolMaxFee; reject with 400.** |
| B10 | med | SIWE nonce is replayable — not consumed on use | Same `{message,signature}` ×3 → 3 fresh JWTs. Fabricated nonce → 401, so it validates issuance but doesn't burn. **Burn nonces on first login.** |
| B11 | med | Vault writes: JWT `sub` not enforced vs `body.walletAddress` (authz gap) | A session built a vault tx for a *different* wallet → 200. Low impact (tx still needs target sig) but should **403 on mismatch**. |
| B12 | med | Native-base buys need forced `gas ≥ 5M`; prepare-tx gives no gasLimit hint | Live error `InsufficientGasForPayout(uint256)` = `0x782b2567`. `breakout-bot.ts` hardcodes `gasLimit:5_000_000n`. **Include a gasLimit hint; document the error signature.** |
| B13 | med | `reduceOrder(uint128,uint256)` live + used by REST but ABSENT from repo ABI | Selector `0x33407b60`. Local decode/static-call fails until added. **Add the fragment to `spotpool.ts`.** |
| B14 | low | `placeTakerOrderWithoutVault` deprecated — bare-reverts 0x, no named error | No migration guidance for legacy callers. **Revert with a named `Deprecated()` or add a doc note → `placeOrder()`.** |
| B15 | low | REST cancel/reduce do no ownership/existence check — 200 ≠ success | `DELETE …/orders/999999999999` (not ours) → 200 with calldata; only on-chain reverts. **Validate server-side or document that prepare 200 ≠ confirmation.** |
| B16 | med | Vault `deposit` doesn't bundle approval; `withdraw` doesn't pre-check balance | Unlike place-order, deposit returns only `deposit()` (caller must `vault/approve` first). Withdraw for amount 1 on a 0 balance returns a revert-bound tx. **Bundle approval; add a balance guard/doc note.** |
| B17 | med | `/orderbooks`&`/tickers`: comma multi-symbol silently empty; bad symbol → 200-empty (vs path-style 404) | Multi-symbol works only with **repeated params** (`symbols=A&symbols=B`). Field is `quantity` not `size` (repo `OrderBookLevel.size` reads undefined). **Support/400 comma; make unknown-symbol consistent; fix repo field.** |
| B18 | med | `ohlcv`/`klines` don't exist; candles are **market-scoped** `/v0/markets/{symbol}/candles?interval=`; 1m empty for active pairs | Interval enum `1m,5m,15m,1h,4h,1d` (required). 1m returns `[]` for WETH/SOMI despite trades. **Re-verified 2026-07-06: top-level `/v0/candles?...` returns 404 "page not found"; the working path is `/v0/markets/{sym}/candles?interval=` (200).** *Document the market-scoped path (a top-level `/v0/candles` would be more discoverable); fix/doc the empty-1m; add a `getCandles` repo method.* |
| B19 | low | Repo `RecentTrade.size` wrong (live fields `amount`+`cost`); default limit mismatch | API default `limit=100` (repo hardcodes 20); trade `id` is composite `makerOrderId:takerOrderId`. **Fix repo type + limit; document the id.** |
| B20 | med | `tickSize` is 1e18 fixed-point (NOT quote decimals); repo `pairs.ts` lot/minQty stale/swapped | WETH tick raw `1e16`, WBTC `1e17`, SOMI `1e14`. Assuming USDso decimals → off-by-1e12 (our bots are safe only because USDso *is* 18-dec). `getPoolParams` tail order is `(tickSize, minQuantity, lotSize)` — repo has lot/minQty swapped. **Document fixed-point; fix repo `pairs.ts` + ABI tail order.** |
| B21 | med | Leaderboard `usdsoBalance` understates true portfolio — penalizes makers holding inventory | `effVol = raw × usdsoBalance/150` reproduces (42829×48.31/150≈13795) but `usdsoBalance` excludes base inventory AND disagrees with live liquid USDso (60.77). **Use total portfolio marked-to-mid.** |
| B22 | low | `placeOrder` returns NAMED custom errors (refutes blanket "bare require(false)") | Sub-min qty → `QuantityBelowMinimum(uint256,uint256)`=`0xeaa68ceb`; `placeOrderFor` w/o perm → `0x3fb0ba2e`. The bare-0x reverts were all from calling WRONG repo-ABI sigs. **The real gap is the missing error catalog (B/below), not uniform bare reverts.** |
| B23 | med | `/v0/trades` (own fills) is auth-gated 401 — confusingly similar to public `/markets/{sym}/trades` | Auth split undocumented; a bot expecting a public `/v0/trades` gets 401. **Document the split / rename (`/v0/account/trades`).** |
| B24 | med | No yield/rewards/rebates/points/leaderboard REST endpoints exist (even with auth) | All 404 with AND without JWT (routes absent, not gated). `yield-algorithm.md`'s "view via Developer API" is phantom. **Ship endpoints or remove the claim.** |
| B25 | low | WS trades snapshot uses `trades:null` (not `[]`); bids/asks arrive UNSORTED | null-vs-array inconsistency; client must sort the book. **Return `[]`; document unsorted + top-level frame shape.** |
| B26 | med | StopOrderRegistry events (`PendingOrderCreated/Triggered/Cancelled`) referenced but never specified | `contracts.md` names them; `events.md` documents only the 7 SpotPool events. Live registry confirmed (`somiPaymentPerOrder()=0.5 SOMI`). **Add signatures + topic0s.** |
| B27 | med | Mixed error envelopes: JSON vs Go "page not found" text vs Google-Frontend HTML | 3 distinct formats by failure class. **Normalize to `{name,description,status}` JSON, incl. unknown-route 404s.** |
| B28 | info | All SpotPools are EIP-1967 **beacon** proxies — one upgrade changes all pools atomically | Beacon `0x55790554…`, impl `0xbc8a166d…`. **Pin/monitor the beacon impl; document the upgrade model.** |

---

## Documentation fix table (14)

1. **functions.md / builder-fees.md / stop-orders.md** — builder codes "disabled until v1.1" but live cap=100 bps → reconcile or set cap=0; drop the `BuilderCodesNotSupported` claim if not produced.
2. **libraries/ccxt.md** — every example uses non-existent `SOMI/USDC`; real is `SOMI:USDso` → fix symbols, mark CCXT alpha/install-from-GitHub.
3. **yield-algorithm.md / fees.md / roadmap.md** — phantom "view yield via Developer API"; missing sigma + settlement interval; current-vs-"Later" contradiction → implement or remove; publish params; reconcile status.
4. **authentication.md (vs trading/wallets/builder-fees)** — scope self-contradiction; no SIWE/login example; nonce doc'd as POST (live GET-only) → enumerate scopes, add a full login example, correct nonce method.
5. **functions.md / types.md / repo ABI** — no custom-error catalog; no `OrderType`→uint8 map; getPoolParams fee + lot/minQty ordering disagreements; 3 wrong repo sigs → publish error table w/ selectors, map enums, fix repo ABI.
6. **market-data.md / trading.md** — OHLCV is `/candles?interval=` (not ohlcv/klines); 1m empty; field names `quantity`/`amount`/`cost`; multi-symbol repeated-param; 200-empty vs 404 inconsistency.
7. **builder-fees.md** — `builder/max-fee` returns 401 for a value readable freely on-chain; over-max approve undocumented → make public or note auth; document the `0xf559e808` revert.
8. **websocket-api/operations.md + overview + real-time-feed.md** — consolidate on the live pub/sub model: wss URL, channel list, two-frame subscribe, client-ping obligation, real ~66–68 s/1006 idle, unsorted book, `trades:null`.
9. **order-types.md / types.md** — state the integers: `NormalOrder=0, FillOrKill=1, ImmediateOrCancel=2, PostOnly=3`; `CancelTaker=0, CancelMaker=1`.
10. **stop-orders.md** — inline per-pair stop-registry addresses (or link `/v0/markets.stopRegistry`) + `somiPaymentPerOrder()=0.5 SOMI`; drop the stale builder-disabled note.
11. **error-handling.md** — claims "no custom Solidity errors" but reverts ARE named (`0xeaa68ceb` etc.); add the error catalog + note the 3 REST envelope formats.
12. **events.md / contracts.md** — add `PendingOrder*` event signatures/params/topic0s.
13. **quick-start.md / section overviews** — add one copy-paste end-to-end example (auth → discover → approve → place → track); flesh out thin section landing stubs (rate limits, auth, Content-Type, wss URL+channels).
14. **trading.md** — document composite trade `id`; note `vault/deposit` needs a separate `vault/approve`; note prepare 200 ≠ execution success.

---

## Coverage gaps (Day-14 plan — status at close; comp ended ~2026-07-07)

The probe was read-only / static-simulation safe (no new mutating txs broadcast from the probe itself; the on-chain
txs — 2,696 at Day-1, 127,570 final — came from the production bots). Planned Day-14 testnet coverage (stg, chain
50312, free funds). **Status at close: items 1–5 & 7 NOT executed during the comp window (optional post-comp
follow-ups); item 6 DONE; item 8 SUPERSEDED:**

1. **Broadcast each prepared tx end-to-end** — confirm the over-max `builder/approve` (`0xf559e808`) revert on a live tx,
   a `vault` deposit→withdraw round-trip, and a `reduceOrder` on a real owned resting order (capture real receipts).
2. **Force the WS 4001 slow-consumer** (stall the read loop) and the **100 in-flight cap** (>100 concurrent subscribes);
   capture a live `trades` frame (none occurred on WETH during windows).
3. **Authenticated WS `order` channel** — validate own-order push + frame schema.
4. **Populated getters** — place a known order, capture its id, then `getOrder(id)` + no-arg `getOwnOpenOrders()` +
   `getBookLevels` both sides against the corrected ABI.
5. **Nonce-replay + JWT-expiry boundaries** — map exact TTLs.
6. **Rate limits** — controlled burst to characterize the ceiling + 429 behavior (saw `x-ratelimit-limit:40` on auth).
   **[DONE — live-measured: 200 req/s public / 40 req/s auth; see "Rate limits (live-measured)" under Advanced capabilities.]**
7. **`OrderExpired` / `OrderReduced` events** — let a PostOnly order expire + issue a reduce to emit + decode both.
8. **Verify docs verbatim** — ~~pull docs via an authenticated browser session (hosted docs are 401 to machine fetch)~~
   **[SUPERSEDED — done 2026-07-06 via token-less `.md` variants (see the re-validation section); the 401 affects only the browser HTML render.]**

---

## Advanced capabilities exercised (beyond basic place/cancel)

Deep capability audit of the HTTP API + on-chain surface, with one flagship demonstrated **live on mainnet**.

### Non-custodial session-key delegation (operators) — DEMONSTRATED LIVE ⭐
`scripts/operator-demo.ts` proves the full operator lifecycle end-to-end on mainnet: a fresh **hot/session key** trades on
behalf of the **cold wallet** without ever holding custody — it can ONLY `placeOrderFor`/`cancelOrderFor`/`reduceOrderFor`
orders owned by the cold wallet; it CANNOT deposit/withdraw/approve/move funds. This is the clean answer to "run a 24/7 bot
on a low-trust server key" and directly serves the cohort-2 24h-activity-or-DQ always-on requirement.
- Registry `0xE7a190736B6024a4DbafadC04E283075877005ce` · `setOperatorApprovalGlobal(address operator, bytes4[] selectors, bool approved)`
- Selectors: `placeOrderFor`=`0x80054449`, `cancelOrderFor`=`0xe37b444b`, `reduceOrderFor`=`0x364c2587`
- Verify via **pool** `isOperatorAuthorized(owner, operator, selector)` (NOT the registry — the registry is a 163-byte proxy).
- **Live proof (WETH:USDso, 2026-06-24):** grant tx `0x901c2c90…` → `isOperatorAuthorized`=true(×3) → hot key
  `placeOrderFor` tx `0xaa5bcdfd…` rested orderId `442721857769041871470` **owned by the cold wallet** (confirmed via the
  no-arg `getOwnOpenOrders()` returning it) → hot `cancelOrderFor` tx `0x03359c0c…` → revoke → `isOperatorAuthorized`=false(×3).
- *Docs gap:* operators.md gives function NAMES + selectors + a `cast` example but NOT full typed signatures or the
  registry's read-function location (it's on the pool). Suggest publishing the registry ABI + that the check is pool-side.
  **[FIXED by 2026-07-08 — operators.md rewritten: pool-side `isOperatorAuthorized` check, registry addresses for both
  chains (incl. previously-undocumented `SpotPoolRegistry` 0xB601bc1099B040E4882089D94690F7C38AF4CCD2), typed setter
  signatures, per-pool grant/denial scoping. Residual: still no per-operator spend cap or grant TTL.]**
- *Security caveat (worth noting in docs):* no per-operator spend cap and no key TTL/expiry — safety rests on (a) operators
  cannot move funds and (b) immediate revocation (which does NOT disturb already-resting orders).

### Other capabilities mapped (audit, not all exercised)
- **Vault-funded resting** (`fundingSource:"vault"` + `setManualVaultMode(true)`): pre-deposit once, then rest N maker/grid
  orders with ZERO per-order ERC20 pulls → lower gas + latency per order = cheaper RAW volume. Wallet funding is IOC/FOK-only;
  resting GTC/PostOnly *requires* vault funding. Scripts `deposit-vault.ts` + `maker-probe.ts` already exercise the path.
- **SpotRouter** `swapExactIn`/`swapExactOut` + REST `type:"market"`: one-tx deterministic RAW volume (no IOC no-fill waste);
  still pays the half-spread, and books are thin (~$3–5k/side, 5–6 levels) so impact caps churn per tx.
- **Rate limits (live-measured, undocumented):** public market-data = **200 req/s** (shared bucket), auth = **40 req/s**,
  window = per-second (headers `x-ratelimit-limit/remaining/reset`). ~17M reads/day headroom — no throttle risk at our rate.
- **Batch cleanup:** `cancelExpiredOrders(uint128[])` / `sweepExpiredAtLevel(bool,price,maxCount)` tear down a stale grid in
  one tx. Asymmetry: batch CANCEL exists but there is **no batch PLACE** (`placeOrder` is single-order only).
- **`reduceOrder(uint128,uint256)`**: in-place size reduction that **preserves queue priority** (vs cancel+repost).
- **On-chain EMA mark** `getMidpointEmaState()` (manipulation-resistant fair value) + **StopOrderRegistry** keeper-executed
  stop/take-profit (per-order SOMI prepay) — useful for grid centering / offline risk management.

### Two doc/code corrections (from this audit)
- **Builder codes are LIVE on-chain** (cap 100 bps), NOT "disabled in v1.0" as some docs/older notes state. Keeping
  `builder=address(0)`/`fee=0` in our code is still correct (we have no third-party flow), but the wording should read
  "live but unused."
- **WebSocket feed IS consumed** by `src/orchestrator.ts` (subscribes `orderbook`+`trades`; momentum/market-maker act on
  deltas). Only the private `order` channel (native fill confirmation) remains unsubscribed.

## Repo follow-ups — FIXED 2026-06-24 (verified on-chain + end-to-end round-trip)

All ABI/consumer bugs the stress-test surfaced in our own code were fixed and validated (typecheck clean; a live
mainnet buy+sell round-trip with the corrected ABI nets 0 WETH with *finer* sizing — 0.0029 vs the old 0.002):

- **`src/dex/abi/spotpool.ts`** — corrected to live signatures: `getOwnOpenOrders()` (no-arg), `getBookLevels(bool,uint64)`
  returning `OrderBookLevel[]` tuple array, `OrderFilled` 6-uint (incl `fillPrice`), `OrderPlaced` (`indexed orderId` +
  `Order` tuple), added `reduceOrder(uint128,uint256)`, fixed `getPoolParams` tail order to **(tickSize, minQuantity, lotSize)**.
- **`src/dex/abi/types.ts`** — `SpotPoolContract` updated (no-arg `getOwnOpenOrders`, `getBookLevels` struct-array, `reduceOrder`).
- **`src/dex/contracts.ts`** — `readBookLevels` maps the new struct[]; `readPoolParams` reads minQuantity@5/lotSize@6;
  `readOwnOpenOrders` uses no-arg with `{from}` override.
- **`src/dex/rest.ts`** — `OrderBookLevel.size→quantity`, `RecentTrade` → `{amount,cost,id,...}`.
- **Consumers** — `mm-loop.ts`, `mm-tuned.ts`, `breakout-bot.ts`, `maker-probe.ts`, `consolidate-sell.ts`, `probe-pool.ts`:
  corrected lot/minQty indices; `ioc-loop.ts`, `ioc-loop-somi.ts`, `cross-loop.ts`, `maker-probe.ts`, `diag-fills.ts`,
  `research-wallet.ts`: corrected `OrderFilled` topic to 6-uint; `sanity-check.ts`: `.size→.quantity`.
- Note: `src/config/pairs.ts` was already correct (matches live `getPoolParams` + REST `/markets`). The report's earlier
  "pairs.ts swapped" suspicion was disproved by on-chain verification — only the ABI *tail order* was swapped.

---

## Developer-docs re-validation — 2026-07-06 (Objective 2, full re-audit)

Re-fetched and re-validated all 25 developer doc pages against the verified live ground truth (fees/ticks/selectors/topics/errors/endpoints/rate-limits re-confirmed on chain 5031 + `api.dreamdex.io/v0` on 2026-07-06). Method: fetched every page's **`.md` variant** directly (see flagship correction), cross-checked vs live probes, adversarially re-verified the load-bearing claims by quoting raw `.md` (no summarizer trust). **Overall usability: still FAIR, but materially improved since the 2026-06-24 pass — many prior items are now fixed.**

### ⭐ Flagship correction — the docs ARE machine-fetchable (supersedes the report's "401 to machine fetch")
Objective-2 summary (above) and Day-14-plan item 8 both state the hosted docs are browser/cookie-gated / 401 to machine fetch. **That is now false (or was HTML-path-only).** Every page has a **token-LESS `.md` variant** served with no auth (e.g. `https://docs.dreamdex.io/developers/http-api/trading.md`), plus a full-corpus **`/llms-full.txt`** (~400 KB), **`/sitemap.md`**, an **`?ask=`** query param, **`Accept: text/markdown`** content-negotiation, and an **MCP server + `AGENTS.md`/`SKILL.md`**. All 25 pages fetched cleanly over plain HTTP. *Path gotcha for future auditors: the token-PREFIXED `.md` URLs (`/ld25g222…/developers/…`) 404 — use the token-less root paths that `/sitemap.md` and the 404 stub both link.* The 401 only affects the browser HTML render.

### Fixed since the 2026-06-24 report (re-verified live)
- **B18 / OHLCV** — `trading.md` now documents candles as market-scoped `GET /v0/markets/{symbol}/candles?interval=` with the exact enum `[1m,5m,15m,1h,4h,1d]` (top-level `/v0/candles`→404, `interval=2h`→400 both match).
- **B17 / field name** — `market-data.md` now uses `quantity` (not `size`).
- **B16 / vault** — `vault.md` now states deposit needs a prior pool-token approve + native approve returns JSON `null` (skip signing).
- **B15 / prepare 200 ≠ execution** — `trading.md` now warns receipt `status=1` can still place nothing (`(false,0)`, no events) → simulate via `eth_call` + check the `OrderPlaced` log; market-buy+wallet → 400 with the limit-IOC-above-ask workaround. **Best page in the section.**
- **B23 / trades auth split** — `trading.md` now documents public `/v0/markets/{symbol}/trades` vs auth-gated `/v0/trades` + `/v0/orders` (`trades:read_any` scope). Live: public 200, `/v0/trades` 401.
- **B5 / WS client-ping (partial)** — `real-time-feed.md` now documents the client-ping obligation (`{operation:ping}` ≥ every 30 s or the 60-s idle timer closes the socket). *(Correction 2026-07-08: the page does NOT state "server sends no pings", and sequence numbers are not mentioned at all — the B5/B7 residual gaps stand.)*
- **doc-item 1 (partial)** — the HTTP `builder-fees.md` page now documents builder codes as SUPPORTED with the correct `100000 = 100 bps` unit. *(Still wrong on `functions.md` + `roadmap.md`.)*
- **doc-item 4 (partial)** — auth-scope contradiction appears resolved; SIWE **nonce method** now matches live (GET). *(Residual: nonce still described as single-use but is replayable within its window.)*

### Still-broken + NEW issues (paste-ready doc-fix table, current 2026-07-06)

> ⚠️ **Delta 2026-07-08:** several rows below were FIXED by DreamDEX between 07-06 and 07-08 — see the
> "Delta re-check — 2026-07-08" section at the end of this report before pasting.

| Page | Sev | Issue | Fix |
|------|-----|-------|-----|
| websocket-api/real-time-feed.md | **high** | Claims book is pre-sorted (bids desc / asks asc); live frames are **UNSORTED** — a bot trusting `bids[0]` reads a wrong top-of-book and can cross badly | Remove the sorted guarantee; warn "levels are NOT sorted server-side — sort before using index 0" |
| libraries/ccxt.md | **high** | Every example uses the non-existent symbol `SOMI/USDC` | Replace with `SOMI:USDso`; align with `operations.md` |
| trading.md · quick-start.md · spot.md · functions.md · fees.md | **high** | Native-base (SOMI) BUY reverts `InsufficientGasForPayout` (0x782b2567) below a ~5 M gas floor — floor **unquantified everywhere** | State `gasLimit ≥ 5,000,000` for native-base BUY / broadcast the server gasLimit unchanged; add to the "why an order is rejected" list **[FIXED 2026-07-08 in functions.md (≥5M floor + selector + simulate-at-broadcast-gas) + OpenAPI `gasLimit` hint; residual: fees.md gas table still [TODO], no cross-ref from trading.md/quick-start]** |
| contracts/types.md · trading/common/order-types.md | **high** | `OrderType`/`SelfMatch` listed by NAME ONLY, no uint8 (ints live only in quick-start) | Add `NormalOrder=0, FillOrKill=1, ImmediateOrCancel=2, PostOnly=3` / `CancelTaker=0, CancelMaker=1` to the canonical enum pages |
| trading/readme-1/spot.md | **high** | Primary spot page never enumerates `placeOrder` params, no example, omits tick/minQty/lot traps | Enumerate `placeOrder(...)` w/ a worked example + tickSize-1e18-fixed-point / minQuantity / lotSize |
| contracts/functions.md + types.md | med | **No consolidated selector→error catalog.** (functions.md DOES list some error *names* + `InsufficientGasForPayout=0x782b2567` inline — the gap is a decode map, not "no errors exist") | Add a selector catalog: `QuantityBelowMinimum(uint256,uint256)=0xeaa68ceb`, `InsufficientGasForPayout=0x782b2567`, builder over-cap `0xf559e808`, + SpotRouter errors |
| http-api/error-handling.md | med | **(NEW)** "stable programmatic" `name` table omits 11 live `ErrorName`s | Add `operator_approval_required, no_liquidity, prepare_error, balance_error, orderbook_error, cancel_error, reduce_error, bad_gateway, provider_unavailable, auth_unavailable, bad_request` (or generate from OpenAPI) |
| http-api/authentication.md (section) | med | Rate limits documented **nowhere** despite `x-ratelimit-*` headers | Add: 200 req/s public market-data, 40 req/s auth (per-second); document headers + 429 |
| http-api/authentication.md | med | Nonce described "single-use, 5 min"; actually stateless/**replayable** | Enforce one-time-use or reword ("not consumed on use") |
| http-api/market-data.md | med | Multi-symbol form not shown; comma / unknown symbol → 200-empty (silent) | Show repeated-param `?symbols=A&symbols=B`; warn silent-empty |
| trading/common/yield-algorithm.md · fees.md · roadmap.md | med | Phantom "view yield via Developer API" (routes 404); yield CURRENT vs roadmap "Later"; sigma + settlement interval withheld | Remove/ship the endpoint; reconcile status; publish σ + interval (seconds) |
| welcome/roadmap.md · functions.md | med | Builder codes framed future ("Next" / "cap is 0"); LIVE at 100 bps | State enforcement LIVE v1.0 (cap 100 bps); scope "Next" to the rebate program; document over-cap revert 0xf559e808 |
| contracts/contract-specifications.md | med | **(NEW)** Tick/price = "raw units × 10^decimals" — wrong for any non-18-dec quote (works only because all live quotes are 18-dec USDso) | State 1e18 fixed-point (raw = human × 1e18); list live raw ticks WETH 1e16 / WBTC 1e17 / SOMI 1e14 |
| trading/common/fees.md | med | Gas-cost table 100% `[TODO]`; "0% fees" omits builder fees | Fill measured SOMI/USD per action; note a 0–100 bps builder fee may attach |
| trading/readme-1/stop-orders.md | med | Unactionable stub: no `SpotStopOrderRegistry` address, no `somiPaymentPerOrder` value | Publish registry address (5031/50312) + `somiPaymentPerOrder` (=0.5 SOMI) + `createPendingOrder` selector |
| trading/readme-1/operators.md | med | "Operators never touch your funds" understates an **uncapped, non-expiring** session key | Clarify: unlimited/non-expiring authority to commit the owner's balance into orders until revoked; recommend per-pool grants + kill-switch |
| websocket-api/real-time-feed.md | med | Trades snapshot implies a populated array; live carries `trades:null` | State `trades` can be null; null-check before iterating |
| websocket-api/operations.md | med | RPC-over-WS shares the socket with pub/sub w/ no signposting; symbol convention disagrees w/ ccxt.md | Distinguish the two WS models; standardize symbol convention |
| http-api/builder-fees.md | low | **(NEW nuance)** `/builder/approve` 200 + guaranteed-revert; "approved may exceed cap" misleading (over-cap reverts → on-chain `approved` ≤ cap always) | Note approve doesn't pre-validate; clamp client-side vs `/builder/max-fee` |
| contracts/contract-specifications.md | low | `getPoolParams` field order absent; no proxy note | Repeat the 7-tuple order; note EIP-1967 **beacon** proxies (0x55790554…, upgrade in lockstep) |
| contracts/spot-router.md | low | **(NEW)** 25+ router error NAMES, **no 4-byte selectors** | Add selectors so integrators can decode router reverts |
| contracts/functions.md | low | Selectors only for the `*For` variants | Add `placeOrder=0x4e978373, cancelOrder=0xdbc91396, reduceOrder=0x33407b60, getPoolParams, getMaxBuilderFeeBpsTimes1k` |
| websocket-api/errors.md | low | 1006 idle close (~66–68 s) not in close-code table; "60 s" imprecise | Add 1006 (abnormal) for the idle/read-timeout; note ~66–68 s observed |
| developers/libraries.md | low | Doesn't state CCXT is the sole binding + TS-only | State CCXT is the only binding, TypeScript-only |

---

## Delta re-check — 2026-07-08 (post-comp; DreamDEX shipped doc fixes)

Re-fetched the load-bearing pages + re-probed the live API two days after the 2026-07-06 pass. **DreamDEX fixed several reported items in the interim** — evidence the feedback loop works:

- **functions.md** — builder codes now documented **LIVE on mainnet** (cap `100000` = 100 bps, testnet 0; over-cap semantics via `getEffectiveBuilderApproval`). Closes item 11 / B8's docs↔chain contradiction; residual: `roadmap.md` still frames builder-codes under "Next".
- **functions.md** — native-base BUY gas floor now quantified ("Set the tx gas limit ≥ 5,000,000", selector `0x782b2567`, simulate-at-broadcast-gas advice); prepare-tx OpenAPI schema now documents a recommended `gasLimit`. Closes item 12 / B12.
- **operators.md** — rewritten: pool-side `isOperatorAuthorized` check, registry addresses for 5031+50312 (incl. previously-undocumented `SpotPoolRegistry` `0xB601bc1099B040E4882089D94690F7C38AF4CCD2`), typed setter signatures, per-pool denial **kill-switch**, "Funds and custody" section, global-grant-auto-extends warning. Residual: no per-operator spend cap / grant TTL.
- **stop-orders.md** — rewritten, no longer an unactionable stub.
- **market-data.md** — multi-symbol now documented (array form, max 16) incl. silent-skip of unknown symbols.
- **1m candles now POPULATED** for WETH+SOMI — B18's empty-1m fixed live.
- **Docs HTML no longer 401s to machine fetch**; token-prefixed `.md` paths now soft-404 with HTTP 200 (page-not-found body) — path gotcha updated.
- **New surface discovered:** auth-gated `GET /v0/portfolio` (PnL/MWRR/volume — partially answers B24's "ship endpoints" ask), `GET /v0/currencies`, and a **4th mainnet market `USDC.e:USDso`** (6-dec base — first non-18-dec-relevant asset; the 1e18-fixed-point doc rows should be re-checked against it).
- **Nuance (B23):** `trades:read_any` gates the any-wallet `trades/{address}` variant, not `/v0/trades` itself.
- **One self-correction:** our "Fixed since" B5 bullet overstated — see the corrected bullet above (client-ping documented; "no server pings" + sequence numbers NOT stated; B5/B7 residuals stand).
- **Still broken (re-confirmed live 2026-07-08):** sorted-book claim in real-time-feed.md (HIGH), ccxt.md `SOMI/USDC` ×10, name-only enums, fees.md `[TODO]` gas table, phantom yield-API claim, no 1006 in errors.md close-code table, selectors only for `*For` variants, error-handling.md missing 11 live `ErrorName`s.
- **Leaderboard:** the board app exposes live JSON at `dreamdex-leaderboard-new.vercel.app/api/leaderboard` — this report's final numbers (raw 945,661.04 / tx 127,570 / PnL −146.44 / eff 22,420.24) verified against it verbatim. All on-chain claims (poolParams, selectors, topics, beacon proxy, cap 100000 ×3 pools) re-confirmed live same day.

*Verification: an adversarial pass re-fetched the load-bearing pages and confirmed every flagged item is REAL doc text (verbatim quotes captured) — e.g. real-time-feed.md "Bids are sorted by price descending … asks ascending" (vs live-unsorted), ccxt.md's 10 `SOMI/USDC` examples, functions.md "At v1.0 launch the cap is 0 … BuilderCodesNotSupported" (vs live cap 100000) *(quote captured 2026-07-06; page fixed by 2026-07-08 — now states builder codes live on mainnet, cap 100000)*, types.md enums name-only. No hallucinated findings. The one softened item: functions.md already carries error names + the `InsufficientGasForPayout` selector inline, so the gap is the missing consolidated selector MAP, not a "no errors exist" claim.*
