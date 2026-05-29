# Feedback Report 16 — MCP Server Advertised But No Endpoint Published

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-29
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

## Type
**Docs Gap / Marketing-vs-Reality**

## Severity
**Medium** — The docs promote a "native MCP server" as an agent-integration feature, but no actual server URL/endpoint is published, so the advertised capability cannot be used.

## Environment
- **Docs:** Intro / "Why DreamDEX" pages (agent-integration section)

---

## Steps to Reproduce

1. Read the intro / "Why DreamDEX" docs. They highlight agent-friendliness, including a **"native MCP server"** (Model Context Protocol) for AI-agent integration.
2. Search the docs for the MCP server's **URL, endpoint, or connection instructions**.
3. Find none. Querying the docs' own assistant confirms: *"what's not published … is an actual MCP server URL or endpoint."*

## Expected Behavior

If an MCP server is advertised, the docs should publish:
- The server URL / connection string.
- Auth requirements (if any).
- A minimal "connect your agent to DreamDEX MCP" example.

OR, if it isn't live yet, label it clearly as "coming soon / roadmap" so integrators don't go looking for a non-existent endpoint.

## Actual Behavior

The MCP server is named as a feature but has no published endpoint or usage instructions anywhere in the docs. An agent developer reading the marketing cannot act on it.

## Logs / Evidence

The docs query interface explicitly returns that no MCP server URL/endpoint is published despite the feature being mentioned. (Related: Feedback Report 17 — the `AGENTS.md`/`SKILL.md` "agent contracts" referenced alongside MCP also 404.)

## Impact

- **Advertised agent feature is unusable** — the one thing AI-agent builders would reach for has no entry point.
- **Marketing-vs-reality gap** erodes trust in other documented capabilities.
- For an "Agentic L1" positioning (Somnia), a dangling MCP claim undercuts the core narrative.

## Suggested Fix

1. Publish the MCP server URL + a connect example, OR
2. Mark it explicitly as "roadmap / not yet available" with an ETA.

## Acceptance Criteria

- [ ] Docs either provide a working MCP endpoint + example, or clearly label it as not-yet-available.

---

*Reported in good faith. DreamTend integrated agent capabilities via the Somnia Agent Kit (Agent #45) instead, since no DreamDEX MCP endpoint was available.*
