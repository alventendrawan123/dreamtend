# DreamTend — DreamDEX Alpha Trading Competition Submission

**Submission by:** Alven Tendrawan
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Repository:** https://github.com/alventendrawan123/dreamtend
**Date:** 2026-06-01

---

## Section A — Bot Architecture

### A.1 Mission Statement

DreamTend is an autonomous trading agent built for the DreamDEX alpha competition. It combines four complementary mechanisms — a counterparty-agnostic IOC-taker engine, a bidirectional self-cross engine, multi-wallet fleet orchestration, and a scheduled Day-7 liquidator — all wired through a 5-step sim-before-broadcast safety net. The agent's goal is to **maximize on-chain volume per unit of starting capital**, keep PnL friction below 5% over the competition window, and ship the resulting codebase as a reusable open-source reference for future DreamDEX integrators.

### A.2 Operational Discipline: Dedicated Trading Wallet

DreamTend operates from a **purpose-created wallet** with zero transaction history prior to the competition kick-off — per the security guidance shared in the Alpha Testing Group:

> *"Please do NOT use your primary wallet. Make sure it's a zero tx wallet."*  — Anjali Singh, welcome message

This separation gives three concrete benefits:

1. **Blast-radius isolation.** A compromised private key affects only the $50 USDso + 10 SOMI competition funds. The user's primary trading wallet, holding unrelated assets, is untouched.
2. **Clean attribution.** Every transaction on `explorer.somnia.network` under this address is bot-driven and competition-related. Anyone auditing the bot's behaviour (DreamDEX team, future testers reading the public repo) gets a noise-free history.
3. **Repeatable bootstrap.** When DreamDEX runs the next testing wave, the same pattern — `git clone dreamtend && fund fresh wallet && set .env && pm2 start` — onboards a new tester in under 10 minutes.

The private key lives only in `.env`, which is gitignored and never logged. All on-chain interactions are signed locally via `ethers.Wallet`; no key material crosses the network.

### A.3 Strategy Engines

DreamTend ships two complementary volume engines that were designed based on direct on-chain analysis of DreamDEX pool dynamics:

#### A.3.1 IOC-Taker Engine (Primary)

After analyzing the trading characteristics of the four available pools (SOMI/USDso, USDC.e/USDso, WETH/USDso, WBTC/USDso), DreamTend identified that **WETH/USDso has consistent external liquidity at market prices** — placeable orders at market BIDs/ASKs fill reliably without the bot needing to bootstrap its own counterparty.

The IOC-taker engine (`scripts/ioc-loop.ts`) exploits this:

```
Cycle pattern:
  1. IOC BUY 0.001 WETH at limit $5,000  (high limit ensures fill at market $3,000)
  2. Wait 7 seconds
  3. IOC SELL 0.001 WETH at limit $1     (low limit ensures fill at market BID)
  4. Wait 7 seconds
  5. Repeat

Per round-trip:
  • Volume on chain: ~$6 (qty × 2 × market price)
  • PnL cost:        ~$0.04 (= 0.7% friction from off-market limits)
  • TX count:        2
```

Verified live across **~1,000 cycles** on WETH/USDso during competition hours. Early small-qty runs (qty=0.001-0.002 WETH) saw 100% fill rate; later large-qty runs (qty=0.005 WETH at qty escalation) saw 91% fill rate (200-cycle batch closed at 182/200 fills, total reported volume ~$2,048). The misses were short-window liquidity drops, not protocol-level rejections — `staticCall` correctly skipped those cycles so zero gas was wasted on reverts.

#### A.3.2 Bidirectional Self-Cross Engine (Secondary)

For pools without consistent external liquidity (SOMI/USDso), DreamTend uses a **self-cross** mechanism via two of its own wallets:

```
Cycle pattern (SOMI/USDso pool):
  1. Fleet wallet W3 places PostOnly maker BID at price below market
  2. Registered wallet sends IOC SELL with msg.value=qty native SOMI
  3. W3's maker BID gets filled by registered's taker SELL
  4. W3 vault gains base SOMI, loses quote USDso
  5. Registered wallet gains USDso, loses native SOMI
  6. Repeat in reverse for the other direction (auto-switch when capital exhausts on one side)
```

This pattern generates volume without requiring external counterparties, at the cost of moving capital between our own wallets — which is recovered at Day-7 by `scripts/sweep-fleet.ts`.

The two engines are **complementary, not redundant**: IOC-taker captures all available external liquidity (high volume per cycle, ~$3-6/tx) while self-cross provides guaranteed fill on quiet pools (small volume per cycle, ~$0.05-0.30/tx, but resilient to any market condition). DreamTend prioritized IOC during the competition because WETH/USDso external liquidity was consistent; the self-cross engine remains hot-swappable for pools or time-windows when external counterparties go quiet.

### A.4 Safety Net

Every order broadcast goes through `safePlaceOrder` (`src/dex/safe-broadcast.ts`), a 5-step pattern designed to prevent the silent-rejection footgun that catches first-time DreamDEX integrators:

1. **Pre-flight assertions** (`src/utils/gotchas.ts`)
   - `expireTimestampNs > now` (DreamDEX rejects 0)
   - `priceRaw > 0` (priceRaw=0 is literal, NOT "market price")
   - `builder == 0x0` and `builderFeeBpsTimes1k == 0` (disabled in v1.0)
2. **Static-call simulation** (`placeOrder.staticCall(...)`)
   - Catches custom-error reverts BEFORE burning gas
3. **Broadcast + receipt wait**
4. **Event verification** — confirms the `OrderPlaced` event topic appears in `receipt.logs`
   - Empirically verified topic: `0xd90f62f6...` (see Feedback Report 01)
5. **Receipt-based orderId extraction**
   - The sim-returned orderId can drift from the actual on-chain orderId when other orders are placed between sim and broadcast — receipt is the authoritative source.

This pattern caught a real bug during the competition: an early bot version lost track of orderIds because it trusted the sim-time orderId; the fix in `extractOrderIdFromReceipt` recovered tracking and prevented future orphan-order incidents.

### A.5 Multi-Wallet Fleet

Per Emre's group-chat guidance:

> *"You can create your wallets your AI agents wallet etc. We'll consider it general."* — Emre Yıldız, DevRel, 2026-05-25

DreamTend ships scripts to spawn N fresh wallets, fund them from the registered wallet, assign each a strategy role, and run them in parallel via separate orchestrator processes:

| Wallet | Role | Pool | Function |
|---|---|---|---|
| Registered (`0x8f0A24…`) | Master + IOC-taker | WETH/USDso | Main volume engine, also taker for self-cross |
| W0 | mm-usdce-tight | USDC.e/USDso | Tight-spread market maker |
| W1 | mm-usdce-mid | USDC.e/USDso | Medium-spread market maker |
| W2 | mm-somi | SOMI/USDso | Native-pair market maker |
| W3 | momentum-somi | SOMI/USDso | Volatility-triggered taker |
| W4 | reserve | — | Standby reserve + Day-7 liquidator host |

All fleet wallet keys live in `data/bot-wallets.json` (gitignored). Day-7 `scripts/sweep-fleet.ts` consolidates every fleet wallet's pool vault balances + ERC20 + native SOMI back to the registered wallet, so the leaderboard's `PnL = wallet_USDso - 50` formula captures the full portfolio.

### A.6 Somnia Agent Kit Registration

DreamTend is a **registered on-chain Somnia Agent** at agent ID **#45** on the Shannon testnet, registered via the official `somnia-agent-kit` SDK:

- **Registration TX:** `0xc2d7f3f14649a9d02f156fb4383036200dbe41554741858e1101ac8b46e2403e`
- **Explorer:** https://shannon-explorer.somnia.network/tx/0xc2d7f3f14649a9d02f156fb4383036200dbe41554741858e1101ac8b46e2403e
- **Agent registry contract:** `0xC9f3452090EEB519467DEa4a390976D38C008347`
- **Capabilities declared on chain:** `["trading", "market-making", "ioc-taker", "self-cross", "multi-wallet-fleet"]`

Anyone can query `getAgent(45)` on the registry contract to verify DreamTend's registration. This aligns with Somnia's "Agentic L1" thesis — bots are first-class participants, not just consumers.

### A.7 LLM Meta-Decision Layer

DreamTend integrates with Ollama (local LLM, default llama3.2) as a **modular, feature-flag-gated** strategy-level meta-decision layer:

```
src/llm/decision-engine.ts
  ↓
{market snapshot} + {bot metrics} → JSON {action, rationale, spreadBps?, switchPair?}
  ↓
Actions: continue | pause | widen_spread | tighten_spread | switch_pair | stop
```

Architecture choices favored shippability + resilience:

- **Transport-isolated client** (`src/llm/ollama-client.ts`): pure HTTP wrapper around `/api/tags` (health) and `/api/generate` (JSON-mode prompts). Configurable model, timeout, base URL via env vars.
- **Graceful degradation**: every LLM call wrapped in try/catch with conservative `"continue"` fallback. Bot never crashes due to Ollama downtime.
- **Cached health-check** (60s TTL): avoids spamming local API.
- **Demo-as-test** (`scripts/llm-demo.ts`): runs three scenarios (quiet market, active market, volatility spike) end-to-end. Works in fallback mode (Ollama not installed) by gracefully returning `"continue"` — useful as a CI sanity check.

**Wiring status**: the engine ships as a reusable module; it is **not** auto-wired into the IOC alternator's hot path (a deliberate Phase 6 decision — wiring the meta-layer requires more A/B observation to avoid letting the LLM override profitable patterns). The integration demonstrates the "AI-driven agent" narrative Anjali highlighted at kickoff, and the modular separation (transport / decision-layer / demo) is reusable as a template for any future Somnia agent.

### A.8 Day-7 Liquidator

Scheduled strategy that auto-fires at `DAY7_LIQUIDATE_AT` (default `2026-06-01T08:00:00Z` = T-2h before snapshot):

1. Cancel all resting orders across active pools
2. IOC-sell entire base inventory at best bid × (1 - slippageBps)
3. **Withdraw all vault balances back to wallet** (critical: leaderboard PnL formula doesn't see vault)

This is the safety net — even if every other strategy fails, this guarantees final wallet USDso captures the full portfolio value at snapshot.

---

## Section B — Code Snippets Highlights

To showcase, in order of demo value (full source: `https://github.com/alventendrawan123/dreamtend`):

### B.1 The Safe Broadcast Pattern (`src/dex/safe-broadcast.ts`)

The 5-step pattern that prevents the silent-rejection footgun (detail in A.4 above; condensed core below):

```typescript
// 1. Pre-flight gotcha assertions (expireNs, priceRaw, builder, qty-lot)
assertExpireNs(expireNs); assertPriceRawNonZero(priceRaw);
assertBuilderDisabled(ZERO, 0n); assertQtyMultipleOfLot(qty, lotRaw);

// 2. Simulate via staticCall — catches custom-error reverts before burning gas
const [simSuccess, simOrderId] = await contract.placeOrder.staticCall(...args);
if (!simSuccess) throw new Error("Sim fail — abort, save gas");

// 3. Broadcast + wait for receipt
const tx = await contract.placeOrder(...args);
const receipt = await tx.wait();

// 4. Event verification — confirm OrderPlaced topic in receipt.logs
assertOrderPlacedEvent(receipt, ORDER_PLACED_TOPIC);

// 5. Receipt-based orderId extraction (sim-time orderId can drift)
const realOrderId = extractOrderIdFromReceipt(receipt) ?? simOrderId;
```

### B.2 Gotcha Validator (`src/utils/gotchas.ts`)

Runtime assertion library encoding every documented and discovered DreamDEX pitfall:

```typescript
export function assertExpireNs(expireNs: bigint): void { ... }
export function assertPriceRawNonZero(priceRaw: bigint): void { ... }
export function assertBuilderDisabled(builder: string, fee: bigint): void { ... }
export function assertQtyMultipleOfLot(qty: bigint, lotRaw: bigint): void { ... }
export function assertOrderPlacedEvent(receipt, topic: string): void { ... }
```

### B.3 IOC Loop (`scripts/ioc-loop.ts`)

Counterparty-agnostic IOC alternator that powered the volume push to rank 1:

```typescript
// Approve USDso + base token once at startup
await usdsoErc.approve(pool, costPerCycle * 1000n);
await baseErc.approve(pool, qty * 1000n);

// Alternate BUY/SELL forever (or until MAX_CYCLES)
let nextSide: "buy" | "sell" = "buy";
for (let cycle = 1; cycle <= MAX_CYCLES; cycle++) {
  const args = [nextSide === "buy", 0n, priceForSide, qty, expireNs, IOC, 0, ZERO, 0n];
  const [ok] = await pool.placeTakerOrderWithoutVault.staticCall(...args);
  if (ok) {
    const tx = await pool.placeTakerOrderWithoutVault(...args);
    await tx.wait();
  }
  nextSide = nextSide === "buy" ? "sell" : "buy";
  await sleep(CYCLE_INTERVAL_MS);
}
```

### B.4 Capital Recycling (`scripts/buy-somi.ts` + `extract-w2-somi.ts`)

When the registered wallet's native SOMI ran low mid-competition (down to 0.027 SOMI after thousands of IOC cycles), two scripts together restored ~12 SOMI of gas budget **without external top-ups** — entirely from competition-allocated capital re-routed across asset types:

- `scripts/buy-somi.ts`: IOC-buy native SOMI from the registered wallet's USDso via the SOMI/USDso pool. Verified: gained 4.997 SOMI for $0.81 USDso (filled at market $0.162, well below the $0.30 limit thanks to external sellers). TX `0x97353994ff4678ddc7ccc75ab0dfe9c82806f4e47f94066b589cddd1efebc23e`.
- `scripts/extract-w2-somi.ts`: Withdraw idle SOMI parked in fleet wallet W2's SOMI/USDso vault back to the registered wallet (recovered 7 SOMI).

The two restored ~12 SOMI runway = ~24,000 additional transaction headroom, and the buy-back leg also generated incremental on-chain volume. **Operational note for the team:** this is not external top-up (rules forbid that) — it's a swap of competition-funded USDso for SOMI, both denominated within the same starting allocation, executed on-chain.

### B.5 Day-7 Liquidator (`src/strategies/day7-liquidator.ts`)

Scheduled cron-style strategy with three steps: cancel-all → IOC dump → withdraw-vault. The withdraw step is critical and was added after observing that the leaderboard `PnL = wallet_USDso - 50` formula doesn't see vault balances.

---

## Section C — Demo Evidence

> **Capture plan (Day 6 — 2026-05-31):** lihat checklist artefak di `SKILL.md` Section "Day-6 Demo Checklist" atau `plan.md` Day 6. Wajib: leaderboard progression (3-4 frame) + explorer wallet + sample TX detail. Nice-to-have: bot console log, architecture diagram export, Loom 2-3 menit, sweep before/after.

### C.1 Leaderboard Rank Progression (during competition)

| Time | Rank | TX | Volume | PnL (leaderboard view) |
|---|---|---|---|---|
| 2026-05-26 evening (Day 1 mid) | 5 | 13 | $2.50 | -$2.00 |
| 2026-05-27 14:30 (Day 2 mid) | 4 | 298 | $531.27 | -$19.34 |
| 2026-05-27 16:18 | 2 | 398 | $947.93 | -$19.40 |
| 2026-05-27 16:42 | 1 | 498 | $1,356.27 | -$19.44 |
| 2026-05-27 17:30 (Day 2 late) | 1 | 909+ | $3,031+ | -$24.59 |
| 2026-05-28 02:45 (Day 3 early) | 1 | 2,148 | ~$13,000 est | -$25.65 |
| 2026-06-01 snapshot (after Day-7 sweep) | TBD | TBD+ | TBD | projected ~-$3 to -$5 |

**Reading the PnL column.** The leaderboard's PnL formula is `wallet_USDso - 50`, which only sees the registered wallet's USDso balance — not vault deposits, not ERC20 inventory in other tokens, not capital parked in fleet sub-wallets. Mid-competition the displayed -$25.65 reflects ~$22 of capital intentionally **displaced** to support multi-wallet trading + IOC inventory cycling, not lost. True trading-friction PnL is ~-$3 to -$5; Day-7 `sweep-fleet.ts` + the Day-7 liquidator (A.8) consolidates everything back so the snapshot reflects the full portfolio.

### C.2 On-Chain Proof

- **Registered wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
- **Explorer URL:** https://explorer.somnia.network/address/0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86
- **First mainnet `placeOrder`** (proof of integration boot): `0x79d4b340ad448571a5b7ea461d33ebff81128c67e124700cff636bfd08157dcf`
- **Sample IOC-taker fill** (high-volume engine): `0x5e10e3c6b7096e75aa1be60b1a397881b6ef64d12ae3793336f1bd6073dcc293`
- **Sample buy-somi capital recycle TX** (USDso → native SOMI swap, no external top-up): `0x97353994ff4678ddc7ccc75ab0dfe9c82806f4e47f94066b589cddd1efebc23e`
- **Somnia Agent #45 registration TX (Shannon testnet):** `0xc2d7f3f14649a9d02f156fb4383036200dbe41554741858e1101ac8b46e2403e`
- **Total TX broadcast by registered wallet (as of 2026-05-28 02:45):** 2,148

### C.3 Repository Statistics

- 19 commits across 7 phase milestones, all on `main`, all CI-clean (TypeScript strict mode passes)
- 35 operational scripts in `scripts/` (covering: order placement, vault management, fleet ops, capital recycling, recovery, monitoring, registration, LLM demo, Day-7 liquidation)
- 100% TypeScript with strict mode enabled — no `any`, no implicit `any`, no unchecked indexed access
- All 12 discovered gotchas documented in `SKILL.md` §12 + encoded as runtime asserts in `src/utils/gotchas.ts`
- 19 polished feedback reports + 7 raw observations (`docs/feedback/OBSERVATIONS.md`)

---

## Section D — GitHub Repository

- **Public repo:** https://github.com/alventendrawan123/dreamtend
- **License:** MIT — fork it, learn from it, ship it
- **Documentation:**
  - `README.md` — architecture diagram, two-strategy explanation, quickstart commands, live numbers
  - `SKILL.md` — operational reference (20 sections from architecture mental model to decision log)
  - `docs/feedback/` — 19 polished feedback reports + 7 raw observations
  - `docs/SUBMISSION_DRAFT.md` — this document (will be lifted into the Google Doc on Day 7)
- **Quickstart** (from `README.md`):

  ```bash
  git clone https://github.com/alventendrawan123/dreamtend && cd dreamtend
  npm install
  cp .env.example .env  # paste private key + RPCs
  npm run typecheck
  NETWORK=mainnet npx tsx scripts/sanity-check.ts     # 8/8 ok
  NETWORK=mainnet npx tsx scripts/ioc-loop.ts WETH:USDso 0.001 5000 1 7000 200
  ```

---

## Section E — Feedback Reports

**19 polished feedback reports** covering critical doc gaps, ABI mismatches, on-chain UX issues, competition mechanics, incentive-mechanism gaps, and SDK/protocol design opportunities discovered through DreamTend's live operation + a verification audit of the live docs. Each report follows the canonical Type / Severity / Environment / Steps to Reproduce / Expected / Actual / Logs / Suggested Fix / Acceptance Criteria format. Severity matrix:

| Tier | Reports | Severity mix |
|---|---|---|
| Original (E.1-E.5) | 01-05 | 1 Critical, 3 High, 1 Medium |
| Polished from observations (E.6-E.7) | 06-07 | 1 High, 1 Medium |
| New from live learnings (E.8-E.10) | 08-10 | 3 High |
| Extended / new discoveries (E.11-E.13) | 11-13 | 3 Medium |
| Docs audit (E.14-E.19) | 14-19 | 1 High, 4 Medium, 1 Low |

> Reports 14-19 came from a verification audit of the current live docs: each candidate was re-checked against the docs before filing, and several earlier-suspected issues were confirmed **already fixed** by the team (SelfMatchingOption enum now documented, stop-order cost dynamic-warning present, builder-codes `BuilderCodesNotSupported` explained) — so they were deliberately NOT filed. Only verified-still-valid gaps are reported below.

### E.1 — `OrderPlaced` Event Signature Undocumented (Critical)
Source: `docs/feedback/01-event-topic-undocumented.md`
Bug: `OrderPlaced` event topic must be reverse-engineered from a real receipt. Documentation only describes the event by name, not its exact ABI. Caused silent-rejection footgun that lost the bot 1.5 USDso to orphan orders before recovery.

### E.2 — `getPoolParams()` Returns 7 Fields, Docs Say 8 (High)
Source: `docs/feedback/02-getpoolparams-field-count-mismatch.md`
Bug: The documented signature has 8 return fields including a leading `poolToken`; the deployed contract returns only 7. Causes `BAD_DATA` decode failure for every first-time integrator using ethers/viem/web3.js.

### E.3 — Pool `lotSize` in Docs Diverges from On-Chain Reality (High)
Source: `docs/feedback/03-pool-lotsize-docs-mismatch.md`
Bug: USDC.e/USDso pool docs say `lotSize=0.01`; on-chain returns `lotSize=1.0`. Custom-error revert (`0xcf479181`) fires when qty isn't a multiple of the actual on-chain lot.

### E.4 — Testnet USDso Onboarding Undocumented + Pool Empty (High)
Source: `docs/feedback/04-testnet-usdso-onboarding-gap.md`
Bug: No documented way to acquire testnet USDso. Testnet SOMI/USDso pool is chronically empty (10/10 polls returned empty over 2.5 minutes). Forces premature mainnet validation.

### E.5 — `getBookLevels` Reverts on Empty Book (Medium)
Source: `docs/feedback/05-getbooklevels-empty-revert.md`
Bug: `getBookLevels(isBid, depth)` reverts with bare `require(false)` on empty book instead of returning `([], [])`. Same pattern affects `getOwnOpenOrders`.

### E.6 — Testnet REST API `/v0` Path Hidden From Base URL (High)
Source: `docs/feedback/06-testnet-rest-v0-path-undocumented.md`
Bug: Docs list testnet base as `https://stg.api.dreamdex.io` (no `/v0`), but the actual API requires `/v0` on testnet just like mainnet. Asymmetric documentation pattern causes 15-30 min of "API is down" debugging per new tester.

### E.7 — `cancelOrder` Custom-Error Revert + No `isOrderFillable` View (Medium)
Source: `docs/feedback/07-cancelorder-no-isfillable-view.md`
Bug: Cancelling an already-filled order reverts with opaque selector `0xf5e39c1f`. No published ABI for the error, no pre-check view function (`isOrderFillable`). Forces every recovery flow to blanket-catch reverts.

### E.8 — Custom Error Registry Not Published (High)
Source: `docs/feedback/08-custom-error-registry-gap.md`
Bug: Every SpotPool revert that uses a custom error returns a bare 4-byte selector + args with no published ABI. Integrators cannot decode reverts programmatically; they fall back to brittle hex string matching. Touches selectors `0xf5e39c1f`, `0xcf479181`, and probably more.

### E.9 — Leaderboard PnL Formula Excludes Vault & Inventory (High)
Source: `docs/feedback/09-leaderboard-pnl-vault-blind.md`
Bug: The `wallet_USDso - 50` formula ignores vault deposits, inventory in other tokens (WETH, USDC.e, etc.), and capital parked in fleet sub-wallets. Penalizes market-making strategies (which hold inventory in vaults) vs pure-taker strategies. Day-7 manual liquidation is the only workaround.

### E.10 — `placeTakerOrderWithoutVault` Payable Semantics For Native-Base Pools (High)
Source: `docs/feedback/10-native-base-placeorder-payable-semantics.md`
Bug: SELL leg on the SOMI:USDso pool requires `msg.value === qtyRaw` (native SOMI is the base token), but docs treat all pools uniformly. First-time SOMI:USDso integrators lose 30-60 minutes diagnosing the silent payable requirement.

### E.11 — WebSocket Reconnect & Resume Protocol Undocumented (Medium)
Source: `docs/feedback/11-websocket-reconnect-protocol-undocumented.md`
Bug: No documented heartbeat, no seqNum, no resume cursor on `wss://api.dreamdex.io/v0/ws/public`. Bots that reconnect after a network blip have no way to know what was missed. Defeats the latency advantage of WS subscriptions.

### E.12 — Stop Order Mechanics & Registry Lifecycle Undocumented (Medium)
Source: `docs/feedback/12-stop-order-mechanics-undocumented.md`
Bug: Stop registry addresses are referenced in chat / contract specs but the ABI, trigger source, lifecycle, and fee structure are not documented. Bots cannot ship stop-loss without reverse-engineering. DreamTend chose to skip on-chain stops entirely as a result.

### E.13 — Multi-Wallet / AI-Agent Aggregation Policy Not in Docs (Medium)
Source: `docs/feedback/13-multi-wallet-aggregation-policy.md`
Bug: The "fleet wallets are allowed" policy lives only in the alpha group chat. New entrants joining mid-competition or future waves will not know multi-wallet is permitted unless they read the chat scrollback. Needs to be in public Competition Rules.

### E.14 — Yield Algorithm Parameters Undocumented (σ, Cadence, Eligibility) (High)
Source: `docs/feedback/14-yield-algorithm-params-undocumented.md`
Gap: The maker-yield page gives the Gaussian formula + 3 weighting factors but omits every quantitative input — σ value, settlement cadence, eligibility (PostOnly? min size? early-cancel penalty?). Integrators can't model APR or design market-making, pushing them to taker-only strategies.

### E.15 — `markPrice` EMA Window (`updateIntervalSec`) Undocumented (Medium)
Source: `docs/feedback/15-markprice-ema-window-undocumented.md`
Gap: Stop triggers fire off the EMA-smoothed `markPrice`, but the deployed `updateIntervalSec` / EMA window is unpublished (type bound only `>0..86400`). Traders can't predict stop-trigger latency or markPrice lag.

### E.16 — MCP Server Advertised But No Endpoint Published (Medium)
Source: `docs/feedback/16-mcp-server-url-not-published.md`
Gap: Docs promote a "native MCP server" for agent integration but publish no URL/endpoint. The advertised agentic feature is unusable.

### E.17 — `AGENTS.md` / `SKILL.md` Agent Contracts Return 404 (Medium)
Source: `docs/feedback/17-agents-skill-md-404.md`
Bug: Docs reference `AGENTS.md` and `SKILL.md` as auto-discoverable agent contracts; both URLs 404. Auto-discovering agents hit dead links. (Pairs with E.16 — the whole agentic surface is marketed but not wired up.)

### E.18 — Spot Trading Page Is a Stub (No Matching-Engine Walkthrough) (Medium)
Source: `docs/feedback/18-spot-page-stub-no-matching-engine.md`
Gap: The core Spot page is ~300-400 words and mentions the matching engine once in passing — no price-time-priority rules, order-flow lifecycle, or settlement walkthrough. No conceptual on-ramp for the most important concept of an order-book DEX.

### E.19 — CCXT Bindings: TypeScript-Only, Not Published to npm (Low)
Source: `docs/feedback/19-ccxt-bindings-ts-only-not-on-npm.md`
Gap: The CCXT integration installs only from a GitHub fork branch (not npm) and only generates JS/TS bindings — Python/Go/PHP/C# (the dominant CCXT cohort) are excluded. Disclosed in docs, so a roadmap/polish item.

**Plus 7 raw observations** (`docs/feedback/OBSERVATIONS.md`) — the working notebook the earlier reports were polished from.

---

## Section F — Operational Notes for the DreamDEX Team

Five operational learnings from running DreamTend at scale that might inform future SDK / docs work:

1. **Always read pool params on startup.** Hardcoding lot/tick/minQty from docs is dangerous (Feedback Report 03). DreamTend reads `getPoolParams()` at boot and uses on-chain values as source of truth. Consider shipping a docs-build-time check that flags drift between the spec page and actual chain state.

2. **Sim-before-broadcast is the only safe broadcast pattern.** Without it, custom-error reverts cost real gas. The pattern is simple (`staticCall(...args)` then check `success`), but every integrator must rediscover it — a one-paragraph docs section + a code snippet would save days of debugging.

3. **Event topic publishing is a wedge** (Feedback Report 01). A single docs page listing all event signatures + their `keccak256` topic hashes would prevent the silent-rejection footgun for every future integrator. Even better: an authoritative ABI JSON file at `https://docs.dreamdex.io/abi/SpotPool.json` that integrators can `wget` and trust.

4. **`getBookLevels` / `getOwnOpenOrders` reverts on empty book are a UX paper-cut** (Feedback Report 05). Returning `([], [])` instead of `require(false)` lets clients treat "empty" as a value rather than a failure mode. We had to wrap every level-read call in try/catch; an empty-tuple return would have eliminated that.

5. **The vault model needs a "PnL realized" view.** The on-leaderboard formula `wallet_USDso - 50` is simple and clear, but it surprises integrators who deposit to vaults expecting that to count. DreamTend's Day-7 liquidator + sweep-fleet exists exclusively to translate vault holdings back to wallet for the snapshot. A leaderboard view that included `vault_USDso` (or a separate "realized vs deposited" column) would let strategies that genuinely market-make on the book — and therefore hold inventory in vault — compete fairly with pure taker strategies that keep everything in wallet.

---

*Submitted in good faith. All code is MIT-licensed and free to use as official getting-started reference material, as encouraged by Anjali at the kick-off meeting.*
