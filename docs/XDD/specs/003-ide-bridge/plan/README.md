---
title: "Hashi IDE Bridge — Implementation Plan"
status: draft
version: "1.0"
---

# Implementation Plan

## Validation Checklist

### CRITICAL GATES (Must Pass)

- [x] All `[NEEDS CLARIFICATION: ...]` markers have been addressed
- [x] All specification file paths are correct and exist
- [x] Each phase follows TDD: Prime → Test → Implement → Validate
- [x] Every task has verifiable success criteria
- [x] A developer could follow this plan independently

### QUALITY CHECKS (Should Pass)

- [x] Context priming section is complete
- [x] All implementation phases are defined with linked phase files
- [x] Dependencies between phases are clear (no circular dependencies)
- [x] Parallel work is properly tagged with `[parallel: true]`
- [x] Activity hints provided for specialist selection `[activity: type]`
- [x] Every phase references relevant SDD sections
- [x] Every test references PRD acceptance criteria
- [x] Integration & E2E tests defined in final phase
- [x] Project commands match actual project setup

---

## Output Schema

### PLAN Status Report

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| specId | string | Yes | Spec identifier (NNN-name format) |
| title | string | Yes | Feature title |
| status | enum: `DRAFT`, `IN_REVIEW`, `COMPLETE` | Yes | Document readiness |
| phases | PhaseStatus[] | Yes | Status of each implementation phase |
| totalTasks | number | Yes | Total tasks across all phases |
| parallelTasks | number | Yes | Tasks marked `[parallel: true]` |
| specReferences | number | Yes | Count of `[ref: ...]` specification links |
| clarificationsRemaining | number | Yes | Count of `[NEEDS CLARIFICATION]` markers |

### PhaseStatus

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| phase | number | Yes | Phase number |
| name | string | Yes | Phase name |
| status | enum: `COMPLETE`, `NEEDS_CLARIFICATION`, `IN_PROGRESS` | Yes | Current state |
| tasks | number | Yes | Task count in this phase |
| file | string | Yes | Path to phase file (phase-N.md) |
| detail | string | No | What needs clarification or what's in progress |

---

## Specification Compliance Guidelines

### How to Ensure Specification Adherence

1. **Before Each Phase**: Complete the Pre-Implementation Specification Gate
2. **During Implementation**: Reference specific SDD sections in each task
3. **After Each Task**: Run Specification Compliance checks
4. **Phase Completion**: Verify all specification requirements are met

### Deviation Protocol

When implementation requires changes from the specification:
1. Document the deviation with clear rationale
2. Obtain approval before proceeding
3. Update SDD when the deviation improves the design
4. Record all deviations in this plan for traceability

## Metadata Reference

- `[parallel: true]` - Tasks that can run concurrently
- `[component: component-name]` - For multi-component features
- `[ref: document/section; lines: 1, 2-3]` - Links to specifications, patterns, or interfaces and (if applicable) line(s)
- `[activity: type]` - Activity hint for specialist agent selection

### Success Criteria

**Validate** = Process verification ("did we follow TDD?")
**Success** = Outcome verification ("does it work correctly?")

```markdown
# Single-line format
- Success: [Criterion] `[ref: PRD/AC-X.Y]`

# Multi-line format
- Success:
  - [ ] [Criterion 1] `[ref: PRD/AC-X.Y]`
  - [ ] [Criterion 2] `[ref: SDD/Section]`
```

---

## Context Priming

*GATE: Read all files in this section before starting any implementation.*

**Specification**:

- `docs/XDD/specs/003-ide-bridge/requirements.md` — Product Requirements (F1, F3–F16; F2 removed — Tomo owns the lock file)
- `docs/XDD/specs/003-ide-bridge/solution.md` — Solution Design (ADR-1…ADR-8, directory map, interface specs)
- `~/Kouzou/projects/miyo/miyo-constitution.md` — L1/L2 rules: localhost-only, no vault I/O, zero new deps, no main-thread blocking, failure-path test coverage

**Reference implementations** (read before the transport/selection work):
- `https://github.com/petersolopov/obsidian-claude-ide` — working Obsidian RFC 6455 + selection APIs + stub set (HIGH)
- `https://github.com/coder/claudecode.nvim` — full protocol reference: lock file, auth header, frame codec, keepalive (MEDIUM)
- `https://code.claude.com/docs/en/ide-integrations` — official Claude Code IDE protocol surface (HIGH)

**Existing Hashi patterns to reuse** (verified to exist):
- `src/util/store.ts` — `Store<T>`: `constructor(value)`, `get()`, `set(next)`, `subscribe(fn) → unsubscribe`. Single-writer discipline.
- `src/connection/state.ts` + `src/connection/connectionStore.ts` — discriminated-union state + module-level store singleton (mirror for `IdeBridgeState` / `ideBridgeStore`).
- `src/ui/status-bar/StatusBarIcon.ts` — `constructor(plugin, actions, getChosenInstanceName)`, `mount()`/`unmount()`, subscribes `connectionStore`, applies `STATE_CLASSES` (extend with a second subscription).
- `src/ui/status-bar/openPopover.ts` — `openPopover(evt, actions)` builds an Obsidian `Menu` (add IDE line + Copy-token action).
- `src/settings/SettingsTab.ts` — `display()`, `buildSettingsHandlers()` (pure/testable), `addPathSetting` helper, full re-render on change.
- `src/types/index.ts` — `PluginSettings` + `DEFAULT_SETTINGS` + `settings_version` (currently 1).
- `src/connection/settingsPersistence.ts` — `loadSettings`/`saveSettings`; migration anchor reads `settings_version` before merge.
- `src/main.ts` — `TomoHashiPlugin`; components built once in `onload`; teardowns pushed to `this.cleanups` (LIFO drain on unload); `getSettings` getter passed to subsystems.
- `src/util/paths.ts` — `normalizeAndContain(raw) → SafetyResult` (rejects absolute / `..` / drive-letter); reuse for `openFile` validation.
- `src/commands/registerCommands.ts` — `registerCommands` / `registerExecutorCommands` patterns.
- `../Kado/src/settings/tabs/ApiKeyTab.ts` — cleartext key + Copy + Regenerate→`ConfirmModal(app, title, message, onConfirm)`.
- `../Kado/src/settings/tabs/GeneralTab.ts` — port locked-while-running via **control-swap** (not `setDisabled`); enable toggle → start/stop + re-render.

**Test infrastructure**:
- `vitest` + `jsdom`. Tests live in `test/**/*.test.ts` (e.g. `test/unit/`). `npm test` = `vitest run`.
- Obsidian is aliased to `test/__mocks__/obsidian.ts` (HTMLElement polyfills: `createDiv`/`createEl`/`createSpan`/`empty`…). **Each test file must `import "obsidian"` first** so the side-effect prototype shim installs before any DOM helper is used (type-only imports erase and the shim never runs).

**Key Design Decisions**:

- **ADR-1**: Hand-rolled RFC 6455 WebSocket over `node:http` — zero new deps; protocol is TEXT + PING/PONG only.
- **ADR-2**: New `src/ide-bridge/` module (Component C) — mirrors Components A (`connection/`) and B (`executor/`); small focused files (≤300–500 LOC).
- **ADR-3**: Reuse `Store<T>` as `ideBridgeStore`; single writer is `IdeBridge`.
- **ADR-4**: Token `hashi_<UUID>` in `data.json`, cleartext, no masking (Kado ADR-5/ADR-6 precedent).
- **ADR-5**: CM6 `EditorView.updateListener` + `active-leaf-change`, 100ms trailing debounce, JSON dedup; `activeWindow` timers (popout-safe).
- **ADR-6**: Fold IDE state into the 友 kanji as **combined worst-state** color (`error > reconnecting/disconnected > connected`); no separate dot; popover line + Copy-token. The `error` tier is fed **only** by `ideBridgeStore` — `ConnectionState` has no `error` kind (its failures are `disconnected`), so Docker contributes `reconnecting`/`disconnected`/`connected` only.
- **ADR-7**: Emit **plain vault-relative paths** in standard `filePath`/`fileUrl`; **empty `workspaceFolders`**; no custom path-field extensions (Kokoro ADR-019 §5/§2.3). Resolution is Tomo-side.
- **ADR-8 (SUPERSEDED)**: Hashi writes **no lock file**. Tomo generates the container lock file. Do not add lock-file writing/cleanup.

**Implementation Context**:

```bash
# Build / dev
npm run dev          # esbuild watch
npm run build        # tsc -noEmit -skipLibCheck + esbuild production  (this is the typecheck gate)

# Tests
npm test             # vitest run (jsdom, obsidian aliased to test/__mocks__)
npm run test:watch   # vitest watch
npm run test:coverage

# Quality
npm run lint         # eslint src/ manifest.json (obsidianmd rules)

# Manual QA in the test vault
HASHI_DEPLOY_VAULT=1 npm run build   # build + deploy into test/Hashi/.obsidian/plugins/miyo-tomo-hashi
```

> Note: there is no standalone `npm run typecheck` and no `test:integration` script. `npm run build` runs `tsc -noEmit` (the type gate); integration/E2E tests run under the same `npm test` (Phase 5 adds them in `test/`).

---

## Implementation Phases

Each phase is defined in a separate file. Tasks follow red-green-refactor: **Prime** (understand context), **Test** (red), **Implement** (green), **Validate** (refactor + verify).

> **Tracking Principle**: Track logical units that produce verifiable outcomes. The TDD cycle is the method, not separate tracked items.

Dependency order is strict bottom-up: protocol/transport primitives → domain (adapter, tools, selection) → server + orchestrator → plugin integration (settings, UI, lifecycle) → end-to-end + docs.

- [x] [Phase 1: Protocol & Transport Primitives](phase-1.md)
- [ ] [Phase 2: Editor Adapter, Tools & Selection Tracking](phase-2.md)
- [ ] [Phase 3: WebSocket Server & Orchestrator](phase-3.md)
- [ ] [Phase 4: Plugin Integration — Settings, UI, Commands & Lifecycle](phase-4.md)
- [ ] [Phase 5: End-to-End Integration & Documentation](phase-5.md)

---

## Plan Verification

Before this plan is ready for implementation, verify:

| Criterion | Status |
|-----------|--------|
| A developer can follow this plan without additional clarification | ✅ |
| Every task produces a verifiable deliverable | ✅ |
| All PRD acceptance criteria map to specific tasks | ✅ |
| All SDD components have implementation tasks | ✅ |
| Dependencies are explicit with no circular references | ✅ |
| Parallel opportunities are marked with `[parallel: true]` | ✅ |
| Each task has specification references `[ref: ...]` | ✅ |
| Project commands in Context Priming are accurate | ✅ |
| All phase files exist and are linked from this manifest as `[Phase N: Title](phase-N.md)` | ✅ |

---

## Feature → Phase Traceability

| PRD Feature | Phase / Tasks |
|-------------|---------------|
| F1 WebSocket IDE Server | T1.3 (handshake), T3.1 (server lifecycle), T3.2 (start/stop), T5.1 (e2e handshake) |
| F3 Auth Token Lifecycle | T1.4 (token), T3.2 (regenerate), T4.3 (UI display/copy/regenerate) |
| F4 Connection Authentication | T1.3 (auth header), T3.1 (401 pre-handshake), T5.1 |
| F5 Selection Changed Broadcast | T2.6 (tracker debounce/dedup), T1.1 (params type), T3.1 (broadcast) |
| F6 getCurrentSelection / getLatestSelection | T2.2 |
| F7 openFile | T2.3 |
| F8 Protocol Stubs | T2.4, T1.5 (-32601 unknown method), T2.5 (registry) |
| F9 Ping/Pong Keepalive | T3.1 |
| F10 Settings UI | T4.3 |
| F11 getOpenEditors | T2.2 |
| F12 IDE Bridge Status (友 kanji) | T4.4 |
| F13 Toggle IDE Bridge command | T4.5 |
| F14 PRIVACY.md | T5.2 |
| F15 Auto-restart (Could — deferred) | T3.1 ships only the single 500ms EADDRINUSE re-listen; full crash auto-restart is out of v0.1 (SDD note) |
| F16 Failed Auth Logging | T1.3 / T3.1 (warn-log rejected token) |

> F2 is intentionally absent (removed 2026-05-28 — Tomo owns the container lock file; ADR-8 superseded). No Hashi task writes a lock file.
