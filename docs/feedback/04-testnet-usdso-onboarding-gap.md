# Feedback Report 04 — Testnet USDso Onboarding Is Undocumented + Pool Empty

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-27
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

## Type
**Docs Gap + Testnet Onboarding**

## Severity
**High** — Blocks meaningful pre-mainnet validation. Forces integrators to debut their first real on-chain logic against mainnet, increasing the risk of early production loss.

## Environment
- **Network:** Somnia testnet / Shannon (chainId 50312)
- **RPC:** `https://dream-rpc.somnia.network`
- **REST:** `https://stg.api.dreamdex.io/v0`
- **Affected pools:** all USDso-quoted pools on testnet (SOMI/USDso, WBTC/USDso, WETH/USDso)
- **Docs referenced:** Quick Start, Trading > Spot, Contract Specifications pages

---

## Steps to Reproduce

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

## Expected Behavior

- A dedicated testnet USDso faucet (e.g. `https://testnet.somnia.network/faucet/usdso`) or
- A public `mint()` on the testnet USDso token contract gated by per-address rate limit (standard testnet stable token pattern), or
- A DevRel-funded seeded liquidity bot on the testnet pools providing both BID and ASK at wide spreads 24/7, so the swap-via-pool path works in practice

## Actual Behavior

USDso acquisition on testnet requires:
1. Possessing existing USDso, OR
2. Finding another tester with USDso willing to fill an ASK order, OR
3. Catching the rare/intermittent moment when external BIDs appear on the testnet pool

For the duration of our Day-1 testing (2026-05-26 23:00 UTC through 2026-05-27 02:00 UTC), the testnet SOMI:USDso book was empty in 10/10 sampled checks across 2.5 minutes. Effectively, **testnet trading was impossible for someone starting from zero USDso**, and no documented path exists for that starting state.

We pivoted to mainnet validation, where USDso is actually distributed by Somnia to participants on competition entry — but this forces integrators to debug their first real trades on the real-money pool.

## Logs / Evidence

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

## Impact

- **Blocks pre-mainnet validation pattern.** Standard best practice is "test on testnet before mainnet" (called out in DreamTend's own `SKILL.md` operational procedures). Without USDso, the bot cannot actually `placeOrder` on testnet.
- **Forces mainnet-first debug.** First real on-chain validation happens on mainnet with real-money capital ($50 USDso). Any bug in this phase costs real money.
- **Onboarding time loss.** Every new alpha tester loses 1-3 hours discovering this issue. Across N testers, that's N hours of avoidable friction.
- **Skews validation surface.** Bug reports tend to come from mainnet-only because nobody can stress testnet, so testnet bugs go undiscovered.

## Suggested Fix (any one is sufficient, multiple are better)

1. **Dedicated USDso testnet faucet endpoint** — minimum viable. Per-wallet daily limit (e.g. 100 USDso/day) prevents abuse. Could even be served from the existing REST API at e.g. `POST /v0/faucet/usdso { address }`.

2. **Public `mint()` on testnet USDso contract** (`0x9c32F3827A1a99f0cf9B213de8b53eC3d57bb171`) gated by per-address rate limit. Standard pattern from most L2 testnets.

3. **Seeded baseline liquidity** in testnet pools. A DevRel-funded wallet posting wide bids+asks 24/7 on every USDso pool. Each tester's first `placeTakerOrderWithoutVault(isBid=true)` then has something to fill against.

4. **Document the bootstrap path explicitly** as a numbered list in Quick Start:
   - "Acquire testnet USDso" page with copy-paste curl/ethers snippets
   - Warning that pool liquidity is intermittent
   - Recommended retry interval
   - Alternative: contact DevRel for manual airdrop

## Acceptance Criteria

This report would be resolved when:
- [ ] A new tester, starting from a zero-balance wallet, can follow public docs to acquire testnet USDso in under 5 minutes
- [ ] The testnet SOMI:USDso book has resting orders ≥90% of the time when probed
- [ ] OR docs explicitly say "testnet trading requires manual DevRel bootstrap" so testers don't waste time

---

*A working alternative would help even if none of the above is implemented quickly: a one-page "Testnet Quickstart for AI agent integrators" with the bootstrap caveats called out, so that new testers know to pivot to mainnet-with-low-notional rather than chase testnet ghosts.*
