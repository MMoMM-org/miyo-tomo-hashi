---
title: "Phase 1: Protocol & Transport Primitives"
status: completed
version: "1.0"
phase: 1
---

# Phase 1: Protocol & Transport Primitives

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Solution Strategy; lines: 204-216]` — layered subsystem; layer 1 (Transport) + layer 2 (Protocol)
- `[ref: SDD/Building Block View/Directory Map; lines: 242-279]` — file responsibilities for `frame.ts`, `handshake.ts`, `jsonRpc.ts`, `protocol.ts`, `token.ts`, `state.ts`, `ideBridgeStore.ts`
- `[ref: SDD/Interface Specifications/Application Data Models; lines: 291-321]` — `IdeBridgeState`, `SelectionChangedParams`, `Pos`
- `[ref: SDD/Implementation Examples/Upgrade auth; lines: 414-435]` — 401-before-handshake + `Sec-WebSocket-Accept`
- `[ref: SDD/Error Handling; lines: 506-513]` — JSON-RPC error codes
- `[ref: SDD/Implementation Gotchas; lines: 678-685]` — Sec-WebSocket-Accept GUID, frame masking, reject-before-upgrade
- `[ref: PRD/F4]`, `[ref: PRD/F8]`, `[ref: PRD/F3]`, `[ref: PRD/F16]`

**Key Decisions**:
- ADR-1: hand-rolled RFC 6455 over `node:http` — TEXT + PING/PONG only, no binary/fragmentation/extensions.
- ADR-2: all files live under `src/ide-bridge/`.
- ADR-3: `ideBridgeStore` reuses `Store<T>` from `src/util/store.ts`.
- ADR-4: token format `hashi_${crypto.randomUUID()}`.

**Dependencies**:
- None (this is the foundation phase). T1.2/T1.3/T1.4 can run in parallel after T1.1 lands the shared types.

---

## Tasks

This phase establishes the pure, Obsidian-free building blocks: protocol types and state, the RFC 6455 frame codec, the WebSocket handshake/auth, the auth token, and JSON-RPC dispatch. Everything here is unit-testable with no live Obsidian and no running server.

- [x] **T1.1 Protocol types & IdeBridge state** `[activity: domain-modeling]`

  1. Prime: Read the data models `[ref: SDD/Interface Specifications/Application Data Models; lines: 294-320]` and the `ConnectionState` shape in `src/connection/state.ts` + `Store<T>` in `src/util/store.ts` (mirror these patterns).
  2. Test: `IdeBridgeState` exhaustive-switch coverage (a helper that maps each variant to a label/color, proving all four `kind`s handled); `ideBridgeStore` notifies subscribers on `set` and the returned unsubscribe stops notifications (mirror existing store tests).
  3. Implement:
     - `src/ide-bridge/protocol.ts` — `RpcRequest`, `RpcResponse`, `RpcError` (with `code`/`message`), `SelectionChangedParams` (`text`, `filePath`, `fileUrl`, `selection`), `Pos` (`line`, `character`, 0-based), `ToolName` union. **No** `vaultRelativePath` field (ADR-7 / §2.3 forbids custom path-field extensions — standard `filePath` IS vault-relative).
     - `src/ide-bridge/state.ts` — `IdeBridgeState = { kind:"stopped" } | { kind:"listening"; port } | { kind:"connected"; port; clientCount } | { kind:"error"; reason }`.
     - `src/ide-bridge/ideBridgeStore.ts` — `export const ideBridgeStore = new Store<IdeBridgeState>({ kind: "stopped" })`.
  4. Validate: Unit tests pass; `npm run lint` clean; `npm run build` typechecks (no `any`).
  5. Success: `IdeBridgeState` has exactly the four variants `[ref: SDD; lines: 294-298]`; `SelectionChangedParams` carries plain vault-relative `filePath` and **no** extra path field `[ref: PRD/F5; ref: SDD/ADR-7]`.

- [x] **T1.2 RFC 6455 frame codec** `[activity: backend-api]` `[parallel: true]`

  1. Prime: Read the frame responsibilities `[ref: SDD/Directory Map; line: 251]` and the masking/PING-PONG/CLOSE gotchas `[ref: SDD/Implementation Gotchas; line: 681]`; skim the ~70-LOC codec in the obsidian-claude-ide reference.
  2. Test: encode a TEXT frame (server→client, **unmasked**) round-trips through a decoder; decode a **masked** client→server TEXT frame yields the original payload; PING decodes and a PONG can be encoded; CLOSE frame recognized; payload-length boundaries (≤125, 126–65535 / 16-bit, >65535 / 64-bit) encode/decode correctly; a partial/truncated buffer does not throw (returns "need more bytes").
  3. Implement: `src/ide-bridge/frame.ts` — `encodeText(s)`, `encodePing()`/`encodePong(payload)`, `encodeClose(code?)`, and `decodeFrames(buffer) → { frames, rest }` handling opcode, MASK bit + unmasking, and the three length encodings.
  4. Validate: Unit tests pass (table-driven across length boundaries); lint clean; types check.
  5. Success: Masked client frames unmask correctly and server frames are emitted unmasked `[ref: SDD; line: 681]`; codec never throws on a partial buffer `[ref: SDD/Error Handling; line: 510]`.

- [x] **T1.3 WebSocket handshake & auth** `[activity: backend-api]` `[parallel: true]`

  1. Prime: Read the upgrade-auth example `[ref: SDD/Implementation Examples; lines: 414-435]`, the Sec-WebSocket-Accept gotcha `[ref: SDD/Implementation Gotchas; line: 680]`, and the auth interface spec `[ref: SDD/Interface Specifications; lines: 167-172]`.
  2. Test: `secWebSocketAccept(key)` returns the RFC value (SHA-1 of key + magic GUID `258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, base64) for a known fixture — the canonical RFC 6455 §1.3 example: key `dGhlIHNhbXBsZSBub25jZQ==` → accept `s3pPLMBiTxaQ9kYGzzhZRbK+xOo=` (corrected 2026-05-29: an earlier draft mistyped the GUID suffix as `B16`, which silently breaks interop with real Claude Code clients); auth check **rejects** a missing header, **rejects** a wrong token, **accepts** the exact stored token; a non-string header value is rejected.
  3. Implement: `src/ide-bridge/handshake.ts` — `secWebSocketAccept(key: string): string` (uses `node:crypto`) and `isAuthorized(headerValue: unknown, token: string): boolean` (checks `x-claude-code-ide-authorization`). Keep both pure (no socket I/O — the socket write lives in `wsServer`, T3.1).
  4. Validate: Unit tests pass against a fixed key→accept fixture; lint clean; types check.
  5. Success: Correct `Sec-WebSocket-Accept` for a known key `[ref: SDD; line: 680]`; auth returns false for missing/wrong token and true only for an exact match `[ref: PRD/F4]`.

- [x] **T1.4 Auth token lifecycle (pure)** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: Read the token rules `[ref: PRD/Feature: Auth Token Lifecycle (F3); lines: 288-292]` and ADR-4 `[ref: SDD; lines: 604-607]`. Note `kado_<UUID>` precedent.
  2. Test: `generateToken()` returns a `hashi_`-prefixed string with a valid UUID body and two calls differ; `ensureToken(current)` returns the existing token when non-empty and a freshly generated one when empty.
  3. Implement: `src/ide-bridge/token.ts` — `generateToken(): string` (`hashi_${crypto.randomUUID()}`) and `ensureToken(current: string): string`. Pure functions; persistence is the orchestrator's job (T3.2). **No `lockFile.ts`** (ADR-8 superseded — Tomo writes the container lock file).
  4. Validate: Unit tests pass; lint clean; types check.
  5. Success: Token matches `hashi_<UUID>` `[ref: PRD/F3; ref: SDD/ADR-4]`; no lock-file module is created `[ref: SDD/ADR-8 superseded; lines: 625-630]`.

- [x] **T1.5 JSON-RPC dispatch & error envelopes** `[activity: backend-api]`

  1. Prime: Read the error-handling spec `[ref: SDD/Error Handling; lines: 506-513]`, the dispatch responsibility `[ref: SDD/Directory Map; line: 253]`, and F8's unknown-method criterion `[ref: PRD/F8; line: 164]`. Depends on T1.1 types.
  2. Test: parse error on malformed JSON → `-32700`; invalid request envelope → `-32600`; unknown method → `-32601`; a registered method routes to its handler and wraps the result in a `{ jsonrpc:"2.0", id, result }` envelope; a notification (no `id`) produces no response; a handler that throws is caught and mapped to an error envelope (never propagates out of the loop).
  3. Implement: `src/ide-bridge/jsonRpc.ts` — `parseMessage(raw) → RpcRequest | RpcError`, `dispatch(req, registry) → RpcResponse | null`, and error-envelope builders. Routing target is the tool registry (built in Phase 2); accept the registry as an injected map so this stays testable with a stub.
  4. Validate: Unit tests cover each error code + happy path + throw-isolation; lint clean; types check.
  5. Success: Each malformed/unknown input maps to the correct JSON-RPC code and nothing throws out of dispatch `[ref: SDD/Error Handling; lines: 510-511]`; unknown method → `-32601` `[ref: PRD/F8]`.

- [x] **T1.6 Phase Validation** `[activity: validate]`

  - Run all Phase 1 tests (`npm test`), `npm run lint`, and `npm run build` (tsc gate). Verify against SDD layer-1/layer-2 design and PRD F4/F8 criteria. Confirm zero new runtime dependencies in `package.json` (ADR-1 / Constitution L1). Confirm no `lockFile.ts` exists.
