---
title: "Suggestions Editor — Implementation Plan"
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

## Specification Compliance Guidelines

1. **Before each phase**: read the Context Priming files + the phase's `[ref: ...]` SDD sections.
2. **During implementation**: keep domain logic behind `SuggestionsDoc`/pure functions (Constitution L1 — testable without Obsidian).
3. **After each task**: `npm test` + `npm run lint` + `npm run build` (tsc) green.
4. **Deviation protocol**: the wire schema is Tomo-owned. Any needed wire change is a **handoff to Tomo**, never a local schema edit — pause the task and raise it (spec-002 drift discipline).

## Metadata Reference

- `[parallel: true]` — tasks that can run concurrently
- `[ref: document/section; lines: ...]` — links to spec sections
- `[activity: type]` — specialist hint

---

## Context Priming

*GATE: Read all files in this section before starting any implementation.*

**Specification**:
- `docs/XDD/specs/004-suggestions-editor/requirements.md` — PRD (10 Must features, 32 ACs)
- `docs/XDD/specs/004-suggestions-editor/solution.md` — SDD (FINAL; ADR-S1..S5, §5 EditModel, §6 tabs, §7 pickers, §9 adapter)
- `src/schema/suggestions-wire.schema.json` — **vendored authoritative wire schema** (`schema_version: "1"`)

**Reuse (already in the codebase — do NOT reimplement)**:
- `src/actions/markdownStructure.ts` — real note structure parse (race-safe #68) → op 2 source of truth
- `src/actions/anchorResolver.ts` — resolves `{callout, heading, line} × {before, after, inside}`; `insertInside:null` for non-callouts
- `src/actions/{linkToMoc,insertUnderMarker,blockInsert,sectionLocator}.ts` — op-2 insert primitives
- `src/actions/{updateLogEntry,updateLogLink,updateTracker}.ts` — daily executor primitives (op-8 reuse)
- `src/ui/chat-view/TomoChatView.ts` — leaf `ItemView` surface precedent (ADR-S1); `src/ui/ConfirmModal.ts` — dirty-guard

**Key Design Decisions** (SDD):
- **ADR-S1**: Surface = leaf `ItemView`, 4 tabs (not a Modal) — iterative + `Save`, sits beside the note.
- **ADR-S2**: `EditModel` holds the **whole** document; every edit is a pure `EditModel → EditModel` transform setting `dirty`.
- **ADR-S4**: JSON-only "own the whole document" — save the full object; carry `emit_digest` verbatim; dirty-gated.
- **ADR-S5**: single wire-aware `SuggestionsDoc` adapter; version-`const` gate fail-loud.

**Implementation Context**:
```bash
npm test            # vitest run (unit + integration)
npm run test:watch  # vitest watch
npm run lint        # eslint src/ + stylelint styles.css
npm run build       # tsc -noEmit + esbuild production
HASHI_DEPLOY_VAULT=1 npm run build   # + deploy into test/Hashi for manual QA
```

---

## Implementation Phases

Each phase is a separate file. Tasks follow red-green-refactor: **Prime** → **Test** (red) → **Implement** (green) → **Validate** (refactor + verify).

> **Tracking Principle**: track logical units that produce verifiable outcomes; the TDD cycle is the method, not separate tracked items.

- [ ] [Phase 1: Domain Core — EditModel + pure transforms](phase-1.md)
- [ ] [Phase 2: SuggestionsDoc Adapter — full-document round-trip](phase-2.md)
- [ ] [Phase 3: Editor View + Pickers](phase-3.md)
- [ ] [Phase 4: Integration & Validation](phase-4.md)

**Dependency order**: Phase 1 (pure core + `FakeSuggestionsDoc`) unblocks everything. Phase 2 (real adapter) and Phase 3 (view against the fake) can proceed in parallel once Phase 1 lands. Phase 4 integrates the real adapter + view and validates end-to-end.

---

## Plan Verification

| Criterion | Status |
|-----------|--------|
| A developer can follow this plan without additional clarification | ✅ |
| Every task produces a verifiable deliverable | ✅ |
| All PRD acceptance criteria map to specific tasks | ✅ (F1→T3.1 · F2→T1.3/T3.2/T3.4 · F3→T1.6/T3.3 · F4→T1.5/T3.5 · F5→T1.3/T3.2/T3.5 · F6→T1.3/T3.4 · F7→T1.4/T3.2/T3.6 · F8→T1.7/T3.6 · F9→T1.8/T3.7 · F10→T1.1/T2.*) |
| All SDD components have implementation tasks | ✅ (§3→P3 · §5→P1 · §6→P3 · §7→P3 · §9→P2) |
| Dependencies are explicit with no circular references | ✅ |
| Parallel opportunities are marked with `[parallel: true]` | ✅ |
| Each task has specification references `[ref: ...]` | ✅ |
| Project commands in Context Priming are accurate | ✅ (from `package.json`) |
| All phase files exist and are linked from this manifest | ✅ |
