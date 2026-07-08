# DreamDEX Dev Traders Program — Cohort 2 — Complete Feedback & Stress-Test Submission

> **Competition ENDED** (Day-14 final snapshot ~2026-07-07). Official results pending from DevRel.

**GitHub Repo:** https://github.com/alventendrawan123/dreamtend
**Wallet:** `0xba4E595D6C2e655592c86ce29BbAec202d9175E1` (trader-3). Cohort 2 start ~2026-06-24, 14 days.
**Method:** live probing of mainnet `api.dreamdex.io/v0`, the `wss://api.dreamdex.io/v0/ws/public` feed, and the 3 SpotPool contracts on Somnia mainnet (chain 5031), cross-checked against the developer docs + our repo ABI. Generated from a multi-agent live stress-test sweep (7 surfaces), re-validated 2026-07-06 and 2026-07-08.

This submission covers the three program objectives: **(1) stress-test the trading API, (2) validate developer-docs usability, (3) generate real trading activity** — and lists every bug + doc fix found, with severities and suggested fixes.

---

## Final result (leaderboard, 2026-07-08 · `dreamdex-leaderboard-new.vercel.app`)

**Finished #3 by raw volume — 945,661.04 USDso** with **the highest tx count in the cohort, 127,570** (1.35× the next-highest, 94,424 — matches our on-chain nonce exactly).

| Rank (raw) | Trader | Raw volume | Tx | PnL |
|---|---|---|---|---|
| 1 | trader-5 | 1,093,447.73 | 43,337 | −125.90 |
| 2 | trader-2 | 1,086,201.94 | 31,324 | −122.31 |
| **3** | **us (trader-3)** | **945,661.04** | **127,570** | **−146.44** |
| 4 | trader-1 | 923,141.92 | 94,424 | −114.56 |

Board ranks by **Eff. Volume = Raw × (1 + PnL%)** (equivalently raw × usdsoBalance/150); by that metric we are #4 (eff 22,420.24). Rewards/winner announcement pending.

---

## Rule 4 deliverables checklist
- [x] **API feedback** — comprehensive live stress-test → see **Part I** (Objective 1 + B1–B28 bug table)
- [x] **Documentation feedback** — usability validation → see **Part I** (Objective 2 + doc-fix tables; the 2026-07-06 re-validation table + 2026-07-08 delta are the CURRENT lists)
- [x] **Bug reports** — 31 bugs total: the 13 originally-logged items (Part II) + the B1–B28 table (Part I) + B29–B31 (Part III); severities + suggested fixes
- [x] **Trading activity** — Objective 3 (Part I) + Days 7–14 addendum (Part III). Final: #3 by raw volume (945,661 USDso), 127,570 txs (cohort-high), PnL −146.44 — see result box above
- [ ] **GitHub repo** — `dreamtend` (comp ended — push cohort-2 work; add cohort-2 README section)
- [x] **Bot snippets** — `scripts/make-take.ts` (⭐ alternating maker+taker — the final-week volume engine: drift-kill + dynamic sizing), `mm-pullonmove.ts` (near-free pull-on-move maker), `mm-loop.ts`, `mm-tuned.ts` (adverse-aware maker), `ioc-loop.ts` (taker), `breakout-bot.ts` (directional, OOS-validated), `backtest.ts` + `backtest-sweep.ts` (research), `operator-demo.ts` (⭐ non-custodial session-key, live-proven), `cancel-all.ts`, `pnl.ts`
- [x] **Screenshots/videos** — final leaderboard captured 2026-07-08; plus bots running, pnl.ts output, fills
- [ ] **Post-comp (optional): testnet end-to-end coverage** of the mutating/auth-gated paths — not completed during the comp window (see Part I "Coverage gaps")

---
---

# PART I — API Stress-Test & Developer-Docs Validation Report

## Objective 1 — API stress-test summary

DreamDEX's API surface is **broadly robust and healthy** under live stress, with a handful of real footguns and genuine bugs.

**What works well.** All read-only market-data GETs respond sub-second (markets ~185–400 ms, orderbooks ~185–435 ms, candles ~190–260 ms, volume ~250 ms, tickers ~420 ms); no rate-limit hit during burst probing; no auth needed for market-data. The full SIWE + JWT auth flow works first-try (ERC-4361 `personal_sign` → ES256 JWT, `sub`/`wallet` claims, 3600 s TTL). The **prepare-then-sign** trading model is sound: POST/DELETE/PATCH on orders return *unsigned* txs `{chainId,data,to,value}` (server holds no keys) whose calldata decodes cleanly to on-chain `placeOrder`(0x4e978373) / `cancelOrder`(0xdbc91396) / `reduceOrder`(0x33407b60). Approval-shortfall detection works (returns `approval:{token,amount}` only when on-chain allowance is short). Native-base (SOMI) value handling is correct. The API **self-documents via its own 400 errors** (every validation failure dumps the full JSON-Schema: enums, required fields, defaults). WS connects in ~200 ms (101, no auth), and subscribe/snapshot/incremental-update/unsubscribe/error frames all work (`quantity:"0"` = level removal). **Testnet (stg, chain 50312) is at full parity.** `getPoolParams()` confirms a true **0%-maker / 0%-taker** venue on all 3 pools.

**What breaks / limits.** WS sends **zero** server ws-pings (keepalive is the client's app-level `{operation:ping}` obligation, and the idle timer resets only on *client→server* frames — an active subscriber that only receives is still killed); idle close fires at ~66–68 s with code **1006** (abnormal, no frame), not the documented 60 s / 4001; WS frames carry **no sequence number** (no gap detection / reconnect resync). Two genuine API bugs: `builder/approve` accepts a fee **over** the protocol cap and returns a guaranteed-to-revert tx; and the SIWE **nonce is replayable** (not consumed on use). Native-base buys silently hit `InsufficientGasForPayout` unless the client forces `gas ≥ 5M`, and prepare-tx responses give no gasLimit hint. **Builder codes are LIVE** (cap 100 bps on all pools) despite docs saying disabled. Reliability/latency: excellent — no flakiness, no 5xx, no hosted OpenAPI spec (`/openapi.json` 404).

**Major correction to a long-standing assumption:** the on-chain getters are **not dead** — our repo's ABI declared the *wrong signatures*. `getOwnOpenOrders()` (no-arg, 0xe1f57e0c) and `getBookLevels(bool,uint64)` (0x4f1ce9a7) both work live; the repo's `getOwnOpenOrders(address)` / `getBookLevels(bool,uint8)` are what bare-revert. See B1/B2.

---

## Objective 2 — developer-docs usability summary

**Overall usability: FAIR.** The single best source of truth turned out to be the API's *own* validation errors (every 400 dumps the full JSON-Schema). The hosted docs are browser/cookie-gated (401 to machine fetch). *(SUPERSEDED 2026-07-06: every page serves a token-less `.md` variant with no auth — see the re-validation section below; the 401 affects only the browser HTML render.)*

- **Contracts docs** (functions/events/types): FAIR-to-GOOD on accuracy — notably *more correct than our repo's ABI* (docs give the correct no-arg `getOwnOpenOrders()`, `getBookLevels(bool,uint64)`, 6-param `OrderFilled` w/ fillPrice, and all 7 event topic0s). POOR on completeness: no custom-error catalog, StopOrder events referenced but unspecified, and no page maps `OrderType`/`SelfMatchingOption` enum **names → uint8 integers** (the most safety-critical params).
- **HTTP-API docs**: GOOD structure, live REST matches, but auth scopes are self-contradictory and OHLCV is mis-described.
- **WebSocket docs**: MIXED — `errors.md` excellent/accurate, `real-time-feed.md` matches live, but `operations.md` describes a different/empty RPC model and omits subscribe semantics.
- **Trading/common**: `fees.md` openly WIP ([TODO] gas table); `yield-algorithm.md` gives formulas but withholds every numeric parameter (sigma, settlement interval) and contradicts the roadmap.
- **Libraries**: POOR — the sole CCXT page is alpha/unpublished and every example uses a non-existent symbol (`SOMI/USDC`).

**Worst gaps:** (1) builder-codes contradiction (docs disabled vs live 100 bps); (2) CCXT examples use `SOMI/USDC` (real: `SOMI:USDso`) — nothing runs as written; (3) phantom "view yield via Developer API" (all yield/reward routes 404 even with a valid JWT); (4) auth-scope self-contradiction; (5) no contract custom-error catalog with selectors; (6) no `OrderType`→uint8 mapping; (7) no full SIWE/login example.

---

## Objective 3 — real trading activity (evidence)

Wallet `0xba4E595D6C2e655592c86ce29BbAec202d9175E1` (trader-3) drove **genuine, two-sided** load across all 3 eligible pairs (WETH/WBTC/SOMI vs USDso) — dominant at the Day-1 snapshot below; final-week state in **Part III** (Days 7–14 addendum).

- **Leaderboard — Day-1 snapshot (2026-06-24, updatedAt 1782299648050):** `txCount=2693, fills=1100, volumeUsdso=42,829.1, volumeEffective=13,795, usdsoBalance=48.31, pnl=−101.69, allocationUsdso=150`. **#1 by both raw and effective volume at that point** — next-best (trader-1) had `volumeUsdso=2,364` (18× less), `fills=213` (5.2× fewer); our raw ≈ **89% of all leaderboard volume** then. *(Final — leaderboard 2026-07-08: **#3 by raw volume, 945,661 USDso**; the cohort's highest tx count, 127,570; eff.vol 22,420 = #4 by the board's Eff = Raw × (1 + PnL%) ranking. See the result box at top.)*
- **On-chain corroboration** (RPC, chain 5031): `eth_getTransactionCount = 2696` broadcast txs at Day-1 (final nonce at comp end: **127,570**, read 2026-07-08); wallet funded as of 2026-06-24 (44.93 SOMI; USDso 60.77, WETH 0.0226, WBTC 0.0007) — post-comp after liquidation to USDso (2026-07-08): 3.56 USDso, 0.30 SOMI, 0 WETH/WBTC.
- **Order types exercised** via `placeOrder` (post-migration from deprecated `placeTakerOrderWithoutVault`): **IOC taker** (`ImmediateOrCancel=2`, auto-ERC20-pull) and **PostOnly maker** (`=3`, rests + earns maker fills), `SelfMatch.CancelTaker=0`, each cycle `staticCall`-simulated then broadcast. `FillOrKill`/`NormalOrder` defined but not exercised live.
- **Engines:** IOC takers (`ioc-loop.ts`), two-sided makers with inventory-skew (`mm-loop.ts`, `mm-tuned.ts`), directional (`breakout-bot.ts`, Binance-ETH Bollinger breakout, OOS Sharpe ≈ 2). Book sourced from REST `/v0/orderbooks` (on-chain getter worked around), fills confirmed via tx receipts + `OrderFilled` (6-uint, topic `0xc87f4223…`) scans. Clean trading throughout (genuine fills, not wash inflation). This load (~2.7k tx / 1,100 fills by Day-1, growing to ~127.6k broadcast txs by comp end) **doubled as the stress test** that surfaced the bugs below.

---

## Bug table (B1–B28)

Severity: **high** = correctness/security/data-loss · **med** = footgun/inconsistency · **low** = minor · **info** = note. "Repo ABI" bugs are in *our* `src/dex/abi/spotpool.ts` (surfaced by the test; some are worth fixing for cleaner bots).

| # | Sev | Title | Detail / Fix |
|---|-----|-------|--------------|
| B1 | high | `getOwnOpenOrders(address)` (repo ABI) bare-reverts; no-arg `getOwnOpenOrders()` WORKS | Repo declares wrong sig → 0x revert on all pools. Docs-correct no-arg `getOwnOpenOrders()` (0xe1f57e0c) returns the caller's `OrderId[]`. **Fix repo ABI** → read own orders directly (drops the OrderPlaced log-scan workaround). |
| B2 | high | `getBookLevels(bool,uint8)` (repo ABI) bare-reverts; `getBookLevels(bool,uint64)` WORKS | 2nd param is **uint64** and return is `OrderBookLevel[]` (struct, not 2 parallel arrays). Live returns populated levels. **Fix repo ABI**; REST `/v0/orderbooks` stays as convenience. |
| B3 | high | `OrderFilled` ABI wrong (5 vs live 6 uints) → silently drops ALL fill logs | Real `OrderFilled(uint128,uint128,uint256,uint256,uint256,uint256)` topic `0xc87f4223…` (incl `fillPrice`). Repo's 5-field → topic never on chain; `ioc-loop.ts` undercounts its own fills. **Add 6th uint** + fix the topic. |
| B4 | high | `OrderPlaced` ABI wrong shape (flat 7-field vs live `indexed orderId` + Order tuple) | Real `OrderPlaced(uint128 indexed, Order tuple)` topic `0xd90f62f6…`. `cancel-all.ts` already hardcodes the correct topic. **Replace the flat ABI entry**. |
| B5 | high | WS server sends ZERO ws-pings; idle timer resets only on client frames | Active receive-only subscriber is still killed. Only `{operation:ping}`→`pong` keeps alive. **Server should ping or count inbound delivery as liveness; docs must state the client-ping obligation.** |
| B6 | high | WS idle close = code 1006 (abnormal, no frame) at ~66–68 s, not 4001/clean | Indistinguishable from a network blip/deploy. **Emit a clean close frame + code; align documented 60 s with real ~66–68 s.** |
| B7 | high | WS frames carry no sequence number — no gap detection / reconnect resync | **Add a per-channel monotonic seq to every snapshot+update; document a resync protocol** (critical given the 1006 closes). |
| B8 | high | Builder codes LIVE on-chain (cap 100 bps) despite docs "disabled in v1.0" | `getMaxBuilderFeeBpsTimes1k()=100000` on all 3 pools; REST encodes builder into calldata. `functions.md` claims disabled + `BuilderCodesNotSupported` (never produced). **Reconcile docs ↔ live, or set cap=0.** *(Docs FIXED by 2026-07-08 — see Delta re-check.)* |
| B9 | high | `builder/approve` accepts over-cap fee → returns a guaranteed-revert tx | `maxFeeBpsTimes1k=999999` (> 100000) returns 200 with an `approveBuilder` tx that reverts on-chain with `0xf559e808`. **Server-side validate ≤ protocolMaxFee; reject with 400.** |
| B10 | med | SIWE nonce is replayable — not consumed on use | Same `{message,signature}` ×3 → 3 fresh JWTs. Fabricated nonce → 401, so it validates issuance but doesn't burn. **Burn nonces on first login.** |
| B11 | med | Vault writes: JWT `sub` not enforced vs `body.walletAddress` (authz gap) | A session built a vault tx for a *different* wallet → 200. Low impact (tx still needs target sig) but should **403 on mismatch**. |
| B12 | med | Native-base buys need forced `gas ≥ 5M`; prepare-tx gives no gasLimit hint | Live error `InsufficientGasForPayout(uint256)` = `0x782b2567`. `breakout-bot.ts` hardcodes `gasLimit:5_000_000n`. **Include a gasLimit hint; document the error signature.** *(Docs FIXED by 2026-07-08 — see Delta re-check.)* |
| B13 | med | `reduceOrder(uint128,uint256)` live + used by REST but ABSENT from repo ABI | Selector `0x33407b60`. Local decode/static-call fails until added. **Add the fragment to `spotpool.ts`.** |
| B14 | low | `placeTakerOrderWithoutVault` deprecated — bare-reverts 0x, no named error | No migration guidance for legacy callers. **Revert with a named `Deprecated()` or add a doc note → `placeOrder()`.** |
| B15 | low | REST cancel/reduce do no ownership/existence check — 200 ≠ success | `DELETE …/orders/999999999999` (not ours) → 200 with calldata; only on-chain reverts. **Validate server-side or document that prepare 200 ≠ confirmation.** |
| B16 | med | Vault `deposit` doesn't bundle approval; `withdraw` doesn't pre-check balance | Unlike place-order, deposit returns only `deposit()` (caller must `vault/approve` first). Withdraw for amount 1 on a 0 balance returns a revert-bound tx. **Bundle approval; add a balance guard/doc note.** |
| B17 | med | `/orderbooks`&`/tickers`: comma multi-symbol silently empty; bad symbol → 200-empty (vs path-style 404) | Multi-symbol works only with **repeated params** (`symbols=A&symbols=B`). Field is `quantity` not `size` (repo `OrderBookLevel.size` reads undefined). **Support/400 comma; make unknown-symbol consistent; fix repo field.** |
| B18 | med | `ohlcv`/`klines` don't exist; candles are **market-scoped** `/v0/markets/{symbol}/candles?interval=`; 1m empty for active pairs | Interval enum `1m,5m,15m,1h,4h,1d` (required). 1m returns `[]` for WETH/SOMI despite trades. **Re-verified 2026-07-06: top-level `/v0/candles?...` returns 404 "page not found"; the working path is `/v0/markets/{sym}/candles?interval=` (200). 1m now POPULATED as of 2026-07-08.** *Document the market-scoped path (a top-level `/v0/candles` would be more discoverable); add a `getCandles` repo method.* |
| B19 | low | Repo `RecentTrade.size` wrong (live fields `amount`+`cost`); default limit mismatch | API default `limit=100` (repo hardcodes 20); trade `id` is composite `makerOrderId:takerOrderId`. **Fix repo type + limit; document the id.** |
| B20 | med | `tickSize` is 1e18 fixed-point (NOT quote decimals); repo `pairs.ts` lot/minQty stale/swapped | WETH tick raw `1e16`, WBTC `1e17`, SOMI `1e14`. Assuming USDso decimals → off-by-1e12 (our bots are safe only because USDso *is* 18-dec). `getPoolParams` tail order is `(tickSize, minQuantity, lotSize)` — repo had lot/minQty swapped. **Document fixed-point; fix repo ABI tail order.** |
| B21 | med | Leaderboard `usdsoBalance` understates true portfolio — penalizes makers holding inventory | `effVol = raw × usdsoBalance/150` reproduces (42829×48.31/150≈13795) but `usdsoBalance` excludes base inventory AND disagrees with live liquid USDso (60.77). **Use total portfolio marked-to-mid.** |
| B22 | low | `placeOrder` returns NAMED custom errors (refutes blanket "bare require(false)") | Sub-min qty → `QuantityBelowMinimum(uint256,uint256)`=`0xeaa68ceb`; `placeOrderFor` w/o perm → `0x3fb0ba2e`. The bare-0x reverts were all from calling WRONG repo-ABI sigs. **The real gap is the missing error catalog, not uniform bare reverts.** |
| B23 | med | `/v0/trades` (own fills) is auth-gated 401 — confusingly similar to public `/markets/{sym}/trades` | Auth split undocumented; a bot expecting a public `/v0/trades` gets 401. **Document the split / rename (`/v0/account/trades`).** *(Nuance 2026-07-08: `trades:read_any` gates the any-wallet `trades/{address}` variant.)* |
| B24 | med | No yield/rewards/rebates/points/leaderboard REST endpoints exist (even with auth) | All 404 with AND without JWT (routes absent, not gated). `yield-algorithm.md`'s "view via Developer API" is phantom. **Ship endpoints or remove the claim.** *(2026-07-08: an auth-gated `/v0/portfolio` (PnL/MWRR/volume) now exists — partially addresses this.)* |
| B25 | low | WS trades snapshot uses `trades:null` (not `[]`); bids/asks arrive UNSORTED | null-vs-array inconsistency; client must sort the book. **Return `[]`; document unsorted + top-level frame shape.** |
| B26 | med | StopOrderRegistry events (`PendingOrderCreated/Triggered/Cancelled`) referenced but never specified | `contracts.md` names them; `events.md` documents only the 7 SpotPool events. Live registry confirmed (`somiPaymentPerOrder()=0.5 SOMI`). **Add signatures + topic0s.** |
| B27 | med | Mixed error envelopes: JSON vs Go "page not found" text vs Google-Frontend HTML | 3 distinct formats by failure class. **Normalize to `{name,description,status}` JSON, incl. unknown-route 404s.** |
| B28 | info | All SpotPools are EIP-1967 **beacon** proxies — one upgrade changes all pools atomically | Beacon `0x55790554…`, impl `0xbc8a166d…`. **Pin/monitor the beacon impl; document the upgrade model.** |

---

## Documentation fix table (original 14)

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

The probe was read-only / static-simulation safe (no new mutating txs broadcast from the probe itself; the on-chain txs — 2,696 at Day-1, 127,570 final — came from the production bots). Planned Day-14 testnet coverage (stg, chain 50312, free funds). **Status at close: items 1–5 & 7 NOT executed during the comp window (optional post-comp follow-ups); item 6 DONE; item 8 SUPERSEDED:**

1. **Broadcast each prepared tx end-to-end** — confirm the over-max `builder/approve` (`0xf559e808`) revert on a live tx, a `vault` deposit→withdraw round-trip, and a `reduceOrder` on a real owned resting order (capture real receipts).
2. **Force the WS 4001 slow-consumer** (stall the read loop) and the **100 in-flight cap** (>100 concurrent subscribes); capture a live `trades` frame (none occurred on WETH during windows).
3. **Authenticated WS `order` channel** — validate own-order push + frame schema.
4. **Populated getters** — place a known order, capture its id, then `getOrder(id)` + no-arg `getOwnOpenOrders()` + `getBookLevels` both sides against the corrected ABI.
5. **Nonce-replay + JWT-expiry boundaries** — map exact TTLs.
6. **Rate limits** — controlled burst to characterize the ceiling + 429 behavior. **[DONE — live-measured: 200 req/s public / 40 req/s auth; see "Rate limits (live-measured)" below.]**
7. **`OrderExpired` / `OrderReduced` events** — let a PostOnly order expire + issue a reduce to emit + decode both.
8. **Verify docs verbatim** — ~~pull docs via an authenticated browser session (hosted docs are 401 to machine fetch)~~ **[SUPERSEDED — done 2026-07-06 via token-less `.md` variants (see re-validation); the 401 affects only the browser HTML render.]**

---

## Advanced capabilities exercised (beyond basic place/cancel)

Deep capability audit of the HTTP API + on-chain surface, with one flagship demonstrated **live on mainnet**.

### Non-custodial session-key delegation (operators) — DEMONSTRATED LIVE ⭐
`scripts/operator-demo.ts` proves the full operator lifecycle end-to-end on mainnet: a fresh **hot/session key** trades on behalf of the **cold wallet** without ever holding custody — it can ONLY `placeOrderFor`/`cancelOrderFor`/`reduceOrderFor` orders owned by the cold wallet; it CANNOT deposit/withdraw/approve/move funds. This is the clean answer to "run a 24/7 bot on a low-trust server key" and directly serves the cohort-2 24h-activity-or-DQ always-on requirement.
- Registry `0xE7a190736B6024a4DbafadC04E283075877005ce` · `setOperatorApprovalGlobal(address operator, bytes4[] selectors, bool approved)`
- Selectors: `placeOrderFor`=`0x80054449`, `cancelOrderFor`=`0xe37b444b`, `reduceOrderFor`=`0x364c2587`
- Verify via **pool** `isOperatorAuthorized(owner, operator, selector)` (NOT the registry — the registry is a 163-byte proxy).
- **Live proof (WETH:USDso, 2026-06-24):** grant tx `0x901c2c90…` → `isOperatorAuthorized`=true(×3) → hot key `placeOrderFor` tx `0xaa5bcdfd…` rested orderId `442721857769041871470` **owned by the cold wallet** (confirmed via the no-arg `getOwnOpenOrders()` returning it) → hot `cancelOrderFor` tx `0x03359c0c…` → revoke → `isOperatorAuthorized`=false(×3).
- *Docs gap:* operators.md gave function NAMES + selectors + a `cast` example but NOT full typed signatures or the registry's read-function location (it's on the pool). **[FIXED by 2026-07-08 — operators.md rewritten: pool-side `isOperatorAuthorized` check, registry addresses for both chains (incl. previously-undocumented `SpotPoolRegistry` 0xB601bc1099B040E4882089D94690F7C38AF4CCD2), typed setter signatures, per-pool grant/denial scoping. Residual: still no per-operator spend cap or grant TTL.]**
- *Security caveat (worth noting in docs):* no per-operator spend cap and no key TTL/expiry — safety rests on (a) operators cannot move funds and (b) immediate revocation (which does NOT disturb already-resting orders).

### Other capabilities mapped (audit, not all exercised)
- **Vault-funded resting** (`fundingSource:"vault"` + `setManualVaultMode(true)`): pre-deposit once, then rest N maker/grid orders with ZERO per-order ERC20 pulls → lower gas + latency per order = cheaper RAW volume. Wallet funding is IOC/FOK-only; resting GTC/PostOnly *requires* vault funding. Scripts `deposit-vault.ts` + `maker-probe.ts` already exercise the path.
- **SpotRouter** `swapExactIn`/`swapExactOut` + REST `type:"market"`: one-tx deterministic RAW volume (no IOC no-fill waste); still pays the half-spread, and books are thin (~$3–5k/side, 5–6 levels) so impact caps churn per tx.
- **Rate limits (live-measured, undocumented):** public market-data = **200 req/s** (shared bucket), auth = **40 req/s**, window = per-second (headers `x-ratelimit-limit/remaining/reset`). ~17M reads/day headroom — no throttle risk at our rate.
- **Batch cleanup:** `cancelExpiredOrders(uint128[])` / `sweepExpiredAtLevel(bool,price,maxCount)` tear down a stale grid in one tx. Asymmetry: batch CANCEL exists but there is **no batch PLACE** (`placeOrder` is single-order only).
- **`reduceOrder(uint128,uint256)`**: in-place size reduction that **preserves queue priority** (vs cancel+repost).
- **On-chain EMA mark** `getMidpointEmaState()` (manipulation-resistant fair value) + **StopOrderRegistry** keeper-executed stop/take-profit (per-order SOMI prepay) — useful for grid centering / offline risk management.

### Two doc/code corrections (from this audit)
- **Builder codes are LIVE on-chain** (cap 100 bps), NOT "disabled in v1.0" as some docs/older notes state. Keeping `builder=address(0)`/`fee=0` in our code is still correct (we have no third-party flow), but the wording should read "live but unused."
- **WebSocket feed IS consumed** by `src/orchestrator.ts` (subscribes `orderbook`+`trades`; momentum/market-maker act on deltas). Only the private `order` channel (native fill confirmation) remains unsubscribed.

## Repo follow-ups — FIXED 2026-06-24 (verified on-chain + end-to-end round-trip)

All ABI/consumer bugs the stress-test surfaced in our own code were fixed and validated (typecheck clean; a live mainnet buy+sell round-trip with the corrected ABI nets 0 WETH with *finer* sizing — 0.0029 vs the old 0.002):

- **`src/dex/abi/spotpool.ts`** — corrected to live signatures: `getOwnOpenOrders()` (no-arg), `getBookLevels(bool,uint64)` returning `OrderBookLevel[]` tuple array, `OrderFilled` 6-uint (incl `fillPrice`), `OrderPlaced` (`indexed orderId` + `Order` tuple), added `reduceOrder(uint128,uint256)`, fixed `getPoolParams` tail order to **(tickSize, minQuantity, lotSize)**.
- **`src/dex/abi/types.ts`** — `SpotPoolContract` updated (no-arg `getOwnOpenOrders`, `getBookLevels` struct-array, `reduceOrder`).
- **`src/dex/contracts.ts`** — `readBookLevels` maps the new struct[]; `readPoolParams` reads minQuantity@5/lotSize@6; `readOwnOpenOrders` uses no-arg with `{from}` override.
- **`src/dex/rest.ts`** — `OrderBookLevel.size→quantity`, `RecentTrade` → `{amount,cost,id,...}`.
- **Consumers** — `mm-loop.ts`, `mm-tuned.ts`, `breakout-bot.ts`, `maker-probe.ts`, `consolidate-sell.ts`, `probe-pool.ts`: corrected lot/minQty indices; `ioc-loop.ts`, `ioc-loop-somi.ts`, `cross-loop.ts`, `maker-probe.ts`, `diag-fills.ts`, `research-wallet.ts`: corrected `OrderFilled` topic to 6-uint; `sanity-check.ts`: `.size→.quantity`.
- Note: `src/config/pairs.ts` was already correct (matches live `getPoolParams` + REST `/markets`). The earlier "pairs.ts swapped" suspicion was disproved by on-chain verification — only the ABI *tail order* was swapped.

---

## Developer-docs re-validation — 2026-07-06 (Objective 2, full re-audit)

Re-fetched and re-validated all 25 developer doc pages against the verified live ground truth (fees/ticks/selectors/topics/errors/endpoints/rate-limits re-confirmed on chain 5031 + `api.dreamdex.io/v0` on 2026-07-06). Method: fetched every page's **`.md` variant** directly (see flagship correction), cross-checked vs live probes, adversarially re-verified the load-bearing claims by quoting raw `.md` (no summarizer trust). **Overall usability: still FAIR, but materially improved since the 2026-06-24 pass — many prior items are now fixed.**

### ⭐ Flagship correction — the docs ARE machine-fetchable (supersedes the report's "401 to machine fetch")
Objective-2 summary and Day-14-plan item 8 both stated the hosted docs are browser/cookie-gated / 401 to machine fetch. **That is now false (or was HTML-path-only).** Every page has a **token-LESS `.md` variant** served with no auth (e.g. `https://docs.dreamdex.io/developers/http-api/trading.md`), plus a full-corpus **`/llms-full.txt`** (~400 KB), **`/sitemap.md`**, an **`?ask=`** query param, **`Accept: text/markdown`** content-negotiation, and an **MCP server + `AGENTS.md`/`SKILL.md`**. All 25 pages fetched cleanly over plain HTTP. *Path gotcha for future auditors: the token-PREFIXED `.md` URLs (`/ld25g222…/developers/…`) 404 — use the token-less root paths that `/sitemap.md` and the 404 stub both link.* The 401 only affects the browser HTML render.

### Fixed since the 2026-06-24 report (re-verified live)
- **B18 / OHLCV** — `trading.md` now documents candles as market-scoped `GET /v0/markets/{symbol}/candles?interval=` with the exact enum `[1m,5m,15m,1h,4h,1d]` (top-level `/v0/candles`→404, `interval=2h`→400 both match).
- **B17 / field name** — `market-data.md` now uses `quantity` (not `size`).
- **B16 / vault** — `vault.md` now states deposit needs a prior pool-token approve + native approve returns JSON `null` (skip signing).
- **B15 / prepare 200 ≠ execution** — `trading.md` now warns receipt `status=1` can still place nothing (`(false,0)`, no events) → simulate via `eth_call` + check the `OrderPlaced` log; market-buy+wallet → 400 with the limit-IOC-above-ask workaround. **Best page in the section.**
- **B23 / trades auth split** — `trading.md` now documents public `/v0/markets/{symbol}/trades` vs auth-gated `/v0/trades` + `/v0/orders` (`trades:read_any` scope). Live: public 200, `/v0/trades` 401.
- **B5 / WS client-ping (partial)** — `real-time-feed.md` now documents the client-ping obligation (`{operation:ping}` ≥ every 30 s or the 60-s idle timer closes the socket). *(Correction 2026-07-08: the page does NOT state "server sends no pings", and sequence numbers are not mentioned at all — the B5/B7 residual gaps stand.)*
- **doc-item 1 (partial)** — the HTTP `builder-fees.md` page now documents builder codes as SUPPORTED with the correct `100000 = 100 bps` unit. *(By 2026-07-08 `functions.md` is fixed too; see Delta re-check.)*
- **doc-item 4 (partial)** — auth-scope contradiction appears resolved; SIWE **nonce method** now matches live (GET). *(Residual: nonce still described as single-use but is replayable within its window.)*

### Still-broken + NEW issues (doc-fix table, as of 2026-07-06)

> ⚠️ **Delta 2026-07-08:** several rows below were FIXED by DreamDEX between 07-06 and 07-08 — see the "Delta re-check — 2026-07-08" section next.

| Page | Sev | Issue | Fix |
|------|-----|-------|-----|
| websocket-api/real-time-feed.md | **high** | Claims book is pre-sorted (bids desc / asks asc); live frames are **UNSORTED** — a bot trusting `bids[0]` reads a wrong top-of-book and can cross badly | Remove the sorted guarantee; warn "levels are NOT sorted server-side — sort before using index 0" |
| libraries/ccxt.md | **high** | Every example uses the non-existent symbol `SOMI/USDC` | Replace with `SOMI:USDso`; align with `operations.md` |
| trading.md · quick-start.md · spot.md · functions.md · fees.md | **high** | Native-base (SOMI) BUY reverts `InsufficientGasForPayout` (0x782b2567) below a ~5 M gas floor — floor **unquantified everywhere** | State `gasLimit ≥ 5,000,000` for native-base BUY; add to the "why an order is rejected" list **[FIXED 2026-07-08 in functions.md (≥5M floor + selector + simulate-at-broadcast-gas) + OpenAPI `gasLimit` hint; residual: fees.md gas table still [TODO], no cross-ref from trading.md/quick-start]** |
| contracts/types.md · trading/common/order-types.md | **high** | `OrderType`/`SelfMatch` listed by NAME ONLY, no uint8 (ints live only in quick-start) | Add `NormalOrder=0, FillOrKill=1, ImmediateOrCancel=2, PostOnly=3` / `CancelTaker=0, CancelMaker=1` to the canonical enum pages |
| trading/readme-1/spot.md | **high** | Primary spot page never enumerates `placeOrder` params, no example, omits tick/minQty/lot traps | Enumerate `placeOrder(...)` w/ a worked example + tickSize-1e18-fixed-point / minQuantity / lotSize |
| contracts/functions.md + types.md | med | **No consolidated selector→error catalog.** (functions.md DOES list some error *names* + `InsufficientGasForPayout=0x782b2567` inline — the gap is a decode map, not "no errors exist") | Add a selector catalog: `QuantityBelowMinimum(uint256,uint256)=0xeaa68ceb`, `InsufficientGasForPayout=0x782b2567`, builder over-cap `0xf559e808`, + SpotRouter errors |
| http-api/error-handling.md | med | **(NEW)** "stable programmatic" `name` table omits 11 live `ErrorName`s | Add `operator_approval_required, no_liquidity, prepare_error, balance_error, orderbook_error, cancel_error, reduce_error, bad_gateway, provider_unavailable, auth_unavailable, bad_request` (or generate from OpenAPI) |
| http-api/authentication.md (section) | med | Rate limits documented **nowhere** despite `x-ratelimit-*` headers | Add: 200 req/s public market-data, 40 req/s auth (per-second); document headers + 429 |
| http-api/authentication.md | med | Nonce described "single-use, 5 min"; actually stateless/**replayable** | Enforce one-time-use or reword ("not consumed on use") |
| http-api/market-data.md | med | Multi-symbol form not shown; comma / unknown symbol → 200-empty (silent) | Show repeated-param `?symbols=A&symbols=B`; warn silent-empty **[FIXED 2026-07-08: array form (max 16) + silent-skip now documented]** |
| trading/common/yield-algorithm.md · fees.md · roadmap.md | med | Phantom "view yield via Developer API" (routes 404); yield CURRENT vs roadmap "Later"; sigma + settlement interval withheld | Remove/ship the endpoint; reconcile status; publish σ + interval (seconds) |
| welcome/roadmap.md · functions.md | med | Builder codes framed future ("Next" / "cap is 0"); LIVE at 100 bps | State enforcement LIVE v1.0 (cap 100 bps); scope "Next" to the rebate program; document over-cap revert 0xf559e808 **[functions.md FIXED 2026-07-08; roadmap.md residual]** |
| contracts/contract-specifications.md | med | **(NEW)** Tick/price = "raw units × 10^decimals" — wrong for any non-18-dec quote (works only because all live quotes are 18-dec USDso) | State 1e18 fixed-point (raw = human × 1e18); list live raw ticks WETH 1e16 / WBTC 1e17 / SOMI 1e14 |
| trading/common/fees.md | med | Gas-cost table 100% `[TODO]`; "0% fees" omits builder fees | Fill measured SOMI/USD per action; note a 0–100 bps builder fee may attach |
| trading/readme-1/stop-orders.md | med | Unactionable stub: no `SpotStopOrderRegistry` address, no `somiPaymentPerOrder` value | Publish registry address (5031/50312) + `somiPaymentPerOrder` (=0.5 SOMI) + `createPendingOrder` selector **[FIXED 2026-07-08: page rewritten]** |
| trading/readme-1/operators.md | med | "Operators never touch your funds" understates an **uncapped, non-expiring** session key | Clarify: unlimited/non-expiring authority to commit the owner's balance into orders until revoked; recommend per-pool grants + kill-switch **[FIXED 2026-07-08: rewritten w/ kill-switch + custody section]** |
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
- **One self-correction:** our "Fixed since" B5 bullet overstated — the corrected bullet stands (client-ping documented; "no server pings" + sequence numbers NOT stated; B5/B7 residuals stand).
- **Still broken (re-confirmed live 2026-07-08):** sorted-book claim in real-time-feed.md (HIGH), ccxt.md `SOMI/USDC` ×10, name-only enums, fees.md `[TODO]` gas table, phantom yield-API claim, no 1006 in errors.md close-code table, selectors only for `*For` variants, error-handling.md missing 11 live `ErrorName`s.
- **Leaderboard:** the board app exposes live JSON at `dreamdex-leaderboard-new.vercel.app/api/leaderboard` — this report's final numbers (raw 945,661.04 / tx 127,570 / PnL −146.44 / eff 22,420.24) verified against it verbatim. All on-chain claims (poolParams, selectors, topics, beacon proxy, cap 100000 ×3 pools) re-confirmed live same day.

*Verification: an adversarial pass re-fetched the load-bearing pages and confirmed every flagged item is REAL doc text (verbatim quotes captured) — e.g. real-time-feed.md "Bids are sorted by price descending … asks ascending" (vs live-unsorted), ccxt.md's 10 `SOMI/USDC` examples, functions.md "At v1.0 launch the cap is 0 … BuilderCodesNotSupported" (quote captured 2026-07-06; page fixed by 2026-07-08 — now states builder codes live on mainnet, cap 100000), types.md enums name-only. No hallucinated findings.*

---
---

# PART II — Originally-logged feedback items (the field notes)

> These 13 items are the originally-logged subset written live during the competition; Part I's B1–B28 table consolidates and expands them. Bracketed **[CORRECTED]/[REVISED]/[RESOLVED]** notes reconcile each item with the later live-verified findings.

### Contract / API bugs
1. **`getOwnOpenOrders(account)` reverts** with bare `require(false)` (no data) on the mainnet SpotPools — cannot enumerate one's own resting orders on-chain. Workaround: scan `OrderPlaced` events and decode the `Order` tuple owner. *Impact: makers can't cleanly cancel/manage their book.* **[CORRECTED — see B1: root cause was OUR ABI's wrong signature `getOwnOpenOrders(address)`; the docs-correct no-arg `getOwnOpenOrders()` (0xe1f57e0c) works live. Residual protocol feedback: a wrong-signature call bare-reverts `0x` with no signal.]**

2. **`getBookLevels(isBid, depth)` reverts even when the book is populated** — on-chain order-book read is unreliable; had to use REST `GET /v0/orderbooks` for mid/touch. *Impact: on-chain bots can't read depth.* **[CORRECTED — see B2: our ABI used `uint8` for the depth param; the live `getBookLevels(bool,uint64)` works and returns populated levels.]**

3. **Bare `require(false)` reverts with no revert string / custom error** across many failure modes (deprecated function, would-cross PostOnly, etc.) — extremely hard to debug; the `data="0x"` gives no signal. *Suggestion: add named custom errors / revert reasons.* **[REVISED — see B22: real failure paths DO revert with named errors (e.g. `QuantityBelowMinimum`=`0xeaa68ceb`); most of our bare-`0x` reverts came from calling wrong repo-ABI signatures. The actual gap = no consolidated selector→error catalog in the docs, plus a few genuinely unnamed paths (B14 deprecated fn, B31 spot over-balance).]**

4. **`placeTakerOrderWithoutVault` was deprecated mid-program (cohort 1)** with no in-doc deprecation notice — every taker order suddenly reverted `require(false)` until we migrated to `placeOrder`. *Suggestion: changelog + deprecation warnings; the silent revert cost hours to diagnose.*

11. **Builder codes: docs say DISABLED at v1.0, but they are ENABLED on-chain.** `builder-fees.md` / `contracts/functions.md` state that at v1.0 launch `getMaxBuilderFeeBpsTimes1k()` is `0` and any non-zero builder reverts `BuilderCodesNotSupported` ("ships with v1.1"). Live mainnet (chain 5031) `getMaxBuilderFeeBpsTimes1k()` returns `0x186a0` = `100000` (= **100 bps cap**) on ALL three eligible SpotPools (WETH `0xa936da…`, WBTC `0x25bfF6…`, SOMI `0x035De7…`). So the feature is already live, contradicting the docs. *Suggestion: update the docs to reflect the live 100 bps cap, or set the cap to 0 if it's not meant to be live yet.* **[RESOLVED in docs as of 2026-07-08: `functions.md` now states builder codes are live on mainnet with cap `100000` (100 bps), testnet 0 — the docs↔chain contradiction is closed. Residual: `roadmap.md` still frames builder-codes under "Next".]**

12. **`InsufficientGasForPayout` (`0x782b2567`) under-documented.** Native-base BUY fills revert with this selector unless the tx gas limit is generously high (~5,000,000) — it's a gas-LIMIT requirement at fill time, not an out-of-gas at submission, so naive gas estimation fails. *Suggestion: document the minimum gas limit for native-base order fills / payout path.* **[RESOLVED in docs as of 2026-07-08: `functions.md` now states "Set the tx gas limit ≥ 5,000,000 on native-base BUYs" with the `0x782b2567` selector + simulate-with-broadcast-gas guidance; the prepare-tx OpenAPI schema now documents a recommended `gasLimit` field.]**

### Documentation feedback
5. **Yield algorithm under-specified**: `trading/common/yield-algorithm` gives the formula `score = quantity × W × seconds`, `W = e^(−(P−Pmid)²/2σ²)`, but **σ, the settlement interval, and the yield-pool size are not given numerically** → impossible to estimate maker yield ex-ante or decide maker-vs-taker rationally.

6. **`OrderFilled` event signature clarity**: correct topic is `0xc87f4223…` = `OrderFilled(uint128,uint128,uint256,uint256,uint256,uint256)` (6 trailing uints incl `fillPrice`). A 5-uint variant silently never matches → "no fill events". *Suggestion: make event sigs prominent in `developers/contracts/events`.*

8. **Yield settlement interval not documented.** `yield-algorithm` says yield is "periodically settled as direct on-chain transfers" but never states the period (per-block? hourly? daily? per-epoch?). Makers can't reason about expected payout cadence or whether short resting bursts earn anything. *Suggestion: state the settlement interval.*

9. **"View historical yield rates via the Developer API" — no such endpoint exists.** The yield-algorithm page claims makers can view yield via the Developer API or Trade Interface, but the HTTP API exposes no yield/rewards/earnings endpoint. Confirmed exhaustively (2026-06): `/v0/yield`, `/v0/yields`, `/v0/rewards`, `/v0/maker-rewards`, `/v0/rebates`, `/v0/yield-rates`, `/v0/yield/history`, `/v0/collateral-yield`, `/v0/incentives`, `/v0/points`, `/v0/settlements` + per-wallet variants ALL return 404 (while `/v0/markets` + `/v0/orderbooks` return 200). No on-chain `claimYield`/`getYield` fn either; yield is described as protocol-push. *Result: the ONLY way to verify maker yield is to watch incoming USDso ERC-20 `Transfer` logs to one's wallet (token `0x00000022dA000002656c64D9eA6011ea952D008A`) across a full settlement epoch.* *Suggestion: ship the endpoint or remove the claim.* (Fees page is also marked Work-in-Progress with the yield rate as a literal `[TODO]`.)

10. **Contradiction: is collateral yield LIVE in v1.0 or not?** `welcome/roadmap` lists "Yield-bearing collateral (for traders)" under the **"Later"** stage (idle margin lends via the lending protocol), while `trading/common/yield-algorithm` describes the yield distribution as current behaviour with a precise formula. Empirically a tight two-sided maker netted ~breakeven over 40 min (no observable yield). *Please clarify whether maker collateral yield is active during this alpha; if not-yet-live, the yield-algorithm page should say so.*

### Metric / UX feedback
7. **Leaderboard `usdsoBalance` (→ PnL → effective volume) counts only LIQUID USDso** — excludes base-token inventory AND principal locked in resting orders. For a market-maker this makes the dashboard wildly misleading: it showed `usdsoBalance $1.97 / PnL −$148 / effVol $1.81` while the true mark-to-market portfolio was ~$146 (funds were in WETH + resting orders). *Suggestion: show mark-to-market total (or a locked/available breakdown) so makers aren't penalized/confused mid-cycle; clarify whether the Day-14 snapshot marks inventory to market or only counts liquid USDso.* **[Extended by B29 in Part III — the metric is not just understated but NON-DETERMINISTIC for an active bot.]**

### Product / roadmap feedback (market-maker economics in the Spot phase)
13. **[P1] Spot-only (no short) + zero observable maker incentive makes sustained two-sided market-making structurally unprofitable in down/trending regimes — which discourages exactly the liquidity the CLOB needs.** As a pure spot CLOB, a maker is always *long-or-flat* (you can only sell inventory you own; you cannot open a short). We validated this exhaustively with a backtester (`scripts/backtest-grid.ts`) over BTC and SOMI Binance klines, sweeping a two-sided cost-basis grid across spacing / margin / inventory-cap / fill-haircut (0.3–1.0) / an EMA trend-filter, at 1m–4h granularity:
    - **Volume is achievable in any regime**, but **terminal PnL is regime-determined**: positive in ranging/up markets (+$36–49 over a 666-day flat window, beating hold-50/50 by ~$48), **negative in sustained downtrends** (−$29 to −$49 per down-segment — the maker can only bag-hold or flatten to cash; it cannot profit from the drop without shorting).
    - A trend-filter only trims the downtrend bleed toward the do-nothing benchmark; it cannot make a long-only spot strategy positive when price falls.
    - With **zero fees, no maker rebate, and no observable yield** (see items 8–10 — the yield endpoint 404s and a tight two-sided maker netted ~breakeven over 40 min with no observable payout), the *only* economic outcome for a passive maker in the current Spot phase is **breakeven-at-best**. That is a weak incentive to provide liquidity.
    - **Constructive asks, tied to your own roadmap:**
      1. **Fee-rebate program ("Next" on the roadmap)** is the single highest-leverage lever to make passive market-making net-positive *during the Spot phase*. Please clarify whether **passive resting makers** earn the rebate, or only builder-code/flow-routing apps — if passive MM qualifies, it directly bootstraps book depth now, before Perpetuals.
      2. **Perpetuals ("Then")** would unlock genuinely two-sided directional MM (profit in both directions). A rough timeline would let market-makers plan capital commitment.
      3. In the interim, **document the maker incentive honestly** — if the expectation in v1.0 Spot is "makers run at breakeven for volume/points, real yield arrives with the rebate/perps phases," say so. Right now the docs imply a live yield that isn't observable, which sets the wrong expectation.

---
---

# PART III — Days 7–14 addendum (live-verified 2026-07-06 / 2026-07-08)

**Verification pass.** Re-checked the report's on-chain claims live on 2026-07-06 (chain 5031) — all still accurate:
- `getPoolParams` **WETH:USDso**: makerFee `0`, takerFee `0`, tickSize `0.01` (raw 1e16), minQuantity `0.001`, lotSize `0.0001`. **SOMI:USDso**: makerFee `0`, takerFee `0`, tickSize `0.0001` (raw 1e14), minQuantity `1.0`, lotSize `0.01`.
- `getMaxBuilderFeeBpsTimes1k` = `100000` (100 bps) on both pools → **builder codes still LIVE** (confirms B8 / item 11; docs since caught up: `builder-fees.md` fixed 2026-07-06, `functions.md` fixed by 2026-07-08 — now states live mainnet cap 100000; residual: `roadmap.md` still frames builder-codes under "Next").
- `OrderFilled` 6-uint w/ `fillPrice` (topic `0xc87f4223…`), `getWithdrawableBalance(account,token)` (vault), and no-arg `getOwnOpenOrders()` all behave as the report states.

### B29 (med) — leaderboard `usdsoBalance`/effVol is NON-DETERMINISTIC for an active bot, not just understated
Extends B21 / item 7. While a bot trades, capital fluxes **free ↔ locked-in-resting-orders ↔ pool vault every second**. Measured on our own wallet within minutes: liquid USDso read **$0.32 → $12 → $75** (rest was WETH + open bids + vault), so `usdsoBalance` — hence PnL and effVol — swings wildly depending on the exact snapshot instant. Two snapshots seconds apart give very different effVol. A single `balanceOf` fooled our own monitoring twice. *Fix (as B21): rank on mark-to-market TOTAL = free + locked-in-orders (`getOrder` over `getOwnOpenOrders`) + vault (`getWithdrawableBalance`), valued at mid — deterministic and fair to makers.*

### P2 (product) — passive market-making is breakeven-at-BEST even with a fair-value overlay (strengthens item 13)
We rigorously tested the one remaining "maker can profit" hypothesis: anchor quotes to the **Binance ETHUSDT true price** (not the DreamDEX mid) to harvest DreamDEX book dislocations. Result on **real execution prices**: edge ≈ **0** (Binance-anchored edge on our recorded maker fills = −0.11 bps, 95% CI includes 0 — statistically identical to the uninformed-mid maker's −0.10 bps adverse-selection bleed). Two reasons it collapses: (1) ~half the apparent "dislocation" is a Binance-1m-kline timing artifact, not tradeable; (2) the freeze regimes (below) where dislocation is largest have **~zero taker flow** to monetize. **Conclusion: with 0/0 fees, no maker rebate, and no observable yield, a passive maker on this venue is structurally breakeven-to-slightly-negative regardless of how it's tuned** — only co-located speed (we measured ~0.8 s tx-confirm, 350 ms RPC RTT — too slow vs whoever holds the book at ~2 bps) or a genuine directional edge (our OOS-validated 1h-ETH breakout, but ~0.6 trades/day) can profit. This is the empirical backing for item 13's ask to **ship the maker rebate** or **document the breakeven expectation honestly**.

### P3 (product / stability) — recurring liquidity FREEZE regime; the book is thin + bot-dependent
Observed multiple times over the final days: the **WETH:USDso book periodically loses its LP/maker bots** → touch spread blows from the normal **~2.0–2.1 bps to 48–214 bps for HOURS** (one spike hit 432 bps) → essentially all CLOB round-trip activity stalls (our fill rate collapsed ~13×, on-chain taker flow → ~0) → then revives when a maker returns. Touch depth is thin in normal regime too (~0.03–0.05 WETH ≈ $50–90/side). **Venue liquidity is fragile and depends on a handful of bots** — exactly what a maker-rebate would stabilize. *Suggestion: a passive-maker incentive would directly harden book depth; also worth documenting expected depth/spread so takers can size clips (thin touch = walking the book above ~0.05 WETH).*

### B30 (med) — gas (SOMI) is a material, poorly-surfaced cost at bot frequency; finite-allowance footgun
An active make-take bot burns **~1.5–3 SOMI/hr** (~$3.6–7/day at SOMI ≈ $0.10) — on a fixed-capital comp, gas (bought from USDso via SOMI:USDso) is a real drag on *effective* volume that the leaderboard doesn't reflect. Two footguns hit live: (1) the SOMI:USDso swap started reverting with a bare **"execution reverted (unknown custom error)"** once the wallet's USDso→SOMI-pool **ERC20 allowance silently depleted** (an earlier finite `approve` ran out) — cost time to diagnose; fix = `approve(MaxUint256)`. (2) `ethers-v6` default 4 s `pollingInterval` adds ~2 s dead time to every `tx.wait()` on a 0.1 s-block chain — set `pollingInterval=200` to cut confirm 2.65 s → ~0.8 s (doubles a latency-bound bot's throughput). *Suggestion: name the insufficient-allowance revert; note the sub-block pollingInterval win for high-frequency bots in the docs.*

### B31 (low) — spot no-leverage revert is generic
`placeOrder` with `quantity × price > free quote balance` (or base > held) reverts **"ERC20: transfer amount exceeds balance"** (the pool escrows the full notional at post; there is no margin/leverage on spot). Expected, but a named error (`InsufficientBalanceForOrder`) would beat the raw ERC20 string. (Same family as B22 — reverts ARE named elsewhere; this path isn't.)

### Trading-activity update (final evidence)
Volume grew from the report's Day-1 snapshot (`volumeUsdso ≈ 42,829`) to **945,661 raw USDso** via the single-process **alternating maker+taker** engine (`make-take.ts`): PostOnly maker window + IOC taker round-trips on one nonce stream, with a **drift-kill** (sell only what the paired buy filled → no accidental net-short) and **dynamic taker sizing** (size the buy to free USDso → never starves). On-chain audited (Blockscout USDso-transfer sum vs WETH pool) at ~$118k/day — matched the bot log, confirming genuine (non-wash) two-sided flow. Held #1 raw for most of the final week; a tight 3-way race in the closing days. Bleed measured **~1.18 bps of volume = ½ the book spread** (structural spread-crossing cost at 0 fees, drift eliminated) — the honest floor for a volume-generating taker here.

**FINAL LEADERBOARD (2026-07-08, `dreamdex-leaderboard-new.vercel.app`):** finished **#3 by raw volume — 945,661.04 USDso** (trader-5 1,093,447.73 · trader-2 1,086,201.94 · **us 945,661.04** · trader-1 923,141.92) with **127,570 txs — the highest tx count in the cohort** (1.35× the next, 94,424; matches our live on-chain nonce exactly). PnL −146.44 (capital fully converted into volume + stress-test coverage), effective volume 22,420.24 = #4 by the board's Eff-ranking (Eff = Raw × (1 + PnL%) — equivalently raw × usdsoBalance/150). Rewards/winner announcement pending from DevRel.
