---
title: "Phase 3: WebSocket Server & Orchestrator"
status: pending
version: "1.0"
phase: 3
---

# Phase 3: WebSocket Server & Orchestrator

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Directory Map; lines: 248-254]` — `wsServer.ts`, `IdeBridge.ts` responsibilities
- `[ref: SDD/Internal API Changes — IdeBridge orchestrator; lines: 323-339]` — constructor deps + method contracts
- `[ref: SDD/Implementation Examples/Upgrade auth; lines: 414-435]` — reject-before-handshake
- `[ref: SDD/Runtime View/Connect & handshake; lines: 491-497]` — MCP handshake sequence
- `[ref: SDD/Error Handling; lines: 506-513]` — EADDRINUSE, dead-client reaping, frame-loop isolation
- `[ref: SDD/Interface Specifications; lines: 167-181]` — inbound WS contract; `outbound: []` (no files written)
- `[ref: PRD/F1]`, `[ref: PRD/F4]`, `[ref: PRD/F9]`, `[ref: PRD/F3 regenerate]`

**Key Decisions**:
- ADR-1: server is `http.createServer` + `'upgrade'` handler; hand-rolled framing from Phase 1.
- ADR-8 (superseded): **no lock file** — `start()` only listens; `outbound: []`.
- Single 500ms EADDRINUSE re-listen only (Kado hot-reload race); full crash auto-restart (F15) deferred.
- `IdeBridge` is the **single writer** of `ideBridgeStore` and the sole owner of the token + server + tracker.

**Dependencies**:
- Phase 1 (frame, handshake, jsonRpc, token, state/store) and Phase 2 (tool registry, selectionTracker) complete.

---

## Tasks

This phase assembles the transport server and the lifecycle orchestrator: a running WebSocket endpoint that authenticates, completes the MCP handshake, broadcasts `selection_changed`, reaps dead clients, and is driven by an idempotent `start`/`stop`/`regenerateToken` API.

- [ ] **T3.1 WebSocket server (upgrade, broadcast, keepalive)** `[activity: backend-api]`

  1. Prime: Read the upgrade-auth example `[ref: SDD/Implementation Examples; lines: 414-435]`, the connect/handshake flow `[ref: SDD/Runtime View; lines: 491-497]`, error handling `[ref: SDD/Error Handling; lines: 506-512]`, and F1/F4/F9 criteria. Reuse Phase 1 `frame.ts`, `handshake.ts`, `jsonRpc.ts`.
  2. Test (use a real loopback `http` server on an ephemeral port + a raw TCP/WS client, or a socket double):
     - **missing** auth header → HTTP **401** and **no** upgrade (`upgraded === false`) — F4;
     - **wrong** token → 401, no upgrade, and a `warn` log containing the rejected token, **no** remote address — F4 + F16;
     - **valid** token → 101 Switching Protocols with correct `Sec-WebSocket-Accept`, client registered, and the `onClientCountChange(1)` callback fires (the **store transition** to `connected{clientCount:1}` is owned by IdeBridge, T3.2 — wsServer does not touch `ideBridgeStore`) — F1/F4;
     - MCP handshake: `initialize` → `{ protocolVersion, capabilities:{tools:{}}, serverInfo }`, `notifications/initialized` (no response), `tools/list` → in-scope registry — F1;
     - `broadcast(msg)` frames a TEXT JSON-RPC notification to every client (unmasked) — F5 transport;
     - ping loop: a client that never PONGs within 30s is closed; `onClientCountChange` fires with the recomputed count; at zero clients the server keeps listening (IdeBridge maps `0` → `listening`) — F9;
     - bind address other than `127.0.0.1` is refused — F4 / Security;
     - `EADDRINUSE` → after a single 500ms re-listen attempt the `onListenError("port {p} in use")` callback fires (IdeBridge maps it to `error{reason}`) — Error Handling;
     - malformed JSON-RPC over the socket maps to a `-32700`/`-32601` error and never throws out of the frame loop.
  3. Implement: `src/ide-bridge/wsServer.ts` — `http.createServer` bound to `127.0.0.1`; `'upgrade'` handler (validate via `isAuthorized`; on fail `socket.write("HTTP/1.1 401 …")` + `destroy()`; on pass write 101 + `secWebSocketAccept` and register the client); a client `Set`; `broadcast(obj)`; per-client read loop decoding frames (handle PING→PONG, CLOSE) and routing TEXT JSON-RPC via `dispatch`; a 30s ping/pong keepalive reaping unresponsive clients; EADDRINUSE single-retry. **Single-writer discipline (ADR-3): wsServer never calls `ideBridgeStore.set()` — it surfaces state via injected callbacks `onClientCountChange(n)` and `onListenError(reason)`; IdeBridge (T3.2) is the sole store writer.** Writes **no files** (`outbound: []`).
  4. Validate: Integration-style tests pass against a loopback server; lint clean; types check; confirm `0.0.0.0` is impossible to configure (review blocker per Quality Requirements).
  5. Success: 401 before handshake on bad/missing token and 101 + working broadcast on a valid one `[ref: PRD/F1, F4]`; dead clients reaped at 30s, server stays up at zero clients `[ref: PRD/F9]`; rejected token is `warn`-logged without a remote address `[ref: PRD/F16]`.

- [ ] **T3.2 IdeBridge orchestrator (lifecycle + token)** `[activity: backend-api]`

  1. Prime: Read the orchestrator API `[ref: SDD/Internal API Changes; lines: 323-339]`, the token getter-vs-snapshot gotcha `[ref: SDD/Implementation Gotchas; line: 685]`, and the deployment/rollback notes `[ref: SDD/Deployment View; lines: 524-527]`. Reuse Phase 1 `token.ts` + `ideBridgeStore`, Phase 2 `selectionTracker`, T3.1 `wsServer`.
  2. Test (with a fake wsServer + fake adapter + injected `persist` spy):
     - `start()` is idempotent (second call is a no-op), calls `ensureToken` then listens, and sets store `listening` (or `error` on EADDRINUSE);
     - `stop()` is idempotent, closes all clients then the server, sets store `stopped`;
     - `isRunning()` reflects state (single source of truth for the settings UI);
     - `regenerateToken()` mints a new `hashi_<UUID>`, calls `persist`, disconnects current clients, and writes **no** lock file;
     - `getToken()` returns the current token;
     - the orchestrator reads settings through the **getter** (a reassigned settings object is still seen) — Gotcha line 685;
     - teardown disposes the selection tracker timer.
  3. Implement: `src/ide-bridge/IdeBridge.ts` — `constructor({ app, getSettings, persist, log })`; `start()/stop()/isRunning()/regenerateToken()/getToken()`; owns the wsServer, token, selectionTracker, and `ideBridgeStore` (**single writer** — the only place `ideBridgeStore.set()` is called; it subscribes to wsServer's `onClientCountChange`/`onListenError` callbacks and translates them into store transitions). Wires `selectionTracker.broadcast = wsServer.broadcast` and `selection tools' getLatest = selectionTracker.getLatest`. The CM6 `updateListener` + `active-leaf-change` registration via the plugin's `register*` is **deferred to T4.5** (where the `Plugin` handle is available); IdeBridge exposes the tracker's `onEditorActivity` for that wiring. **No lock file written.**
  4. Validate: Unit tests pass (fake server/adapter); lint clean; types check.
  5. Success: Idempotent start/stop; `regenerateToken` rotates the token, persists it, disconnects clients, and writes no lock file `[ref: PRD/F3; ref: SDD/ADR-8 superseded]`; store transitions match `IdeBridgeState` `[ref: SDD; lines: 294-298]`.

- [ ] **T3.3 Phase Validation** `[activity: validate]`

  - Run all Phase 3 tests, `npm run lint`, `npm run build`. Verify the full connect→handshake→broadcast→reap path against `[ref: SDD/Runtime View; lines: 465-497]`. Confirm: bind is `127.0.0.1`-only, 401 happens pre-handshake, no file is ever written by the bridge (grep for `writeFile`/`mkdir` in `src/ide-bridge/` → none), and start/stop are idempotent.
