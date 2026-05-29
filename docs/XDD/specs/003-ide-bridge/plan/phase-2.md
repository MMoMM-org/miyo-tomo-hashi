---
title: "Phase 2: Editor Adapter, Tools & Selection Tracking"
status: in_progress
version: "1.0"
phase: 2
---

# Phase 2: Editor Adapter, Tools & Selection Tracking

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Solution Strategy; lines: 204-216]` — layer 3 (Domain/Tools) + layer 4 (Adapter seam)
- `[ref: SDD/Directory Map; lines: 256-264]` — `ObsidianEditorAdapter.ts`, `selectionTracker.ts`, `tools/*`
- `[ref: SDD/Tool registry; lines: 341-359]` — exact return shapes per tool
- `[ref: SDD/Implementation Examples/Selection broadcast; lines: 381-411]` — debounce + dedup + path build
- `[ref: SDD/Runtime View/openFile flow; lines: 499-504]` — path-safety → resolve → open
- `[ref: SDD/Implementation Examples/Test Examples; lines: 438-461]` — fake-adapter test shape
- `[ref: PRD/F5]`, `[ref: PRD/F6]`, `[ref: PRD/F7]`, `[ref: PRD/F8]`, `[ref: PRD/F11]`
- `[ref: PRD/Feature: Selection Changed Broadcast (F5); lines: 248-274]` — Business Rules 1–7 + edge cases

**Key Decisions**:
- ADR-5: CM6 `EditorView.updateListener` + `active-leaf-change`; 100ms trailing debounce; JSON dedup; `activeWindow` timers (popout-safe).
- ADR-7: tools emit **plain vault-relative** `filePath`/`fileUrl`; `getWorkspaceFolders` returns an **empty** array.
- Adapter seam exists so all tool/tracker logic is testable with a fake (Constitution L1/L3) — no live Obsidian in unit tests.

**Dependencies**:
- Phase 1 complete (`protocol.ts` types, `frame.ts`/`wsServer` broadcast contract are referenced by the tracker — but the tracker is tested against an injected `broadcast` fn, so it does not need T3.1 to land).
- `src/util/paths.ts` (`normalizeAndContain`) reused by `openFile`.

**Intra-phase ordering**:
- T2.1 lands first (the adapter seam + fake). T2.2/T2.3/T2.4 are then mutually independent (`[parallel: true]`) — they write disjoint files and depend only on the adapter + injected getters, **not** on each other or on T2.6.
- `getLatestSelection` (in T2.2) reads the last-broadcast cache via an **injected `getLatest()` getter** (an abstraction, stubbed in T2.2's tests). The concrete getter is produced by the tracker in T2.6 and wired by the orchestrator (T3.2) — so T2.2 has no build dependency on T2.6.
- T2.5 (registry) is **not** parallel and runs after T2.2–T2.4 (it imports their handlers). T2.6 (tracker) runs last in the phase.

---

## Tasks

This phase delivers the editor seam and every tool handler, plus the selection tracker that produces broadcasts. All logic is exercised through a `FakeEditorAdapter` so it runs without Obsidian.

- [x] **T2.1 Obsidian editor adapter + fake** `[activity: backend-api]`

  1. Prime: Read the adapter responsibilities `[ref: SDD/Directory Map; line: 256]`, the tool return shapes `[ref: SDD/Tool registry; lines: 345-349]`, and the existing `src/vault/VaultFS.ts` + `src/vault/FakeVaultFS.ts` pair (the established real/fake seam pattern to mirror). Note `getCursor` is 0-based.
  2. Test (against the fake): `getCurrentSelection()` returns `{ text, filePath (vault-relative), fileUrl, selection }` when a markdown editor is active and `null` when not; `getOpenEditors()` lists vault-relative paths with `isDirty:false`; `openFile(path)` records the opened path; `workspaceRoot()` behavior. The fake exposes a settable active selection + a `files` set + an `opened` capture.
  3. Implement:
     - `src/ide-bridge/ObsidianEditorAdapter.ts` — `EditorAdapter` interface + real impl reading `MarkdownView`/`editor.getCursor`/`workspace.getActiveViewOfType`/`getLeavesOfType("markdown")`/`workspace.openLinkText`. Convert Obsidian abs/path to **vault-relative** here. `fileUrl` is a `file://` URL whose path is the vault-relative path (no host absolute path — ADR-7).
     - `FakeEditorAdapter` (co-located or in `test/`) implementing the same interface for tests.
  4. Validate: Unit tests pass (fake only); lint clean; types check.
  5. Success: Adapter returns plain vault-relative paths and `null` outside markdown editors `[ref: PRD/F5; ref: SDD/ADR-7]`; the fake satisfies the same interface, enabling Obsidian-free tests `[ref: SDD/Test Examples; lines: 438-461]`.

- [x] **T2.2 Selection & workspace tools** `[activity: backend-api]` `[parallel: true]`

  1. Prime: Read tool shapes `[ref: SDD/Tool registry; lines: 345-349]` and F6/F11/F8 criteria `[ref: PRD/F6; ref: PRD/F11; ref: PRD/F8, line: 160]`. `getLatestSelection` reads the last-broadcast cache via an **injected `getLatest(): SelectionChangedParams | null` getter** — an abstraction stubbed in this task's tests; the real getter comes from the tracker (T2.6) wired by the orchestrator (T3.2). No build dependency on T2.6.
  2. Test: `getCurrentSelection` → adapter snapshot when a markdown editor is active; **empty result = `null`** when no editor (pin this exact shape; the e2e client in T5.1 asserts it). `getLatestSelection` → the injected getter's value (stub returns canned params); `null` when the stub returns `null`. `getOpenEditors` → tab list with vault-relative paths + `isDirty:false`, `{ tabs: [] }` when no markdown tabs. `getWorkspaceFolders` → **always** `{ workspaceFolders: [] }` regardless of editor state.
  3. Implement: `src/ide-bridge/tools/selection.ts` (`getCurrentSelection` via `adapter`; `getLatestSelection` via injected `getLatest`), `src/ide-bridge/tools/openEditors.ts` (`getOpenEditors`), `src/ide-bridge/tools/workspace.ts` (`getWorkspaceFolders`). Each handler takes `(params, adapter, ctx)` where `ctx` carries `getLatest` — so every handler is pure relative to injected state and the three files are genuinely parallel-safe.
  4. Validate: Unit tests pass; lint clean; types check.
  5. Success: `getWorkspaceFolders` returns empty unconditionally `[ref: PRD/F8, line: 160; ref: SDD/ADR-7]`; selection tools return the specified shapes incl. the pinned empty cases `[ref: PRD/F6, F11]`.

- [ ] **T2.3 openFile tool (path-safety)** `[activity: backend-api]` `[parallel: true]`

  1. Prime: Read the openFile flow `[ref: SDD/Runtime View; lines: 499-504]`, F7 criteria `[ref: PRD/F7]`, and `src/util/paths.ts` (`normalizeAndContain` — rejects absolute / `..` / drive-letter / double-sep).
  2. Test: rejects `../../etc/passwd` and absolute paths with JSON-RPC `-32602` (message contains "unsafe"); missing-but-safe path → `-32602` (not-found); existing vault file → adapter `opened` equals that path; empty path rejected.
  3. Implement: `src/ide-bridge/tools/openFile.ts` — validate via `normalizeAndContain` → on `!ok`, return `-32602` with a message **containing the word "unsafe"** (map `normalizeAndContain`'s `reason`, e.g. `"Path escapes vault root"`, into `unsafe path: <reason>` — the helper does not itself emit "unsafe", so openFile must wrap it to satisfy the assertion and match the SDD test example `[ref: SDD/Test Examples; line: 445]`); resolve via adapter (`getAbstractFileByPath`) → missing → `-32602`; else `openLinkText` and return success.
  4. Validate: Unit tests (mirror the SDD test example) pass; lint clean; types check.
  5. Success: Traversal/absolute paths rejected with `-32602`; existing file opens `[ref: PRD/F7; ref: SDD/Test Examples; lines: 442-452]`.

- [ ] **T2.4 Protocol stubs** `[activity: backend-api]` `[parallel: true]`

  1. Prime: Read the stub set `[ref: SDD/Tool registry; lines: 351-358]` and F8 criteria `[ref: PRD/F8; lines: 161-164]`.
  2. Test: `getDiagnostics → { diagnostics: [] }`; `checkDocumentDirty → { isDirty: false }`; `saveDocument → { saved: true }`; `close_tab → { closed: true }`; `closeAllDiffTabs → { closed: 0 }`. (`openDiff`/`executeCode` are NOT registered.)
  3. Implement: `src/ide-bridge/tools/stubs.ts` — the five no-op handlers above.
  4. Validate: Unit tests pass; lint clean; types check.
  5. Success: Each stub returns the documented shape; out-of-scope tools are absent `[ref: PRD/F8; ref: SDD/Tool registry; lines: 351-358]`.

- [ ] **T2.5 Tool registry & `tools/list`** `[activity: backend-api]`

  1. Prime: Read the registry responsibility `[ref: SDD/Directory Map; line: 259]` and `tools/call` targets `[ref: SDD/Tool registry; lines: 341-359]`. Depends on T2.2–T2.4 + Phase 1 `jsonRpc` dispatch contract.
  2. Test: registry maps each registered name → `{ description, inputSchema, handler }`; `buildToolsList()` returns exactly the registered tools (selection/openEditors/workspace/openFile + stubs) and **excludes** `openDiff`/`executeCode`; dispatching a registered name invokes its handler; dispatching an unregistered name yields `-32601` via the Phase 1 dispatcher.
  3. Implement: `src/ide-bridge/tools/index.ts` — assemble the registry from T2.2–T2.4 handlers and expose `buildToolsList()` for the `tools/list` response.
  4. Validate: Unit tests pass; lint clean; types check.
  5. Success: `tools/list` lists the in-scope set only; unknown tool → `-32601` `[ref: PRD/F8; ref: SDD/Tool registry; line: 357]`.

- [ ] **T2.6 Selection tracker (debounce + dedup + broadcast)** `[activity: backend-api]`

  1. Prime: Read the broadcast example `[ref: SDD/Implementation Examples; lines: 381-411]`, the primary flow `[ref: SDD/Runtime View; lines: 465-489]`, ADR-5 `[ref: SDD; lines: 609-612]`, and **all seven Business Rules + edge cases** `[ref: PRD/Feature F5; lines: 260-274]`. Needs T2.1 adapter + an injected `broadcast(msg)` fn (the real one arrives in T3.1).
  2. Test (with fake adapter + injected broadcast spy + fake timers):
     - rapid activity collapses to **one** broadcast after 100ms (trailing-edge) — Rule 2;
     - identical state does not re-broadcast (dedup) — Rule 3;
     - non-editor context → no broadcast — Rule 1;
     - active-leaf change broadcasts the new file's cursor — Rule 5;
     - text > 100KB truncated to 100KB, selection range preserved — Rule 4;
     - `latest` cache updates so `getLatestSelection` (T2.2) sees the last params;
     - teardown cancels a pending timer (no broadcast) — unload edge case.
  3. Implement: `src/ide-bridge/selectionTracker.ts` — `onEditorActivity()` arms an `activeWindow.setTimeout(flush, 100)`; `flush()` reads the adapter, builds `SelectionChangedParams` (plain vault-relative, ≤100KB), dedups against `lastKey`, updates `latest`, and calls `broadcast({ jsonrpc:"2.0", method:"selection_changed", params })`. Expose `getLatest()` and a `dispose()` that clears the timer. CM6 `updateListener`/`active-leaf-change` registration is wired by the orchestrator (T3.2) via `register*`.
  4. Validate: Unit tests pass under fake timers; lint clean; types check; no synchronous heavy work in the activity handler (Constitution L1).
  5. Success: Exactly one debounced, deduped broadcast per settled change with ≤100KB text and vault-relative path; no broadcast in non-editor contexts `[ref: PRD/F5; ref: SDD/ADR-5, ADR-7]`.

- [ ] **T2.7 Phase Validation** `[activity: validate]`

  - Run all Phase 2 tests, `npm run lint`, `npm run build`. Verify every tool's return shape against `[ref: SDD/Tool registry; lines: 341-359]` and that all F5 Business Rules have a corresponding passing test. Confirm no tool emits a host-absolute path or a custom path field (ADR-7), and all logic ran against the fake adapter (no live Obsidian).
