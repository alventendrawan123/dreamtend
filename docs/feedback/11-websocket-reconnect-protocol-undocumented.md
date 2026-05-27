# Feedback Report 11 — WebSocket Reconnect & Resume Protocol Undocumented

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-28
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

## Type
**WebSocket Protocol / Docs Gap**

## Severity
**Medium** — Bots that subscribe to `wss://api.dreamdex.io/v0/ws/public` have no documented contract for handling reconnects, missed messages, or resume tokens. The first connection drop forces every integrator to either rebuild orderbook state from REST polling or accept gaps.

## Environment
- **Network:** Somnia mainnet (chainId 5031)
- **WS endpoint:** `wss://api.dreamdex.io/v0/ws/public`
- **Tools:** `ws` (Node v22), Browser DevTools, `wscat`
- **Docs referenced:** Developers > HTTP API page, sparse WS subsection

---

## Steps to Reproduce

1. Open a WebSocket connection and subscribe to a channel per the documented pattern:
   ```typescript
   const ws = new WebSocket("wss://api.dreamdex.io/v0/ws/public");
   ws.on("open", () => {
     ws.send(JSON.stringify({ op: "subscribe", channel: "orderbook:WETH:USDso" }));
   });
   ```
2. Receive a snapshot + incremental updates. Note the message format: no `seqNum`, no `lastEventId`, no `resumeToken`.
3. Disconnect the network briefly (e.g., flip wifi off for 5 seconds, then back on).
4. Observe:
   - `ws.on("close")` fires with code 1006 ("Abnormal Closure")
   - No documented heartbeat interval
   - No documented reconnect URL with cursor
   - No documented way to know what messages were missed

5. Reconnect with a fresh subscribe. Receive a new snapshot. **No information** about messages emitted during the disconnect window.

6. Manually compare orderbook state against a fresh REST `/orderbooks/WETH:USDso` call to detect drift.

## Expected Behavior

A documented reconnect protocol covering:

1. **Heartbeat / ping interval.** "Server sends `{op: 'ping'}` every N seconds; client must reply `{op: 'pong'}` within M seconds or be disconnected."

2. **Resume cursor.** Either:
   - Server includes `seqNum` on every message; client tracks last-received seqNum; reconnect URL is `wss://...?resume_from=N`, OR
   - Server emits a `cursor` field; client stores last cursor; subscribe message can include `{ op: "subscribe", channel: "...", from_cursor: "..." }`.

3. **Replay behavior.** On reconnect with cursor, server sends:
   - All events from `cursor + 1` up to current head
   - Then continues with live stream
   - If `cursor` is too old (e.g., past retention window), server sends a fresh snapshot + `gap: true` flag

4. **Connection-level metadata.** On `open`, server sends a hello message:
   ```json
   {
     "type": "hello",
     "session_id": "abc123",
     "heartbeat_interval_s": 30,
     "max_subscriptions": 100,
     "version": "v0"
   }
   ```

## Actual Behavior

- No heartbeat pattern documented.
- Connection drops silently when network blips; no auto-reconnect at the protocol level.
- Subscribe-fresh-after-disconnect loses any updates that occurred during the gap.
- No way to know retroactively whether anything was missed.

DreamTend's workaround:
- Wrap WS client in a reconnect loop with exponential backoff
- On reconnect, immediately fire a REST `/orderbooks/<pair>` call to refresh the snapshot
- Treat WS as "best-effort hint" rather than authoritative — fall back to RPC `getBookLevels` if state ever feels stale

This works but loses the latency advantage of WS (which was its main value-add over REST polling).

## Logs / Evidence

DreamTend client (`src/dex/ws.ts`) keepalive log on 2026-05-26 evening during the documented REST API hiccup:

```
[20:14:33] WS open, subscribed to orderbook:WETH:USDso
[20:18:01] WS message received (orderbook snapshot)
...regular updates for 4h 23min...
[00:41:17] WS close, code=1006 reason="Abnormal Closure"
[00:41:17] Reconnecting in 2s
[00:41:19] WS open, subscribed to orderbook:WETH:USDso
[00:41:19] [WARN] No resume protocol — full snapshot will be re-fetched
[00:41:20] REST /orderbooks/WETH:USDso → got fresh snapshot
[00:41:20] Drift check: 3 levels mismatched between last-WS and fresh-REST states
            (likely 2-3 missed updates during disconnect window)
```

## Impact

- **Latency advantage lost:** WS becomes a notification trigger only; REST is the authoritative source. Defeats the purpose of WS subscriptions for low-latency strategies.
- **Strategy correctness risk:** Bots that act purely on WS state can develop silent drift that causes incorrect orders (e.g., place a maker order at a price level that no longer exists).
- **Reconnect storm risk:** Without a documented backoff pattern, naïve clients reconnect aggressively after network blips, potentially DoSing the server.
- **No observability:** Bots can't measure their own missed-message rate because there's no seqNum to count gaps in.

## Suggested Fix

In order of preference:

1. **Document the existing reconnect behavior** (if any). Even "there is no resume; always refetch via REST after disconnect" is better than nothing — at least integrators design for it explicitly.

2. **Add `seqNum` to every message + `?resume_from=N` query param** on the WS URL. Simple, well-understood pattern (used by Binance, Coinbase WS).

3. **Add hello message + heartbeat protocol.** Required for any production-grade WS API. Prevents silent connection death after middlebox idle timeouts.

4. **Document expected behavior under team-side events** (deploys, restarts). Right now integrators can't distinguish "my network blipped" from "DreamDEX deployed" from "permanent server failure" — all look like code 1006.

## Acceptance Criteria

This report would be resolved when:
- [ ] WS docs describe heartbeat + reconnect + resume behavior explicitly.
- [ ] If no resume is supported, docs say so explicitly + recommend REST-refresh pattern.
- [ ] If seqNum is added, all messages include it and the server supports `?resume_from=` on the WS URL.

---

*Reported in good faith. DreamTend's WS client in `src/dex/ws.ts` ships the REST-refresh-on-reconnect workaround.*
