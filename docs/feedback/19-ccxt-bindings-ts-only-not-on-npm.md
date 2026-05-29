# Feedback Report 19 — CCXT Bindings: TypeScript-Only, Not Published to npm

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-29
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

## Type
**SDK / Distribution Gap**

## Severity
**Low** — The CCXT integration (a major ease-of-integration selling point) installs only from a GitHub branch and exists only in TypeScript/JS. Python/Go/PHP/C# traders — a large share of the algo-trading world — can't use it yet. Docs disclose this, so it's a roadmap/polish item rather than a hidden bug.

## Environment
- **Docs page:** `developers/libraries/ccxt`
- **Install:** `npm install github:somnia-chain/ccxt#add-dreamdex-exchange`

---

## Steps to Reproduce

1. Read the CCXT integration docs — DreamDEX is presented as available through CCXT (the standard multi-exchange trading library).
2. Try the standard install path: `npm install ccxt` then use the dreamdex exchange → **not present** (the dreamdex exchange isn't in the published npm package).
3. The docs disclose the real path: `npm install github:somnia-chain/ccxt#add-dreamdex-exchange` (a fork branch, "not yet published to npm").
4. Check language support: only **TypeScript/JS** bindings are generated; "Python / PHP / C# / Go have not yet been generated."

## Expected Behavior

For a CCXT integration to deliver its main value (drop-in, multi-language, install-from-npm):
- The dreamdex exchange should be in the **published `ccxt` npm package** (or a clearly-versioned `@somnia/ccxt` package), AND
- The standard CCXT codegen for **Python / Go / PHP / C#** should be generated, since CCXT's biggest user base is Python algo traders.

## Actual Behavior

- Install is from a **GitHub fork branch**, not npm — fragile (branch can move/disappear), no semver, no `npm audit` integration.
- **TypeScript/JS only** — Python/Go/PHP/C# traders are excluded for now.

The docs DO disclose this honestly (so it's not a hidden trap), but it limits the reach of an otherwise strong "standard tooling" selling point.

## Logs / Evidence

Docs state the install is `github:somnia-chain/ccxt#add-dreamdex-exchange`, that it's "not yet published to npm," and that non-JS language bindings "have not yet been generated."

## Impact

- **Python algo traders blocked** (the largest CCXT cohort) — they'd need to wait for codegen or hand-roll an integration.
- **Branch-install fragility** — pinning to a moving branch is not production-safe; a CI build could break if the branch is rebased/removed.
- Limits the "use your existing CCXT bot with DreamDEX" pitch to JS-only users.

## Suggested Fix

1. Publish the dreamdex exchange to the official `ccxt` npm package (or a versioned standalone package).
2. Generate the Python / Go / PHP / C# bindings via standard CCXT codegen.
3. Until then, prominently label the CCXT integration as "alpha, JS-only, install-from-branch" at the top of the page (currently disclosed but easy to miss).

## Acceptance Criteria

- [ ] dreamdex CCXT integration installable via a versioned npm package (no GitHub-branch pin required).
- [ ] At least Python bindings generated (the dominant CCXT language).
- [ ] Alpha/limitation status stated prominently on the CCXT page.

---

*Reported in good faith. DreamTend integrated directly via ethers.js + the SpotPool ABI rather than CCXT, partly because the CCXT path was JS-branch-only and we wanted production stability.*
