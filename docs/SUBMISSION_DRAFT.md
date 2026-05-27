# DreamTend — DreamDEX Alpha Trading Competition Submission

**Submission by:** Alven Tendrawan
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Repository:** https://github.com/alventendrawan123/dreamtend
**Date:** 2026-06-01

---

## Section A — Bot Architecture

### A.1 Mission Statement

DreamTend is an autonomous multi-wallet trading agent built specifically for the DreamDEX alpha competition. It combines four complementary mechanisms — IOC-taker engine, bidirectional self-cross, multi-wallet fleet orchestration, and Day-7 liquidator — to maximize on-chain trading volume while maintaining a controlled PnL profile and reusable open-source code.

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

Verified at **100% fill rate across 800+ cycles** on the WETH/USDso pool. The pool's external order book provided counterparties for every single attempt during competition hours.

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

This engine is dormant in the current competition phase (WETH IOC is more efficient) but remains in the repo as a backup mechanism.

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

DreamTend integrates with Ollama (local LLM, default llama3.2) for strategy-level meta-decisions every ~15 minutes:

```
src/llm/decision-engine.ts
  ↓
{market snapshot} + {bot metrics} → JSON {action, rationale, spreadBps?, switchPair?}
  ↓
Actions: continue | pause | widen_spread | tighten_spread | switch_pair | stop
```

Health check + JSON-mode prompting + graceful fallback to "continue" when Ollama unavailable. Demo script (`scripts/llm-demo.ts`) runs three scenarios end-to-end.

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

The 3-step pattern that prevents the silent-rejection footgun:

```typescript
const [simSuccess, simOrderId] = await contract.placeOrder.staticCall(...args);
if (!simSuccess) throw new Error("Sim fail — abort, save gas");

const tx = await contract.placeOrder(...args);
const receipt = await tx.wait();

const realOrderId = extractOrderIdFromReceipt(receipt) ?? simOrderId;
// Use receipt-based orderId — sim-time orderId can drift if other orders
// were placed between sim and broadcast
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

When the registered wallet's native SOMI ran low mid-competition, two scripts together restored 12 SOMI of gas budget without external top-ups:

- `buy-somi.ts`: IOC-buy native SOMI from the registered wallet's USDso balance via the SOMI/USDso pool
- `extract-w2-somi.ts`: Withdraw idle SOMI parked in fleet wallet W2's pool vault back to the registered wallet
- Verified: gained 4.997 SOMI for $0.81 USDso (BUY at market $0.16, well below limit $0.30) + recovered 7 SOMI from W2 vault

### B.5 Day-7 Liquidator (`src/strategies/day7-liquidator.ts`)

Scheduled cron-style strategy with three steps: cancel-all → IOC dump → withdraw-vault. The withdraw step is critical and was added after observing that the leaderboard `PnL = wallet_USDso - 50` formula doesn't see vault balances.

---

## Section C — Demo Evidence

> **Capture plan (Day 6 — 2026-05-31):** lihat checklist artefak di `SKILL.md` Section "Day-6 Demo Checklist" atau `plan.md` Day 6. Wajib: leaderboard progression (3-4 frame) + explorer wallet + sample TX detail. Nice-to-have: bot console log, architecture diagram export, Loom 2-3 menit, sweep before/after.

### C.1 Leaderboard Rank Progression (during competition)

| Time | Rank | TX | Volume | PnL |
|---|---|---|---|---|
| 2026-05-26 evening (Day 1 mid) | 5 | 13 | $2.50 | -$2.00 |
| 2026-05-27 14:30 (Day 2 mid) | 4 | 298 | $531.27 | -$19.34 |
| 2026-05-27 16:18 | 2 | 398 | $947.93 | -$19.40 |
| 2026-05-27 16:42 | 1 | 498 | $1,356.27 | -$19.44 |
| 2026-05-27 17:30+ | 1 | 909+ | $3,031+ | -$24.59 |
| Day-7 snapshot (after sweep) | TBD | TBD | TBD | recovered to ~-$5 to -$8 |

### C.2 On-Chain Proof

- **Registered wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
- **Explorer URL:** https://explorer.somnia.network/address/0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86
- **Sample trade TX (first mainnet placeOrder):** `0x79d4b340ad448571a5b7ea461d33ebff81128c67e124700cff636bfd08157dcf`
- **Sample IOC-taker TX:** `0x5e10e3c6b7096e75aa1be60b1a397881b6ef64d12ae3793336f1bd6073dcc293`
- **Somnia Agent registration TX (testnet):** `0xc2d7f3f14649a9d02f156fb4383036200dbe41554741858e1101ac8b46e2403e`

### C.3 Repository Statistics

- 17+ commits across 7 phase milestones, all on `main`, all CI-clean
- 26 operational scripts in `scripts/`
- 100% TypeScript with strict mode enabled
- All gotchas documented in `SKILL.md` + encoded as runtime asserts

---

## Section D — GitHub Repository

**Public repo:** https://github.com/alventendrawan123/dreamtend
**License:** MIT — fork it, learn from it, ship it
**Documentation:** README.md (architecture + quickstart) + SKILL.md (operational reference)

---

## Section E — Feedback Reports

Five polished feedback reports covering critical doc gaps, ABI mismatches, and on-chain UX issues discovered through DreamTend's live operation:

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

**Additional 7 observations** captured in `docs/feedback/OBSERVATIONS.md` (raw log, ready to be promoted to formal reports if engineering wants the full set).

---

## Section F — Operational Notes for the DreamDEX Team

Three operational learnings from running DreamTend at scale that might inform future SDK design:

1. **Always read pool params on startup.** Hardcoding lot/tick/minQty from docs is dangerous. DreamTend now reads `getPoolParams()` at boot and uses on-chain values as source of truth. Consider shipping a docs-build-time check that flags drift between the spec page and actual chain state.

2. **Sim-before-broadcast is the only safe broadcast pattern.** Without it, custom-error reverts cost real gas. The pattern is simple (`staticCall(...args)` then check `success`), but every integrator must rediscover it.

3. **Event topic publishing is a wedge.** A single docs page listing all event signatures + their `keccak256` topic hashes would prevent the silent-rejection footgun for every future integrator. Even better: an authoritative ABI JSON file at `https://docs.dreamdex.io/abi/SpotPool.json`.

---

*Submitted in good faith. All code is MIT-licensed and free to use as official getting-started reference material, as encouraged by Anjali at the kick-off meeting.*
