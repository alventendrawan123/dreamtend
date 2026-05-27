# Feedback Report 09 — Leaderboard PnL Formula Excludes Vault & Inventory

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-28
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

## Type
**Leaderboard / Competition Mechanics**

## Severity
**High** — Penalizes legitimate market-making strategies (which hold inventory in vaults / base tokens) vs pure taker strategies (which keep everything in wallet USDso). Distorts both the competition outcome and the visibility of in-progress strategies during the run.

## Environment
- **Leaderboard:** https://dreamdex-leaderboard-super-cool.vercel.app/
- **Observed PnL formula:** `wallet_USDso - 50` (initial USDso allocation)
- **Verified empirically against:** DreamTend wallet `0x8f0A24…ec86` over Days 1-3 of competition

---

## Steps to Reproduce

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

## Expected Behavior

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

## Actual Behavior

The leaderboard reads only the registered wallet's USDso ERC20 balance. Any capital deposited to vaults, swapped to base tokens, or moved to fleet wallets becomes invisible — registered as "loss" — until Day-7 when the integrator manually consolidates everything back to the registered wallet.

DreamTend's workaround:
- Built `scripts/sweep-fleet.ts` to consolidate fleet wallets back at Day-7
- Built `src/strategies/day7-liquidator.ts` to:
  - Cancel all resting orders
  - IOC-sell entire base inventory at best bid
  - **Withdraw all vault balances** to wallet (critical — without this step the PnL formula misses the vault portion)
- Scheduled to auto-fire at `2026-06-01T08:00:00Z` (T-2h before snapshot)

This pattern is non-obvious for first-time integrators: a market-maker bot that genuinely posts maker liquidity may discover only at snapshot time that its vault holdings weren't counted, and that it needed an explicit liquidation pass.

## Logs / Evidence

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

## Impact

- **Strategy distortion:** Bots that genuinely market-make (= hold inventory in vaults) look like they're losing while bots that pure-take (= keep everything in USDso wallet) look better, even though the underlying economics may favor MM.
- **Onboarding cliff:** New integrators see a sharply negative PnL once they deposit to vaults, panic, and reverse course — even when the deposit was strategically correct.
- **Day-7 surprise risk:** Integrators who don't read the formula closely may forget to withdraw vault balances before snapshot, getting an artificially low final PnL.
- **Hidden friction in DreamTend's own design:** We had to invest engineering time in the Day-7 liquidator and sweep-fleet scripts. Time that could have gone into more strategy if the formula included vaults natively.

## Suggested Fix

In order of preference:

1. **Two-column leaderboard:** show both "Wallet PnL" (current) and "Portfolio PnL" (wallet + vault + inventory). Lets viewers see both views; preserves the current simple formula for comparability while removing the disincentive to use vaults.

2. **Auto-include vault USDso in PnL.** Easiest aggregation: `PnL = wallet_USDso + sum(vault_USDso_across_pools) - 50`. Doesn't require pricing other tokens; just lifts the vault floor.

3. **Document the formula explicitly + recommend a Day-7 liquidation pattern.** A "Snapshot Strategy" page in docs explaining the formula and showing the recommended consolidation script. DreamDEX could even ship a reference `liquidator.ts` template.

4. **Programmatic snapshot API.** Endpoint at `https://api.dreamdex.io/v0/leaderboard/snapshot?wallet=0x…` that returns both the current-formula PnL and the full-portfolio value, so integrators can see their hidden-vault gap mid-competition.

## Acceptance Criteria

This report would be resolved when:
- [ ] Leaderboard either shows full-portfolio PnL or makes the formula gap visible (e.g., second column or info tooltip).
- [ ] Docs explicitly describe the formula at the top of the Quick Start.
- [ ] A reference liquidation pattern (template script) is recommended for snapshot prep.

---

*Reported in good faith. DreamTend's full Day-7 liquidator + sweep-fleet implementation in the reference repo (`src/strategies/day7-liquidator.ts`, `scripts/sweep-fleet.ts`) demonstrates one solution to this gap — happy to discuss the design with the team.*
