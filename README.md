# DreamTend

> _Tending the order book on DreamDEX._

Autonomous multi-wallet trading agent for the [DreamDEX](https://dreamdex.io) Alpha Trading Competition on the [Somnia](https://somnia.network) blockchain. Built in TypeScript on top of [ethers v6](https://docs.ethers.org/v6/).

**Final standing (end-of-Day-7 window, 2026-06-01):**

- 🥇 Reached **rank 1 with genuine, counterparty-diverse IOC volume** at Day-6 peak (2026-05-31 00:09 WIB, ~$159k volume)
- 🥈 **Final rank #2** with ~$317k genuine IOC volume, 31,809 broadcast txs, ~31k fills on WETH/USDso
- 💰 Final leaderboard PnL: -$43.98 USDso (genuine spread cost — no wash trading)
- 📝 **22 polished feedback reports** + 7 raw observations submitted to engineering (doc gaps, ABI mismatches, pool UX, incentive-mechanism gaps, agent-integration 404s, metric-integrity)
- 🤖 Registered as **Somnia Agent #45** on Shannon testnet via `somnia-agent-kit` SDK
- 🔐 Production-ready safety net (eth_call simulation + event verification + gotcha asserts + defensive timeout/heartbeat layer)

Full submission narrative + 22 verbatim feedback reports: [`docs/SUBMISSION_DRAFT.md`](docs/SUBMISSION_DRAFT.md).

---

## Why "DreamTend"?

A market maker is a gardener — it doesn't pick winners, it _tends the order book_: trims overgrown spreads, plants liquidity on both sides, weeds out stale quotes. DreamTend was originally designed around that metaphor (multi-wallet market-making), but during the competition pivoted to a tighter, capital-efficient strategy: a **single counterparty-agnostic IOC-taker engine on WETH/USDso** that captures real external liquidity at market mid, paired with a self-funded USDso → SOMI gas-recycling loop and a post-Day-7 inventory-sweep to lock the leaderboard PnL. Multi-wallet infrastructure ships as a reusable scaffold for future testers (see [Multi-Wallet Fleet](#multi-wallet-fleet)).

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

# 7. Day-7 (2026-06-01): post-window cleanup
#    - sweep-fleet.ts consolidates fleet wallet vault balances (used in production
#      only for fleet-vault recovery — see B.4 of SUBMISSION_DRAFT.md)
NETWORK=mainnet npx tsx scripts/sweep-fleet.ts

# 8. Post-Day-7: manual inventory sweep (the path we actually used in production)
#    The registered wallet's IOC-taker never used a pool vault, so the leaderboard
#    PnL drift was driven by WETH inventory left on the wallet. The Day-7
#    auto-fire cron (src/strategies/day7-liquidator.ts) was built but NOT used
#    end-to-end — we executed a manual IOC sell of remaining WETH → USDso after
#    the Day-7 trading window closed (tx 0xdb1ef29b...41649b5). See A.8 of
#    SUBMISSION_DRAFT.md for the full execution narrative.
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
scripts/  (~35 utilities — grouped by purpose)

  ── Volume engine (production) ───────────────────────────────────────────
  ioc-loop.ts                IOC taker loop on WETH/USDso — our genuine engine
                             Defensive: withTimeout (sim/broadcast/tx.wait),
                             30s heartbeat, slow-cycle warn, gas pre-flight abort
  ioc-loop-somi.ts           SOMI/USDso variant — handles native-base msg.value
                             === qtyRaw payable requirement (Report 10)

  ── Retired experiments (kept for transparency) ─────────────────────────
  cross-loop.ts              Bidirectional self-cross — RETIRED (wash trading,
                             Feedback Report 20)
  self-cross.ts              Single-direction self-cross prototype — RETIRED

  ── Capital recycling / gas ──────────────────────────────────────────────
  buy-somi.ts                IOC-buy native SOMI from USDso on SOMI/USDso pool
                             (self-funded gas refuel; B.4 of SUBMISSION_DRAFT)
  rebalance-w3.ts            Top-up W3 wallet/vault with native SOMI
                             (only used during the early self-cross experiment)
  consolidate-gas.ts         Sweep native SOMI from fleet → registered
  fund-w2-gas.ts             Minimal native-SOMI gas funding for W2

  ── Fleet management ─────────────────────────────────────────────────────
  generate-bot-wallets.ts    Create N fresh wallets, save data/bot-wallets.json
  fund-bot-wallets.ts        Send USDso + native SOMI from registered → each
  prepare-fleet.ts           Each wallet approves + deposits USDso to pool vault
  run-fleet.ts               Spawn N parallel bot processes per role
  fleet-state.ts             Tabular fleet snapshot (native + USDso wallet + vault)
  sweep-fleet.ts             Consolidate fleet vault balances back to registered
  extract-w2-somi.ts         Withdraw W2's idle SOMI/USDso vault → registered
                             (recovered ~7 SOMI from mm-somi MM run)
  withdraw-w3-somi.ts        Withdraw W3's native-SOMI vault balance → registered

  ── Monitoring / health ──────────────────────────────────────────────────
  sanity-check.ts            8 checks: RPC, wallet, pool params, book RPC,
                             REST /markets, REST /orderbooks, WS subscribe
  full-state.ts              Wallet + vault balance probe across all tokens
  probe-pool.ts              getPoolParams() + book snapshot for any pool
  pool-watch.ts              Live watch loop on pool book depth + spread
  reg-all-balances.ts        Tabular snapshot of registered-wallet holdings
  check-all-vaults.ts        Vault-balance audit across all fleet wallets
  analyze-friction.ts        PnL friction analysis: spread cost per fill

  ── Recovery / cleanup ───────────────────────────────────────────────────
  cancel-by-id.ts            Cancel an order by hex orderId
  cancel-all.ts              Cancel via getOwnOpenOrders (caveat: reverts empty)
  cancel-raw.ts              Cancel without sim (workaround for edge cases)
  recover-orders.ts          Extract orderIds from tx hashes + cancel
  find-recent-orders.ts      Scan recent blocks for our OrderPlaced events
  recover-reg-vault.ts       Withdraw any leftover registered-wallet vault balance

  ── Compliance / evidence (Rule 2) ───────────────────────────────────────
  verify-usdso-inflows.ts    Scan every USDso Transfer into registered wallet,
                             label each sender (pool / fleet / external).
                             Produces zero external (non-pool, non-fleet)
                             inflows — used as Rule 2 compliance evidence
  dump-tx-topics.ts          Print all topics + method selector for any tx
                             — reproducer for Feedback Report 22
  research-wallet.ts         Audit a third-party wallet's OrderPlaced events
                             (filter owner from data slot 2 client-side per
                             Report 22 ABI mismatch fix)
  scan-wallet-txs.ts         Generic tx history scanner for a wallet
  inspect-tx.ts              Decode logs/topics/data from a known tx hash
  inspect-block-tx.ts        Same but lookup by block + index

  ── Misc ─────────────────────────────────────────────────────────────────
  deposit-vault.ts           Manual deposit USDso/base to a pool vault
  swap-stt-to-usdso.ts       Testnet bootstrap helper (limited by empty book)
  wallet-info.ts             Quick wallet identity + balance printout
  register-agent.ts          Register the bot as Somnia Agent #45 (Shannon)
  llm-demo.ts                Ollama LLM meta-decision-layer demo (3 scenarios)
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

### Resilience layer (added Day-5/6)

After a 5-hour zombie-cycle incident where `tx.wait()` hung indefinitely waiting for a receipt that never came, we added a defensive layer to both `ioc-loop.ts` and `ioc-loop-somi.ts` (commit `671ed1e`):

- **`withTimeout` on every RPC call** — 15s sim, 30s broadcast, 60s `tx.wait()`. On timeout the cycle's try/catch logs and the loop continues to the next iteration.
- **30s heartbeat log** via `setInterval` — a frozen loop becomes immediately visible.
- **Slow-cycle warning** when a cycle body exceeds 10s — surfaces RPC lag.
- **Gas pre-flight abort** — bot exits cleanly when native SOMI < 0.5 instead of dying mid-broadcast with low-funds errors.

---

## Multi-Wallet Fleet

Per Emre's group-chat guidance:

> "You can create your wallets your AI agents wallet etc. We'll consider it general." — Emre Yıldız, DevRel, 2026-05-25

DreamTend ships scripts to spawn N fresh wallets, fund them from the registered wallet, assign each a strategy role, and run them in parallel via separate orchestrator processes (one per wallet). The infrastructure supports roles `mm-usdce-tight`, `mm-usdce-mid`, `mm-somi`, `momentum-somi`, `reserve`. All wallet keys live in `data/bot-wallets.json` (gitignored, never committed).

**Designed scope vs production reality.** The fleet wallets ship as a reusable scaffold, but in production the **registered wallet's IOC engine was the only volume source**. Two fleet wallets briefly ran during the competition:

- **W3** (`momentum-somi`) — PostOnly maker for the early self-cross experiment on SOMI/USDso, then retired (see A.3.2 of `docs/SUBMISSION_DRAFT.md`).
- **W2** (`mm-somi`) — short run of the `mm-somi` MarketMakerStrategy on SOMI/USDso; bid fills converted W2's USDso into a small SOMI vault position, later recovered via `scripts/extract-w2-somi.ts`.

W0, W1, W4 were built but not run in production. Capital recycling (USDso → SOMI for gas) was performed by the **registered wallet** swapping on the public SOMI/USDso pool, not from the fleet.

Day-7: `sweep-fleet.ts` consolidates fleet vault balances + ERC20 + native SOMI back to the registered wallet. The post-Day-7 WETH-inventory sweep on the registered wallet itself was a separate manual transaction (tx `0xdb1ef29b...`); the registered wallet never used the pool-vault path.

---

## Feedback Reports

**22 polished reports** in `docs/feedback/` (one `.md` file per report, indexed `01-*.md` through `22-*.md`) + 7 raw observations in `docs/feedback/OBSERVATIONS.md`. Each report follows the canonical Type / Severity / Environment / Steps to reproduce / Expected / Actual / Logs / Suggested fix / Acceptance criteria format.

Severity matrix:

| Tier | Reports | Severity mix |
|---|---|---|
| Original (Days 1–2) | 01–05 | 1 Critical, 3 High, 1 Medium |
| Polished from observations | 06–07 | 1 High, 1 Medium |
| New from live learnings | 08–10 | 3 High |
| Extended / new discoveries | 11–13 | 3 Medium |
| Docs audit | 14–19 | 1 High, 4 Medium, 1 Low |
| Competition-integrity | 20–21 | 1 High, 1 Medium |
| Live ABI discovery | 22 | 1 High |

Selected highlights (full list in [`docs/SUBMISSION_DRAFT.md`](docs/SUBMISSION_DRAFT.md) Section E):

- **01** — `OrderPlaced` event topic must be reverse-engineered from a real receipt. Critical "silent rejection" footgun.
- **02** — `getPoolParams()` returns 7 fields, docs say 8. BAD_DATA decode failure.
- **09** — Leaderboard `PnL = wallet_USDso - 50` formula ignores vault deposits, ERC20 inventory in other tokens, and capital parked in fleet sub-wallets.
- **10** — `placeTakerOrderWithoutVault` SELL leg on native-base pools (SOMI/USDso) requires `msg.value === qtyRaw`, undocumented.
- **20** — Volume metric is gameable via cross-wallet self-dealing; `SelfMatchingOption` only guards single-wallet self-match.
- **22** — `OrderPlaced` event `owner` is NOT indexed despite docs claiming otherwise; `eth_getLogs` topic-filter on owner returns zero matches.

---

## Live Numbers

Final live-observed numbers at end of competition window (post-Day-7 sweep, 2026-06-02):

| Metric                           | Value                                                            |
| -------------------------------- | ---------------------------------------------------------------- |
| Mainnet TX broadcast             | **31,809** (registered wallet)                                   |
| On-chain volume                  | **~$317k live observed** (~$295k at end of Day-7 window)         |
| Total fills                      | **~31,000** (~15,900 round-trip IOC cycles)                      |
| Peak leaderboard rank            | **#1** with genuine IOC volume at Day-6 peak (2026-05-31 00:09)  |
| Final leaderboard rank           | **#2** (overtaken Day-7 — see Feedback Report 20 for structure)  |
| Final leaderboard PnL            | -$43.98 USDso (genuine spread cost; no wash trading)             |
| Successful fill rate (IOC loops) | ≈100% during active pool windows; 60–100% incl. dead-pool skips  |
| Fleet wallets briefly run        | 2 of 5 (W2 mm-somi briefly + W3 self-cross then retired)         |
| DevRel SOMI gas top-ups received | 3 (10 + 10 + 5 SOMI; gas-only, never crossed into USDso capital) |
| Self-recycled gas (USDso → SOMI) | ~30 SOMI cumulative for ~$4–5 USDso on registered wallet         |
| Bugs caught by safety net        | 1 silent-rejection event topic mismatch (recovered Day-1)        |
| Feedback reports submitted       | 22 polished + 7 raw observations in OBSERVATIONS.md              |

---

## License

[MIT](LICENSE) — fork it, ship it, improve it. The DreamDEX team is welcome to use any of this code as official getting-started reference material (per Anjali's encouragement at the kick-off meeting).

---

## Acknowledgments

- DreamDEX team — Anjali Singh, Emre Yıldız, Tom, Dave, Paul
- Somnia Network — Agentic L1 vision
