# Feedback Report 17 — `AGENTS.md` / `SKILL.md` Agent Contracts Return 404

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-29
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

## Type
**Docs Gap / Broken Reference**

## Severity
**Medium** — Docs reference `AGENTS.md` and `SKILL.md` as "auto-discoverable agent contracts," but both URLs 404. An agent that tries to auto-discover its contract via these files fails.

## Environment
- **Docs base:** https://docs.dreamdex.io/ld25g222WKDrLlJMcR41/
- **Claimed files:** `/AGENTS.md`, `/SKILL.md`

---

## Steps to Reproduce

1. Read the intro / agent-integration docs. They mention `SKILL.md` and `AGENTS.md` as machine-readable agent contracts for auto-discovery.
2. Fetch them directly:
   ```
   GET https://docs.dreamdex.io/ld25g222WKDrLlJMcR41/AGENTS.md  → 404 (does not exist)
   GET https://docs.dreamdex.io/ld25g222WKDrLlJMcR41/SKILL.md   → 404 (does not exist)
   ```
3. Both return "The URL … does not exist." The only related asset found is the GitHub repo `github.com/somnia-chain/somnia-skills` (not linked from the agent-contract mention).

## Expected Behavior

Either:
- Host `AGENTS.md` and `SKILL.md` at the referenced location (so agents can `wget` them), OR
- Link the canonical source (e.g., the `somnia-skills` repo) from the docs where these files are mentioned, OR
- Remove the references if the files don't exist yet.

## Actual Behavior

The files are named as agent contracts but 404 at the docs domain. An auto-discovering agent following the docs gets a dead link.

## Logs / Evidence

Direct fetches of both `/AGENTS.md` and `/SKILL.md` under the docs token path return 404. (Pairs with Feedback Report 16 — the MCP server referenced alongside these also has no published endpoint. The whole "auto-discoverable agent contract" surface is advertised but not wired up.)

## Impact

- **Auto-discovery broken** for any agent following the documented contract path.
- **Compounds the agent-integration gap** (with MCP, Report 16): the "agentic" surface is marketed but the concrete artifacts (MCP endpoint, AGENTS.md, SKILL.md) are all missing/404.
- Wastes integrator time chasing dead links.

## Suggested Fix

1. Host the files at the referenced URLs, or link the `somnia-skills` repo from the docs.
2. If not ready, remove/relabel the references as roadmap.

## Acceptance Criteria

- [ ] `AGENTS.md` and `SKILL.md` either resolve (200) at the documented location or the docs point to the correct canonical source.
- [ ] No dead references remain in the agent-integration section.

---

*Reported in good faith. See also Feedback Report 16 (MCP server URL not published) — same agent-integration surface.*
