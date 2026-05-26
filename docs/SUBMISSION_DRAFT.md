# DreamTend — Day-7 Submission Draft

> **Status:** WIP — paragraphs accumulated here turn into the final Google Doc on 2026-06-01.
> Build sections incrementally; copy-paste into Google Doc closer to submission.

---

## Section A — Bot Architecture (draft excerpts)

### Operational Discipline: Dedicated Trading Wallet

DreamTend operates from a **purpose-created wallet** (`0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`) with zero transaction history prior to the competition kick-off — per the security guidance shared in the Alpha Testing Group:

> *"Please do NOT use your primary wallet. Make sure it's a zero tx wallet."*  — Anjali Singh, group welcome

This separation gives three concrete benefits:

1. **Blast-radius isolation.** A compromised private key affects only the $50 USDso + 10 SOMI competition funds. The user's primary trading wallet, holding unrelated assets, is untouched.
2. **Clean attribution.** Every transaction on `explorer.somnia.network` under this address is bot-driven and competition-related. Anyone auditing the bot's behaviour (DreamDEX team, future testers reading the public repo) gets a noise-free history.
3. **Repeatable bootstrap.** When DreamDEX runs the next testing wave, the same pattern — `git clone dreamtend && fund fresh wallet && set .env && pm2 start` — onboards a new tester in under 10 minutes.

The private key lives only in `.env`, which is gitignored and never logged. All on-chain interactions are signed locally via `ethers.Wallet`; no key material crosses the network.

---

### Architecture overview (placeholder — fill in Day-6)

```
Orchestrator (src/orchestrator.ts)
├─ Loads strategies per FEATURES flags in .env
├─ Dispatches WS events to each strategy
└─ Graceful shutdown — cancels all resting orders before exit

Strategy: MarketMakerStrategy (src/strategies/market-maker.ts)
├─ Reads mid from getBookLevels (with empty-book fallback to seedMid)
├─ Quotes ±N basis points around mid, aligned to tick + lot
├─ PostOnly orders only — refuses to cross book
├─ Re-quotes on MarkPriceUpdated drift > 2 bps (mutex + 2s cooldown)
└─ Tracks orderId from receipt logs for clean cancellation

Safety layer (src/utils/gotchas.ts + src/dex/safe-broadcast.ts)
├─ Static-call simulate before broadcast (catches sim-revert)
├─ Verifies OrderPlaced event topic in receipt
└─ Asserts: expireNs > now, priceRaw > 0, builder == 0x0, qty multiple of lot
```

---

## Section B — Code Snippets Highlights (planned)

To showcase, in order of demo value:

1. **`src/dex/safe-broadcast.ts: safePlaceOrder`** — 3-step pattern (simulate → broadcast → event-verify) that prevents the silent-rejection footgun documented in feedback Obs-006.
2. **`src/utils/gotchas.ts`** — runtime assertion library for every DreamDEX gotcha (expireNs=0, priceRaw=0, builder ≠ address(0), qty alignment, sufficient balance).
3. **`src/strategies/market-maker.ts: requote`** — mutex + cooldown pattern that prevents WS-event-driven sim-revert storms.
4. **`src/dex/websocket.ts`** — WebSocket client with 30s ping heartbeat, exponential reconnect, and subscription replay.
5. **`src/dex/abi/types.ts`** — Typechain-style typed Contract interfaces wrapping `ethers.Contract` for editor autocomplete.

---

## Section C — Demo Evidence (planned)

To capture:
- Terminal screenshot mid-MM cycle (Order posted log line + state snapshot)
- Explorer.somnia.network transaction history page for the wallet
- Leaderboard rank screenshot at peak
- (Optional) Loom video walkthrough — 2-3 min

---

## Section D — GitHub Repo

**Public repo:** https://github.com/alventendrawan123/dreamtend
**License:** MIT
**Stars / forks at submission:** TBD

The repo contains: full TypeScript source, all operational scripts (`deposit-vault`, `cancel-by-id`, `find-recent-orders`, `swap-stt-to-usdso`), the 5 final feedback reports under `docs/feedback/`, and this submission document.

---

## Section E — Feedback Reports (planned 5)

Source pool: 7 observations in `docs/feedback/OBSERVATIONS.md` (Obs-001 … Obs-007), plus the 23-item inventory in `SKILL.md §13`. Curate top 5 by impact + actionability:

| # | Title | Severity | Type | Source |
|---|---|---|---|---|
| 1 | `OrderPlaced` event topic undocumented — silent-rejection footgun | **Critical** | Doc gap | Obs-006 (lived experience) |
| 2 | `getPoolParams` returns 7 fields not 8 — docs outdated | High | Doc + ABI | Obs-001 |
| 3 | Pool params (lotSize) in docs diverge from on-chain reality | High | Doc QA | Obs-005 |
| 4 | Testnet USDso onboarding undocumented + chronic empty book | High | Doc + ops | Obs-004 |
| 5 | `getBookLevels` reverts with `require(false)` on empty book | Medium | Smart contract UX | Obs-003 |

Each report follows the canonical structure (Type / Severity / Environment / Steps to reproduce / Expected / Actual / Logs / Suggested fix) as required by `tugasLengkap.md §1.2`.
