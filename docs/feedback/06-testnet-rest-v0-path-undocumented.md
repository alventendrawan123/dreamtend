# Feedback Report 06 — Testnet REST API Base URL Inconsistency (`/v0` Path Hidden)

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-28
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

## Type
**Docs Gap / REST API Onboarding**

## Severity
**High** — Every first-time testnet integrator hits 404 on every endpoint and assumes the API is down. The fix is a one-line docs change, but the cost-of-not-fixing is paid per-new-tester forever.

## Environment
- **Network:** Somnia testnet / Shannon (chainId 50312)
- **Documented testnet REST base:** `https://stg.api.dreamdex.io`
- **Actual working base:** `https://stg.api.dreamdex.io/v0`
- **Mainnet (for contrast):** `https://api.dreamdex.io/v0` — docs DO include `/v0` here
- **Tools used:** `curl`, `node-fetch`
- **Docs referenced:** Quick Start, Developers > HTTP API section

---

## Steps to Reproduce

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

## Expected Behavior

Either:
- (A) Update testnet docs base URL to `https://stg.api.dreamdex.io/v0` (matching mainnet's documented style), OR
- (B) Clarify in docs that `/v0` is part of the **path**, not the **base URL**, on both networks — so neither needs the prefix in the base.

## Actual Behavior

The docs document mainnet base as `https://api.dreamdex.io/v0` (with `/v0`) and testnet base as `https://stg.api.dreamdex.io` (without `/v0`). The actual API behavior is identical: both require `/v0` somewhere in the URL. This asymmetric documentation pattern causes first-time integrators to spend 15-30 minutes debugging "API down" before realizing they need to add `/v0` to the testnet URL too.

## Logs / Evidence

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

## Impact

- **Per-new-tester time loss:** ~15-30 minutes debugging "API down" / "endpoint not found" before realizing the `/v0` is missing.
- **Pattern of distrust:** When the very first documented endpoint returns 404, integrators start to lose confidence in other documented values too.
- **Skipping testnet:** Some testers may give up on testnet REST entirely and pivot directly to mainnet REST or contract calls — bypassing the safer testnet validation phase.

## Suggested Fix

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

## Acceptance Criteria

This report would be resolved when:
- [ ] Testnet and mainnet REST base URLs in docs follow the same pattern (both with `/v0` or both without).
- [ ] A copy-pasteable `curl` example for testnet markets endpoint exists in the docs and returns 200.
- [ ] A new tester, starting from zero knowledge, can hit their first testnet endpoint successfully on the first attempt.

---

*Reported in good faith as a contributor to the DreamDEX Alpha Testing programme. Original raw note: `docs/feedback/OBSERVATIONS.md` Obs-002.*
