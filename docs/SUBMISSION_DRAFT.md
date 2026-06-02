# DreamTend — DreamDEX Alpha Trading Competition Submission

**Submission by:** Alven Tendrawan
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Repository:** https://github.com/alventendrawan123/dreamtend
**Date:** 2026-06-02

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

DreamTend's competitive volume comes from a single **genuine** engine — the IOC-taker loop — designed from direct on-chain analysis of DreamDEX pool dynamics. (An early self-cross experiment was deliberately retired; see A.3.2 for why.)

#### A.3.1 IOC-Taker Engine (the engine — genuine, counterparty-diverse)

After analyzing the trading characteristics of the four available pools (SOMI/USDso, USDC.e/USDso, WETH/USDso, WBTC/USDso), DreamTend identified that **WETH/USDso has consistent external liquidity at market prices** — placeable orders at market BIDs/ASKs fill reliably without the bot needing to bootstrap its own counterparty.

The IOC-taker engine (`scripts/ioc-loop.ts`) exploits this:

```
Cycle pattern (production config — qty actively tuned over the comp):
  1. IOC BUY  <qty> WETH at limit <buyLimit> USDso  (e.g. 0.005 @ $2,400 —
                                                     well above market $2,020,
                                                     pool refunds the difference)
  2. Wait <cycleInterval>ms                          (3,000ms early competition,
                                                     1,500ms aggressive late-game)
  3. IOC SELL <qty> WETH at limit $1                 (extreme low ensures fill at
                                                     market BID; pool credits market price)
  4. Wait <cycleInterval>ms
  5. Repeat — or USDso hysteresis guard kicks in (force SELL-only when USDso
            drops below FLOOR, exit when USDso recovers above CEILING)

Per round-trip (representative — qty 0.005 @ market $2,020):
  • Volume on chain: ~$20 (qty × 2 × market)
  • PnL cost:        ~$0.04 (≈0.2% spread + slippage)
  • TX count:        2

Across the full competition (qty varied 0.001 → 0.011 → back down):
  • Total volume: ~$317k live observed (~$295k at end of Day 7 window)
  • Total fills:  ~31k (≈ 100% success during active pool windows;
                  60–100% across all windows including dead-pool sim-skips)
```

Verified live across **~31,000 cycles** on WETH/USDso over the full 7-day competition. The qty was actively tuned over time — starting at **0.001 WETH** for testing, escalating to **0.011 WETH** during Day-4/5 to maximize per-fill volume while pool liquidity supported it, then scaling **back down to 0.002-0.003** in the late game once spread cost slowly drained the registered wallet's USDso below the larger-qty escrow threshold. Multiple 1200-cycle batches recorded **100% fill rate** during active pool windows. The misses were short-window liquidity drops, not protocol-level rejections — `staticCall` correctly skipped those cycles so zero gas was wasted on reverts.

**Capital-bound qty scaling — a lesson learned the hard way.** The leaderboard's `PnL = wallet_USDso - 50` formula combined with the IOC engine's per-fill spread cost (~$0.001-0.05) means that even a clean genuine taker slowly drains USDso below the BUY escrow threshold (`qty × buy_limit`). Once USDso < escrow, the BUY pre-check fails on every cycle and the bot enters a sell-only state. We addressed this by **progressively lowering qty** (0.011 → 0.008 → 0.005 → 0.003 → 0.002 → 0.001) as USDso decayed, trading off per-fill volume for capital-sustainable cycling. The transition points are visible in the leaderboard rank progression in C.1.

#### A.3.2 Self-Cross Experiment (built early, deliberately retired)

Early in the competition we built a **self-cross** mechanism (`scripts/cross-loop.ts`): one fleet wallet posts a PostOnly maker order on the near-empty SOMI/USDso pool and the registered wallet IOC-takes it. It generates volume without an external counterparty.

We used it only **minimally (~$5–30 of volume)** and then **deliberately retired it.** The reason is a matter of integrity: self-crossing your own wallets is, in substance, **wash trading** — the transactions are real and on-chain, but there is no genuine counterparty, no price discovery, and no economic risk transfer. It inflates the volume KPI without representing real trading.

DreamTend chose to compete on **genuine, counterparty-diverse volume only** (the IOC-taker engine above, taking real third-party liquidity). We did not ramp self-cross to chase the leaderboard, even though it would have raised our rank, because:

1. It conflicts with the spirit of a trading competition (rewarding real liquidity/flow, not manufactured volume).
2. We instead surfaced it as **Feedback Report 20** — the volume metric is inflatable via cross-wallet self-dealing, since the on-chain `SelfMatchingOption` only guards single-wallet self-match. We recommend the leaderboard discount self-dealing volume (funding-graph linkage / counterparty-diversity weighting).

The `cross-loop.ts` script remains in the repo for transparency, but it is **not** part of our competitive strategy. Essentially all of our competition volume is genuine IOC flow.

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
| Registered (`0x8f0A24…`) | Master + IOC-taker | WETH/USDso | Main (genuine) volume engine |
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

### B.4 Capital Recycling (`scripts/buy-somi.ts`, `ioc-loop-somi.ts`, `extract-w2-somi.ts`)

When the registered wallet's native SOMI ran low mid-competition (the IOC engine consumes ≈ 0.0015 SOMI per fill × tens of thousands of fills), DreamTend recycled USDso → SOMI on the SOMI/USDso pool itself instead of waiting for sponsor top-ups. This is **not an external top-up** — it's a swap of competition-funded USDso for SOMI, both denominated within the same starting allocation, executed on-chain through the public pool with refunds + receipts like any other taker fill.

Operational history:

- **Day-3 initial recycle** — `scripts/buy-somi.ts` IOC-bought ~5 SOMI from USDso at market $0.16 (well below the $0.30 limit), gaining 4.997 SOMI for $0.81 USDso. TX `0x97353994ff4678ddc7ccc75ab0dfe9c82806f4e47f94066b589cddd1efebc23e`.
- **Day-6 / Day-7 / Day-8 mini-refuels** — `scripts/ioc-loop-somi.ts` (a SOMI-specific variant of the IOC engine that handles the native-base `msg.value === qtyRaw` payable requirement from Report 10) ran several single-cycle BUYs at qty 5 / qty 20 / qty 5 as the gas budget approached the bot's pre-flight cutoff (<0.5 SOMI). Total USDso spent on recycling across the competition: roughly $4–5 USDso, gaining ~30 SOMI cumulative.
- **Fleet-vault recovery** — `scripts/extract-w2-somi.ts` withdrew idle SOMI parked in fleet wallet W2's SOMI/USDso vault (a leftover position from the early self-cross experiment) back to the registered wallet — recovered ~7 SOMI.

The combined recycling restored multiple tens of SOMI of gas runway over the competition (= tens of thousands of additional IOC fills) without leaving the $50 USDso starting allocation. The buy-back legs also generated incremental on-chain volume that counts toward the volume KPI — the trades are real CLOB fills against external counterparty, not internal moves.

In parallel with the recycling, the DevRel team also sponsored 3 native-SOMI top-ups directly (logged in C.2 "Native SOMI (Gas) — Sponsored Top-Ups by DevRel"). Recycling provided continuous self-sufficiency; the DevRel sponsorship covered the larger gas surges. Either path on its own would have kept the bot running; both together kept it running comfortably.

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
| 2026-05-30 14:30 (Day 5 — pool first wakes, massive burst) | 2 | 9,945 | $120,066 | -$22.55 |
| **2026-05-31 00:09 (Day 6 — peak)** | **1 (genuine)** | 12,819 | $159,950 | -46.54 |
| 2026-05-31 00:25 (Day 6 — extending lead clean) | 1 | 12,943 | $162,646 | -46.84 |
| 2026-06-01 17:46 (Day 7 — overtaken on volume by a wash-style competing strategy) | 2 | 25,569 | $295,256 | -48.07 |
| 2026-06-01 late / 2026-06-02 (post-snapshot cleanup window) | 2 | 31,809 | ~$317,000 (live observed) | -$43.98 |

**Reading the PnL column.** The leaderboard's PnL formula is `wallet_USDso - 50`, which only sees the registered wallet's USDso balance — not vault deposits, not ERC20 inventory in other tokens, not capital parked in fleet sub-wallets (see Feedback Report 09). Mid-competition the displayed PnL oscillates dramatically based on the moment of snapshot (post-BUY = USDso drained transient ~-$45; post-SELL = recovered ~-$22). The volume + rank columns are the stable signal of actual performance.

**A note on the snapshot timing.** The official schedule says *"Day 7: Trading window closes. Final leaderboard snapshot taken."* Day 7 = 2026-06-01. The leaderboard was still in `Live` mode at the time this document was compiled (2026-06-02) — i.e., we could not confirm exactly when the team would freeze the snapshot. The numbers above are what the leaderboard showed live; if the team has already taken the official snapshot at end-of-Day-7, our credited volume is the **end-of-Day-7 figure** (closer to ~$295k–$300k), and the last row above represents only the post-window cleanup state (we manually swept WETH inventory back to USDso to lock the leaderboard PnL formula on Day 8 — a no-new-trades cleanup pass, not a competitive volume push). All bot activity from Day 8 onward was either (a) selling our outstanding WETH inventory back to the pool (Day-8 sweep tx `0xdb1ef29b…`), or (b) gathering this submission's artifacts.

**Key narrative moments**:
- **Day 6 (2026-05-31 00:09 WIB)**: DreamTend reached **rank #1 on the leaderboard with genuine, counterparty-diverse IOC volume** — the only top-5 trader without observable wash patterns at that point. Volume/TX ratio: $12.48 (genuine fills, ~3× more efficient than the next-ranked wash trader).
- **Day 7 (2026-06-01)**: Overtaken on volume by a competing strategy that exhibited classic self-cross signatures (paired GTC maker + IOC taker, ratio-perfect 1:1 fills, qty stable at 0.0128) — see Feedback Report 20 for the structural cause.
- **Final placement (live, at end of Day 7 window)**: rank #2 with $295k+ genuine on-chain IOC volume, sustained across 7 trading days through multiple bot resilience iterations.

### C.2 On-Chain Proof

- **Registered wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
- **Explorer URL:** https://explorer.somnia.network/address/0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86
- **First mainnet `placeOrder`** (proof of integration boot): `0x79d4b340ad448571a5b7ea461d33ebff81128c67e124700cff636bfd08157dcf`
- **Sample IOC-taker fill** (high-volume engine): `0x5e10e3c6b7096e75aa1be60b1a397881b6ef64d12ae3793336f1bd6073dcc293`
- **Sample buy-somi capital recycle TX** (USDso → native SOMI swap, no external top-up): `0x97353994ff4678ddc7ccc75ab0dfe9c82806f4e47f94066b589cddd1efebc23e`
- **Day-8 final WETH inventory sweep** (locks final PnL): `0xdb1ef29b33752b7938964f0f61e27808e275d4af03b8bca523ecf2d3a41649b5`
- **Somnia Agent #45 registration TX (Shannon testnet):** `0xc2d7f3f14649a9d02f156fb4383036200dbe41554741858e1101ac8b46e2403e`
- **Total TX broadcast by registered wallet (as of 2026-06-02):** **31,809**

### Rule 2 Compliance — The $50 Trading-Capital Cap Was Never Breached

Per the official competition rules:

> *"Equal starting capital. Everyone begins with $50. You cannot top up or transfer additional funds into your registered wallet."*

The starting $50 is denominated in **USDso** (the competition's trading-capital token). DreamTend never received any external USDso transfer beyond the original $50 allocation. Verifiable on-chain via `scripts/verify-usdso-inflows.ts`, which scans every USDso `Transfer` event into the registered wallet and labels each sender (internal pool, fleet, or external). Result: **zero external (non-pool, non-fleet) USDso inflows.**

The starting $50 USDso has only ever been used to:
- (a) trade on DreamDEX SpotPools (every fill emits its own `Transfer` events with the pool as counterparty — these are pool refunds + IOC settlements, not external top-ups), and
- (b) swap a portion to native SOMI on the SOMI:USDso pool to refuel gas (the bot's own outbound trade — captured in `scripts/buy-somi.ts` + tx `0x97353994...`).

### Native SOMI (Gas) — Sponsored Top-Ups by DevRel

`SOMI` is the **chain's native currency** for transaction fees on Somnia mainnet — separate from `USDso`, which is the trading capital denominated by the competition. The starting allocation explicitly includes both (10 SOMI gas + 50 USDso capital).

During the competition we requested gas top-ups from Emre (DevRel) when native SOMI ran low. Each request was approved and fulfilled directly by Emre's wallet — i.e., the sponsor-provided gas was authorized by the team running the competition itself. Three top-ups were received, totaling 25 SOMI:

| Date | Amount | Tx hash | Sender |
|---|---|---|---|
| 2026-05-29 16:40 UTC | 10 SOMI | `0x2391d928531e75f2aa7a082be6f4b876f124fd828bfe3e844e1c8c5342d660ea` | DevRel (`0x26D5c2bD…`) |
| 2026-05-31 08:54 UTC | 10 SOMI | `0x3fd72ea19cb4a32be7dbb0892f7d82bcae662db4652014324e3ab8dbaf73bc84` | DevRel (`0x26D5c2bD…`) |
| 2026-06-02 08:00 UTC | 5 SOMI | (incoming-tx list, same sender wallet) | DevRel (`0x26D5c2bD…`) |

All three were sourced from the same DevRel sponsor wallet `0x26D5c2bD940389859151f9e65C22Ef478d4cc203` (queryable via the explorer's "incoming transactions" filter on our registered wallet), and were used exclusively for gas — they never crossed into USDso or contributed to trading capital. The bot also recycled some USDso to SOMI internally (point (b) above) when DevRel top-ups weren't yet available; that recycling stays on-balance-sheet within the $50 starting allocation and is independently auditable.

**Net compliance statement:** the trading-capital line stayed at exactly the initial $50 USDso allocation throughout the competition. Native-SOMI gas was sponsored by DevRel within the explicit boundaries of the competition (gas is required by the chain, the team controls the sponsor wallet, and each top-up was an in-response-to-request transfer). If a stricter reading of Rule 2 is preferred, the bot's behavior would have been identical — the only adjustment would have been to stop trading earlier when our self-recycled SOMI ran out, which would have lowered our volume but kept every other claim above unchanged.

### C.3 Repository Statistics

- **27 commits** across 7 phase milestones + Day-5/6/7 resilience patches, all on `main`, all CI-clean (TypeScript strict mode passes)
- **35+ operational scripts** in `scripts/` (covering: order placement, vault management, fleet ops, capital recycling, recovery, monitoring, registration, LLM demo, Day-7 liquidation, ABI-dump utility, defensive bot variants)
- 100% TypeScript with strict mode enabled — no `any`, no implicit `any`, no unchecked indexed access
- All 12 discovered gotchas documented in `SKILL.md` §12 + encoded as runtime asserts in `src/utils/gotchas.ts`
- **22 polished feedback reports** + 7 raw observations (`docs/feedback/OBSERVATIONS.md`) — see Section E
- **Live ops resilience layer** added during Day-5/6 after a 5-hour zombie-cycle incident: `withTimeout` on every RPC call (sim/broadcast/tx.wait), 30s heartbeat log so a frozen loop is visible, slow-cycle warning, gas pre-flight abort. See commit `671ed1e`.

---

## Section D — GitHub Repository

- **Public repo:** https://github.com/alventendrawan123/dreamtend
- **License:** MIT — fork it, learn from it, ship it
- **Documentation:**
  - `README.md` — architecture diagram, two-strategy explanation, quickstart commands, live numbers
  - `SKILL.md` — operational reference (20 sections from architecture mental model to decision log)
  - `docs/feedback/` — 22 polished feedback reports + 7 raw observations
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

**22 polished feedback reports** covering critical doc gaps, ABI mismatches, on-chain UX issues, competition mechanics, incentive-mechanism gaps, metric-integrity concerns, and SDK/protocol design opportunities — discovered through DreamTend's live operation + a verification audit of the live docs. Each report follows the canonical Type / Severity / Environment / Steps to Reproduce / Expected / Actual / Logs / Suggested Fix / Acceptance Criteria format.

> 📎 **One-line index below; full verbatim text of all 22 reports is embedded in Appendix A at the end of this document.** The reports also live in the public repository at `docs/feedback/` (one `.md` file per report) for git-blame friendliness.

Severity matrix:

| Tier | Reports | Severity mix |
|---|---|---|
| Original (E.1-E.5) | 01-05 | 1 Critical, 3 High, 1 Medium |
| Polished from observations (E.6-E.7) | 06-07 | 1 High, 1 Medium |
| New from live learnings (E.8-E.10) | 08-10 | 3 High |
| Extended / new discoveries (E.11-E.13) | 11-13 | 3 Medium |
| Docs audit (E.14-E.19) | 14-19 | 1 High, 4 Medium, 1 Low |
| Competition-integrity (E.20-E.21) | 20-21 | 1 High, 1 Medium |
| Live ABI discovery (E.22) | 22 | 1 High |

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

### E.20 — Volume Metric Inflatable via Cross-Wallet Self-Dealing (High)
Source: `docs/feedback/20-volume-metric-gameable-wash-trading.md`
Concern: The on-chain `SelfMatchingOption` prevents single-wallet self-match, but cross-wallet self-dealing (operator's wallet A makes, wallet B takes) is undetected and counts fully toward the volume KPI. The headline metric is gameable; genuine flow isn't distinguished from manufactured volume. Constructive fix: discount self-dealing volume via on-chain funding-graph linkage / counterparty-diversity weighting. (Filed with our own `cross-loop.ts` as the illustrative example — non-accusatory.)

### E.21 — Mainnet Pools Have Extended Dead Periods, No Baseline Liquidity (Medium)
Source: `docs/feedback/21-mainnet-pools-no-baseline-liquidity.md`
Gap: All four mainnet pools observed empty (both sides) for multi-hour stretches, with no seeded baseline liquidity / market-maker-of-last-resort (confirmed in docs). Genuine takers stall during dead windows while self-dealers keep generating volume — structurally pushing competitors toward wash trading (compounds E.20). Fix: DevRel MM-of-last-resort + concrete yield params (E.14) to attract organic resting liquidity.

### E.22 — `OrderPlaced` Event: `owner` Not Indexed (Docs/ABI Diverges From Contract) (High)
Source: `docs/feedback/22-orderplaced-event-abi-mismatch.md`
Bug: Docs claim `event OrderPlaced(uint128 indexed orderId, address indexed owner, ...)` — two indexed topics. Deployed contract emits **only one** indexed topic (orderId at `topic[1]`); `owner` lives at `data` slot 2, non-indexed. Plus the `data` payload contains 8 slots vs the 5 non-indexed fields the docs document. Result: any integrator using the documented ABI for an `eth_getLogs` owner-filter (`topics: [sig, null, ownerTopic]`) receives **zero matches**, even for a wallet actively trading thousands of orders — silent zero-result, no decode error. Discovered on Day-5 while trying to enumerate a third-party wallet's order history via the documented filter; concrete tx evidence + reproducer (`scripts/dump-tx-topics.ts`) in repo. Same bug class as E.2 (`getPoolParams` field-count mismatch) — silent docs/contract drift that costs every integrator hours.

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

---

## Appendix A — Full Feedback Reports (Verbatim)

This appendix contains the verbatim text of all 22 polished feedback reports summarized in Section E. Each follows the canonical Type / Severity / Environment / Steps to Reproduce / Expected / Actual / Logs / Suggested Fix / Acceptance Criteria template.

These reports also live in the public repository at `docs/feedback/` (one .md file per report). The order below matches `docs/feedback/01-*.md` through `docs/feedback/22-*.md`.


---

### Feedback Report 01 — `OrderPlaced` Event Signature Undocumented

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-27
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

#### Type
**Smart Contract / Docs Gap**

#### Severity
**Critical** — Causes "silent rejection" pattern: orders succeed on chain but client code believes they failed, leading to unrecoverable orphan orders and locked vault balances.

#### Environment
- **Network:** Somnia mainnet
- **Chain ID:** 5031
- **RPC:** `https://api.infra.mainnet.somnia.network`
- **Framework:** ethers v6 (v6.16.0), TypeScript 5.7, Node 22.13
- **Pool:** USDC.e:USDso (`0x47fD2f18426f67106DBaC82F6d21D446c5F2120b`)
- **Docs referenced:** https://docs.dreamdex.io/ld25g222WKDrLlJMcR41/ → "Trading > Spot > Contracts" section

---

#### Steps to Reproduce

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

#### Expected Behavior

Either:
- (A) The docs/Contracts page publishes the **exact Solidity event signature** (struct field order + types) so the topic can be computed deterministically, OR
- (B) The docs publish the topic hash directly alongside the event description, with a copy-pasteable example.

Ideally **both** — plus a Hardhat/Foundry test or ethers snippet in the docs showing end-to-end "place order + verify event" decode.

#### Actual Behavior

The "Event Schema" reference (and matching section in SKILL.md notes shared in the alpha group) lists `OrderPlaced` with only the indexed `orderId` and a `placedOrder` "struct" parameter without expanding the struct's fields, types, or order. No topic hash is published.

The actual on-chain topic must be reverse-engineered by:
1. Broadcasting a real `placeOrder` tx
2. Fetching the receipt via `eth_getTransactionReceipt`
3. Reading `logs[0].topics[0]` and using that as the hard-coded constant

This works for those who know to do it, but it is **silently wrong** for first-time integrators. The DreamTend bot lost 1.5 USDso of vault liquidity to "phantom orders" before this was diagnosed — funds that had to be manually recovered by scanning blocks with `eth_getLogs` (filter by `topic[0]`) and calling `cancelOrder` against each discovered ID.

#### Logs / Evidence

##### On-chain proof
Two successful `placeOrder` transactions on Somnia mainnet:

| Tx hash | Block | Status | OrderId emitted |
|---|---|---|---|
| `0x79d4b340ad448571a5b7ea461d33ebff81128c67e124700cff636bfd08157dcf` | 317034820 | 1 (ok) | `0x080000000000185d2f` |
| `0x53a7018b7985157ea9dcc697592e6888f142f91744ad8303e864368c25c4d0e0` | 317035239 | 1 (ok) | `0x0a0000000000185d73` |

Both txs emitted 2 events at the pool address:
- `topics[0]=0xd90f62f6…` — actual OrderPlaced
- `topics[0]=0xcdd45acd…` — likely OrderRested (also undocumented)

##### Client-side incident log
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

##### Recovery
A manual recovery script (`scripts/recover-orders.ts` in the reference repo) had to be written:
1. `eth_getLogs` with `topics[0] = 0xd90f62f6…` over recent blocks
2. Extract `orderId` from `topics[1]`
3. Call `cancelOrder(orderId)` for each — partially worked (one had filled in the meantime, returning `OrderNotFound`)

#### Suggested Fix

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

#### Impact Summary

- **Real loss in this case:** ~$0 (recovered via manual script after ~15 minutes)
- **Time cost:** ~45 minutes diagnosing + 30 minutes building recovery tooling
- **Latent risk:** any integrator using the documented "verify event topic" pattern from a fresh ABI guess will believe their orders failed, retry them (doubling exposure), or write code that drifts apart from on-chain state silently. Risk grows with bot uptime.

#### Verification — Fix Acceptance Criteria

This report would be resolved when:
- [ ] The Contracts docs page lists every event's exact signature **and** its `keccak256` topic hash
- [ ] A working ethers/viem snippet demonstrates `receipt.logs.find(l => l.topics[0] === ORDER_PLACED_TOPIC)` decoding the `orderId` and remaining fields
- [ ] Optional: published `dreamdex-abi` npm package or equivalent for type-safe integration

---

*Reported in good faith as a contributor to the DreamDEX Alpha Testing programme. Bot source code, full incident logs, and recovery scripts are available in the public reference repository above.*


---

### Feedback Report 02 — `getPoolParams()` Returns 7 Fields, Docs Say 8

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-27
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

#### Type
**ABI / Docs Mismatch**

#### Severity
**High** — Any client following the documented signature will fail to decode the contract response with an opaque `BAD_DATA` error. The on-chain reality has been silently different from the docs since at least mainnet launch.

#### Environment
- **Network:** Somnia mainnet (chainId 5031) AND testnet (chainId 50312)
- **RPC:** `https://api.infra.mainnet.somnia.network`, `https://dream-rpc.somnia.network`
- **Framework:** ethers v6 (v6.16.0), TypeScript 5.7
- **Docs referenced:** https://docs.dreamdex.io/ld25g222WKDrLlJMcR41/ → "Developers > Contracts" section, `SpotPool` interface

---

#### Steps to Reproduce

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

#### Expected Behavior

Either:
- (A) The contract returns 8 fields matching the documented signature, OR
- (B) The docs reflect the actual 7-field signature

#### Actual Behavior

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

#### Logs / Evidence

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

#### Impact

- **Silent failure for every first-time integrator.** Anyone copying the docs ABI into ethers/viem/web3.js gets `BAD_DATA` on the very first call.
- **Lost developer time.** Diagnosing this requires either:
  - Reading the on-chain return length manually (32-byte alignment + counting)
  - Comparing with a known-good production tool's source
  - Trial-and-error with progressively reduced field counts
- **Loss of confidence.** A docs/contract mismatch on a core view function suggests other parts of the docs may also drift; integrators start distrusting all docs and reverse-engineer from chain instead.
- **Knock-on bugs from wrong field positions.** Some early DreamTend code used `result[5]` as `tickSize` (per the 8-field doc indexing) — which actually returned `lotSize` since `poolToken` is missing — leading to incorrect tick alignment in our market-maker.

#### Suggested Fix

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

#### Acceptance Criteria

This report would be resolved when:
- [ ] The Contracts docs page's `getPoolParams()` signature matches the on-chain return tuple exactly (whether 7 or 8 fields after a contract change)
- [ ] A published ABI artifact (JSON or Typechain) is the canonical source consumers can import directly
- [ ] At least one integration example in the docs (ethers v6 or viem) demonstrates `getPoolParams()` + decode end-to-end

---

*Reported in good faith as a contributor to the DreamDEX Alpha Testing programme. Bot source code referencing the corrected 7-field shape is in the public reference repository above (see `src/dex/abi/spotpool.ts` and `src/dex/contracts.ts: readPoolParams`).*


---

### Feedback Report 03 — Pool `lotSize` in Docs Differs From On-Chain Reality

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-27
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

#### Type
**Docs Inaccuracy / Smart Contract Param Drift**

#### Severity
**High** — Orders sized per documented `lotSize` get rejected by the contract with a custom error during the simulation step, wasting integration time and (without a sim-before-broadcast pattern) wasting gas.

#### Environment
- **Network:** Somnia mainnet (chainId 5031)
- **RPC:** `https://api.infra.mainnet.somnia.network`
- **Framework:** ethers v6 (v6.16.0), TypeScript 5.7
- **Docs referenced:** https://docs.dreamdex.io/ld25g222WKDrLlJMcR41/trading/readme-1/contract-specifications#testnet-somnia-shannon-chain-id-50312

---

#### Steps to Reproduce

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

#### Expected Behavior

Either:
- (A) Docs reflect the on-chain reality (`lotSize=1.0` for USDC.e:USDso), OR
- (B) Contract is redeployed to match the documented `0.01` lot.

#### Actual Behavior

The docs and on-chain return drift. Verified divergence on USDC.e:USDso (docs says 0.01, on-chain returns 1.0). Smaller pool-by-pool audit needed to determine which others are correct.

Known good (docs match chain): tickSize on all pools we checked.
Known mismatch: lotSize on USDC.e:USDso (potentially other pools too).

#### Logs / Evidence

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

#### Impact

- **Wasted onboarding time.** Any integrator reading the docs configures their bot with `lotSize=0.01` and gets confusing reverts on certain qty values.
- **Trust erosion.** When numerical config values in docs are wrong, integrators stop trusting other documented values too.
- **Hidden cost.** Without a sim-before-broadcast pattern (which we ship in DreamTend's `safePlaceOrder`), each failed broadcast burns ~200k gas in fees.

#### Suggested Fix

In order of preference:

1. **Authoritative table** under "Contract Specifications" generated from a per-deployment query at docs-build time. Avoids any drift by construction. Each pool table row would include a timestamp of "last on-chain verification" + the actual raw values used.

2. **Read pool params at runtime, treat docs as informational only.** Add a bold callout to the docs: "These values are illustrative. Always call `getPoolParams()` at bot startup; never hard-code lot/tick from these tables." DreamTend now does this — see Obs-005 in our `docs/feedback/OBSERVATIONS.md`.

3. **Custom error registry.** Whatever `0xcf479181` is (presumably `InvalidQuantity` or `InvalidLotMultiple`), publish the error ABI so revert messages decode to human-readable names.

#### Acceptance Criteria

This report would be resolved when:
- [ ] All pool lot/tick/minQty values in the docs match `getPoolParams()` output for the same pool on the same network
- [ ] A "last on-chain verification: YYYY-MM-DD" stamp on the pool spec table
- [ ] Or: docs explicitly tell integrators to always query on-chain and treat the table as illustrative

---

*See also feedback report 02 (getPoolParams field-count mismatch) — same root cause: docs and contract drift over time without coordinated updates.*


---

### Feedback Report 04 — Testnet USDso Onboarding Is Undocumented + Pool Empty

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-27
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

#### Type
**Docs Gap + Testnet Onboarding**

#### Severity
**High** — Blocks meaningful pre-mainnet validation. Forces integrators to debut their first real on-chain logic against mainnet, increasing the risk of early production loss.

#### Environment
- **Network:** Somnia testnet / Shannon (chainId 50312)
- **RPC:** `https://dream-rpc.somnia.network`
- **REST:** `https://stg.api.dreamdex.io/v0`
- **Affected pools:** all USDso-quoted pools on testnet (SOMI/USDso, WBTC/USDso, WETH/USDso)
- **Docs referenced:** Quick Start, Trading > Spot, Contract Specifications pages

---

#### Steps to Reproduce

1. Acquire testnet STT from the official faucet at `https://testnet.somnia.network/`.

2. Try to use that STT to trade on testnet SpotPools. Find that USDso-denominated pools only — there's no STT/STT pair.

3. Read the docs cover-to-cover looking for how to obtain testnet USDso:
   - **Quick Start:** No mention of USDso acquisition
   - **Trading > Overview:** Defines USDso as the quote currency but doesn't say how to get it on testnet
   - **Contract Specifications:** Lists the testnet USDso token address but no faucet
   - **Developers > HTTP API:** No `/faucet` or `/airdrop` endpoint exists

4. Ask in the alpha tester group chat. After ~12 hours of waiting, get this from Emre:
   > "You can swap STT … here's the pool contract address on testnet" — followed by a link to the same Contract Specifications page that started the search.

5. Open `getBookLevels` on testnet SOMI:USDso (`0x259fD6559214dd5aD3752322426eA9F9fABEFff4`). Returns `require(false)` for both sides — **book is empty**, no resting BIDs to take an STT→USDso swap against.

6. Set up a polling loop attempting `placeTakerOrderWithoutVault(isBid=false, ...)` every 15 seconds, retrying for the entire chronic-empty window. Verified empirically: 10 attempts in 2.5 minutes all return `success=false` from the sim. No bids appear.

#### Expected Behavior

- A dedicated testnet USDso faucet (e.g. `https://testnet.somnia.network/faucet/usdso`) or
- A public `mint()` on the testnet USDso token contract gated by per-address rate limit (standard testnet stable token pattern), or
- A DevRel-funded seeded liquidity bot on the testnet pools providing both BID and ASK at wide spreads 24/7, so the swap-via-pool path works in practice

#### Actual Behavior

USDso acquisition on testnet requires:
1. Possessing existing USDso, OR
2. Finding another tester with USDso willing to fill an ASK order, OR
3. Catching the rare/intermittent moment when external BIDs appear on the testnet pool

For the duration of our Day-1 testing (2026-05-26 23:00 UTC through 2026-05-27 02:00 UTC), the testnet SOMI:USDso book was empty in 10/10 sampled checks across 2.5 minutes. Effectively, **testnet trading was impossible for someone starting from zero USDso**, and no documented path exists for that starting state.

We pivoted to mainnet validation, where USDso is actually distributed by Somnia to participants on competition entry — but this forces integrators to debug their first real trades on the real-money pool.

#### Logs / Evidence

`scripts/swap-stt-to-usdso.ts` run on 2026-05-27 00:19–00:21 UTC, against testnet SOMI:USDso:

```
[00:19:14] Self-cross orchestrator starting
[00:19:15] WARN  No resting bids; retrying in 15s…   attempt 1/10
[00:19:30] WARN  No resting bids; retrying in 15s…   attempt 2/10
[00:19:46] WARN  No resting bids; retrying in 15s…   attempt 3/10
[00:20:02] WARN  No resting bids; retrying in 15s…   attempt 4/10
[00:20:18] WARN  No resting bids; retrying in 15s…   attempt 5/10
[00:20:34] WARN  No resting bids; retrying in 15s…   attempt 6/10
[00:20:49] WARN  No resting bids; retrying in 15s…   attempt 7/10
[00:21:05] WARN  No resting bids; retrying in 15s…   attempt 8/10
[00:21:21] WARN  No resting bids; retrying in 15s…   attempt 9/10
[00:21:37] WARN  No resting bids; retrying in 15s…   attempt 10/10
[00:21:52] FATAL Failed to swap after 10 attempts — book empty too long
```

The book was empty for the FULL 2.5-minute polling window.

#### Impact

- **Blocks pre-mainnet validation pattern.** Standard best practice is "test on testnet before mainnet" (called out in DreamTend's own `SKILL.md` operational procedures). Without USDso, the bot cannot actually `placeOrder` on testnet.
- **Forces mainnet-first debug.** First real on-chain validation happens on mainnet with real-money capital ($50 USDso). Any bug in this phase costs real money.
- **Onboarding time loss.** Every new alpha tester loses 1-3 hours discovering this issue. Across N testers, that's N hours of avoidable friction.
- **Skews validation surface.** Bug reports tend to come from mainnet-only because nobody can stress testnet, so testnet bugs go undiscovered.

#### Suggested Fix (any one is sufficient, multiple are better)

1. **Dedicated USDso testnet faucet endpoint** — minimum viable. Per-wallet daily limit (e.g. 100 USDso/day) prevents abuse. Could even be served from the existing REST API at e.g. `POST /v0/faucet/usdso { address }`.

2. **Public `mint()` on testnet USDso contract** (`0x9c32F3827A1a99f0cf9B213de8b53eC3d57bb171`) gated by per-address rate limit. Standard pattern from most L2 testnets.

3. **Seeded baseline liquidity** in testnet pools. A DevRel-funded wallet posting wide bids+asks 24/7 on every USDso pool. Each tester's first `placeTakerOrderWithoutVault(isBid=true)` then has something to fill against.

4. **Document the bootstrap path explicitly** as a numbered list in Quick Start:
   - "Acquire testnet USDso" page with copy-paste curl/ethers snippets
   - Warning that pool liquidity is intermittent
   - Recommended retry interval
   - Alternative: contact DevRel for manual airdrop

#### Acceptance Criteria

This report would be resolved when:
- [ ] A new tester, starting from a zero-balance wallet, can follow public docs to acquire testnet USDso in under 5 minutes
- [ ] The testnet SOMI:USDso book has resting orders ≥90% of the time when probed
- [ ] OR docs explicitly say "testnet trading requires manual DevRel bootstrap" so testers don't waste time

---

*A working alternative would help even if none of the above is implemented quickly: a one-page "Testnet Quickstart for AI agent integrators" with the bootstrap caveats called out, so that new testers know to pivot to mainnet-with-low-notional rather than chase testnet ghosts.*


---

### Feedback Report 05 — `getBookLevels` Reverts on Empty Book Instead of Returning Empty Arrays

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-27
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

#### Type
**Smart Contract UX**

#### Severity
**Medium** — Not a correctness bug per se, but a DX cliff that hits every reactive bot. Forces all callers to wrap the view function in try/catch and assume "any revert = empty book", which is brittle.

#### Environment
- **Network:** Somnia mainnet (chainId 5031) AND testnet (chainId 50312)
- **RPC:** `https://api.infra.mainnet.somnia.network`, `https://dream-rpc.somnia.network`
- **Framework:** ethers v6 (v6.16.0)
- **Affected contract function:** `SpotPool.getBookLevels(bool isBid, uint8 depth)`
- **Also affects:** `getOwnOpenOrders(address)` exhibits the same pattern

---

#### Steps to Reproduce

1. Identify a SpotPool with no resting orders on one side (e.g. testnet SOMI:USDso `0x259fD6559214dd5aD3752322426eA9F9fABEFff4` during off-hours; we observed the book empty for an entire 11-hour overnight window).

2. Call `getBookLevels(true, 5)` to fetch the top 5 BID levels:
   ```typescript
   const c = new ethers.Contract(POOL, [
     "function getBookLevels(bool isBid, uint8 depth) view returns (uint256[] prices, uint256[] sizes)"
   ], provider);
   const [prices, sizes] = await c.getBookLevels(true, 5);
   ```

3. Instead of `([], [])`, the call reverts:
   ```
   CALL_EXCEPTION  (action="call", data="0x", reason="require(false)")
   ```

4. ethers throws because the static call returned `0x` with no revert reason data.

#### Expected Behavior

Either:
- (A) Return `([], [])` when the book side is empty — the most natural and informative behavior, OR
- (B) Return a partial fill — if `depth=5` and only 1 level exists, return that 1, OR
- (C) Revert with a named custom error like `error EmptyBook()` so callers can decode and branch deterministically

#### Actual Behavior

A bare `require(false)` revert with no decodable selector. Every caller must:
1. Wrap in try/catch
2. Match on the message string `"require(false)"` (brittle across ethers versions and RPC providers)
3. Assume any revert from this view function means "empty book" (which may not be true — could also be invalid args, contract paused, etc.)

#### Logs / Evidence

Run of `scripts/probe-pool.ts WETH:USDso` on 2026-05-27 06:36 UTC:

```
[14:36:48.058] WARN  Book empty/revert
  side: "BID"
  err: "execution reverted (no data present; likely require(false) occurred
        (action=\"call\", data=\"0x\", reason=\"require(false)\",
         transaction={
           \"data\": \"0x8be6b9d300000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000005\",
           \"to\": \"0xa936da11B57b50A344e1293AAaE5232885ea2bDE\"
         },
         invocation=null, revert=null, code=CALL_EXCEPTION, version=6.16.0)"

[14:36:48.425] WARN  Book empty/revert
  side: "ASK"
  err: "execution reverted ... \"data\": \"0x8be6b9d30000…000000000000\" …"
```

`0x8be6b9d3` is the `getBookLevels(bool,uint8)` selector. The args after it are isBid=1 (true), depth=5 — perfectly valid input. Yet the call reverts.

#### Impact

- **Every reactive bot must wrap in try/catch.** Without the wrap, a transient empty-book moment crashes the bot.
- **Pre-trade safety checks (recommended in SKILL.md §12 #10) become brittle.** "Always check `getBookLevels` first before placing taker orders" is the suggested pattern, but when the check ITSELF reverts, the check is harder to write than the thing it's protecting.
- **Distinguishing genuine errors from empty-book becomes impossible.** If `getBookLevels` reverts because the contract was paused or our address blacklisted, callers can't tell that apart from "book is empty" because both look like `require(false)`.
- **Same applies to `getOwnOpenOrders(address)`.** During incident recovery on 2026-05-27, this revert pattern blocked us from listing our orphan orders — we had to scan `eth_getLogs` for `OrderPlaced` events to recover orderIds.

#### Suggested Fix

In order of preference:

1. **Return empty arrays for empty book.** Simplest and most predictable. Solidity supports `uint256[] memory empty;` returns; this is the cleanest fix.
   ```solidity
   function getBookLevels(bool isBid, uint8 depth) external view returns (uint256[] memory prices, uint256[] memory sizes) {
       // Existing logic but instead of require(false), just return what's there
       // (possibly fewer than `depth` levels)
   }
   ```

2. **Named custom error.** If reverting must remain for some reason:
   ```solidity
   error EmptyBook(bool isBid);
   // ...
   if (bookSide.length == 0) revert EmptyBook(isBid);
   ```
   Document the selector in the Contracts docs page so integrators can decode it.

3. **Apply the same fix to `getOwnOpenOrders(address)`.** Same revert pattern when the address has no open orders; same fix should be applied there.

#### Acceptance Criteria

- [ ] `getBookLevels(true, N)` on an empty book returns `([], [])` instead of reverting
- [ ] `getOwnOpenOrders(addr)` for an address with no orders returns `[]` instead of reverting
- [ ] If reverts are kept, both errors are named (e.g. `EmptyBook()`, `NoOpenOrders()`) and their selectors are listed in the docs
- [ ] At least one example in the docs shows the correct "check book before taker order" pattern using the updated semantics

---

*DreamTend's `readBookLevels` wrapper in `src/dex/contracts.ts` catches the revert and treats it as empty book — this is the workaround pattern integrators are currently forced into.*


---

### Feedback Report 06 — Testnet REST API Base URL Inconsistency (`/v0` Path Hidden)

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-28
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

#### Type
**Docs Gap / REST API Onboarding**

#### Severity
**High** — Every first-time testnet integrator hits 404 on every endpoint and assumes the API is down. The fix is a one-line docs change, but the cost-of-not-fixing is paid per-new-tester forever.

#### Environment
- **Network:** Somnia testnet / Shannon (chainId 50312)
- **Documented testnet REST base:** `https://stg.api.dreamdex.io`
- **Actual working base:** `https://stg.api.dreamdex.io/v0`
- **Mainnet (for contrast):** `https://api.dreamdex.io/v0` — docs DO include `/v0` here
- **Tools used:** `curl`, `node-fetch`
- **Docs referenced:** Quick Start, Developers > HTTP API section

---

#### Steps to Reproduce

1. Read the docs Quick Start. The testnet section lists the base URL as `https://stg.api.dreamdex.io` (note: no `/v0`).

2. Try a standard endpoint per the docs path conventions:
   ```bash
   curl -s "https://stg.api.dreamdex.io/markets"
   ```

3. Observe HTTP 404:
   ```
   404 page not found
   ```

4. Compare with mainnet — the same `/markets` path works because `/v0` is part of the mainnet base URL in docs:
   ```bash
   curl -s "https://api.dreamdex.io/v0/markets"
   # → 200 OK with markets list
   ```

5. Try the prefixed version on testnet:
   ```bash
   curl -s "https://stg.api.dreamdex.io/v0/markets"
   # → 200 OK with markets list
   ```

6. The `/v0` path component is **required** on testnet too, but it's omitted from the documented base URL — inconsistent with the mainnet documentation.

#### Expected Behavior

Either:
- (A) Update testnet docs base URL to `https://stg.api.dreamdex.io/v0` (matching mainnet's documented style), OR
- (B) Clarify in docs that `/v0` is part of the **path**, not the **base URL**, on both networks — so neither needs the prefix in the base.

#### Actual Behavior

The docs document mainnet base as `https://api.dreamdex.io/v0` (with `/v0`) and testnet base as `https://stg.api.dreamdex.io` (without `/v0`). The actual API behavior is identical: both require `/v0` somewhere in the URL. This asymmetric documentation pattern causes first-time integrators to spend 15-30 minutes debugging "API down" before realizing they need to add `/v0` to the testnet URL too.

#### Logs / Evidence

```bash
# 2026-05-26 23:14:02 UTC — DreamTend bot's first testnet REST call
$ curl -s -w "%{http_code}\n" "https://stg.api.dreamdex.io/markets"
404 page not found
404

$ curl -s -w "%{http_code}\n" "https://stg.api.dreamdex.io/orderbooks/SOMI:USDso"
404 page not found
404

# After adding /v0
$ curl -s -w "%{http_code}\n" "https://stg.api.dreamdex.io/v0/markets" | head -5
[{"id":"SOMI:USDso","status":"ACTIVE",...
200
```

#### Impact

- **Per-new-tester time loss:** ~15-30 minutes debugging "API down" / "endpoint not found" before realizing the `/v0` is missing.
- **Pattern of distrust:** When the very first documented endpoint returns 404, integrators start to lose confidence in other documented values too.
- **Skipping testnet:** Some testers may give up on testnet REST entirely and pivot directly to mainnet REST or contract calls — bypassing the safer testnet validation phase.

#### Suggested Fix

Pick one:

1. **Update testnet base URL in docs** (one-line change):
   - Current: `Base URL: https://stg.api.dreamdex.io`
   - Fixed: `Base URL: https://stg.api.dreamdex.io/v0`

2. **Move `/v0` out of base URL on both networks** (consistency play):
   - Mainnet base: `https://api.dreamdex.io` + path `/v0/markets`
   - Testnet base: `https://stg.api.dreamdex.io` + path `/v0/markets`
   - Add a "Versioning" callout: "All current endpoints are under `/v0`. Future major versions will be `/v1`, etc."

3. **Add a "Common 404 cause" note** to the Quick Start: "If you get 404, check that `/v0` is in your URL — it's required on both networks."

Option 1 is the smallest delta and least disruptive to existing mainnet integrators.

#### Acceptance Criteria

This report would be resolved when:
- [ ] Testnet and mainnet REST base URLs in docs follow the same pattern (both with `/v0` or both without).
- [ ] A copy-pasteable `curl` example for testnet markets endpoint exists in the docs and returns 200.
- [ ] A new tester, starting from zero knowledge, can hit their first testnet endpoint successfully on the first attempt.

---

*Reported in good faith as a contributor to the DreamDEX Alpha Testing programme. Original raw note: `docs/feedback/OBSERVATIONS.md` Obs-002.*


---

### Feedback Report 07 — `cancelOrder` Custom-Error Revert + Missing `isOrderFillable` View

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-28
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

#### Type
**Smart Contract DX / Custom Error Surface**

#### Severity
**Medium** — Recovery-flow papercut. Hits any bot trying to cancel orders that may have been filled in the meantime. Opaque revert selector + no introspection view forces trial-and-error.

#### Environment
- **Network:** Somnia mainnet (chainId 5031)
- **RPC:** `https://api.infra.mainnet.somnia.network`
- **Affected pools:** all SpotPool contracts (verified on USDC.e:USDso)
- **Framework:** ethers v6 (v6.16.0)
- **Affected functions:** `cancelOrder(uint128 orderId)`

---

#### Steps to Reproduce

1. Place two orders on the same pool. Capture the emitted `orderId` from each receipt.
2. Wait long enough for the order book to potentially fill one of them (e.g., 60-300 seconds during active hours).
3. Attempt to cancel both via `cancelOrder(orderId)` without first checking whether each is still active:
   ```typescript
   await pool.cancelOrder(orderId1);  // may or may not still be active
   await pool.cancelOrder(orderId2);
   ```
4. If one order was already filled before the cancel attempt, observe a revert with custom selector:
   ```
   revert data: 0xf5e39c1f...
   ```
   No human-readable error name. No exported ABI for the selector.
5. The other order (still resting) cancels successfully, refunding its locked vault balance.

#### Expected Behavior

Either:
- (A) `cancelOrder(filledOrderId)` returns a no-op or boolean `false` instead of reverting (idempotent semantics), OR
- (B) The revert is a named custom error documented in the Contracts page with its ABI, e.g.:
  ```solidity
  error OrderNotFound(address pool, uint256 orderId);
  // selector: 0xf5e39c1f
  ```
  So callers can decode the revert programmatically and branch on it.
- (C) A new view function `isOrderFillable(uint128 orderId) view returns (bool exists, bool filled, uint256 remaining)` so callers can pre-check before cancel.

#### Actual Behavior

The pool contract reverts with raw custom-error selector `0xf5e39c1f` followed by 2 uint256 args. The selector is not published in the Contracts docs or the SDK ABI file. Integrators must:

1. Wrap every `cancelOrder` in try/catch.
2. Match on the hex selector string (brittle across ethers versions).
3. Assume any revert means "order already filled" — but it could also be "order belongs to different wallet", "contract paused", "selector matches a different error entirely".

There is also no pre-check view function, so bots cannot determine whether a given orderId is still cancelable without attempting the cancel.

#### Logs / Evidence

DreamTend bot incident, 2026-05-27, mainnet USDC.e:USDso (`0x47fD2f18426f67106DBaC82F6d21D446c5F2120b`):

```
[01:14:08] INFO   Cancel attempt 1/2
                  orderId: 0x080000000000185d2f
                  txReceipt:
                    status:   0  (REVERTED)
                    gasUsed:  ~52000
                    revertData: 0xf5e39c1f...
                    decoded:  (unknown custom error)

[01:14:12] INFO   Cancel attempt 2/2
                  orderId: 0x0a0000000000185d73
                  txReceipt:
                    status:   1  (OK)
                    refunded: 1.5 USDso to vault
```

Hypothesis: the first orderId was fully filled by an external taker between our placeOrder and our cancelOrder attempts. Once filled, cancel is impossible because the order no longer exists in the active set. The contract reverts with this case-specific custom error — operationally normal behavior, but the lack of decoding ABI means the bot can't distinguish "already filled" from "permission denied" or "contract paused".

Recovery script (`scripts/recover-orders.ts` in our reference repo) currently:
1. Scans recent `OrderPlaced` events to find our orphan orderIds
2. Attempts `cancelOrder` on each
3. Catches revert as "already filled, no action needed"
4. Logs both success and revert cases for human review

This brittle pattern would be eliminated by either of the suggested fixes below.

#### Impact

- **Recovery-flow brittleness:** Every recovery script must blanket-catch reverts. If the contract starts using selector `0xf5e39c1f` for a different error in a future version, recovery silently breaks.
- **Lost diagnostic signal:** When a real "permission denied" or "pool paused" error occurs, it's indistinguishable from the common "already filled" case.
- **Wasted gas:** Each cancel attempt against a filled order burns ~52k gas. A bot trying to clean up 20 orphan IDs after a crash spends ~$0.50 in gas on guaranteed reverts.
- **No pre-check primitive:** A `isOrderFillable` view would let cancel logic branch deterministically, saving gas and giving operators a clear picture of order state.

#### Suggested Fix

In order of preference:

1. **Add `isOrderFillable(uint128 orderId)` view function:**
   ```solidity
   function isOrderFillable(uint128 orderId) external view returns (
     bool exists,
     bool filled,
     uint256 remainingQuantity,
     address owner
   );
   ```
   Bots use this before cancel to skip non-cancelable orders. Zero gas, zero ambiguity.

2. **Publish the custom error registry.** Add a "Custom Errors" section to the Contracts docs page listing every error name + selector + args:
   ```
   error OrderNotFound(address pool, uint256 orderId);
     selector: 0xf5e39c1f
   error NotOrderOwner(address caller, address owner);
     selector: 0xXXXXXXXX
   error PoolPaused();
     selector: 0xXXXXXXXX
   ```
   See also Feedback Report 08 (custom error registry — combined treatment).

3. **Make `cancelOrder` idempotent.** For a filled orderId, return without reverting (and emit a `CancelNoOp(orderId)` event for observability). This is the simplest UX win but is a contract-side change that requires coordinated rollout.

#### Acceptance Criteria

This report would be resolved when:
- [ ] An `isOrderFillable` view exists OR `cancelOrder` is idempotent on filled orders.
- [ ] The custom error `0xf5e39c1f` (and any sibling errors) is published in the docs with ABI + decoded args.
- [ ] An ethers/viem code example in the docs shows the recommended cancel pattern (pre-check → cancel → handle revert).

---

*Reported in good faith as a contributor to the DreamDEX Alpha Testing programme. Original raw note: `docs/feedback/OBSERVATIONS.md` Obs-007. See also `scripts/recover-orders.ts` in the reference repo for the current workaround.*


---

### Feedback Report 08 — Custom Error Registry Not Published

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-28
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

#### Type
**Smart Contract DX / ABI Publishing**

#### Severity
**High** — Every revert from a SpotPool contract that doesn't use a string reason returns an opaque 4-byte selector + args. Without a published error registry, integrators cannot decode reverts programmatically; they fall back to substring-matching on raw hex which is brittle and impossible to maintain across contract upgrades.

#### Environment
- **Network:** Somnia mainnet (chainId 5031) + testnet (chainId 50312)
- **Affected contracts:** all SpotPool deployments
- **Framework:** ethers v6 (v6.16.0), viem, web3.js — any client expecting ABI-decoded errors
- **Docs referenced:** Contracts page — has no "Errors" section

---

#### Steps to Reproduce

1. Trigger any revert from a SpotPool contract via a deliberately malformed call. Easy reproductions:

   **A. `cancelOrder` on a filled order** (selector `0xf5e39c1f`):
   ```typescript
   await pool.cancelOrder(alreadyFilledOrderId);
   // → revert with selector 0xf5e39c1f + 2 uint256 args
   ```

   **B. `placeOrder` with qty not multiple of `lotSize`** (selector `0xcf479181`):
   ```typescript
   await pool.placeOrder({ quantity: 1.05e6, ... });  // lot is 1.0 USDC.e
   // → revert with selector 0xcf479181 + 2 uint256 args
   ```

   **C. `getBookLevels` on empty book** (no selector, bare `require(false)`):
   ```typescript
   await pool.getBookLevels(true, 5);  // empty BID side
   // → revert with data="0x" — entirely opaque
   ```

2. Inspect the revert data:
   ```
   $ ethers.parseTransaction(receipt.data)
   // No decoder available — selector is not in any published ABI
   ```

3. Search the Contracts docs page for "Errors", "Custom Error", or the specific selectors. **No matches.**

4. Conclude: the only way to identify what each selector means is to (a) cause it deliberately under varied conditions and pattern-match the trigger, or (b) ask the team in chat.

#### Expected Behavior

A "Custom Errors" section in the Contracts docs (or an authoritative ABI JSON file) listing every revert error from each contract, with:

- **Error name** (Solidity declaration)
- **4-byte selector** (`keccak256(signature)[:4]`)
- **Args** with types and meanings
- **Common triggers** so integrators know which scenarios produce which error

Example:
```
SpotPool Custom Errors:

error OrderNotFound(address pool, uint256 orderId);
  selector: 0xf5e39c1f
  triggers: cancelOrder on a filled or non-existent orderId

error InvalidQuantity(uint256 provided, uint256 lotSize);
  selector: 0xcf479181
  triggers: placeOrder qty not a multiple of pool's lotSize

error EmptyBook(bool isBid);
  selector: 0xXXXXXXXX
  triggers: getBookLevels on an empty side  (currently uses bare require(false))
```

#### Actual Behavior

The Contracts page has no Errors section. The ABI export (if any exists) does not include error definitions. Integrators see bare selectors in receipts and must reverse-engineer meanings via trial-and-error.

DreamTend's reference repo currently maintains a manual `CUSTOM_ERRORS.md` mapping (workaround):

```
0xf5e39c1f — likely OrderNotFound (cancelOrder filled/missing order)
0xcf479181 — likely InvalidQuantity (lot multiple violation)
0xab12...   — TBD (have not triggered yet)
```

Each entry is annotated with the conditions we triggered it under, but the actual error names + arg semantics are guesses based on context.

#### Logs / Evidence

##### Selector `0xf5e39c1f` — cancelOrder on filled order
- Bot: DreamTend
- Date: 2026-05-27 01:14:08 UTC
- Pool: USDC.e:USDso mainnet (`0x47fD2f18426f67106DBaC82F6d21D446c5F2120b`)
- Orderid attempted: `0x080000000000185d2f`
- Tx: reverted with selector `0xf5e39c1f`
- See Feedback Report 07 for full incident.

##### Selector `0xcf479181` — qty/lot mismatch
- Bot: DreamTend
- Date: 2026-05-27 02:02 UTC
- Pool: USDC.e:USDso mainnet
- Attempted qty: 1.05 USDC.e (= `1050000` raw) — not multiple of on-chain lot `1000000`
- Tx: reverted with selector `0xcf479181` + args
- See Feedback Report 03 for full incident (lotSize docs/chain mismatch).

##### `0x` bare revert — getBookLevels on empty book
- See Feedback Report 05.

#### Impact

- **Brittle revert handling** in every integrator's code. Any error path that needs to distinguish between "already filled" vs "permission denied" vs "paused" is impossible without ABI.
- **Cross-version drift risk.** If contract gets upgraded and a selector changes meaning (or new selectors are added), every integrator's hardcoded selector-string matching silently breaks.
- **Maintenance burden** shifts to every integrator independently. Each team rediscovers the same selectors over time.
- **No-tooling friction** for popular Solidity development tools: Tenderly, Foundry's `decode-error`, ethers' `Interface.parseError()` — all rely on having the error ABI.

#### Suggested Fix

In order of preference:

1. **Ship a complete `SpotPool.json` ABI file** including error definitions (in addition to function & event ABIs):
   ```
   https://docs.dreamdex.io/abi/SpotPool.json
   ```
   Solidity 0.8.x compilers already emit error ABIs by default; this is just publishing what's already generated.

2. **Add a "Custom Errors" section to the Contracts docs page** listing every error name + selector + args, organized by which function emits them. Provides human-readable reference even for teams that don't import ABI files.

3. **Tag selectors with deprecation policy.** Document that any selector listed will not change meaning across contract upgrades; new errors get new selectors. Gives integrators confidence to pattern-match safely.

#### Acceptance Criteria

This report would be resolved when:
- [ ] An authoritative ABI artifact for SpotPool (and any sibling contracts) is published at a stable URL.
- [ ] The Contracts docs page lists every custom error with selector + args.
- [ ] At least one code example in docs shows: catch revert → decode via Interface.parseError → branch on error name (not on hex string).

---

*Reported in good faith. Bot's manual selector mapping is in the reference repo at `src/utils/custom-errors.ts` (if it ends up being formally maintained); otherwise commentary lives in the source as TODO comments where each selector is matched.*


---

### Feedback Report 09 — Leaderboard PnL Formula Excludes Vault & Inventory

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-28
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

#### Type
**Leaderboard / Competition Mechanics**

#### Severity
**High** — Penalizes legitimate market-making strategies (which hold inventory in vaults / base tokens) vs pure taker strategies (which keep everything in wallet USDso). Distorts both the competition outcome and the visibility of in-progress strategies during the run.

#### Environment
- **Leaderboard:** https://dreamdex-leaderboard-super-cool.vercel.app/
- **Observed PnL formula:** `wallet_USDso - 50` (initial USDso allocation)
- **Verified empirically against:** DreamTend wallet `0x8f0A24…ec86` over Days 1-3 of competition

---

#### Steps to Reproduce

1. Start with $50 USDso in registered wallet, 10 SOMI native.
2. Run a market-making bot that:
   - Deposits some USDso to a SpotPool vault to provide maker liquidity
   - Buys some WETH or USDC.e as inventory for hedging
   - Spawns N fleet wallets and seeds each with some USDso
3. Watch the leaderboard PnL column tick down by the amount displaced, even though no capital has been lost — it's been intentionally moved into productive positions.

Concrete reproduction from DreamTend's Day-3 snapshot:

```
Registered wallet USDso visible:    $24.35
Leaderboard PnL shows:              -$25.65  ($24.35 - $50)

Where the missing $25.65 actually is:
  Reg vault USDso:                   $9.50    (recoverable Day-7)
  Reg vault USDC.e (= USDso equiv):  $0.50    (recoverable, swap-able)
  Fleet wallets W0-W4 USDso:         $5.84    (recoverable, sweep)
  Reg WETH 0.002 (~$6 at market):    $6.00    (recoverable, sell)
  W2 vault SOMI 1.79 (= USDso equiv):$0.29    (recoverable)
  Trading slippage (REAL loss):      ~$2.70
  Gas spent on 2,148 tx (in SOMI):   ~$0.80
  Capital used to buy back gas SOMI: ~$0.81
                                     ──────
                                     $25.65   ← matches
```

So ~$22 of the displayed "loss" is recoverable; only ~$3.50 is real PnL friction. The leaderboard cannot distinguish.

#### Expected Behavior

A PnL formula that reflects the **full portfolio value** at any point in time, e.g.:

```
PnL = wallet_USDso
    + sum(vault[pool].USDso_balance)
    + sum(vault[pool].base_balance × current_mid_price)
    + wallet[other_tokens] × current_mid_price
    + sum(fleet_wallets[i].USDso + fleet_wallets[i].other_tokens × mid)
    - 50
```

Or, less ambitious but still meaningful: show **two columns**:
- "Wallet USDso PnL" (current formula)
- "Total Portfolio PnL" (includes vault + inventory + fleet)

So strategies that legitimately use vaults and multi-wallet inventory aren't penalized in the visible scoreboard.

#### Actual Behavior

The leaderboard reads only the registered wallet's USDso ERC20 balance. Any capital deposited to vaults, swapped to base tokens, or moved to fleet wallets becomes invisible — registered as "loss" — until Day-7 when the integrator manually consolidates everything back to the registered wallet.

DreamTend's workaround:
- Built `scripts/sweep-fleet.ts` to consolidate fleet wallets back at Day-7
- Built `src/strategies/day7-liquidator.ts` to:
  - Cancel all resting orders
  - IOC-sell entire base inventory at best bid
  - **Withdraw all vault balances** to wallet (critical — without this step the PnL formula misses the vault portion)
- Scheduled to auto-fire at `2026-06-01T08:00:00Z` (T-2h before snapshot)

This pattern is non-obvious for first-time integrators: a market-maker bot that genuinely posts maker liquidity may discover only at snapshot time that its vault holdings weren't counted, and that it needed an explicit liquidation pass.

#### Logs / Evidence

DreamTend snapshot @ 2026-05-28 02:31 UTC:

```
=== Registered wallet (visible to leaderboard) ===
USDso:    $24.35
SOMI:      8.21 native (= $1.31 at $0.16/SOMI)
WETH:      0.002      (= ~$6.00 at $3000/WETH)
USDC.e:    $0.00

=== Vault balances (INVISIBLE to leaderboard) ===
USDC.e:USDso pool, REG:        USDso=$9.50,  USDC.e=$0.50
USDC.e:USDso pool, W0:         USDso=$0.50
USDC.e:USDso pool, W1:         USDso=$0.50
SOMI:USDso pool, W2:           SOMI=1.79
SOMI:USDso pool, W3:           USDso=$0.84

=== Fleet wallet USDso (INVISIBLE) ===
W0:  $0.50,  W1: $0.50,  W2: $0.50,  W3: $0.50,  W4: $2.00

=== Computed values ===
Leaderboard PnL (visible):  $24.35 - $50 = -$25.65
True portfolio value:       ~$46.48 USDso-equivalent
True PnL post-sweep:        ~-$3.50  (vs displayed -$25.65)
Hidden capital:             ~$22.13
```

#### Impact

- **Strategy distortion:** Bots that genuinely market-make (= hold inventory in vaults) look like they're losing while bots that pure-take (= keep everything in USDso wallet) look better, even though the underlying economics may favor MM.
- **Onboarding cliff:** New integrators see a sharply negative PnL once they deposit to vaults, panic, and reverse course — even when the deposit was strategically correct.
- **Day-7 surprise risk:** Integrators who don't read the formula closely may forget to withdraw vault balances before snapshot, getting an artificially low final PnL.
- **Hidden friction in DreamTend's own design:** We had to invest engineering time in the Day-7 liquidator and sweep-fleet scripts. Time that could have gone into more strategy if the formula included vaults natively.

#### Suggested Fix

In order of preference:

1. **Two-column leaderboard:** show both "Wallet PnL" (current) and "Portfolio PnL" (wallet + vault + inventory). Lets viewers see both views; preserves the current simple formula for comparability while removing the disincentive to use vaults.

2. **Auto-include vault USDso in PnL.** Easiest aggregation: `PnL = wallet_USDso + sum(vault_USDso_across_pools) - 50`. Doesn't require pricing other tokens; just lifts the vault floor.

3. **Document the formula explicitly + recommend a Day-7 liquidation pattern.** A "Snapshot Strategy" page in docs explaining the formula and showing the recommended consolidation script. DreamDEX could even ship a reference `liquidator.ts` template.

4. **Programmatic snapshot API.** Endpoint at `https://api.dreamdex.io/v0/leaderboard/snapshot?wallet=0x…` that returns both the current-formula PnL and the full-portfolio value, so integrators can see their hidden-vault gap mid-competition.

#### Acceptance Criteria

This report would be resolved when:
- [ ] Leaderboard either shows full-portfolio PnL or makes the formula gap visible (e.g., second column or info tooltip).
- [ ] Docs explicitly describe the formula at the top of the Quick Start.
- [ ] A reference liquidation pattern (template script) is recommended for snapshot prep.

---

*Reported in good faith. DreamTend's full Day-7 liquidator + sweep-fleet implementation in the reference repo (`src/strategies/day7-liquidator.ts`, `scripts/sweep-fleet.ts`) demonstrates one solution to this gap — happy to discuss the design with the team.*


---

### Feedback Report 10 — `placeTakerOrderWithoutVault` Payable Semantics For Native-Base Pools

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-28
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

#### Type
**Smart Contract Function Semantics / Docs Gap**

#### Severity
**High** — Wrong `msg.value` on the SOMI/USDso pool causes silent failure or "InsufficientBalance"-class reverts. The relationship between `quantity`, `isBid`, and `msg.value` is non-obvious and undocumented for pools where the base token is the chain's native asset.

#### Environment
- **Network:** Somnia mainnet (chainId 5031)
- **Affected pool:** SOMI:USDso (`0x035De7403eac6872787779CCA7CCF1b4CDb61379`)
- **Affected function:** `SpotPool.placeTakerOrderWithoutVault(...)` (and presumably `placeOrder(...)` too)
- **Framework:** ethers v6 (v6.16.0)
- **Docs referenced:** Contracts > placeOrder section — no native-base callout

---

#### Steps to Reproduce

Set up: registered wallet with 8 SOMI native + $24 USDso. We want to SELL 1 native SOMI for USDso via an IOC taker order at limit price $0.10 (very low, ensures fill at market ~$0.16):

##### Attempt 1 — Try the "obvious" non-payable call (matches WETH/USDso pattern)

```typescript
const args = [
  false,           // isBid (SELL)
  0n,              // tickIndex (unused for IOC)
  parseUnits("0.10", 18),  // priceRaw (limit)
  parseUnits("1", 18),     // qty (1 SOMI)
  futureNs,        // expireNs
  2,               // IOC orderType
  0,               // selfMatchProtection
  ZERO,            // builder
  0n               // builderFeeBpsTimes1k
];
await pool.placeTakerOrderWithoutVault(...args);
// → reverts. Symptoms: similar to "insufficient balance"
```

Cause: with no `msg.value` attached, the contract sees zero native SOMI sent — but the SELL leg requires the taker to deliver the qty in base token (which is native SOMI for this pool).

##### Attempt 2 — Discover via trial that the call must be payable

```typescript
await pool.placeTakerOrderWithoutVault(...args, { value: parseUnits("1", 18) });
// ↑ msg.value matches qty
// → tx succeeds
```

The pool contract pulls the 1 native SOMI from `msg.value` to deliver as the base side of the taker SELL.

##### Attempt 3 — Confirm the inverse direction does NOT need msg.value

```typescript
// IOC BUY 1 SOMI with USDso (no native SOMI needed)
const buyArgs = [true /* isBid */, ...rest];
await pool.placeTakerOrderWithoutVault(...buyArgs);
// → tx succeeds without msg.value, USDso is pulled via the prior approve() call
```

So the rule is asymmetric: **SELL on a native-base pool requires `msg.value === qtyRaw`**. BUY does not.

The docs do not call out this asymmetry for pools where `baseToken == native`.

#### Expected Behavior

The Contracts docs page should include a "Native Base Token Pools" callout under the placeOrder/placeTakerOrderWithoutVault sections. Specifically:

```markdown
### Native Base Token Pools

For pools where the base token is the chain's native asset (e.g. SOMI:USDso on Somnia
mainnet), the SELL leg of any `placeOrder` / `placeTakerOrderWithoutVault` call
requires `msg.value === qtyRaw`:

```solidity
pool.placeTakerOrderWithoutVault{value: qtyRaw}(
  /* isBid: */ false,
  /* ...rest of args */
);
```

The BUY leg does NOT need msg.value — the quote token (USDso) is pulled via
the pool's standard ERC20 transferFrom flow.
```

Plus a code snippet in the integrator example showing both directions side-by-side.

#### Actual Behavior

The docs treat all pools uniformly. No callout for native-base pools. The function is implicitly payable, but this is only visible in the ABI's `stateMutability: "payable"` field (which most integrators don't read).

DreamTend hit this during early experimentation on SOMI:USDso self-cross: the first IOC SELL attempt reverted, and the diagnosis took ~40 minutes to identify that `msg.value` had to be attached. The fix in `scripts/ioc-loop.ts` and `scripts/cross-loop.ts` is straightforward once known:

```typescript
const txOpts = (isNativeBase && !isBid) ? { value: qtyRaw } : {};
await pool.placeTakerOrderWithoutVault(...args, txOpts);
```

But every integrator must rediscover this independently.

#### Logs / Evidence

##### Successful SELL on SOMI:USDso (post-fix)
- Date: 2026-05-27 16:30 UTC
- Bot: DreamTend cross-loop
- Pool: SOMI:USDso (`0x035De7403eac6872787779CCA7CCF1b4CDb61379`)
- `msg.value`: 1.0 SOMI (= `parseEther("1")`)
- Filled against W3's PostOnly maker BID
- TX value column on explorer shows `1 SOMI` — visible signal that the call was payable

##### Failed SELL attempt (pre-fix)
- The early failed attempt did not produce a clean error; ethers reported simulation failure. After adding `{ value }`, the same args succeeded.

#### Impact

- **Onboarding cost:** First-time SOMI:USDso integrators lose 30-60 minutes diagnosing the payable requirement.
- **Strategy gaps:** Bots that don't realize they need `msg.value` may abandon native-base pools entirely, missing the volume opportunity.
- **Generalization risk:** As DreamDEX adds more pools where the base is native (or where base is a token requiring special handling), this pattern compounds — each new pool brings the same asymmetric semantics for new integrators.

#### Suggested Fix

In order of preference:

1. **Add "Native Base Token Pools" callout to docs.** One paragraph + code snippet covers it.

2. **Update ABI/SDK to embed the rule.** Generate helper wrappers like `placeTakerSellNative(qty, price, ...)` that automatically attach `msg.value`. Hides the asymmetry behind a clean API surface.

3. **Surface in `getPoolParams()`** with an `isNativeBase` boolean. So bots can branch on the field at startup and choose the right payment path without per-pool hardcoding.

4. **Symmetric contract design:** wrap native SOMI in a WSOMI-style ERC20 internally and treat all pools the same way at the SpotPool surface. This is the most invasive but eliminates the asymmetry entirely.

#### Acceptance Criteria

This report would be resolved when:
- [ ] Docs include explicit "Native Base Token Pools" section with code snippet showing payable SELL pattern.
- [ ] A new integrator can place a SELL on SOMI/USDso on their first attempt by following docs.
- [ ] OR the ABI/SDK exposes an `isNativeBase` query so bots can detect the requirement programmatically.

---

*Reported in good faith. See `scripts/cross-loop.ts` and `scripts/ioc-loop.ts` in the reference repo for working examples of the payable SELL pattern.*


---

### Feedback Report 11 — WebSocket Reconnect & Resume Protocol Undocumented

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-28
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

#### Type
**WebSocket Protocol / Docs Gap**

#### Severity
**Medium** — Bots that subscribe to `wss://api.dreamdex.io/v0/ws/public` have no documented contract for handling reconnects, missed messages, or resume tokens. The first connection drop forces every integrator to either rebuild orderbook state from REST polling or accept gaps.

#### Environment
- **Network:** Somnia mainnet (chainId 5031)
- **WS endpoint:** `wss://api.dreamdex.io/v0/ws/public`
- **Tools:** `ws` (Node v22), Browser DevTools, `wscat`
- **Docs referenced:** Developers > HTTP API page, sparse WS subsection

---

#### Steps to Reproduce

1. Open a WebSocket connection and subscribe to a channel per the documented pattern:
   ```typescript
   const ws = new WebSocket("wss://api.dreamdex.io/v0/ws/public");
   ws.on("open", () => {
     ws.send(JSON.stringify({ op: "subscribe", channel: "orderbook:WETH:USDso" }));
   });
   ```
2. Receive a snapshot + incremental updates. Note the message format: no `seqNum`, no `lastEventId`, no `resumeToken`.
3. Disconnect the network briefly (e.g., flip wifi off for 5 seconds, then back on).
4. Observe:
   - `ws.on("close")` fires with code 1006 ("Abnormal Closure")
   - No documented heartbeat interval
   - No documented reconnect URL with cursor
   - No documented way to know what messages were missed

5. Reconnect with a fresh subscribe. Receive a new snapshot. **No information** about messages emitted during the disconnect window.

6. Manually compare orderbook state against a fresh REST `/orderbooks/WETH:USDso` call to detect drift.

#### Expected Behavior

A documented reconnect protocol covering:

1. **Heartbeat / ping interval.** "Server sends `{op: 'ping'}` every N seconds; client must reply `{op: 'pong'}` within M seconds or be disconnected."

2. **Resume cursor.** Either:
   - Server includes `seqNum` on every message; client tracks last-received seqNum; reconnect URL is `wss://...?resume_from=N`, OR
   - Server emits a `cursor` field; client stores last cursor; subscribe message can include `{ op: "subscribe", channel: "...", from_cursor: "..." }`.

3. **Replay behavior.** On reconnect with cursor, server sends:
   - All events from `cursor + 1` up to current head
   - Then continues with live stream
   - If `cursor` is too old (e.g., past retention window), server sends a fresh snapshot + `gap: true` flag

4. **Connection-level metadata.** On `open`, server sends a hello message:
   ```json
   {
     "type": "hello",
     "session_id": "abc123",
     "heartbeat_interval_s": 30,
     "max_subscriptions": 100,
     "version": "v0"
   }
   ```

#### Actual Behavior

- No heartbeat pattern documented.
- Connection drops silently when network blips; no auto-reconnect at the protocol level.
- Subscribe-fresh-after-disconnect loses any updates that occurred during the gap.
- No way to know retroactively whether anything was missed.

DreamTend's workaround:
- Wrap WS client in a reconnect loop with exponential backoff
- On reconnect, immediately fire a REST `/orderbooks/<pair>` call to refresh the snapshot
- Treat WS as "best-effort hint" rather than authoritative — fall back to RPC `getBookLevels` if state ever feels stale

This works but loses the latency advantage of WS (which was its main value-add over REST polling).

#### Logs / Evidence

DreamTend client (`src/dex/ws.ts`) keepalive log on 2026-05-26 evening during the documented REST API hiccup:

```
[20:14:33] WS open, subscribed to orderbook:WETH:USDso
[20:18:01] WS message received (orderbook snapshot)
...regular updates for 4h 23min...
[00:41:17] WS close, code=1006 reason="Abnormal Closure"
[00:41:17] Reconnecting in 2s
[00:41:19] WS open, subscribed to orderbook:WETH:USDso
[00:41:19] [WARN] No resume protocol — full snapshot will be re-fetched
[00:41:20] REST /orderbooks/WETH:USDso → got fresh snapshot
[00:41:20] Drift check: 3 levels mismatched between last-WS and fresh-REST states
            (likely 2-3 missed updates during disconnect window)
```

#### Impact

- **Latency advantage lost:** WS becomes a notification trigger only; REST is the authoritative source. Defeats the purpose of WS subscriptions for low-latency strategies.
- **Strategy correctness risk:** Bots that act purely on WS state can develop silent drift that causes incorrect orders (e.g., place a maker order at a price level that no longer exists).
- **Reconnect storm risk:** Without a documented backoff pattern, naïve clients reconnect aggressively after network blips, potentially DoSing the server.
- **No observability:** Bots can't measure their own missed-message rate because there's no seqNum to count gaps in.

#### Suggested Fix

In order of preference:

1. **Document the existing reconnect behavior** (if any). Even "there is no resume; always refetch via REST after disconnect" is better than nothing — at least integrators design for it explicitly.

2. **Add `seqNum` to every message + `?resume_from=N` query param** on the WS URL. Simple, well-understood pattern (used by Binance, Coinbase WS).

3. **Add hello message + heartbeat protocol.** Required for any production-grade WS API. Prevents silent connection death after middlebox idle timeouts.

4. **Document expected behavior under team-side events** (deploys, restarts). Right now integrators can't distinguish "my network blipped" from "DreamDEX deployed" from "permanent server failure" — all look like code 1006.

#### Acceptance Criteria

This report would be resolved when:
- [ ] WS docs describe heartbeat + reconnect + resume behavior explicitly.
- [ ] If no resume is supported, docs say so explicitly + recommend REST-refresh pattern.
- [ ] If seqNum is added, all messages include it and the server supports `?resume_from=` on the WS URL.

---

*Reported in good faith. DreamTend's WS client in `src/dex/ws.ts` ships the REST-refresh-on-reconnect workaround.*


---

### Feedback Report 12 — Stop Order Mechanics & Registry Lifecycle Undocumented

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-28
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

#### Type
**Smart Contract Mechanism / Docs Gap**

#### Severity
**Medium** — Stop orders are a critical risk-management primitive (every serious trading bot wants them) but the on-chain registry, trigger semantics, and lifecycle are not documented. Integrators cannot ship stop-loss logic without first reverse-engineering the registry contract.

#### Environment
- **Network:** Somnia mainnet (chainId 5031)
- **Stop registry addresses (from `src/config/pairs.ts`):**
  - SOMI:USDso → `0x68c8f6fb1EA19A28F25358Ff00b8Ed8E1216df30`
  - USDC.e:USDso → `0xD53E3F3b73513F2147377ef8f573f649cF60100c`
  - WBTC:USDso → `0xed32F048D6a47923D38eCeD868d6f8b0eB4852bd`
  - WETH:USDso → `0x9653a7355849B7691802A6AA49fDe18eF5ba633d`
- **Docs referenced:** Contracts page — references stop orders by name only

---

#### Steps to Reproduce

1. Read the Contracts docs page looking for stop order documentation. Find:
   - Brief mention that stop orders exist
   - No interface (ABI) for the stop registry contract
   - No example showing how to place a stop order
   - No example showing how a stop is triggered
   - No information on per-pool fees, oracle source for trigger price, latency to trigger

2. Inspect a stop registry contract on the explorer. The contract has methods like `createStop(...)`, `cancelStop(uint256 stopId)`, but the function ABI isn't published.

3. Attempt to integrate stop orders into a bot strategy by reverse-engineering the methods. Discover that:
   - The relationship between stop registry and SpotPool isn't documented
   - Trigger price source (oracle vs spot vs index) is not stated
   - Behavior when triggered with no liquidity at limit is not stated
   - Cancel + refund semantics are not stated

4. Decide that integrating stop orders is too risky without docs; ship the bot without stop-loss protection or roll your own off-chain trigger using a pollloop.

#### Expected Behavior

A "Stop Orders" section under the Contracts docs page covering:

##### 1. Registry ABI
```solidity
interface IStopRegistry {
  function createStop(
    address pool,
    bool isBid,           // direction triggered: buy-stop vs sell-stop
    uint256 triggerPrice, // price level that activates the stop
    uint256 limitPrice,   // price for the resulting limit order
    uint256 quantity,
    uint64 expireTs
  ) external returns (uint256 stopId);

  function cancelStop(uint256 stopId) external;

  function getStop(uint256 stopId) external view returns (
    address owner,
    address pool,
    bool isBid,
    uint256 triggerPrice,
    uint256 limitPrice,
    uint256 quantity,
    uint64 expireTs,
    bool triggered,
    uint256 createdAt
  );
}
```
(Exact signatures TBD by contract — this is illustrative.)

##### 2. Trigger source
What price source determines whether a stop has been crossed?
- (A) Spot mid of the underlying pool, OR
- (B) Last traded price, OR
- (C) An oracle (Pyth, Chainlink, etc.) — specify which and its update frequency

##### 3. Trigger mechanics
- Who pays gas to trigger a stop?
- Is there a permissionless keeper / triggerer (anyone can call `triggerStop(id)`) or is it auto-triggered on every fill / by a privileged role?
- What's the latency from price-cross to triggered limit order?

##### 4. Fees, expiry, cancellation
- Stop registration fee (if any)?
- What happens on expiry — auto-cancel + refund collateral?
- Cancel partial refund semantics?

#### Actual Behavior

The Contracts docs name-drop "stop orders" without explaining their full lifecycle. Integrators have to either:
- Trial-and-error against mainnet (risky, real money)
- Decode the registry contract via Blockscout's verified-source viewer (if source is verified)
- Skip stop orders entirely

DreamTend chose option 3 — we shipped without on-chain stop integration. Our Day-7 liquidator handles risk via scheduled IOC dump, not via on-chain stops. This is a workaround; on-chain stops would be lower-latency and more capital-efficient if their behavior were documented.

#### Logs / Evidence

The stop registry addresses are configured in DreamTend's `src/config/pairs.ts` (we discovered them via DreamDEX team chat reference), but never invoked because the integration risk is too high without docs:

```typescript
export const POOLS = {
  mainnet: {
    "SOMI:USDso": {
      poolAddress: "0x035De7403eac6872787779CCA7CCF1b4CDb61379",
      stopRegistry: "0x68c8f6fb1EA19A28F25358Ff00b8Ed8E1216df30",  // ← address known
      ...
    },
    // ...same for other pools
  }
};
```

No code in DreamTend's repo actually calls these stop registry contracts — pure address bookkeeping.

#### Impact

- **Risk management gap.** Bots cannot implement stop-loss logic without on-chain stops; they have to poll prices off-chain and broadcast a cancel + IOC sell as a substitute. Slower + costlier + only as reliable as the bot's uptime.
- **Strategy ceiling lowered.** Without stops, more conservative bots stick to small notional or pure-taker patterns. Larger maker strategies that need downside protection skip DreamDEX.
- **DreamDEX feature underutilized.** Stop orders are a real feature shipped on the chain, but the docs gap means few integrators use them.

#### Suggested Fix

In order of priority:

1. **Add a "Stop Orders" section to the Contracts docs page** with the full registry ABI, lifecycle diagram, trigger source, fee structure.

2. **Publish the stop registry ABI as JSON.** Same pattern as SpotPool — `https://docs.dreamdex.io/abi/StopRegistry.json`.

3. **Ship a reference integration example:** "Add stop-loss to your bot" tutorial with copy-paste ethers/viem code.

4. **Document trigger oracle dependency.** Critical for strategy design — bots need to know whether stops are spot-mid-triggered or oracle-triggered (the difference matters for MEV resistance, latency, and front-run risk).

#### Acceptance Criteria

This report would be resolved when:
- [ ] Stop registry ABI is published in docs (with selectors, args, return types).
- [ ] At least one end-to-end stop-order example exists in docs.
- [ ] Trigger semantics, fee, expiry, cancellation refund behavior are documented.

---

*Reported in good faith. DreamTend chose to ship without on-chain stops; happy to integrate them once the lifecycle is documented and ship as a reference example for the next testing wave.*


---

### Feedback Report 13 — Multi-Wallet / AI-Agent Aggregation Policy Not in Docs

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-28
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

#### Type
**Competition Rules / Policy Documentation**

#### Severity
**Medium** — A material policy decision (multi-wallet aggregation) was communicated only via group chat. Future testing waves and new entrants who don't have access to chat history will not know what's permitted, and may be unfairly penalized or unfairly favored relative to today's competitors.

#### Environment
- **Competition:** DreamDEX Alpha Trading Competition (2026-05-26 to 2026-06-01)
- **Source of policy:** Telegram group chat, Emre Yıldız (DevRel), 2026-05-25
- **Public docs status:** No mention of multi-wallet permissibility, aggregation rules, or fleet patterns

---

#### Steps to Reproduce

1. Read the public docs and Quick Start page. Find:
   - Mention of "one wallet per person" (initial impression)
   - No mention of AI-agent sub-wallets
   - No mention of multi-wallet aggregation under a single tester identity

2. Ask in the alpha tester group chat: "Can my bot run from multiple wallets and aggregate their volume under my submission?"

3. Receive verbal confirmation from DevRel (Emre, 2026-05-25):
   > *"You can create your wallets your AI agents wallet etc. We'll consider it general."*

4. Discover this policy is not documented anywhere outside the chat scrollback.

5. Realize that any future tester who joins later (or any reviewer auditing the competition retrospectively) has no canonical reference for this rule.

#### Expected Behavior

A "Multi-Wallet & AI Agent Policy" section in the Competition Rules or Quick Start covering:

##### 1. What's allowed
```markdown
### Multi-Wallet & AI Agent Submissions

A single tester may operate multiple wallets as part of their bot
architecture (e.g., separate wallets for different strategies, AI agents,
or risk-tier roles). All wallets must:

- Be funded from the registered wallet (no external top-ups)
- Be under the tester's exclusive control
- Be declared in the submission

Volume from all declared wallets aggregates to the tester's submission
total. PnL is computed by consolidating all USDso from all declared
wallets to the registered wallet before snapshot.
```

##### 2. What's NOT allowed
- Wash trading between unrelated testers
- External capital injection during the competition
- Sybil-style identity multiplication (one human, multiple "testers")

##### 3. How to declare
- A "declared wallets" field in the submission template
- Or an auto-discovery rule: all wallets that received funding from the registered wallet within the competition window count as fleet

##### 4. Snapshot mechanics
- Day-7 consolidation pattern explicitly recommended
- Reference implementation (e.g., DreamTend's `scripts/sweep-fleet.ts`)

#### Actual Behavior

The policy lives only in Telegram. New entrants joining mid-competition would either:
- Not know multi-wallet is allowed → ship suboptimal strategies (e.g., no self-cross because they think it's prohibited)
- Discover only by accident from chat scrollback → uneven playing field based on chat-reading discipline
- Discover later than competition starts → can't catch up after building solo-wallet architecture

DreamTend benefited from being early enough in the chat to catch Emre's message; we built a 6-wallet fleet (1 registered + 5 bot-spawned) and used it for self-cross, fleet MM, and capital recycling. The full reference implementation in `src/agent/registry.ts` + `data/bot-wallets.json` + `scripts/sweep-fleet.ts` is shipped open-source.

But the next tester who joins for the next competition wave will not have that head start unless the rule is documented.

#### Logs / Evidence

DreamTend's commit `1057d85` (phase-5e in original history) explicitly cites Emre's quote:

```
feat(phase-5e): multi-wallet fleet infrastructure (per Emre's AI-agent guidance)

Per the alpha group chat (Emre Yıldız, 2026-05-25):
  "You can create your wallets your AI agents wallet etc.
   We'll consider it general."

Adds infrastructure for spawning, funding, role-assigning N fresh wallets
under the registered wallet's control. ...
```

This serves as a concrete reference for the policy. But it's buried in DreamTend's git history, not in DreamDEX's official docs.

#### Impact

- **Unequal information access** across testers — those who read chat carefully get an architectural lead over those who only read docs.
- **No clear submission template** for declaring fleet wallets, so reviewers will need to chase down each tester's setup individually at snapshot time.
- **Risk of disputes** — without a written rule, edge cases (e.g., a tester who used 30 wallets across 3 strategies) may need ad-hoc adjudication.
- **Onboarding loss for future waves** — every new testing programme will repeat this question, costing DevRel time.

#### Suggested Fix

In order of preference:

1. **Add the policy to the Competition Rules / Quick Start page** as a numbered subsection. One paragraph + an example is enough.

2. **Ship a reference fleet pattern.** Either link to a community implementation (DreamTend offers ours under MIT) or provide an official template.

3. **Submission template field:** "Declared wallets — list all addresses controlled by your bot." Forces explicit declaration; makes review easy at snapshot.

4. **Auto-aggregation rule:** treat all wallets that received funds from the registered wallet during the competition window as fleet. Eliminates the declaration step.

#### Acceptance Criteria

This report would be resolved when:
- [ ] The multi-wallet / AI-agent policy is in the public docs (not only in chat).
- [ ] A submission template includes a "declared wallets" field or an auto-aggregation rule is stated.
- [ ] A reference fleet pattern (template script or community link) is documented.

---

*Reported in good faith. DreamTend's full fleet implementation is available under MIT — happy for the team to fork it, reference it, or use it as the basis for an official template in future waves.*


---

### Feedback Report 14 — Yield Algorithm Parameters Undocumented (σ, Cadence, Eligibility)

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-29
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

#### Type
**Docs Gap / Incentive Mechanism**

#### Severity
**High** — The yield (maker rewards) mechanism is the core economic incentive for providing liquidity, but the parameters needed to model it are missing. An integrator cannot estimate APR, size positions, or design a rational market-making strategy without them.

#### Environment
- **Docs page:** `trading/common/yield-algorithm.md` (https://docs.dreamdex.io/ld25g222WKDrLlJMcR41/trading/common/yield-algorithm)
- **Network:** Somnia mainnet (chainId 5031)

---

#### Steps to Reproduce

1. Open the Yield Algorithm docs page.
2. Read the reward formula and weighting factors:
   ```
   W = e^(-(P_order - P_mid)^2 / 2σ^2)   (Gaussian proximity weight)
   Weighting factors: Notional Value + Time in Book + Proximity to Mid-price
   Book state tracked "in real-time (i.e. on each block)"; yield "periodically
   settled to the user's margin sub-account."
   ```
3. Try to compute the expected yield for a concrete maker order (e.g., 100 USDso resting 5 ticks from mid for 10 minutes). **You cannot** — the required parameters are absent:
   - **σ** is described only qualitatively ("how quickly yield rewards drop off") with **no numeric value**.
   - **"Periodically settled"** gives **no interval** (per block? per hour? per epoch?).
   - **Eligibility** is unspecified: must the order be PostOnly? Is there a minimum size or minimum time-in-book? Is there an early-cancel penalty / clawback?

#### Expected Behavior

The yield page should publish the concrete parameters needed to model rewards:
- The deployed **σ** value (or per-pool σ table).
- The **settlement cadence** (e.g., "settled every N blocks / every epoch of T seconds").
- **Eligibility rules**: order types that qualify (PostOnly only? any maker?), minimum notional / minimum time-in-book, and any early-cancel penalty.
- A **worked example**: "a 100-USDso order resting X ticks from mid for T minutes earns ≈ Y USDso," so integrators can sanity-check their own math.

#### Actual Behavior

The formula and the three qualitative factors are given, but every quantitative input (σ, cadence, eligibility thresholds, penalties) is omitted. Integrators must reverse-engineer rewards from on-chain settlement observations over days, or avoid maker strategies entirely (which is what DreamTend did — we ran taker-only IOC partly because the maker-yield economics were unmodelable from docs).

#### Logs / Evidence

Direct from the yield page (paraphrased from current docs): the σ term is explained as controlling "how quickly yield rewards drop off as your order moves away from the mid-price," with no value attached; settlement is "periodic" to the margin sub-account with no stated interval; no eligibility or penalty section exists.

#### Impact

- **Maker strategies are undesignable.** Without σ and cadence, no one can compute expected APR or compare resting at 2 ticks vs 10 ticks from mid.
- **Pushes integrators toward taker-only strategies** (or off the platform), reducing the resting liquidity the yield program is meant to attract — self-defeating.
- **Trust gap.** A core incentive described only with a formula but no parameters reads as incomplete.

#### Suggested Fix

1. Publish σ (global or per-pool), the settlement interval, and eligibility/penalty rules on the yield page.
2. Add one fully worked numeric example.
3. (Bonus) Expose a read function or REST endpoint returning the live yield params so bots can adapt programmatically.

#### Acceptance Criteria

- [ ] σ, settlement cadence, and eligibility rules are documented with concrete values.
- [ ] A worked example lets an integrator reproduce an expected-yield figure.
- [ ] (Optional) yield params are queryable on-chain or via REST.

---

*Reported in good faith. DreamTend ran taker-only partly because maker-yield economics were unmodelable from the current docs — documenting these params would let future testers run informed market-making strategies.*


---

### Feedback Report 15 — `markPrice` EMA Window (`updateIntervalSec`) Undocumented

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-29
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

#### Type
**Docs Gap / Stop-Order Mechanics**

#### Severity
**Medium** — Stop-loss / take-profit triggers fire off the EMA-smoothed `markPrice`, but the smoothing window / update interval is undocumented, so integrators cannot predict trigger latency or how far the trigger price lags the raw market.

#### Environment
- **Docs:** `trading/readme-1/stop-orders.md` + the `MarkPriceUpdated` event / types reference
- **Network:** Somnia mainnet (chainId 5031)

---

#### Steps to Reproduce

1. Read the stop-order docs: triggers use the **EMA-smoothed midpoint** (`markPrice`), not the raw midpoint.
2. Read the `MarkPriceUpdated(asset, markPrice, rawMidpoint)` event description: `markPrice` "advances at most one step per `updateIntervalSec`."
3. Try to find the deployed `updateIntervalSec` value (and the EMA window length / smoothing factor). The type definition only bounds it generically (`>0 and <=86400`); **no configured value is published.**
4. Conclusion: you cannot predict (a) how quickly a stop will trigger after the raw price crosses your level, or (b) how much `markPrice` lags `rawMidpoint` during a fast move.

#### Expected Behavior

Docs should publish:
- The deployed `updateIntervalSec` per pool (or globally).
- The EMA window length / smoothing coefficient used to compute `markPrice` from `rawMidpoint`.
- A note on expected trigger latency (e.g., "a stop may lag the raw price by up to `updateIntervalSec` seconds plus EMA smoothing").

#### Actual Behavior

The mechanism is named (EMA-smoothed markPrice, `updateIntervalSec` gated) but the actual deployed values are absent. The type bound (`<=86400`, i.e., up to a day) is uselessly wide — a 1-second interval and a 1-hour interval behave very differently for stop triggering, and integrators can't tell which they're getting.

#### Logs / Evidence

From the types/event docs: `markPrice` "advances at most one step per `updateIntervalSec`," with `updateIntervalSec` constrained only to `>0 and <=86400`. No per-pool deployed value or EMA window is given anywhere in the docs.

#### Impact

- **Stop-order behavior is unpredictable.** A trader setting a stop can't know whether it triggers near-instantly or lags by seconds/minutes, which matters for risk management.
- **MEV / front-run reasoning impossible.** Whether stops are EMA-lagged affects how exploitable they are; integrators can't assess this.
- Compounds with Feedback Report 12 (stop-order lifecycle undocumented) — together they make on-chain stops hard to adopt confidently.

#### Suggested Fix

1. Publish the deployed `updateIntervalSec` and EMA window/coefficient on the stop-orders page.
2. Add a one-line "expected trigger latency" guidance.
3. (Bonus) Expose `updateIntervalSec` via a read function so bots can adapt.

#### Acceptance Criteria

- [ ] Deployed `updateIntervalSec` (and EMA window) is documented per pool.
- [ ] Docs state the expected lag between `rawMidpoint` crossing and `markPrice`-based stop trigger.

---

*Reported in good faith. See also Feedback Report 12 (stop-order registry/lifecycle undocumented).*


---

### Feedback Report 16 — MCP Server Advertised But No Endpoint Published

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-29
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

#### Type
**Docs Gap / Marketing-vs-Reality**

#### Severity
**Medium** — The docs promote a "native MCP server" as an agent-integration feature, but no actual server URL/endpoint is published, so the advertised capability cannot be used.

#### Environment
- **Docs:** Intro / "Why DreamDEX" pages (agent-integration section)

---

#### Steps to Reproduce

1. Read the intro / "Why DreamDEX" docs. They highlight agent-friendliness, including a **"native MCP server"** (Model Context Protocol) for AI-agent integration.
2. Search the docs for the MCP server's **URL, endpoint, or connection instructions**.
3. Find none. Querying the docs' own assistant confirms: *"what's not published … is an actual MCP server URL or endpoint."*

#### Expected Behavior

If an MCP server is advertised, the docs should publish:
- The server URL / connection string.
- Auth requirements (if any).
- A minimal "connect your agent to DreamDEX MCP" example.

OR, if it isn't live yet, label it clearly as "coming soon / roadmap" so integrators don't go looking for a non-existent endpoint.

#### Actual Behavior

The MCP server is named as a feature but has no published endpoint or usage instructions anywhere in the docs. An agent developer reading the marketing cannot act on it.

#### Logs / Evidence

The docs query interface explicitly returns that no MCP server URL/endpoint is published despite the feature being mentioned. (Related: Feedback Report 17 — the `AGENTS.md`/`SKILL.md` "agent contracts" referenced alongside MCP also 404.)

#### Impact

- **Advertised agent feature is unusable** — the one thing AI-agent builders would reach for has no entry point.
- **Marketing-vs-reality gap** erodes trust in other documented capabilities.
- For an "Agentic L1" positioning (Somnia), a dangling MCP claim undercuts the core narrative.

#### Suggested Fix

1. Publish the MCP server URL + a connect example, OR
2. Mark it explicitly as "roadmap / not yet available" with an ETA.

#### Acceptance Criteria

- [ ] Docs either provide a working MCP endpoint + example, or clearly label it as not-yet-available.

---

*Reported in good faith. DreamTend integrated agent capabilities via the Somnia Agent Kit (Agent #45) instead, since no DreamDEX MCP endpoint was available.*


---

### Feedback Report 17 — `AGENTS.md` / `SKILL.md` Agent Contracts Return 404

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-29
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

#### Type
**Docs Gap / Broken Reference**

#### Severity
**Medium** — Docs reference `AGENTS.md` and `SKILL.md` as "auto-discoverable agent contracts," but both URLs 404. An agent that tries to auto-discover its contract via these files fails.

#### Environment
- **Docs base:** https://docs.dreamdex.io/ld25g222WKDrLlJMcR41/
- **Claimed files:** `/AGENTS.md`, `/SKILL.md`

---

#### Steps to Reproduce

1. Read the intro / agent-integration docs. They mention `SKILL.md` and `AGENTS.md` as machine-readable agent contracts for auto-discovery.
2. Fetch them directly:
   ```
   GET https://docs.dreamdex.io/ld25g222WKDrLlJMcR41/AGENTS.md  → 404 (does not exist)
   GET https://docs.dreamdex.io/ld25g222WKDrLlJMcR41/SKILL.md   → 404 (does not exist)
   ```
3. Both return "The URL … does not exist." The only related asset found is the GitHub repo `github.com/somnia-chain/somnia-skills` (not linked from the agent-contract mention).

#### Expected Behavior

Either:
- Host `AGENTS.md` and `SKILL.md` at the referenced location (so agents can `wget` them), OR
- Link the canonical source (e.g., the `somnia-skills` repo) from the docs where these files are mentioned, OR
- Remove the references if the files don't exist yet.

#### Actual Behavior

The files are named as agent contracts but 404 at the docs domain. An auto-discovering agent following the docs gets a dead link.

#### Logs / Evidence

Direct fetches of both `/AGENTS.md` and `/SKILL.md` under the docs token path return 404. (Pairs with Feedback Report 16 — the MCP server referenced alongside these also has no published endpoint. The whole "auto-discoverable agent contract" surface is advertised but not wired up.)

#### Impact

- **Auto-discovery broken** for any agent following the documented contract path.
- **Compounds the agent-integration gap** (with MCP, Report 16): the "agentic" surface is marketed but the concrete artifacts (MCP endpoint, AGENTS.md, SKILL.md) are all missing/404.
- Wastes integrator time chasing dead links.

#### Suggested Fix

1. Host the files at the referenced URLs, or link the `somnia-skills` repo from the docs.
2. If not ready, remove/relabel the references as roadmap.

#### Acceptance Criteria

- [ ] `AGENTS.md` and `SKILL.md` either resolve (200) at the documented location or the docs point to the correct canonical source.
- [ ] No dead references remain in the agent-integration section.

---

*Reported in good faith. See also Feedback Report 16 (MCP server URL not published) — same agent-integration surface.*


---

### Feedback Report 18 — Spot Trading Page Is a Stub (No Matching-Engine Walkthrough)

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-29
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

#### Type
**Docs Gap / Incomplete Page**

#### Severity
**Medium** — The core "Spot" trading page is a short stub with no explanation of the matching engine (price-time priority, order-flow lifecycle, settlement). New integrators have no conceptual on-ramp to how trades actually match.

#### Environment
- **Docs page:** `trading/readme-1/spot.md` (https://docs.dreamdex.io/ld25g222WKDrLlJMcR41/trading/readme-1/spot)

---

#### Steps to Reproduce

1. Open the Spot trading docs page — the natural starting point for "how does spot trading work here."
2. Read it: ~300-400 words. The matching engine is mentioned exactly once, in passing ("the same matching engine that will power perpetuals in v2.0").
3. Look for: price-time-priority rules, how a taker order walks the book, partial-fill behavior, how PostOnly/IOC/FOK/GTC differ in matching, settlement flow (vault vs wallet). **None are on the Spot page.**

#### Expected Behavior

The Spot page should give a conceptual walkthrough:
- **Matching model**: price-time priority (FIFO at a price level?), how a taker order sweeps levels.
- **Order types in matching**: how GTC / IOC / FOK / PostOnly behave when they hit the book.
- **Order lifecycle**: placed → rested → (partially) filled → settled, with the events emitted at each step.
- **Settlement**: where filled funds land (margin sub-account / vault / wallet), referencing the deposit model.
- A simple worked example (one taker order matching one or two resting makers).

#### Actual Behavior

The Spot page is a stub. The matching engine — the single most important concept for an order-book DEX — gets one passing clause. Integrators must piece the model together from the Functions reference + event list + trial-and-error, instead of reading one coherent overview.

#### Logs / Evidence

`trading/readme-1/spot.md` is ~300-400 words; the only matching-engine reference is the "same matching engine that will power perpetuals in v2.0" mention. No price-time-priority, order-flow, or settlement walkthrough appears on the page.

#### Impact

- **No conceptual on-ramp.** First-time integrators (the exact audience of an alpha program) have nowhere to learn how matching works before diving into raw contract functions.
- **Slower, error-prone integration.** Without the matching model, devs make wrong assumptions (e.g., about partial fills, PostOnly crossing, IOC remainder handling) and discover them via failed txs.
- Undersells a genuinely strong feature (on-chain CLOB matching) by not explaining it.

#### Suggested Fix

1. Expand the Spot page with a matching-engine section (priority rules, order-type matching behavior, lifecycle, settlement).
2. Add one worked taker-vs-maker example.
3. Cross-link to the Functions and Events references.

#### Acceptance Criteria

- [ ] The Spot page explains price-time priority and how each order type matches.
- [ ] A worked example shows a taker order matching resting maker(s).
- [ ] Order lifecycle + settlement flow is described with the corresponding events.

---

*Reported in good faith. DreamTend reverse-engineered the matching behavior from the Functions reference + on-chain event observation (e.g., the `OrderFilled` / `OrderRested` semantics) — a Spot-page walkthrough would have saved that effort.*


---

### Feedback Report 19 — CCXT Bindings: TypeScript-Only, Not Published to npm

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-29
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

#### Type
**SDK / Distribution Gap**

#### Severity
**Low** — The CCXT integration (a major ease-of-integration selling point) installs only from a GitHub branch and exists only in TypeScript/JS. Python/Go/PHP/C# traders — a large share of the algo-trading world — can't use it yet. Docs disclose this, so it's a roadmap/polish item rather than a hidden bug.

#### Environment
- **Docs page:** `developers/libraries/ccxt`
- **Install:** `npm install github:somnia-chain/ccxt#add-dreamdex-exchange`

---

#### Steps to Reproduce

1. Read the CCXT integration docs — DreamDEX is presented as available through CCXT (the standard multi-exchange trading library).
2. Try the standard install path: `npm install ccxt` then use the dreamdex exchange → **not present** (the dreamdex exchange isn't in the published npm package).
3. The docs disclose the real path: `npm install github:somnia-chain/ccxt#add-dreamdex-exchange` (a fork branch, "not yet published to npm").
4. Check language support: only **TypeScript/JS** bindings are generated; "Python / PHP / C# / Go have not yet been generated."

#### Expected Behavior

For a CCXT integration to deliver its main value (drop-in, multi-language, install-from-npm):
- The dreamdex exchange should be in the **published `ccxt` npm package** (or a clearly-versioned `@somnia/ccxt` package), AND
- The standard CCXT codegen for **Python / Go / PHP / C#** should be generated, since CCXT's biggest user base is Python algo traders.

#### Actual Behavior

- Install is from a **GitHub fork branch**, not npm — fragile (branch can move/disappear), no semver, no `npm audit` integration.
- **TypeScript/JS only** — Python/Go/PHP/C# traders are excluded for now.

The docs DO disclose this honestly (so it's not a hidden trap), but it limits the reach of an otherwise strong "standard tooling" selling point.

#### Logs / Evidence

Docs state the install is `github:somnia-chain/ccxt#add-dreamdex-exchange`, that it's "not yet published to npm," and that non-JS language bindings "have not yet been generated."

#### Impact

- **Python algo traders blocked** (the largest CCXT cohort) — they'd need to wait for codegen or hand-roll an integration.
- **Branch-install fragility** — pinning to a moving branch is not production-safe; a CI build could break if the branch is rebased/removed.
- Limits the "use your existing CCXT bot with DreamDEX" pitch to JS-only users.

#### Suggested Fix

1. Publish the dreamdex exchange to the official `ccxt` npm package (or a versioned standalone package).
2. Generate the Python / Go / PHP / C# bindings via standard CCXT codegen.
3. Until then, prominently label the CCXT integration as "alpha, JS-only, install-from-branch" at the top of the page (currently disclosed but easy to miss).

#### Acceptance Criteria

- [ ] dreamdex CCXT integration installable via a versioned npm package (no GitHub-branch pin required).
- [ ] At least Python bindings generated (the dominant CCXT language).
- [ ] Alpha/limitation status stated prominently on the CCXT page.

---

*Reported in good faith. DreamTend integrated directly via ethers.js + the SpotPool ABI rather than CCXT, partly because the CCXT path was JS-branch-only and we wanted production stability.*


---

### Feedback Report 20 — Volume Metric Inflatable via Cross-Wallet Self-Dealing

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-29
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

#### Type
**Competition Mechanics / Protocol Metric Integrity**

#### Severity
**High** — The headline competition KPI (trading volume) can be inflated arbitrarily via self-dealing between an operator's own wallets, with no on-chain or leaderboard distinction from genuine, counterparty-diverse volume. This rewards wash trading over real liquidity provision and undermines the metric the competition is built on.

#### Environment
- **Leaderboard:** https://dreamdex-leaderboard-super-cool.vercel.app/ (KPI = on-chain trading volume)
- **Network:** Somnia mainnet (chainId 5031)
- **Relevant contract feature:** `SelfMatchingOption` (`cancelTaker` / `cancelMaker`)

---

#### Observation (from our own implementation)

DreamTend built a **self-cross** mechanism early in the competition (`scripts/cross-loop.ts`): one of our own wallets posts a PostOnly maker order and another of our wallets takes it via IOC. Both transactions are real and on-chain, and the resulting `OrderFilled` volume counts toward the leaderboard — **but there is no genuine counterparty, no price discovery, and no economic risk transfer.** It is, in substance, wash trading.

We deliberately kept this minimal (~$5-30) and pivoted to genuine taker trading against real external liquidity, because we wanted clean, defensible volume. But the mechanism works precisely because the metric cannot tell self-dealing apart from genuine flow.

#### The gap

1. The on-chain **`SelfMatchingOption`** prevents a *single wallet* from matching its own resting order. This is good — but it only covers the single-wallet case.
2. **Cross-wallet self-dealing is undetected.** Wallet A (maker) + Wallet B (taker), both controlled and funded by the same operator, can churn volume indefinitely. `SelfMatchingOption` does not fire (different addresses), and the leaderboard counts every fill.
3. Multi-wallet operation is explicitly permitted (per DevRel guidance on AI-agent wallets), which is reasonable — but combined with (2), it makes the volume KPI **fully gameable**: an operator can post-and-take their own orders across N wallets to manufacture arbitrary volume with zero genuine market participation.

#### Expected Behavior

The competition's volume metric should reward **genuine** liquidity/flow, not self-dealing. Options:
- **Detect linked wallets:** discount or flag volume where maker and taker wallets are funded from / sweep back to a common source (an on-chain funding-graph heuristic).
- **Counterparty-diversity weighting:** weight a wallet's volume by the diversity of distinct counterparties it traded against (self-dealing collapses to near-zero weight).
- **Net-flow / inventory-turnover metric:** reward volume that actually moves inventory between independent parties, not round-trips within one operator's wallet set.

#### Actual Behavior

All fills count equally. A genuine taker that depends on external liquidity (and therefore stalls when the book is empty — see Feedback Report 21) is out-competed on the leaderboard by self-dealers who manufacture volume independent of real market conditions. The metric inverts the intended incentive: it rewards manufacturing volume over providing real liquidity.

#### Logs / Evidence

- Our own `scripts/cross-loop.ts` demonstrates the mechanism: W3 maker + registered-wallet taker on SOMI:USDso, generating on-chain `OrderFilled` volume with no external counterparty.
- The on-chain `SelfMatchingOption` enum (cancelTaker/cancelMaker) confirms single-wallet self-match is guarded — but nothing guards the cross-wallet case.

#### Impact

- **The headline KPI is gameable**, so the leaderboard may not reflect genuine trading skill or real liquidity contribution.
- **Perverse incentive:** rational competitors are pushed toward wash trading (it's the highest-volume-per-unit-effort strategy, and unbounded by real liquidity), away from genuine market-making/taking.
- **Audit burden:** distinguishing genuine from manufactured volume after the fact (which the team has indicated it intends to do for capital-rule compliance) is far harder than building the distinction into the metric up front.

#### Suggested Fix

1. Add a self-dealing discount to the leaderboard: detect maker/taker wallet linkage via on-chain funding graph and down-weight intra-operator volume.
2. Publish the rule so competitors know genuine flow is what's rewarded.
3. (Longer term) consider a counterparty-diversity or net-inventory-turnover metric alongside raw volume.

#### Acceptance Criteria

- [ ] Leaderboard volume distinguishes (or discounts) self-dealing / cross-wallet wash volume from genuine counterparty-diverse flow.
- [ ] The rule is documented in the competition guidelines.

---

*Reported in good faith. DreamTend chose to compete on genuine taker volume rather than maximize via self-cross — we'd rather the metric rewarded that choice. Multi-wallet operation itself is legitimate and useful (we use it); the gap is specifically that the volume metric can't tell self-dealing from genuine flow.*


---

### Feedback Report 21 — Mainnet Pools Have Extended Dead Periods (No Baseline Liquidity)

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-29
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

#### Type
**Liquidity / Competition Fairness / Protocol Design**

#### Severity
**Medium** — Mainnet SpotPool books go completely empty for hours at a time, with no seeded baseline liquidity or market-maker-of-last-resort. Genuine taker strategies cannot fill during these windows, while self-dealing strategies (which create their own liquidity) can — pushing rational competitors toward wash trading (see Feedback Report 20).

#### Environment
- **Network:** Somnia mainnet (chainId 5031)
- **Pools observed:** all four — SOMI:USDso, USDC.e:USDso, WBTC:USDso, WETH:USDso

---

#### Steps to Reproduce

1. During an off-peak window, probe each pool's book:
   ```
   getBookLevels(true, 1)  // BID
   getBookLevels(false, 1) // ASK
   ```
2. Observe that **all four pools** revert (empty book) on both sides simultaneously — no resting orders anywhere.
3. Attempt a genuine IOC taker order: the `staticCall` returns `success=false` (nothing to match), so the order can't fill. Repeat over hours and the books stay empty.

#### Expected Behavior

For a live mainnet (and especially a volume-based competition), there should be **baseline liquidity** so genuine takers can always trade:
- A DevRel-funded **market-maker-of-last-resort** posting wide bid/ask on each pool 24/7, OR
- Protocol-incentivized resting liquidity (the yield program is meant to do this — but if yield params are unmodelable, makers don't show up; see Feedback Report 14), OR
- At minimum, **documentation** of expected liquidity hours so integrators know when genuine trading is viable.

#### Actual Behavior

We observed **all four mainnet pools empty for multi-hour stretches** (verified by repeated `getBookLevels` probes returning empty on both sides across the period). The docs confirm there is **no seeded baseline liquidity or market-maker-of-last-resort** on mainnet pools. During these windows:
- A genuine taker (our IOC engine) sim-skips every cycle (no liquidity to take) → zero volume.
- A self-dealer (posts its own maker order, then takes it) generates volume regardless → unaffected by the dead book.

So the dead-pool periods **disproportionately advantage wash trading** over genuine flow.

#### Logs / Evidence

```
Audit @ ~20:52 mainnet (all 4 pools, both sides):
  WETH:USDso   BID empty / ASK empty
  SOMI:USDso   BID empty / ASK empty
  USDC.e:USDso BID empty / ASK empty
  WBTC:USDso   BID empty / ASK empty
```
Our IOC engine's fill rate dropped from ~100% (active hours) to 0% (dead window) across these probes, with gas barely consumed (sim-skip, no broadcasts). Docs contain no mention of seeded baseline liquidity.

#### Impact

- **Genuine takers stall** during dead windows — they literally cannot generate volume, while the competition rewards volume.
- **Pushes competitors toward wash trading** (the only volume source when books are empty), compounding the metric-integrity problem in Feedback Report 20.
- **Poor UX for new integrators:** a tester who connects during a dead window sees "nothing fills" and may conclude the DEX/their integration is broken, when the book is simply empty.

#### Suggested Fix

1. Run a DevRel-funded market-maker-of-last-resort posting wide bid/ask on each mainnet pool (especially during the competition) so genuine takers can always fill.
2. Make the yield program's parameters concrete (Feedback Report 14) so third-party makers are incentivized to provide resting liquidity organically.
3. Document expected liquidity windows / current liquidity sources so integrators know what to expect.

#### Acceptance Criteria

- [ ] Mainnet pools have non-empty books a strong majority of the time (e.g., ≥90% when probed), OR
- [ ] Docs clearly state the liquidity model and expected active windows.
- [ ] Genuine taker strategies are not structurally disadvantaged vs self-dealers during off-peak.

---

*Reported in good faith. DreamTend's genuine IOC engine idled (safely, no gas waste) through multi-hour dead windows while observing that self-dealing strategies kept generating volume — a baseline-liquidity layer would let genuine takers compete fairly and reduce the wash-trading incentive (see Feedback Report 20).*


---

### Feedback Report 22 — `OrderPlaced` Event: `owner` is NOT `indexed` (Docs/ABI Diverges From Deployed Contract)

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-30
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

#### Type
**ABI / Docs Mismatch — Event Topic Indexing**

#### Severity
**High** — The documented event signature claims `owner` is `indexed`, but the deployed `SpotPool` contract emits `OrderPlaced` with **only one indexed topic** (`orderId`). Any third-party integrator using the documented ABI to query "all orders for wallet X" via `eth_getLogs` with a topic filter on `owner` will receive **zero results**, even when the wallet is actively trading. Same bug class as Report 02 (`getPoolParams` field-count mismatch): silent, hard to diagnose, and only discoverable by reading raw receipt topics.

#### Environment
- **Network:** Somnia mainnet (chainId 5031)
- **RPC:** `https://api.infra.mainnet.somnia.network`
- **Framework:** ethers v6 (v6.16.0), TypeScript 5.7
- **Pools verified:** WETH:USDso, SOMI:USDso, USDC.e:USDso, WBTC:USDso (all four mainnet SpotPool deployments)
- **Docs referenced:** https://docs.dreamdex.io/ → "Developers > Contracts" → `SpotPool.OrderPlaced` event signature

---

#### Steps to Reproduce

1. Take the documented `OrderPlaced` event signature with **two** indexed parameters:
   ```solidity
   event OrderPlaced(
     uint128 indexed orderId,
     address indexed owner,
     bool   isBid,
     uint8  orderType,
     uint256 price,
     uint256 quantity,
     uint64 expireTimestampNs
   );
   ```

2. Build the standard owner-filter and call `eth_getLogs`:
   ```typescript
   const ORDER_PLACED_TOPIC =
     "0xd90f62f61ee2f606b132cfdfd883ddd079228b6fd6bffd9d7cf848daf824639d";
   const ownerTopic = ethers.zeroPadValue(targetWallet, 32);
   const logs = await provider.getLogs({
     address: SPOTPOOL_ADDRESS,
     fromBlock: lookbackStart,
     toBlock: latest,
     // Per docs: topic1 = orderId, topic2 = owner
     topics: [ORDER_PLACED_TOPIC, null, ownerTopic],
   });
   ```

3. Inspect any real `placeTakerOrderWithoutVault` or `placeOrder` transaction's receipt with `eth_getTransactionReceipt` (no ABI decode — read raw `log.topics[]`).

#### Expected Behavior

Either:
- (A) The deployed contract emits `OrderPlaced` with both `orderId` AND `owner` as `indexed` topics (matching the documented signature), so a topic filter on `owner` returns all of that wallet's orders, OR
- (B) The docs reflect the actual on-chain reality: `owner` is **not** indexed and lives in the event's `data` payload.

#### Actual Behavior

The deployed contract emits `OrderPlaced` with **only one indexed topic**:
- `topic[0]` = event signature hash (`0xd90f62f6...`)
- `topic[1]` = `orderId` (uint128, packed into 32 bytes)
- **No `topic[2]`** — `owner` is in the `data` payload, not the topic array

A `topics: [ORDER_PLACED_TOPIC, null, ownerTopic]` filter therefore matches **zero events** for any wallet, even one that has placed thousands of orders.

Additionally, the `data` payload contains **8 32-byte slots (256 bytes)**, but the documented non-indexed fields (`isBid, orderType, price, quantity, expireTimestampNs`) account for only 5 slots — suggesting the deployed event has additional undocumented fields, and `slot[0]` of `data` duplicates the `orderId` already present in `topic[1]`.

Empirical data layout we observed:

| `data` slot | Contents (decoded) | Notes |
|---|---|---|
| 0 | `orderId` duplicate | matches `topic[1]` byte-for-byte |
| 1 | `isBid` (bool, lower byte) | `0x01` for BUY, `0x00` for SELL — confirmed across multiple txs |
| 2 | `owner` (address) | bottom 20 bytes — the field that **should have been `topic[2]`** |
| 3 | likely `userData` (uint64) | we observed `0` here for orders placed with `orderType = IOC`, so this slot is **not** `orderType` — the docs ABI position is wrong by at least one slot |
| 4 | `price` (uint256) | raw 18-decimal price — empirically matches the price-leg of the corresponding USDso settlement transfer |
| 5 | `quantity` (uint256) | raw quantity (base-token decimals) — empirically matches the qty-leg |
| 6 | `expireTimestampNs` (uint64, packed) | high confidence |
| 7 | unknown / undocumented | non-zero, content varies per tx (likely `orderType` + packed flags, since the docs would predict `orderType` somewhere in data and we have ruled out slot 3) |

The contract therefore emits at least **one undocumented non-indexed field** beyond the docs signature.

#### Logs / Evidence

Live mainnet tx from DreamTend's own genuine IOC engine — `placeTakerOrderWithoutVault` (selector `0x1c792779`) on the WETH:USDso pool. The same shape holds for any other `placeOrder` or `placeTakerOrderWithoutVault` tx we have inspected; this is one concrete reproducer that an auditor can replay end-to-end:

```
tx: 0x16a942045120e485d4aca437eba739c6d76d53349ec80840c632a8f43d1f6435
status: 1   gas: 465565
from:    0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86   (reporter wallet — DreamTend's registered wallet)
log[3] (OrderPlaced):
  address: 0xa936da11B57b50A344e1293AAaE5232885ea2bDE   (WETH:USDso pool)
  topic[0]: 0xd90f62f61ee2f606b132cfdfd883ddd079228b6fd6bffd9d7cf848daf824639d
  topic[1]: 0x00000000000000000000000000000000000000000000000200000000002a8f0b
  (no topic[2] — only TWO topics emitted; docs would predict a 3rd one with the owner)
  data (8 × 32-byte slots, 256 bytes):
    [0] 0x00000000000000000000000000000000000000000000000200000000002a8f0b  ← orderId duplicate
    [1] 0x0000000000000000000000000000000000000000000000000000000000000001  ← isBid = true (BUY)
    [2] 0x0000000000000000000000008f0a24ae910d4b89c4422b6884d71739dbc1ec86  ← owner (== `from`, == reporter wallet)
    [3] ... (orderType or userData — see note below)
    [4] ... (price)
    [5] ... (quantity)
    [6] ... (expireTimestampNs)
    [7] ... (undocumented 8th field)
```

Reproduce with our verification script (works on any `OrderPlaced` tx):

```bash
NETWORK=mainnet npx tsx scripts/dump-tx-topics.ts \
  0x16a942045120e485d4aca437eba739c6d76d53349ec80840c632a8f43d1f6435
```

The same structure (1 indexed topic + owner in data slot 2 + 8 data slots) appears on every other `OrderPlaced` log we have inspected — across all four mainnet pools and across both `placeOrder` (selector `0x4e978373`) AND `placeTakerOrderWithoutVault` (selector `0x1c792779`). The owner-in-data, 8-slot-data layout is **not pool-specific or function-specific** — it is the universal `OrderPlaced` emission shape on the current deployed SpotPool implementation.

#### Impact

- **Silent zero-result filter for every owner query.** Any indexer, dashboard, analytics tool, MEV bot, or audit script that wants to list "all orders placed by wallet X" via a topic filter — the canonical, gas-cheap eth_getLogs pattern — gets **zero matches**, with no error. There is no decode failure, no exception, just an empty result set.
- **Forced fallback to full-pool scan + client-side filter.** To find a wallet's orders without the indexed owner, the consumer must `getLogs` for **every** `OrderPlaced` event on the pool, then decode `data[2]` client-side. On an active pool this is **orders of magnitude more bandwidth, RPC load, and CPU**.
- **Breaks docs-driven decoders.** `ethers.Interface.parseLog()` instantiated from the documented ABI will throw or mis-decode, because it expects `owner` at `topic[2]` and the remaining non-indexed fields offset by one slot.
- **Cross-contamination of bug-class.** Combined with the additional undocumented 8th data slot, anyone decoding the event by position (e.g. assuming `price` is at `data[3]`) will be silently off-by-one. This is the same failure mode as Report 02 (where `tickSize` was wrongly read as `lotSize`).
- **Wasted analyst hours during integration / audit work.** Our reference repo initially concluded — incorrectly — that an arbitrary wallet whose orders we were trying to enumerate must be trading through a proxy contract, because the docs-driven owner-filter returned 0 events. Only by reading raw receipt topics did we discover the indexing mismatch. Other integrators (block explorers, dashboards, MEV bots, audit tooling) will hit the same dead-end.

#### Suggested Fix

Choose one of three resolutions (in order of preference):

1. **Update the docs** to reflect the deployed event signature exactly:
   ```solidity
   event OrderPlaced(
     uint128 indexed orderId,
     bool   isBid,
     address owner,
     uint8  orderType,
     uint256 price,
     uint256 quantity,
     uint64 expireTimestampNs,
     <undocumented 8th field — please name + describe>
   );
   ```
   Add a callout: "Note: `owner` is **not** indexed. To find a wallet's orders, scan all `OrderPlaced` events on the pool and filter `owner` client-side from `data` slot 2."

2. **Publish a canonical ABI artifact** (JSON or Typechain) alongside the docs, e.g. at `https://docs.dreamdex.io/abi/SpotPool.json`, so integrators can `import` the source-of-truth event signature instead of transcribing it. This would have prevented this issue entirely.

3. **Re-deploy `SpotPool`** with `owner` as `indexed` (matching the documented intent). Highest cost, but restores the natural eth_getLogs ergonomics; integrators expect "find orders by owner" to be a one-call query.

In all cases:
- **Document the 8th data slot.** What is it? `userData`? a sequence number? A maker reference? Without this, any consumer decoding by-position is silently wrong.
- **Add an integration example** to the docs showing the full `OrderPlaced` decode path — including the topic-vs-data layout — end-to-end in ethers v6 or viem.

#### Acceptance Criteria

This report would be resolved when:
- [ ] The Contracts docs page's `OrderPlaced` event signature matches the on-chain emission exactly (indexed vs non-indexed parameters AND total field count).
- [ ] A published ABI artifact (JSON or Typechain) is the canonical source consumers can import directly.
- [ ] At least one integration example demonstrates `eth_getLogs` + decode of `OrderPlaced` end-to-end, including how to recover `owner` from the current (or updated) layout.
- [ ] The previously-undocumented 8th `data` slot is named and described.

---

*Reported in good faith. The reference repository's `scripts/research-wallet.ts` initially hit this exact bug — its owner-topic filter returned zero events on every pool for a wallet known to be actively trading. The fix (move owner-filter to client-side data decoding) is now in the repo; this report exists so other integrators do not lose the same hours diagnosing a silent eth_getLogs filter mismatch.*

