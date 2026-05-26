# DreamTend

> *Tending the order book on DreamDEX.*

Autonomous multi-strategy market-making agent for the [DreamDEX](https://dreamdex.io) Alpha Trading Competition on the [Somnia](https://somnia.network) blockchain.

Built in TypeScript on top of [ethers v6](https://docs.ethers.org/v6/), the [DreamDEX CCXT fork](https://github.com/somnia-chain/ccxt/tree/add-dreamdex-exchange), and the [Somnia Agent Kit](https://github.com/xuanbach0212/somnia-agent-kit). LLM meta-decisions powered by local Ollama.

---

## Why "DreamTend"?

A market maker is a gardener — it doesn't pick winners, it *tends the order book*: trims overgrown spreads, plants liquidity on both sides, weeds out stale quotes. DreamTend automates that gardening 24/7 against four DreamDEX pools.

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
# edit .env: paste your TRADING wallet private key + RPCs

# 4. Dry-run on testnet
npm run dev -- --network testnet --pair SOMI:USDso

# 5. Go live on mainnet
npm run dev -- --network mainnet --pair USDC.e:USDso

# 6. Production (24/7)
npm run build
pm2 start ecosystem.config.js
```

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Orchestrator  (multi-strategy scheduler)       │
│       │                                         │
│       ├─→ Strategy: USDC.e/USDso MM   (70%)     │
│       ├─→ Strategy: SOMI/USDso MM     (20%)     │
│       ├─→ Strategy: Momentum chaser   (5%)      │
│       ├─→ Strategy: Inventory rebalancer (5%)   │
│       └─→ Strategy: Day-7 liquidator  (T-2h)    │
│       │                                         │
│       └─→ LLM Meta-Engine (Ollama llama3.2)     │
│           (15-min strategy switch decisions)    │
└─────────────────────────────────────────────────┘
         │                            │
         ↓                            ↓
┌─────────────────────┐   ┌─────────────────────┐
│  DreamDEX REST/WS   │   │  Direct contracts   │
│  (convenience)      │   │  (fallback path)    │
└──────────┬──────────┘   └──────────┬──────────┘
           │                         │
           └────────────┬────────────┘
                        ↓
              ┌──────────────────┐
              │   Somnia RPC     │
              │  (chain ID 5031) │
              └──────────────────┘
```

Trading happens on-chain at SpotPool contracts (e.g. USDC.e:USDso at `0x47fD…120b`). The REST API is convenience; the bot falls back to direct contract calls when REST is unstable. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full breakdown.

---

## Strategy Summary

| # | Strategy | Pair | Allocation | Tactic |
|---|---|---|---|---|
| 1 | Primary MM | USDC.e:USDso | 70% | Post-only ±1 tick, re-quote on MarkPriceUpdated |
| 2 | Secondary MM | SOMI:USDso | 20% | Post-only ±10 bps |
| 3 | Momentum chaser | SOMI:USDso | 5% | IOC on >50 bps moves |
| 4 | Inventory rebalancer | varies | 5% | Auto-correct skew |
| 5 | Day-7 liquidator | all | T-2h fire | Settle to USDso before snapshot |
| ⭐ | LLM meta-engine | global | — | Ollama llama3.2, 15-min cadence |

See [docs/STRATEGIES.md](docs/STRATEGIES.md).

---

## Repo Layout

```
src/
  config/       # network, tokens, pools, constants
  agent/        # Somnia Agent Kit (registry + vault)
  dex/          # DreamDEX REST + WS + direct contract client
  strategies/   # 5 strategy modules + base class
  llm/          # Ollama client + decision engine
  utils/        # logger, decimals, price helpers
docs/
  ARCHITECTURE.md
  STRATEGIES.md
  api-gotchas.md   # 20 gotchas baked into code
  feedback/        # 5 detailed feedback reports
scripts/
  register-agent.ts
  deposit-vault.ts
  liquidate-final.ts
tests/
  testnet-dry-run.ts
```

---

## Status

This is a competition entry for the **DreamDEX Alpha Trading Competition** (2026-05-26 → 2026-06-01). Code will be polished into an official getting-started reference for future DreamDEX testers.

- Phase 1: Setup — in progress
- Phase 2-12: see [SKILL.md](SKILL.md) section 16

---

## Acknowledgments

- DreamDEX team — Anjali Singh, Emre Yıldız, Tom, Dave, Paul
- Somnia Network — Agentic L1 vision
- Community testers running this through its paces

---

## License

[MIT](LICENSE) — fork it, ship it, learn from it.
