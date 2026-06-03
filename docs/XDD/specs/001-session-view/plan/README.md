---
title: "Implementation Plan — Tomo Connection & Chat Window"
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

| Field | Value |
|-------|-------|
| specId | 001-session-view |
| title | Tomo Connection & Chat Window |
| status | COMPLETE (release gate passed for code; manual-QA + CI live-test still pending — see spec README "Release Gate Status") |
| phases | 5 |
| totalTasks | 30 (T5.5b added 2026-04-25 to mirror spec 002's T6.4) |
| parallelTasks | 4 (Phase 4 UI surfaces) |
| specReferences | 70 PRD ACs + SDD sections (bumped from 64 in 2026-04-28 review-fix pass; matrix at 68/70 ✅, 2 intentional manual+live orphans documented in traceability.md) |
| clarificationsRemaining | 0 |

### Phase Status

| Phase | Name | Status | Tasks | File |
|-------|------|--------|-------|------|
| 1 | Foundation | completed | 6 | [phase-1.md](phase-1.md) |
| 2 | Docker Boundary | completed | 4 | [phase-2.md](phase-2.md) |
| 3 | Connection Service | completed | 5 | [phase-3.md](phase-3.md) |
| 4 | UI Surfaces | completed | 5 | [phase-4.md](phase-4.md) |
| 5 | Wire-up, Integration & Release Gate | completed | 10 | [phase-5.md](phase-5.md) |

---

## Specification Compliance Guidelines

### How to Ensure Specification Adherence

1. **Before Each Phase**: Read the Specification References section in the phase file; verify every `[ref: …]` still points to a valid spec location.
2. **During Implementation**: Reference specific SDD sections in each task; rely on the TDD gate (test must fail first).
3. **After Each Task**: Run the task's Validate step; confirm Success criteria are met before checking off.
4. **Phase Completion**: All tasks in the phase closed; the phase's final `Phase Validation` task runs `npm run build && npm test` (or `npm run test:live` for phases that add live tests) and records the result.

### Deviation Protocol

When implementation requires changes from the specification:
1. Document the deviation with clear rationale in the spec README's Decisions Log.
2. Obtain approval before proceeding (user confirmation; auto mode does NOT cover spec-level deviations).
3. Update SDD when the deviation improves the design; bump SDD version.
4. Record all deviations in this plan's notes section below for traceability.

### Deviations recorded during implementation
*(empty at plan draft time; populated during execution)*

## Metadata Reference

- `[parallel: true]` — Tasks that can run concurrently (independent file targets, no shared state)
- `[ref: document/section; lines: 1, 2-3]` — Links to specifications, patterns, or interfaces
- `[activity: type]` — Activity hint for specialist agent selection

### Success Criteria Format

```markdown
- Success: [Criterion] `[ref: PRD/AC-X.Y]`

- Success:
  - [ ] [Criterion 1] `[ref: PRD/AC-X.Y]`
  - [ ] [Criterion 2] `[ref: SDD/Section]`
```

---

## Context Priming

*GATE: Read all files in this section before starting any implementation task.*

**Specification**:
- `docs/XDD/specs/001-session-view/requirements.md` — PRD v2.1 (rewritten after brainstorm pivot + refinement round)
- `docs/XDD/specs/001-session-view/solution.md` — SDD v1.1 (10 ADRs confirmed)
- `docs/XDD/specs/001-session-view/README.md` — Scope + full Decisions Log

**Key Design Decisions** (full rationale in SDD):
- **ADR-1** Docker client = `dockerode` — battle-tested stream hijack + demux
- **ADR-2** Attach = `docker attach` PID 1 + xterm.js — full-fidelity Claude Code TUI
- **ADR-3** UI = plain TypeScript + Obsidian primitives — no framework runtime
- **ADR-4** (revised 2026-04-25 v3) State = single `Store<T>` helper (`src/util/store.ts`) — subscribe returns unsubscribe; no `derived<T,U>`; no read/write split
- **ADR-5** (revised 2026-04-25 v2) Docker edge = use dockerode directly (no port); unit tests use `vi.mock('dockerode')`
- **ADR-6** Chat view = `getLeavesOfType` + `setViewState` singleton
- **ADR-7** Reconnect = cancellable promise chain, delays `[500, 1000, 2000, 4000, 8000]` ms
- **ADR-8** Dynamic command label = `removeCommand` + `addCommand` on state change
- **ADR-9** Status bar popover = Obsidian `Menu` API (3 actions)
- **ADR-10** Tests = vitest unit (with `vi.mock('dockerode')`) + vitest live (real Docker) + manual QA in test vault per Phase 5 T5.5b

**Implementation Context**:
```bash
# Testing
npm test                    # vitest unit — jsdom + obsidian mock + vi.mock('dockerode')
npm run test:watch          # vitest unit in watch mode
npm run test:coverage       # vitest unit with v8 coverage
npm run test:live           # vitest live — node env, REAL Docker, 90s timeout

# Quality
npm run lint                # ESLint with obsidianmd rules
npm run build               # tsc --noEmit && esbuild production (typecheck runs as part of tsc step)

# Dev loop
npm run dev                 # esbuild watch mode with inline sourcemaps
```

**Integration test expectation**: `npm run test:live` is required to pass before release. It hits a real Docker daemon — no mocks at that boundary (team feedback memory: prior mock/prod divergence caused a broken migration).

---

## Test seam strategy

Every external boundary this spec touches is exercised through one explicit, named seam — there are no production-only test hooks and no incidental reliance on real wall-clock time. Pick the matching seam when adding a test; do not invent a new one without logging a deviation.

| Boundary | Seam | Mechanism | Where (representative) |
|---|---|---|---|
| Docker daemon | `vi.mock('dockerode')` | Module mock; resolve/reject the hijacked stream + container list per case (daemon-down, EACCES, empty list, vanish-mid-session) | `test/unit/connection/docker.test.ts` |
| Real Docker (live) | none — real daemon | `npm run test:live` (node env, 90 s timeout); the one boundary deliberately left un-mocked per ADR-10 | `test/live/docker-attach.live.test.ts` |
| Time / reconnect backoff | `vi.useFakeTimers()` | Drive the `[500, 1000, 2000, 4000, 8000]` ms delay ladder with `await vi.advanceTimersByTimeAsync(ms)` | `test/unit/connection/reconnectLoop.test.ts`, `TomoConnection.test.ts` |
| Obsidian API + DOM | `test/__mocks__/obsidian.ts` | **Side-effect** `import "obsidian"` at the top of every test file installs the `HTMLElement.prototype` shim (`createDiv`/`createEl`/…). Type-only imports erase before resolution — the shim never runs, `createDiv` is missing | all UI tests |
| Terminal (xterm.js) | constructor injection | Pass a fake terminal handle; assert OSC 8/52 disabled and write/resize calls — no real xterm runtime | `test/unit/ui/chat-view/terminalHost.test.ts`, `TomoChatView.test.ts` |

**Async-ordering mandate.** Any test that asserts the *order or timing* of asynchronous events — reconnect-delay progression, detach-while-write-in-flight interleave, autoReconnect fail-clean — MUST control time and the event loop explicitly via `vi.useFakeTimers()` plus `await vi.advanceTimersByTimeAsync(...)` (and explicit microtask flushes where needed). A bare real-time `setTimeout`/`sleep` in an ordering test is rejected in review: racing the real clock is this project's primary flake source. The live boundary is the sole exception — it owns a generous real timeout because it cannot fake the daemon's clock.

---

## Canonical Task Shape (RED → GREEN → REFACTOR)

Every task in every phase file follows this exact gate. The `Test:` step is NOT documentation — it is a *failing test must exist and be observed to fail* gate before any production code is written.

```
1. Prime   — Read referenced PRD/SDD sections; understand the contract.
2. RED     — Write the failing test. Run `npm test -- <path>`. CAPTURE the failure
              output (the actual stderr / "Cannot find module" / assertion text)
              and PASTE IT into the commit body. If the test passes on first run,
              the test is wrong — strengthen it until red.
3. GREEN   — Write the minimum production code to pass. Re-run; tests green.
4. REFACTOR — With tests green, simplify. Re-run; tests stay green. Run lint.
5. Validate — Final command run for the task (typically `npm test && npm run lint`).
```

The TDD-Guardian skill (`tcs-workflow:xdd-tdd`) enforces this gate. A commit with no captured red-output in the message body is treated as missing the gate.

Phase intros may abbreviate the steps as "Prime → RED → GREEN → REFACTOR → Validate" but the discipline is the one defined here.

> **Tracking Principle**: Track logical units that produce verifiable outcomes. The TDD cycle is the method, not separate tracked items.

## Implementation Phases

Each phase is defined in a separate file.

- [x] [Phase 1: Foundation](phase-1.md)
- [x] [Phase 2: Docker Boundary](phase-2.md)
- [x] [Phase 3: Connection Service](phase-3.md)
- [x] [Phase 4: UI Surfaces](phase-4.md)
- [x] [Phase 5: Wire-up, Integration & Release Gate](phase-5.md)

---

## Edge Cases → Tests

Every PRD edge-case bullet (PRD §F1–F9 / FS1 / FS2 *Edge Cases*) must trace to a test artifact OR be marked manual-QA-only with explicit justification. Update this matrix whenever an edge-case bullet is added/changed in the PRD.

| PRD edge case (F# / wording fragment) | Coverage | Where |
|---|---|---|
| F1: Docker daemon not running at Connect | unit | `test/unit/connection/docker.test.ts` (vi.mock rejects) |
| F1: Docker socket permission denied | unit | `test/unit/connection/docker.test.ts` (vi.mock with EACCES) |
| F1: No Tomo containers found | unit | `test/unit/ui/settings/InstancePickerModal.test.ts` (empty-state) |
| F1: Chosen instance vanishes mid-session | unit + live | `test/unit/connection/TomoConnection.test.ts` + `test/live/docker-attach.live.test.ts` |
| F1: Detach while message in flight | unit | `test/unit/connection/TomoConnection.test.ts` (write→close interleave) |
| F1: Chat window closed while Connected | unit | `test/unit/ui/chat-view/TomoChatView.test.ts` (onClose / lifecycle) |
| F1: `@file` invoked while not connected | unit | `test/unit/commands/fileMenu.test.ts` |
| F1: Instance-name label absent | unit | `test/unit/connection/docker.test.ts` (mapping) + UI label in `InstancePickerModal.test.ts` |
| F1: Multi-Tomo duplicate names / >20 / vanish-mid-pick | unit | `test/unit/ui/settings/InstancePickerModal.test.ts` (3 dedicated cases per the new F1 ACs) |
| F1: Obsidian launched offline | unit | `test/unit/connection/TomoConnection.test.ts` (autoReconnectIfRemembered fail-clean) |
| F1: Tomo output contains ANSI escapes / Obsidian URIs | unit + manual QA | xterm.js OSC 8/52 disabled assertion (`TomoChatView.test.ts`) + visual check in T5.5b |
| F4: Bidirectional stream | live | `test/live/docker-attach.live.test.ts` happy path |
| F8: Daemon restarts mid-session | manual QA | T5.5b checklist — `docker restart` and observe reconnect |
| F8: Reconnect bound exhausted | unit | `test/unit/connection/reconnectLoop.test.ts` (exhaustion case) |

## Plan Verification

| Criterion | Status |
|-----------|--------|
| A developer can follow this plan without additional clarification | ✅ |
| Every task produces a verifiable deliverable | ✅ |
| All PRD acceptance criteria map to specific tasks | ✅ (see Phase 5 traceability table) |
| All SDD components have implementation tasks | ✅ |
| Dependencies are explicit with no circular references | ✅ (Phase 1 → 2 → 3 → 4 → 5; within Phase 4 all 4 UI tasks are parallel) |
| Parallel opportunities are marked with `[parallel: true]` | ✅ (4 tasks in Phase 4) |
| Each task has specification references `[ref: ...]` | ✅ |
| Project commands in Context Priming are accurate | ✅ (verified from `package.json`) |
| All phase files exist and are linked from this manifest as `[Phase N: Title](phase-N.md)` | ✅ |
