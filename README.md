# DreamTend

> _Tending the order book on DreamDEX._

Autonomous multi-wallet trading agent for the [DreamDEX](https://dreamdex.io) Alpha Trading Competition on the [Somnia](https://somnia.network) blockchain. Built in TypeScript on top of [ethers v6](https://docs.ethers.org/v6/).

**Status during the competition:**

- 🏆 Reached **rank 1** on the live leaderboard 2026-05-27 16:42 UTC with ~$1,356 USDso volume
- 📝 22 polished feedback reports submitted to engineering (doc gaps, ABI mismatches, pool UX, incentive-mechanism gaps, agent-integration 404s, metric-integrity)
- 🧱 Multi-wallet fleet architecture per Emre's "AI agents wallet" guidance
- 🔐 Production-ready safety net (eth_call simulation + event verification + gotcha asserts)

---

## Why "DreamTend"?

A market maker is a gardener — it doesn't pick winners, it _tends the order book_: trims overgrown spreads, plants liquidity on both sides, weeds out stale quotes. DreamTend automates that gardening across multiple wallets simultaneously, and combines it with an aggressive IOC-taker module that captures external liquidity on the higher-priced pairs (WETH, WBTC).

---

## The Strategy: Genuine IOC-Taker

```
                  REGISTERED WALLET (0x8f0A...ec86)
                          ($50 USDso modal)
                                │
                                ↓
                    ┌───────────────────────┐
                    │  IOC-LOOP (primary)    │
                    │  IOC-taker alternator  │
                    │                        │
                    │ • WETH:USDso           │
                    │ • IOC takers on real   │
                    │   external liquidity   │
                    │ • USDso hysteresis     │
                    │   guard (PnL-safe)     │
                    │ • genuine fills only   │
                    └───────────────────────┘
                                │
                                ↓  ON-CHAIN
                     DreamDEX SpotPool contracts
                     Genuine volume → leaderboard
```

**IOC-loop** (`scripts/ioc-loop.ts`) is our volume engine and the source of essentially all our competitive volume: it alternates IOC BUY/SELL at wide limit prices on WETH:USDso, **taking whatever real external counterparty exists at market price**. Every fill is against a genuine third party — no self-dealing. A USDso hysteresis guard keeps the wallet balance (and therefore leaderboard PnL) safely away from the floor while deploying capital efficiently.

### A note on `cross-loop.ts` (deliberately abandoned)

Early in the competition we also built a **self-cross** experiment (`scripts/cross-loop.ts`): one fleet wallet posts a PostOnly maker order and the registered wallet IOC-takes it. We used it only minimally (~$5–30 of volume on the near-empty SOMI:USDso pool) and then **deliberately retired it**, because self-crossing your own wallets is — in substance — **wash trading**: real on-chain transactions but no genuine counterparty, price discovery, or risk transfer.

We chose to compete on **genuine, counterparty-diverse volume** instead. We even filed this as **Feedback Report 20** (the volume metric is inflatable via cross-wallet self-dealing, since the on-chain `SelfMatchingOption` only guards single-wallet self-match). The script remains in the repo for transparency, but it is not part of our competitive strategy.

---

## Quickstart

```powershell
# 1. Clone
git clone https://github.com/alventendrawan123/dreamtend.git
cd dreamtend

# 2. Install
npm install

# 3. Configure
cp .env.example .env
# edit .env — paste your trading wallet private key + RPCs

# 4. Verify the toolchain
npm run typecheck       # passes — no TS errors
NETWORK=mainnet npx tsx scripts/sanity-check.ts   # 8/8 checks ok

# 5. (Optional) Generate + fund a multi-wallet fleet
npx tsx scripts/generate-bot-wallets.ts 5         # creates data/bot-wallets.json (gitignored)
NETWORK=mainnet npx tsx scripts/fund-bot-wallets.ts data/bot-wallets.json 2 0.2
NETWORK=mainnet npx tsx scripts/prepare-fleet.ts data/bot-wallets.json 1.5

# 6. Run the genuine IOC-taker engine (our only competitive strategy).
#    The optional last two args are the USDso hysteresis-guard floor/ceiling.
NETWORK=mainnet npx tsx scripts/ioc-loop.ts WETH:USDso 0.008 3000 1 4000 200 18 30

# (cross-loop.ts exists in the repo but is a retired self-cross experiment —
#  it's wash trading, see Feedback Report 20. Not part of our strategy.)

# 7. Day-7 (2026-06-01): sweep fleet + liquidate
NETWORK=mainnet npx tsx scripts/sweep-fleet.ts
```

---

## Architecture

```
src/
  config/          Network, tokens, pool addresses, env-driven constants
  dex/             SpotPool ABI + typed contract wrappers, REST + WS clients
    abi/             Human-readable ABIs (spotpool.ts, erc20.ts) + TS interfaces
    contracts.ts     getPoolHandle, readBookLevels (revert-safe), readPoolParams
    safe-broadcast.ts  Sim → broadcast → event-verify pattern (Obs-006 fix baked in)
    rest.ts          DreamDEX REST API client w/ SIWE auth stub
    websocket.ts     Subscribe + 30s ping heartbeat + exp reconnect
  strategies/      Bot strategies (one process can load N strategies)
    base.ts          Strategy abstract class
    market-maker.ts  Two-sided MM, requote mutex + 2s cooldown
    momentum.ts      Volatility-triggered IOC taker
    day7-liquidator.ts  T-2h before snapshot: cancel + IOC dump + withdraw vault
  utils/           gotchas.ts (runtime asserts), price.ts (tick/lot align), signer.ts (fleet-aware)
  orchestrator.ts  Loads strategies per FEATURES flags, dispatches WS events

scripts/         (live ops tooling — see "Operational Scripts" below)
docs/            Architecture notes + feedback/ folder with 22 polished reports
```

---

## Operational Scripts

```
scripts/
  generate-bot-wallets.ts    Create N fresh wallets, save data/bot-wallets.json (gitignored)
  fund-bot-wallets.ts        Send USDso + native SOMI from registered → each bot wallet
  prepare-fleet.ts           Each wallet approves + deposits USDso to its target pool vault
  run-fleet.ts               Spawn N parallel bot processes per role (homogeneous orchestrators)
  fleet-state.ts             Tabular fleet snapshot (native + USDso wallet + vault + nonce)
  consolidate-gas.ts         Sweep native SOMI from fleet → registered (gas refill)
  withdraw-w3-somi.ts        Withdraw W3's native-SOMI vault balance back to registered

  sanity-check.ts            8 checks: RPC, wallet, pool params, book RPC, REST /markets,
                             REST /orderbooks, WebSocket subscribe
  full-state.ts              Wallet + vault balance probe across all relevant tokens
  fleet-state.ts             Same but for all fleet wallets in one table
  probe-pool.ts              getPoolParams() + book snapshot for any pool
  inspect-tx.ts              Decode logs/topics/data from a known tx hash

  ioc-loop.ts                IOC taker loop, alternates BUY/SELL (genuine — our engine)
  cross-loop.ts              Self-cross experiment — RETIRED (wash trading, see Feedback 20)
  self-cross.ts              Earlier single-direction self-cross prototype — RETIRED
  swap-stt-to-usdso.ts       Testnet bootstrap helper (limited by empty book)
  rebalance-w3.ts            Top-up W3 wallet/vault with native SOMI

  deposit-vault.ts           Manual deposit USDso (or base) to a pool vault
  cancel-by-id.ts            Cancel an order by hex orderId
  cancel-all.ts              Cancel via getOwnOpenOrders (caveat: reverts on empty)
  cancel-raw.ts              Cancel without sim (workaround for some edge cases)
  recover-orders.ts          Extract orderIds from tx hashes + cancel (incident recovery)
  find-recent-orders.ts      Scan recent blocks for our wallet's OrderPlaced events
  sweep-fleet.ts             Day-7: cancel orders + withdraw vault + transfer all → registered
```

---

## Safety Net

Every order broadcast goes through `safePlaceOrder` (`src/dex/safe-broadcast.ts`):

1. **Pre-flight asserts** (`src/utils/gotchas.ts`)
   - `expireTimestampNs > now` (DreamDEX rejects 0)
   - `priceRaw > 0` (priceRaw=0 is literal, NOT "market price")
   - `builder == 0x0` and `builderFeeBpsTimes1k == 0` (disabled in v1.0)
2. **Static-call simulation** (`placeOrder.staticCall(...)`)
   - Catches custom-error reverts BEFORE burning gas
3. **Broadcast + receipt wait**
4. **Event verification** — confirms the `OrderPlaced` topic appears in `receipt.logs`
   - Empirically verified topic: `0xd90f62f6...` (see Feedback Report 01)
5. **Receipt-based orderId extraction**
   - The sim-returned orderId can drift from the actual on-chain orderId when other orders are placed between sim and broadcast — receipt is the only authoritative source.

This pattern caught real bugs during the competition: an early version of the bot lost track of orderIds (Day-1 incident) because we trusted the sim-time orderId; the fix in `extractOrderIdFromReceipt` recovered tracking and prevented future orphan-order incidents.

---

## Multi-Wallet Fleet

Per Emre's group-chat guidance:

> "You can create your wallets your AI agents wallet etc. We'll consider it general." — Emre Yıldız, DevRel, 2026-05-25

DreamTend ships scripts to spawn N fresh wallets, fund them from the registered wallet, assign each a strategy role, and run them in parallel via separate orchestrator processes (one per wallet). Roles include `mm-usdce-tight`, `mm-somi`, `momentum-somi`, `reserve`. All wallet keys live in `data/bot-wallets.json` (gitignored, never committed).

Day-7: `sweep-fleet.ts` consolidates ALL pool vault balances + ERC20 + native back to the registered wallet, so the leaderboard's `PnL = wallet_USDso - 50` formula captures the full portfolio.

---

## Feedback Reports

Five polished reports in `docs/feedback/`:

1. **`01-event-topic-undocumented.md`** — `OrderPlaced` event topic must be reverse-engineered from a real receipt. Critical "silent rejection" footgun.
2. **`02-getpoolparams-field-count-mismatch.md`** — Docs say 8 fields, contract returns 7. BAD_DATA decode failure.
3. **`03-pool-lotsize-docs-mismatch.md`** — Docs and on-chain `lotSize` diverge on USDC.e:USDso (0.01 vs 1.0).
4. **`04-testnet-usdso-onboarding-gap.md`** — No documented way to acquire testnet USDso; pool chronically empty.
5. **`05-getbooklevels-empty-revert.md`** — View function reverts with `require(false)` on empty book instead of returning empty arrays.

Each report follows the canonical Type / Severity / Environment / Steps to reproduce / Expected / Actual / Logs / Suggested fix / Acceptance criteria format.

Raw observations + incident notes live in `docs/feedback/OBSERVATIONS.md`.

---

## Live Numbers

As of 2026-05-27 17:00 UTC (Day 2):

| Metric                           | Value                                               |
| -------------------------------- | --------------------------------------------------- |
| Mainnet TX broadcast             | ~9,000+ (and climbing)                              |
| On-chain volume contribution     | ~$93,000+ USDso (genuine IOC, counterparty-diverse) |
| Leaderboard rank                 | #2 genuine (the #1 is a near-floor wash-trader)     |
| Fleet wallets active             | 5 (W0–W4)                                           |
| Real-money loss                  | ~$2-3 USDso genuine trading friction (spread)       |
| Recoverable at Day-7 sweep       | ~$40 USDso (wallet + vault + fleet)                 |
| Successful fill rate (IOC loops) | 92-100% during active hours                         |
| Bugs caught by safety net        | 1 silent-rejection event topic mismatch (recovered) |
| Feedback reports submitted       | 22 polished + 7 raw observations in OBSERVATIONS.md |

---

## License

[MIT](LICENSE) — fork it, ship it, improve it. The DreamDEX team is welcome to use any of this code as official getting-started reference material (per Anjali's encouragement at the kick-off meeting).

---

## Acknowledgments

- DreamDEX team — Anjali Singh, Emre Yıldız, Tom, Dave, Paul
- Somnia Network — Agentic L1 vision
