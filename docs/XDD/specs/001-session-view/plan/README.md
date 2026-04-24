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
| status | DRAFT |
| phases | 5 |
| totalTasks | 29 |
| parallelTasks | 4 (Phase 4 UI surfaces) |
| specReferences | 60+ across PRD/AC + SDD sections |
| clarificationsRemaining | 0 |

### Phase Status

| Phase | Name | Status | Tasks | File |
|-------|------|--------|-------|------|
| 1 | Foundation | pending | 6 | [phase-1.md](phase-1.md) |
| 2 | Docker Boundary | pending | 4 | [phase-2.md](phase-2.md) |
| 3 | Connection Service | pending | 5 | [phase-3.md](phase-3.md) |
| 4 | UI Surfaces | pending | 5 | [phase-4.md](phase-4.md) |
| 5 | Wire-up, Integration & Release Gate | pending | 9 | [phase-5.md](phase-5.md) |

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
- **ADR-4** State = custom `Store<T>` helper (`src/util/store.ts`) — subscribe returns unsubscribe
- **ADR-5** Docker edge = ports & adapters (`DockerClient` interface + `DockerodeAdapter`)
- **ADR-6** Chat view = `getLeavesOfType` + `setViewState` singleton
- **ADR-7** Reconnect = cancellable promise chain, delays `[500, 1000, 2000, 4000, 8000]` ms
- **ADR-8** Dynamic command label = `removeCommand` + `addCommand` on state change
- **ADR-9** Status bar popover = Obsidian `Menu` API (3 actions)
- **ADR-10** Tests = vitest unit (mocked `DockerClient`) + vitest live (real Docker)

**Implementation Context**:
```bash
# Testing
npm test                    # vitest unit — jsdom + obsidian mock + fake DockerClient
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

## Implementation Phases

Each phase is defined in a separate file. Tasks follow red-green-refactor: **Prime** (understand context), **Test** (red), **Implement** (green), **Validate** (refactor + verify).

> **Tracking Principle**: Track logical units that produce verifiable outcomes. The TDD cycle is the method, not separate tracked items.

- [ ] [Phase 1: Foundation](phase-1.md)
- [ ] [Phase 2: Docker Boundary](phase-2.md)
- [ ] [Phase 3: Connection Service](phase-3.md)
- [ ] [Phase 4: UI Surfaces](phase-4.md)
- [ ] [Phase 5: Wire-up, Integration & Release Gate](phase-5.md)

---

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
