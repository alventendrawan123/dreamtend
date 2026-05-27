# SKILL.md — DreamTend Operating Guide

> **Purpose:** Master reference for the DreamTend trading agent. Captures everything we know about DreamDEX, Somnia, the competition rules, and our architecture. Designed to be loaded by any future AI session (or new human collaborator) so work can resume from full context.

---

## 📑 Table of Contents

0. [**Architecture Mental Model** ⭐ (READ FIRST)](#0-architecture-mental-model)
1. [Project Identity](#1-project-identity)
2. [Competition Mission](#2-competition-mission)
3. [Network Reference Sheet](#3-network-reference-sheet)
4. [Tokens & Pools](#4-tokens--pools)
5. [API Endpoints](#5-api-endpoints)
6. [Smart Contract Interface](#6-smart-contract-interface)
7. [Order Placement Protocol](#7-order-placement-protocol)
8. [Event Schema](#8-event-schema)
9. [Yield Mechanics](#9-yield-mechanics)
10. [Stop Order Mechanics](#10-stop-order-mechanics)
11. [Strategy Library](#11-strategy-library)
12. [Gotchas & Pitfalls](#12-gotchas--pitfalls)
13. [Feedback Inventory](#13-feedback-inventory)
14. [Tech Stack & Dependencies](#14-tech-stack--dependencies)
15. [Project Structure](#15-project-structure)
16. [Phase Plan](#16-phase-plan)
17. [Operational Procedures](#17-operational-procedures)
18. [Submission Checklist (Day 7)](#18-submission-checklist-day-7)
19. [References](#19-references)
20. [Decision Log](#20-decision-log)

---

## 0. Architecture Mental Model

> **READ THIS FIRST.** Understand WHERE trading actually happens before touching any code.

### The 3-Layer Reality

DreamDEX is a **fully on-chain DEX** on the Somnia blockchain. Trading happens at the **smart contract layer**, not at any REST API. Understanding this prevents 90% of confusion.

```
┌────────────────────────────────────────────────────────────┐
│  LAYER 3 — CONVENIENCE                                     │
│  REST API: https://api.dreamdex.io/v0                      │
│  WebSocket: wss://api.dreamdex.io/v0/ws/public             │
│                                                            │
│  Purpose: market data reader, order preparation helper,    │
│           real-time event streams, SIWE auth.              │
│  Optional: bot can work WITHOUT this (use direct contract  │
│            calls instead) but it's slower + more code.     │
└──────────────────┬─────────────────────────────────────────┘
                   │ uses
                   ↓
┌────────────────────────────────────────────────────────────┐
│  LAYER 2 — GATEWAY                                         │
│  RPC: https://api.infra.mainnet.somnia.network             │
│                                                            │
│  Purpose: send transactions to the blockchain, read        │
│           blockchain state directly via eth_call.          │
│  MANDATORY: every order MUST be broadcast through here.    │
└──────────────────┬─────────────────────────────────────────┘
                   │ submits tx to
                   ↓
┌────────────────────────────────────────────────────────────┐
│  LAYER 1 — SOURCE OF TRUTH ⭐                              │
│  SOMNIA BLOCKCHAIN + SPOTPOOL SMART CONTRACTS              │
│                                                            │
│  USDC.e:USDso pool: 0x47fD2f18426f67106DBaC82F6d21D446c5F2120b
│  Holds: on-chain order book, vault balances, fills.        │
│                                                            │
│  ✨ THIS IS WHERE TRADING ACTUALLY HAPPENS ✨              │
│                                                            │
│  Leaderboard reads volume/PnL from blockchain events here. │
└────────────────────────────────────────────────────────────┘
```

### Trade Flow (One Order, End-to-End)

```
1. Bot decides: "buy 5 USDC.e @ 0.9999 USDso"
2. Bot reads market data         → REST API (optional, can use RPC)
3. Bot builds tx                  → REST API helper (or encode ABI manually via ethers.js)
4. Bot signs tx                   → local with private key (NEVER send to server)
5. Bot broadcasts signed tx       → Somnia RPC (MANDATORY)
6. Validator includes in block    → on-chain
7. SpotPool contract executes     → on-chain order book updated
8. OrderPlaced / OrderFilled event emitted → on-chain
9. Bot receives event via WS      → REST API WebSocket OR direct contract event subscription
10. Leaderboard updates volume    → reads blockchain events
```

### Where Trading Volume is Recorded

**ON THE BLOCKCHAIN.** Every fill emits an `OrderFilled` event from the SpotPool contract. The leaderboard at https://dreamdex-leaderboard-super-cool.vercel.app/ reads these events from chain. **The REST API does not track or affect leaderboard volume.**

### What Each URL Actually Does

| URL | What It Is | When You Need It |
|---|---|---|
| `https://api.infra.mainnet.somnia.network` | **Somnia RPC** — gateway to the blockchain | Every time bot broadcasts a tx or reads chain state. **MANDATORY.** |
| `https://api.dreamdex.io/v0` | **REST convenience API** — wraps order book, prepares unsigned tx, market data | Useful but optional. Bot can work without it via direct RPC + ethers.js. |
| `wss://api.dreamdex.io/v0/ws/public` | **WebSocket** — real-time feed (order book, trades, events) | Saves polling. Alternative: subscribe directly to contract events via RPC. |
| Smart Contract Addresses (e.g. `0x47fD...120b`) | **The actual trading venue** | Where placeOrder/cancelOrder/getBookLevels live. Source of truth. |

### "Can I Still Trade If REST API Goes Down?"

**YES.** REST API is convenience, not requirement. DreamDEX team confirmed this:
- Emre (2026-05-26): *"Update: REST API is ok, /trades is back"* — meaning API had outage, but trading on-chain didn't stop
- Anjali (kickoff): mentioned REST API + WebSocket + **smart contracts** as three independent integration paths

**Our bot uses BOTH layers for resilience:**
- **Primary path:** REST API for convenience (faster development, prepared txs)
- **Fallback path:** Direct contract calls via ethers.js + RPC (works even when API is down)

### Why This Matters for Strategy

1. **Volume counts on-chain, not via API** — so any path that successfully fills an order on-chain counts equally
2. **Multiple wallets allowed** — Emre confirmed AI agent wallets aggregate as "general" contribution. Architecture: registered wallet → contract/Agent Kit vault → multiple sub-wallets, all trading on same on-chain SpotPool
3. **API instability ≠ trading downtime** — bot must be robust enough to keep trading even when REST hiccups
4. **Direct contract path is the "true" agent path** — most aligned with Somnia's "agentic" thesis (autonomous on-chain agents that don't depend on centralized APIs)

---

## 1. Project Identity

| Field | Value |
|---|---|
| **Project Name** | DreamTend |
| **Tagline** | *Tending the order book on DreamDEX* |
| **Type** | Autonomous market-making trading agent |
| **Owner** | Alven Tendrawan (display name in alpha group) |
| **Trading Wallet** | `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86` |
| **MetaMask account label** | `AlvenSomniaDreamDexTester` |
| **Local workspace** | `D:\dreamtend\` |
| **GitHub repo** | `github.com/<user>/dreamtend` (TBD, public, MIT) |
| **Competition** | DreamDEX Alpha Trading Competition |
| **Phase** | Day 1 starts 2026-05-26 10:00 UTC |
| **Snapshot** | 2026-06-01 (Day 7) |

---

## 2. Competition Mission

### Headline Rules

- **1 week** active trading window
- **$50 USDso** equal starting capital — no top-ups, no transfers
- **One wallet per person**
- **Primary KPI:** Total trading volume (USDso)
- **Secondary metrics:** PnL, Tx count
- **Minimum 3 structured feedback reports** required
- **Bots and automation explicitly allowed and encouraged**
- **Mainnet only** (testnet is for practice only)

### Hidden Rules (from kickoff meeting transcript)

> "We won't consider like uh leaderboard based or contact based things. We will consider your effort and your tactics." — Emre Yıldız

- Final evaluation weights ~ **40% engineering effort, 25% volume, 15% feedback quality, 10% demo content, 10% Somnia primitive alignment**
- "You can create a Somnia agent based contract... You can take the funds, send them to your contract, make volume there, and after that push it to your wallet again to make your PnL high." — Emre
- "Code becomes getting-started content as well as demo content." — Anjali
- "Vibe coding [is] allowed... everything is allowed." — Anjali
- GitHub repo with demo product is REQUIRED, not optional

### PnL Formula (verified on leaderboard page)

```
PnL = current_USDso_balance - 50
```

→ Must liquidate all inventory back to USDso before Day 7 snapshot.

### Key People

| Person | Role | Contact |
|---|---|---|
| Anjali Singh | DevRel coordinator | Telegram `@AnjaliOnChain` |
| Emre Yıldız (emrey.somi) | DevRel + technical Q&A + wallet reg | Telegram `@emreyeth` |
| Tom & Dave | Engineering support | Via group |
| Paul | Activity oversight | Via group |

---

## 3. Network Reference Sheet

### Mainnet (PRIMARY — competition runs here)

```
Chain ID:      5031
Currency:      SOMI
RPC:           https://api.infra.mainnet.somnia.network
Explorer:      https://explorer.somnia.network
Settlement:    USDso (Frax-backed stablecoin via LayerZero)
Gas:           Sponsored on SOMI + stablecoin pairs; negligible on others
Fee model:     0% maker, 0% taker
```

### Testnet (Shannon — for dry-run only)

```
Chain ID:      50312
Currency:      STT (treated as native SOMI by contracts)
RPC:           https://dream-rpc.somnia.network
Explorer:      https://shannon-explorer.somnia.network
Faucet:        https://testnet.somnia.network/
Alt faucet:    https://stakely.io/faucet/somnia-testnet-stt
```

### MetaMask Setup (already complete)

```typescript
const NETWORKS = {
  mainnet: {
    chainId: 5031,
    rpc: "https://api.infra.mainnet.somnia.network",
    symbol: "SOMI",
  },
  testnet: {
    chainId: 50312,
    rpc: "https://dream-rpc.somnia.network",
    symbol: "STT",
  },
};
```

---

## 4. Tokens & Pools

### Token Addresses

**Mainnet**

| Token | Address | Decimals |
|---|---|---|
| **USDso** | `0x00000022dA000002656c64D9eA6011ea952D008A` | 18 |
| SOMI (ERC20) | `0x28f34DeFd2b4CB48d9eE6d89f2Be4Bc601694c00` | 18 |
| WETH | `0x936Ab8C674bcb567CD5dEB85D8A216494704E9D8` | 18 |
| **USDC.e** | `0x28BEc7E30E6faee657a03e19Bf1128AaD7632A00` | **6** |
| WBTC | `0xC5098b3cA516784323872F17235fa074E167D3D2` | **8** |

**Testnet (Shannon)**

| Token | Address | Decimals |
|---|---|---|
| **USDso** | `0x9c32F3827A1a99f0cf9B213de8b53eC3d57bb171` | 18 |
| SOMUSD (legacy — ignore) | `0x02B8316775057E2096471473663D51CeAfBE3e3b` | 6 |
| SOMI | `0x28f34DeFd2b4CB48d9eE6d89f2Be4Bc601694c00` | 18 |
| WETH | `0x4d8E02BBfCf205828A8352Af4376b165E123D7b0` | 18 |
| WBTC | `0x4e85DC48a70DA1298489d5B6FC2492767d98f384` | 8 |

### Spot Pools (matching engine contracts)

**Mainnet**

| Pair | Pool Address | Tick | Lot | minQty |
|---|---|---|---|---|
| SOMI:USDso | `0x035De7403eac6872787779CCA7CCF1b4CDb61379` | 0.0001 | 0.01 | 1 |
| **USDC.e:USDso** ⭐ | `0x47fD2f18426f67106DBaC82F6d21D446c5F2120b` | 0.0001 | 0.01 | 1 |
| WBTC:USDso | `0x25bfF6B7B5E2243424F38E75de7ab03C0522a5EA` | 0.1 | 0.00001 | 0.0001 |
| WETH:USDso | `0xa936da11B57b50A344e1293AAaE5232885ea2bDE` | 0.01 | 0.0001 | 0.001 |

⭐ = primary MM target (stablecoin pair → tightest spread → highest volume potential)

**Testnet (USDso-quoted only — ignore SOMUSD pools)**

| Pair | Pool Address |
|---|---|
| SOMI:USDso | `0x259fD6559214dd5aD3752322426eA9F9fABEFff4` |
| WBTC:USDso | `0x3605f28aA7C50e7441211e77Cb0762d49539326C` |
| WETH:USDso | `0xD180195da5459C7a0DEA188ed61216ec43682b50` |

### Stop Order Registries

**Mainnet**

| Pair | Registry |
|---|---|
| SOMI/USDso | `0x68c8f6fb1EA19A28F25358Ff00b8Ed8E1216df30` |
| USDC.e/USDso | `0xD53E3F3b73513F2147377ef8f573f649cF60100c` |
| WBTC/USDso | `0xed32F048D6a47923D38eCeD868d6f8b0eB4852bd` |
| WETH/USDso | `0x9653a7355849B7691802A6AA49fDe18eF5ba633d` |

**Testnet**

| Pair | Registry |
|---|---|
| SOMI/USDso | `0xEb97349Aa62A68507c0bE535eD88B0d028a47E1e` |
| WBTC/USDso | `0x53d5B2b0791b3992a1F3b5e0b0277Ee2e08B7aaD` |
| WETH/USDso | `0xf822D4Cb94902d667c9650e702aA5f096cc7598F` |

### Critical Notes

- ⚠️ **USDC.e:USDso is MAINNET-ONLY** — testnet dry-run must use SOMI:USDso or WETH:USDso
- ⚠️ On `SOMI:USDso` pool, **SOMI is the chain's NATIVE token** — use `depositNative()` with `msg.value`, not standard `deposit(token, amount)`
- ⚠️ Quote decimals matter: USDC.e is 6 decimals — different from USDso (18)

---

## 5. API Endpoints

### REST (Mainnet)
```
Base URL:        https://api.dreamdex.io/v0
Auth:            POST /auth/nonce → POST /auth/login (SIWE) → JWT bearer
Markets:         GET /markets
Order book:      GET /orderbooks?symbols=USDC.e:USDso
Recent trades:   GET /markets/{symbol}/trades
Ticker:          GET /markets/{symbol}/tickers
Candles:         GET /markets/{symbol}/candles?interval=1m
Place order:     POST /markets/{symbol}/orders   (returns unsigned tx + optional approval)
Get order:       GET /markets/{symbol}/orders/{id}
List orders:     GET /markets/{symbol}/orders?status=open
Cancel order:    DELETE /markets/{symbol}/orders/{id}
Vault approve:   POST /markets/{symbol}/vault/approve
Vault deposit:   POST /markets/{symbol}/vault/deposit
```

### WebSocket (Mainnet)
```
URL:             wss://api.dreamdex.io/v0/ws/public
Subscribe:       {"operation":"subscribe","channel":"orderbook","params":{"symbols":["USDC.e:USDso"]}}
Channels:        orderbook | ohlcv | trades | order (auth req unclear)
Heartbeat:       Client sends {"operation":"ping"} every 30s
Timeout:         Server closes after 60s inactivity
```

### REST (Testnet)
```
Base URL:        https://stg.api.dreamdex.io  ← note 'stg' prefix
WebSocket:       wss://stg.api.dreamdex.io/v0/ws/public
```
"Same paths/payloads as mainnet, only the host changes." — Emre

### Other
- **Leaderboard:** https://dreamdex-leaderboard-super-cool.vercel.app/
- **Trading UI (gated):** https://app.dreamdex.io/ (401 until whitelisted)
- **CCXT TS fork:** `npm install github:somnia-chain/ccxt#add-dreamdex-exchange` (alpha)
- **Somnia Agent Kit:** `npm install somnia-agent-kit`
- **CLI:** `go install github.com/somnia-chain/somnia-dex-cli/cmd/dreamdex@latest`
- **MCP server URL:** ❌ promised but not published (feedback item #3)

---

## 6. Smart Contract Interface

### SpotPool — Core Functions

```solidity
// Place order using vault-funded balance (supports all order types)
function placeOrder(
  bool isBid,
  uint64 userData,
  uint256 price,
  uint256 quantity,
  uint64 expireTimestampNs,    // ⚠️ MUST be > now; 0 is REJECTED
  OrderType orderType,         // 0=NormalOrder, 1=FillOrKill, 2=IOC, 3=PostOnly
  SelfMatchingOption selfMatchingOption,
  address builder,             // ⚠️ MUST be address(0) in v1.0
  uint96 builderFeeBpsTimes1k  // ⚠️ MUST be 0 in v1.0
) external returns (bool success, OrderId orderId);

// Place IOC/FOK order using wallet-funded balance
function placeTakerOrderWithoutVault(...) external returns (bool success, OrderId orderId);

// Cancel order
function cancelOrder(OrderId orderId) external;

// Vault operations
function deposit(address token, uint256 amount) external;
function depositNative() external payable;    // For SOMI on SOMI:USDso pool
function withdraw(address token, uint256 amount) external;
function approve(address spender, uint256 amount) external;

// View functions
function getPoolParams() external view returns (
  address poolToken,
  address baseToken,
  address quoteToken,
  uint256 makerFeeBpsTimes1k,    // 0 in v1.0
  uint256 takerFeeBpsTimes1k,    // 0 in v1.0
  uint256 tickSize,
  uint256 lotSize,
  uint256 minQuantity
);
function getOrder(uint128 orderId) external view returns (Order memory);
function getBookLevels(bool isBid, uint8 depth) external view returns (uint256[] memory prices, uint256[] memory sizes);
function getOwnOpenOrders(address account) external view returns (uint128[] memory);
function getWithdrawableBalance(address account, address token) external view returns (uint256);
```

### SpotStopOrderRegistry — Functions

```solidity
function somiPaymentPerOrder() external view returns (uint256);   // ⚠️ DYNAMIC, read before each call

function createPendingOrder(
  PendingOrderWithTrigger calldata pendingOrder
) external payable returns (OrderId);  // ⚠️ msg.value must equal somiPaymentPerOrder() EXACTLY

function cancelPendingOrder(uint128 orderId) external;  // Refunds SOMI
function claimSomi() external;                          // Claim unclaimed refunds
```

### Enums

```solidity
enum OrderType {
  NormalOrder,        // = 0 = GTC (Good-Till-Cancelled)
  FillOrKill,         // = 1
  ImmediateOrCancel,  // = 2 (IOC)
  PostOnly            // = 3
}

enum SelfMatchingOption {
  // REST API maps: cancelTaker (default) | cancelMaker
  // Smart contract values: NOT DOCUMENTED (feedback item #14)
}

// Stop order trigger
enum TriggerOperator {
  GTE = 0,    // ≥ threshold
  LTE = 1     // ≤ threshold
}

// Stop order type
enum StopOrderType {
  LIMIT  = 0,   // limitPrice required, tick-aligned
  MARKET = 1    // limitPrice MUST be 0 (auto-calculated from slippage)
}
```

---

## 7. Order Placement Protocol

### Verified Workflow (Direct Contract Calls)

```typescript
async function placeMarketMakingOrder(side: "bid" | "ask", price: bigint, qty: bigint) {
  // 1. Verify liquidity exists on opposite side
  const [prices, sizes] = await pool.getBookLevels(side === "bid" ? false : true, 5);
  if (prices.length === 0) throw new Error("Empty book — abort");

  // 2. Build expire timestamp (NEVER 0)
  const expireNs = BigInt(Date.now()) * 1_000_000n + 3600n * 1_000_000_000n; // now + 1h in ns

  // 3. Simulate via eth_call
  const [success, orderId] = await pool.callStatic.placeOrder(
    side === "bid",
    0n,                              // userData
    price,                           // priceRaw, NEVER 0
    qty,                             // multiple of lotSize, ≥ minQty
    expireNs,
    3,                               // PostOnly
    0,                               // cancelTaker (default)
    ethers.ZeroAddress,              // builder — must be 0 in v1.0
    0n                               // builderFeeBpsTimes1k — must be 0 in v1.0
  );
  if (!success) throw new Error("Simulation failed — skip broadcast");

  // 4. Broadcast
  const tx = await pool.placeOrder(/* same args */);
  const receipt = await tx.wait();

  // 5. Verify OrderPlaced event (silent rejection check)
  const event = receipt.logs.find(l => l.topics[0] === ORDER_PLACED_TOPIC);
  if (!event) throw new Error("Silent rejection — no OrderPlaced event");

  return orderId;
}
```

### Verified Workflow (REST API)

```typescript
async function placeOrderViaRest(side, price, qty) {
  // 1. SIWE auth (once per session)
  const nonce = await fetch("/v0/auth/nonce").then(r => r.json());
  const siweMsg = buildSiweMessage(nonce);
  const signature = await wallet.signMessage(siweMsg);
  const { jwt } = await fetch("/v0/auth/login", {
    method: "POST",
    body: JSON.stringify({ message: siweMsg, signature })
  }).then(r => r.json());

  // 2. Prepare order
  const prep = await fetch("/v0/markets/USDC.e:USDso/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      type: "limit",
      side,           // "buy" or "sell"
      price: price.toString(),
      amount: qty.toString(),
      fundingSource: "vault",
      orderType: "postOnly"
    })
  }).then(r => r.json());
  // Response: { to, data, value, chainId, approval? }

  // 3. Handle approval if needed
  if (prep.approval) {
    const approveTx = await wallet.sendTransaction({
      to: prep.approval.token,
      data: encodeApproveCall(prep.to, prep.approval.amount)
    });
    await approveTx.wait();
  }

  // 4. Simulate
  const simResult = await provider.call({ to: prep.to, data: prep.data, value: prep.value });
  if (!parseSimResult(simResult).success) throw new Error("Sim failed");

  // 5. Broadcast
  const tx = await wallet.sendTransaction(prep);
  const receipt = await tx.wait();

  // 6. Verify OrderPlaced event
  // ... same as above
}
```

---

## 8. Event Schema

Subscribe to these via WebSocket or watch via contract event filters.

| Event | Indexed args | Non-indexed args | Trigger |
|---|---|---|---|
| `OrderPlaced` | orderId | placedOrder struct | Every accepted order |
| `OrderRested` | orderId | — | Order rests on book |
| **`OrderFilled`** | takerOrderId, makerOrderId | quantityFilled, takerRemaining, makerRemaining | **Match** |
| `OrderCancelled` | orderId | — | Owner cancels |
| `OrderExpired` | orderId | — | Auto-expired |
| `OrderReduced` | orderId | newQuantity | Partial reduction |
| **`MarkPriceUpdated`** | asset | markPrice (EMA), rawMidpoint | **Re-quote trigger** |
| `PendingOrderCreated` | orderId | pending struct | Stop order placed |
| `PendingOrderTriggered` | orderId | resultOrderId | Stop fires |
| `PendingOrderCancelled` | orderId | — | Stop cancel |

### Bot Reactive Pattern

```
MarkPriceUpdated → cancel stale orders → post new bid+ask at fresh mid
OrderFilled (bid side) → inventory↑ → post tighter ask
OrderFilled (ask side) → inventory↓ → post tighter bid
OrderExpired → re-post automatically
```

---

## 9. Yield Mechanics

### Formula (Gaussian Proximity)

```
W = e^(-(P_order - P_mid)² / (2 × σ²))
```

### Three Weighting Factors

1. **Notional value** — larger orders earn more
2. **Time in book** — longer rest earns more
3. **Proximity to mid-price** — Gaussian distance penalty

### Settlement

- Settled periodically to user's margin sub-account in USDso
- Funded by yield on resting collateral (NOT taken from trade fees)
- ⚠️ **σ value, snapshot frequency, eligibility (post-only? min size?), early-cancel penalty: NOT documented** (feedback items #6-#8)

### Bot Implication

To maximize yield while still generating volume:
- Use **slightly larger** orders than minQty (notional matters)
- Place orders **close to mid-price** (Gaussian peak)
- Hold orders **30-60 seconds** before re-quoting (time-in-book accumulation)
- Don't churn cancel-replace every block — let orders rest

---

## 10. Stop Order Mechanics

### Cost Model
- `somiPaymentPerOrder()` returns current price in SOMI (DYNAMIC — read before each call)
- Default observed: 0.1 SOMI per pending order
- `msg.value` must EQUAL this exactly (over/under → `InsufficientSomiPayment` revert)
- Cancellation refunds full SOMI (or credits to unclaimed balance)
- Trigger consumes SOMI whether fill succeeds or not

### Trigger Mechanics
- Uses EMA-smoothed `markPrice` (NOT raw midpoint) for triggering
- EMA advances at most 1 step per `updateIntervalSec` — anti-manipulation
- Somnia on-chain reactivity fires the IOC order in the same block as the trigger
- One-shot: cannot re-trigger
- Failed fills don't block other stops in same batch

### Strategy Note
**Avoid stops for primary MM strategy** — the 0.1 SOMI cost adds up fast. Reserve stops for risk management on momentum positions (not bread-and-butter MM).

---

## 11. Strategy Library

### 1. Primary: USDC.e:USDso Market Maker (70% capital)

**Goal:** Maximum volume via stablecoin-pair MM. Smallest spread = lowest cost per round-trip.

**Logic:**
```
on MarkPriceUpdated:
  mid = event.rawMidpoint
  bidPx = mid - 1 tick      (= mid - 0.0001 USDso)
  askPx = mid + 1 tick      (= mid + 0.0001 USDso)
  qty   = 5 USDC.e          (~$5 per leg, > minQty=1, decent notional)

  cancel orders if their price diverged > 2 ticks from new mid
  ensure exactly 1 bid + 1 ask resting at new prices

on OrderFilled:
  immediately re-post the filled side at new optimal price
```

**Expected:** With $35 USDC.e (70% of $50), at $5 per leg, ~7 cycles capital per round-trip. Spread cost ~0.02% per cycle. Volume potential: 30-50× capital per day = ~$300-500/day → ~$2k-3.5k/week.

### 2. Secondary: SOMI:USDso Market Maker (20% capital)

**Goal:** Diversification + capture SOMI price exposure if trending favorably.

**Logic:** Same as #1 but wider spread (volatile pair).

```
bidPx = mid × (1 - 0.0010)   (10 bps below mid)
askPx = mid × (1 + 0.0010)   (10 bps above mid)
qty   = 5 SOMI               (~$0.85)
```

**Risk:** SOMI can swing 5%+ in a day. Hold inventory at end → loss vs USDso.

### 3. Tertiary: Momentum Chaser (5% capital, optional)

**Goal:** When MarkPrice moves > 50 bps in 1 minute, fire IOC taker order in direction of move.

**Logic:**
```
if mid_now / mid_60s_ago > 1.005:
  IOC buy on SOMI:USDso for 0.5 USDC.e
if mid_now / mid_60s_ago < 0.995:
  IOC sell on SOMI:USDso for 0.5 SOMI
```

**Purpose:** Generate volume during big moves + showcase strategy variety.

### 4. Inventory Rebalancer (5% buffer)

**Goal:** Auto-correct inventory imbalance when one side fills more than the other.

**Logic:**
```
if abs(USDC.e_balance - target_USDC.e) > 2 USDC.e:
  market order to rebalance (small size, IOC)
```

### 5. Day-7 Liquidator (special mode, fires at T-2h)

**Goal:** Liquidate all non-USDso inventory back to USDso before snapshot.

**Logic:**
```
at 2026-06-01T08:00:00Z:
  cancel all open orders
  for each non-USDso token in inventory:
    place IOC sell at best bid (accept slippage)
  log final USDso balance for PnL submission
```

### 6. LLM Meta-Decisions (Ollama llama3.2 local)

**Goal:** Strategy-level decisions, not per-tick. Demo "AI-driven" narrative.

**Examples of LLM queries:**
- "Mark price moved 2% in 10 min on SOMI:USDso. Should we pause MM or widen spread? Respond JSON: {action: 'pause'|'widen'|'continue', spreadBps: number, reason: string}"
- "Current PnL is -$3. Volume target $1k/day not being hit. Adjust strategy mix. Respond JSON: {newWeights: {USDC.e: 0.X, SOMI: 0.Y, ...}}"

**Triggered:** Every 15 minutes, or on regime change detected (volatility spike).

**Cache:** Cache LLM responses for similar contexts (cost-free since local).

---

## 12. Gotchas & Pitfalls

⚠️ **Always bake these into code:**

### Order Placement

1. **`expireTimestampNs=0` is REJECTED** — set to `now + 1h` in nanoseconds
2. **`priceRaw=0` is LITERAL** — does NOT mean "market price"; order won't cross, gas wasted
3. **Builder codes must be `address(0)` and `0` in v1.0** — disabled but still required in signature
4. **USDso has 18 decimals** (Oderah: `priceRaw=170700000000000000` for `0.1707 USDso`)
5. **USDC.e has 6 decimals** — different from USDso! Handle conversion carefully
6. **Market buy + wallet funding is UNSUPPORTED** — REST returns 400 silently
7. **0-sentinel inconsistency lintas function:** `priceRaw=0` literal | `expireNs=0` rejected | `limitPrice=0` REQUIRED for stop MARKET

### Verification

8. **Always `eth_call` simulate** before broadcasting — abort if returns `(false, 0)`
9. **Always verify `OrderPlaced` event** in tx receipt — silent rejection possible even after sim passes
10. **Always check `getBookLevels` first** before placing taker orders — testnet book is intermittent

### Silent Rejection Scenarios (sim passes, execution fails)
- Expired order at execution time
- Self-trade hit (if SelfMatchingOption = cancel)
- PostOnly order that would immediately cross book
- FillOrKill that can't fill 100%
- IOC with no resting liquidity

### Funding Sources

11. **`placeTakerOrderWithoutVault`** = wallet-funded path, IOC/FOK only
12. **For PostOnly / GTC / Stop** → must use vault, call `deposit()` or `depositNative()` first
13. **SOMI native handling on SOMI:USDso pool** — use `depositNative()` with msg.value, not ERC20 deposit

### WebSocket

14. **Send `{"operation":"ping"}` every 30s** — server closes after 60s inactivity
15. **`order` channel auth requirements unclear** — public WS but personal order tracking may need session

### Stop Orders

16. **`somiPaymentPerOrder()` is DYNAMIC** — read before every call, can change
17. **`msg.value` must equal exactly** — over/under both revert

### Contract Pool Params

18. **`getPoolParams()` returns 7 values, not 4** — docs may be outdated; includes maker/taker fee fields (0 in v1.0)

### Off-chain Coordination

19. **PDF AI meeting notes inaccurate** — Gemini misheard "$50" as "$550"
20. **Notion rules page has stale leaderboard URL** — use `dreamdex-leaderboard-super-cool.vercel.app/`

---

## 13. Feedback Inventory

23 items identified. Top 5 chosen for submission:

| # | Title | Severity | Type |
|---|---|---|---|
| 1 | **AGENTS.md / SKILL.md / MCP server URL missing** — promised but 404 | Critical | Doc gap + arch |
| 2 | **Testnet onboarding gap** — zero faucet/swap docs for USDso testnet | High | Doc gap |
| 3 | **Market buy + wallet funding** silently returns 400 | High | Bug |
| 4 | **0-sentinel inconsistency** across function signatures (priceRaw / expireNs / limitPrice) | High | Bug + doc |
| 5 | **Doc QA process** — Notion stale URL + PDF AI notes misheard $50 as $550 | Medium | Internal QA |

### Full inventory (23)

1. AGENTS.md returns 404
2. SKILL.md returns 404
3. MCP server URL not published in docs
4. CCXT npm package not published; install only via GitHub branch
5. CCXT bindings TypeScript-only (no Python/Go/PHP)
6. Yield σ calibration not documented
7. Yield snapshot frequency not documented
8. Yield eligibility criteria not documented
9. Some doc sub-pages 404 (e.g., quick-start without `.md`)
10. Market buy + wallet funding silently fails (HTTP 400)
11. `expireTimestampNs=0` rejected despite docs implying it means no expiry
12. `priceRaw=0` does not behave as "market price"
13. Builder codes disabled at v1.0 but signature still demands them
14. `SelfMatchingOption` enum values not documented (smart contract side)
15. `markPrice` EMA window length not documented
16. PDF AI meeting notes inaccurate ($550 vs $50)
17. WS "order" channel auth requirement unclear
18. `somiPaymentPerOrder` documented as "0.1 SOMI" without dynamic warning
19. 0-sentinel inconsistency (priceRaw, expireNs, limitPrice all behave differently)
20. Testnet section: zero onboarding info (no faucet, no swap guide, no docs)
21. Notion rules page has stale leaderboard URL
22. Spot trading page has thin content (no walk-through examples)
23. `getPoolParams` returns 7 fields not 4 (docs outdated)

---

## 14. Tech Stack & Dependencies

### Locked Stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript (strict) | Aligned with DreamDEX official tooling |
| Runtime | Node.js 18+ (20 ideal) | LTS, native ES modules |
| Package manager | npm | Default, no extra setup |
| EVM library | ethers v6 | Mature, widely used |
| DreamDEX trading | CCXT TS fork | Official DEX-supported binding |
| Agent framework | Somnia Agent Kit | Native agent registry + vault + monitoring |
| LLM | Ollama (llama3.2 local) | Free, private, hybrid pattern |
| Process manager | PM2 | 24/7 reliability |
| Testing | Vitest | Fast, TS-native |
| Linting | ESLint + Prettier | Standard |
| Logging | pino + CSV writer | Structured + auditable |

### Dependencies (planned)

```json
{
  "dependencies": {
    "ethers": "^6.13.0",
    "ws": "^8.18.0",
    "somnia-agent-kit": "latest",
    "ccxt": "github:somnia-chain/ccxt#add-dreamdex-exchange",
    "pino": "^9.5.0",
    "node-fetch": "^3.3.2",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.13",
    "vitest": "^2.1.0",
    "tsx": "^4.19.0",
    "pm2": "^5.4.0"
  }
}
```

---

## 15. Project Structure

```
dreamtend/
├── README.md                       # Public-facing pitch + setup
├── SKILL.md                        # This file
├── LICENSE                         # MIT
├── .env.example                    # Template env vars
├── .gitignore
├── package.json
├── tsconfig.json
├── ecosystem.config.js             # PM2 config for 24/7
│
├── src/
│   ├── index.ts                    # Entry — orchestrator boot
│   ├── config/
│   │   ├── network.ts              # Mainnet/testnet switching
│   │   ├── pairs.ts                # Pool addresses + market params
│   │   ├── tokens.ts               # Token addresses + decimals
│   │   └── constants.ts            # Magic numbers (tick, spreads)
│   │
│   ├── agent/
│   │   ├── registry.ts             # Somnia Agent registration
│   │   ├── vault.ts                # Agent Kit vault interaction
│   │   └── monitoring.ts           # Telemetry + dashboard URL
│   │
│   ├── dex/
│   │   ├── ccxt-client.ts          # DreamDEX CCXT wrapper
│   │   ├── contracts.ts            # ethers.js pool + registry handles
│   │   ├── websocket.ts            # WS subscribe + reconnect
│   │   ├── auth.ts                 # SIWE login → JWT
│   │   └── safe-broadcast.ts       # eth_call sim + event verify
│   │
│   ├── strategies/
│   │   ├── base.ts                 # Strategy interface + lifecycle
│   │   ├── market-maker.ts         # Primary MM logic
│   │   ├── momentum.ts             # Taker on volatility
│   │   ├── rebalancer.ts           # Inventory fix
│   │   └── day7-liquidator.ts      # End-of-comp settle
│   │
│   ├── llm/
│   │   ├── ollama-client.ts        # Local Ollama HTTP client
│   │   └── decision-engine.ts      # Strategy-switching meta-logic
│   │
│   ├── orchestrator.ts             # Coordinator across strategies
│   │
│   └── utils/
│       ├── logger.ts               # Pino + CSV trade log
│       ├── gotchas.ts              # Helpers: validateExpireNs, etc.
│       ├── decimals.ts             # Token decimal conversions
│       └── price.ts                # Tick alignment, BPS calcs
│
├── contracts/                      # (Optional v2 — Solidity layer)
│   └── DreamTendAgent.sol
│
├── docs/
│   ├── ARCHITECTURE.md             # Diagram + explanation
│   ├── STRATEGIES.md               # Each strategy explained
│   ├── api-gotchas.md              # The 20 gotchas as guide
│   ├── DEMO.md                     # Demo flow + screenshots
│   └── feedback/
│       ├── 01-agents-skill-mcp-missing.md
│       ├── 02-testnet-onboarding-gap.md
│       ├── 03-market-buy-wallet-bug.md
│       ├── 04-sentinel-inconsistency.md
│       └── 05-doc-qa-process.md
│
├── scripts/
│   ├── register-agent.ts           # One-time registration
│   ├── deposit-vault.ts            # Move USDso to vault
│   ├── inventory.ts                # Check balances
│   └── liquidate-final.ts          # Day-7 settle
│
└── tests/
    ├── strategy-backtest.ts        # Simulate strategies
    └── testnet-dry-run.ts          # Live test on Shannon
```

---

## 16. Phase Plan

| Phase | Goal | Status | Est. Time |
|---|---|---|---|
| 1. Setup | Repo + deps + env | ⏳ Pending | 30 min |
| 2. Foundation | Network/pair config + DreamDEX client | ⏳ Pending | 2h |
| 3. MVP Bot | Single MM on testnet (SOMI:USDso) | ⏳ Pending | 3h |
| 4. Mainnet Live | Switch to mainnet, single strategy live | ⏳ Pending | 1h |
| 5. Multi-strategy | Add secondary MM + momentum + rebalancer | ⏳ Pending | 3h |
| 6. LLM Layer | Ollama integration + decision engine | ⏳ Pending | 2h |
| 7. Agent Kit | Register on-chain as Somnia Agent | ⏳ Pending | 1.5h |
| 8. Observability | Logger + CSV + dashboard | ⏳ Pending | 2h |
| 9. Feedback Reports | 5 detailed reports in `docs/feedback/` | ⏳ Pending | 2h |
| 10. Polish | README, demo gif/video, comments | ⏳ Pending | 2h |
| 11. Day-7 Liquidation | Run liquidator + final snapshot | ⏳ Pending | 30 min |
| 12. Submission | Google Doc master compile | ⏳ Pending | 1h |

**Total estimated active dev:** 20-22 hours across 6.5 days = ~3-4 hours/day average.

---

## 17. Operational Procedures

### Daily Routine (during competition)

1. **Morning (5 min):** Check leaderboard rank + bot uptime
2. **Mid-day (10 min):** Review fill rate + adjust spreads if needed
3. **Evening (15 min):** Log session notes + capture any bugs encountered
4. **Before sleep (5 min):** Confirm bot still running via PM2

### Emergency Procedures

**If bot crashes:**
```powershell
pm2 logs dreamtend --lines 100        # Diagnose
pm2 restart dreamtend                  # Restart
```

**If wallet drained unexpectedly:**
1. Stop bot: `pm2 stop dreamtend`
2. Check tx history on explorer
3. Identify last good state
4. Report to Emre via Telegram immediately

**If API down:**
1. Check status by curl: `curl https://api.dreamdex.io/v0/markets`
2. Fall back to direct contract calls (REST is convenience, contracts are source of truth)
3. Ping group chat for confirmation

### Pre-flight Checklist (Before Going Live)

- [ ] `.env` populated with private key (never commit!)
- [ ] `.env` in `.gitignore`
- [ ] Connected to correct network (verify chainId)
- [ ] Vault has been approved + deposited
- [ ] Test order placed + cancelled successfully on testnet
- [ ] PM2 ecosystem config tested
- [ ] CSV log writing correctly
- [ ] WS heartbeat verified
- [ ] All gotchas accounted for in code

---

## 18. Submission Checklist (Day 7)

Due 2026-06-01 (snapshot time TBD by team — likely 10:00 UTC).

### Required Deliverables

- [ ] Wallet liquidated to USDso (PnL = current balance - 50)
- [ ] GitHub repo `dreamtend` public, polished
  - [ ] README with overview + setup + demo gif
  - [ ] LICENSE (MIT)
  - [ ] Architecture diagram
  - [ ] Strategy explanations
  - [ ] api-gotchas.md
- [x] 3+ feedback reports submitted (target: 5, **actual: 13** polished — see `docs/feedback/`)
- [ ] Master Google Doc compiled with:
  - Section A: Bot architecture
  - Section B: Feedback reports
  - Section C: Code snippets + screenshots
  - Section D: GitHub link

### Nice-to-have

- [ ] Demo video (Loom or YouTube unlisted)
- [ ] Twitter thread tagging @DreamDEXSomnia
- [ ] Open-source notebook with backtest results
- [ ] DM Anjali + Emre with personal note

---

### Day-6 Demo Checklist (Phase 10 — 2026-05-31)

> Source of truth untuk demo artifacts. Section C dari `docs/SUBMISSION_DRAFT.md` adalah target final.
> Mirror dari memory `project_demo_checklist.md` + `plan.md` Day 6.

**Wajib (Hard requirement):**

- [ ] **Screenshot leaderboard rank progression** (3-4 frame):
  - Rank 5 (Day 1, $2.50 vol) — kalau masih bisa di-capture
  - Rank 4 (Day 2 mid, ~$531 vol)
  - Rank 2 → 1 (Day 2 sore, breakthrough moment)
  - Rank 1 dengan lead $2,500+ (current state)
- [ ] **Screenshot explorer wallet** showing:
  - Tx count 2148+
  - USDso balance
  - Recent IOC transactions list
- [ ] **Sample TX detail screenshots** (1-2):
  - First placeOrder `0x79d4b340ad448571a5b7ea461d33ebff81128c67e124700cff636bfd08157dcf` — bukti pertama berfungsi
  - Latest IOC-taker — bukti pattern berhasil

**Nice-to-have (boost narrative):**

- [ ] **Bot console screenshot** — running cycle log dengan `[SIM OK]`, `[BROADCAST]`, `[FILLED]` lines berurutan. Bukti safety pattern bukan kata-kata.
- [ ] **Architecture diagram** — already di `README.md`, tapi bisa di-export jadi PNG terpisah untuk Google Doc.
- [ ] **Loom video 2-3 menit** (optional tapi powerful):
  - (0:00-0:30) intro: "DreamTend, multi-agent IOC bot"
  - (0:30-1:30) screen-record bot running 5-10 cycles live
  - (1:30-2:30) leaderboard tab + explorer tab side-by-side
  - Voiceover singkat — yang penting visual nya
- [ ] **Sweep evidence** (post Day-7):
  - Before sweep: vault balances dari `check-all-vaults.ts` output
  - After sweep: wallet USDso jump
  - Final PnL realized

**Yang sudah otomatis terdokumentasi (tidak perlu kerja manual):**

- `docs/run-logs/` — kalau ada log files
- Git commit history (sudah CI-clean)
- TX hashes (sudah di-embed di draft)

---

## 19. References

### Documentation
- **Canonical docs:** https://docs.dreamdex.io/ld25g222WKDrLlJMcR41/  (custom domain)
- **Gitbook host alias:** https://metaversal.gitbook.io/dex/ld25g222WKDrLlJMcR41  (307 redirects to canonical — Anjali's welcome message uses this older URL; bookmark the canonical)
- DreamDEX docs (token B variant): https://docs.dreamdex.io/uK9H3quGFeuU9dyKOiCH/
- DreamDEX full text dump: https://docs.dreamdex.io/ld25g222WKDrLlJMcR41/llms-full.txt
- Somnia network docs: https://docs.somnia.network
- Somnia Agentic L1 thesis: https://blog.somnia.network/p/somnia-the-agentic-l1-blockchain

### Competition Resources
- Notion rules: https://somniachain.notion.site/DreamDEX-Alpha-Trading-Competition-367b7df18a6b81c78ef3ccd9b4c8fd26
- Leaderboard: https://dreamdex-leaderboard-super-cool.vercel.app/
- Meeting Google Meet: https://meet.google.com/vhy-keur-myu

### Community
- DreamDEX Twitter: @DreamDEXSomnia
- Somnia Discord: https://discord.com/invite/somnia
- Somnia website: https://somnia.network
- DreamDEX landing: https://dreamdex.io

### Code Repos
- Somnia Agent Kit: https://github.com/xuanbach0212/somnia-agent-kit
- DreamDEX CCXT fork: github:somnia-chain/ccxt#add-dreamdex-exchange
- DreamDEX CLI: github.com/somnia-chain/somnia-dex-cli

### External References
- Ironic's feedback Google Doc: https://docs.google.com/document/d/1QSmiLs7-MwATPkavNO9dClOwxQMootUtuFHsb6CWPjw/edit (expireTimestampNs bug)

---

## 20. Decision Log

### 2026-05-26 — Initial Locks

| Decision | Choice | Driver |
|---|---|---|
| Language | TypeScript | Aligned with DreamDEX official tooling (CCXT TS only, Agent Kit TS only) |
| Tier | Opsi B (Full Showcase) | User goal = Top 3, time budget supports complexity |
| LLM | Ollama llama3.2 local | Free, private, demo "AI-driven" narrative |
| Smart Contract | Agent Kit vault built-in (skip Solidity v1) | Match Emre's intent without v1 deploy risk |
| Pair primary | USDC.e:USDso | Stablecoin pair = tightest spread = max volume |
| Pair secondary | SOMI:USDso (20%) | Diversification |
| Strategies | 5 (MM × 2 + Momentum + Rebalancer + Day7Liq) | Showcase variety; team values "effort + tactics" |
| Project name | DreamTend | Tending metaphor for MM |
| Repo visibility | Public from day 1 | "Code becomes demo content" per Anjali |
| Workspace | Will rename `D:\DreamDex Alpha Testing Somnia` → `D:\dreamtend` | Clean naming consistency |

### Open Questions (To Resolve Later)

- [ ] Day 7 snapshot exact time? (Assume 2026-06-01 10:00 UTC, confirm with Anjali)
- [ ] MCP server URL? (Awaiting team response)
- [ ] Agent Kit npm package fully published? (Verify on `npm install`)
- [ ] Yield σ value? (Open question for feedback report)

---

> **Last updated:** 2026-05-26
> **Maintainer:** Alven Tendrawan + Claude Opus 4.7
> **License:** MIT (this guide), MIT (project code)
