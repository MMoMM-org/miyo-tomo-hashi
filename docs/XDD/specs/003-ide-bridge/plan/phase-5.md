---
title: "Phase 5: End-to-End Integration & Documentation"
status: completed
version: "1.0"
phase: 5
---

# Phase 5: End-to-End Integration & Documentation

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Runtime View; lines: 463-513]` — full connect → handshake → broadcast → error paths
- `[ref: SDD/Acceptance Criteria; lines: 639-666]` — the SDD's own EARS acceptance list (the master checklist)
- `[ref: SDD/Quality Requirements; lines: 632-637]` — performance/security/reliability targets
- `[ref: SDD/Directory Map/Docs; lines: 281-285]` — `PRIVACY.md`, `README.md` updates
- `[ref: PRD/F14]`, `[ref: PRD/Success Metrics; lines: 299-319]`
- Constitution L1 Testing: external surfaces need registration/discovery + representative end-to-end calls; L2 regression-test on fixes.

**Key Decisions**:
- The IDE Bridge is an **external surface** → Constitution L1 mandates integration tests that exercise the handshake and a representative set of end-to-end calls against a fake/loopback (not just unit tests).
- No telemetry / no external network / no vault content in logs — verified here as a release gate.

**Dependencies**:
- Phases 1–4 complete (the bridge builds, runs, and is wired into the plugin).

---

## Tasks

This phase proves the assembled system end-to-end, documents the network surface, and runs the full specification-compliance gate before the plan is marked done.

- [x] **T5.1 End-to-end protocol integration test** `[activity: integration-testing]`

  1. Prime: Read the connect/handshake + primary flows `[ref: SDD/Runtime View; lines: 465-497]` and the SDD acceptance list `[ref: SDD/Acceptance Criteria; lines: 639-666]`. Reuse the loopback-server harness from T3.1; drive it with a raw WebSocket client (hand-rolled frames from `frame.ts`) on an ephemeral port.
  2. Test (true end-to-end, real `IdeBridge.start()` on `127.0.0.1:0`):
     - **Auth gate**: connect with a wrong/missing token → HTTP 401, no upgrade; connect with the bridge's actual token → 101 + open socket.
     - **MCP handshake**: `initialize` → valid result; `notifications/initialized` (no reply); `tools/list` → exactly the in-scope tools (no `openDiff`/`executeCode`).
     - **Broadcast delivery**: drive a fake editor selection through the tracker → the connected client receives one `selection_changed` TEXT frame with a plain vault-relative `filePath`, empty-ish `workspaceFolders` semantics upheld (via `getWorkspaceFolders` call returning `[]`).
     - **Tool round-trips**: `tools/call getCurrentSelection`, `getLatestSelection`, `getOpenEditors`, `openFile` (happy + `-32602` traversal), `getWorkspaceFolders` (empty), an unknown method (`-32601`).
     - **Keepalive**: PING→PONG round-trip; a non-responding client is reaped (use fake/short timer where feasible).
     - **Lifecycle**: `stop()` closes the client socket and frees the port (a subsequent `start()` on the same port succeeds).
  3. Implement: `test/integration/ide-bridge.e2e.test.ts` (or under `test/unit/` per repo convention) — the harness + the scenarios above. Use the fake editor adapter for editor state; the WebSocket transport is real.
  4. Validate: `npm test` green incl. the new suite; no port leakage between tests (each uses an ephemeral port and tears down); lint clean; types check.
  5. Success: A representative end-to-end set (handshake + each tool + broadcast + keepalive + auth reject) passes against a real loopback WebSocket `[ref: SDD/Acceptance Criteria; lines: 639-666; ref: Constitution L1 Testing]`.

- [x] **T5.2 PRIVACY.md + README documentation** `[activity: documentation]` `[parallel: true]`

  1. Prime: Read F14 `[ref: PRD/F14]`, the security/UX surface `[ref: SDD/System-Wide Patterns; line: 582; ref: SDD/Interface Specifications; lines: 167-174]`, and the existing `PRIVACY.md` + `README.md` at the repo root (match tone/structure).
  2. Test: documentation review (no automated test) — confirm `PRIVACY.md` states the WebSocket surface, the `127.0.0.1`-only bind, the data transmitted (file paths, cursor positions, selected text — **ephemeral only, never logged/persisted**), and the auth mechanism (`x-claude-code-ide-authorization`); confirm it notes Hashi writes **no** lock file (Tomo, container-side).
  3. Implement: `PRIVACY.md` — add the IDE Bridge network-surface section (F14). `README.md` — add IDE Bridge to the feature list + a setup pointer to the Tomo Docker-wiring handoff (token + port; Tomo writes the container lock file).
  4. Validate: `npm run lint` (manifest/markdown unaffected); a reader can verify exactly what the bridge exposes and to whom.
  5. Success: PRIVACY.md documents bind address, data sent (ephemeral), and auth; no undocumented network surface `[ref: PRD/F14; ref: Constitution L1 Privacy]`.

- [x] **T5.3 Full specification-compliance validation** `[activity: validate]`

  1. Prime: Read the SDD acceptance list `[ref: SDD/Acceptance Criteria; lines: 639-666]`, Quality Requirements `[ref: SDD/Quality Requirements; lines: 632-637]`, and the PRD success metrics `[ref: PRD; lines: 299-319]`.
  2. Verify (release gate):
     - `npm test`, `npm run lint`, `npm run build` all green.
     - Every PRD acceptance criterion (F1, F3–F16) maps to a passing test or a verified manual check; record any gaps.
     - Security gates: `127.0.0.1`-only bind (no `0.0.0.0` path anywhere), 401 before handshake, selected text never logged/persisted, token cleartext-by-design only.
     - Constitution gates: zero new runtime deps in `package.json` (ADR-1/L1); no main-thread blocking on selection (100ms debounce + dedup + 100KB cap); failure/denial-path tests exist for every FS-touching path (`openFile`) and every auth path (L1 Testing); no vault content in any log (L2).
     - Performance NFRs (`<200ms` editor-change→frame, `<1MB` overhead, no measurable typing latency) are verified **by-construction** (debounce + dedup + cap + async I/O + the proven reference impl), **not** by a latency/memory measurement test in v0.1. Record this explicitly as a deliberate decision so the gap is acknowledged, not silent `[ref: SDD/Quality Requirements; line: 634]`.
     - No lock file written by Hashi (grep `src/ide-bridge/` for `writeFile`/`mkdir` → none); ADR-8-superseded contract honored.
  3. Implement: address any gaps found (add missing tests / fix drift), then update `docs/XDD/specs/003-ide-bridge/README.md` Documents table (`plan/` → completed) and Decisions Log.
  4. Validate: re-run the full gate after fixes; run `/validate` to catch PRD ↔ SDD ↔ Plan drift (per `docs/CLAUDE.md` XDD discipline).
  5. Success: Full build/lint/test green; all PRD acceptance criteria traced to evidence; all Constitution L1/L2 gates verified `[ref: SDD/Acceptance Criteria; ref: SDD/Quality Requirements; ref: miyo-constitution L1/L2]`.
