---
title: "Instruction Fixer — Implementation Plan"
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
| specId | 006-instruction-editor |
| title | Instruction Fixer — repair failed instruction actions and re-run |
| status | IN_REVIEW |
| phases | 5 |
| totalTasks | 15 deliverable tasks (+ per-phase validation) |
| parallelTasks | 4 |
| clarificationsRemaining | 0 |

---

## Specification Compliance Guidelines

### Deviation Protocol
When implementation requires changes from the specification: document the deviation with rationale,
obtain approval before proceeding, update the SDD when the deviation improves the design, and record
it here. Note the standing repo lesson: **plan-wins-over-SDD on drift** (`docs/ai/memory/decisions.md`)
— if a target file's current state differs from the SDD's picture, follow the code and flag the SDD.

## Metadata Reference
- `[parallel: true]` — Tasks that can run concurrently
- `[ref: document/section]` — Links to specifications
- `[activity: type]` — Activity hint for specialist agent selection

---

## Context Priming

*GATE: Read all files in this section before starting any implementation.*

**Specification**:
- `docs/XDD/specs/006-instruction-editor/requirements.md` — Product Requirements (F1–F8; F5 descoped)
- `docs/XDD/specs/006-instruction-editor/solution.md` — Solution Design (ADR-1..9, gate algorithm, directory map)
- `docs/XDD/specs/006-instruction-editor/README.md` — Resolved contract (ADR-027 + Tomo confirms + research)

**Reuse surface (READ — the Fixer is a specialization of these)**:
- `src/ui/garden-audit-view/{GardenAuditEditorView,openGardenAuditEditor,tabContract,TargetControl,noteNavigation}.ts`
- `src/garden-audit/{ObsidianGardenAuditDoc,transforms}.ts` · `src/vault/GardenAuditDoc.ts`
- `src/schema/{instructions.schema.json,types.ts,validator.ts}` (REUSED as-is)
- `src/executor/{InstructionExecutor,state,executionStore,jsonAppliedWriter,peerCheckboxSync,runLog}.ts`
- `src/commands/registerCommands.ts` · `src/main.ts`

**Key Design Decisions**:
- **ADR-1/2** — reuse the existing instruction wire + validator; parallel `InstructionFixerView` (`ItemView`) + `InstructionSetDoc` adapter mirroring garden-audit.
- **ADR-3** — entry: dedicated command + apply-modal option + run-log pointer; NO click-to-open.
- **ADR-4** — outcome-sourced **fail-closed** edit gate (load-bearing): editable iff trusted `failed`/`skipped-*` AND `applied !== true`; else read-only + offer to run.
- **ADR-5** — editable surface = target fields on 7 repair kinds only; verbatim round-trip.
- **ADR-6** — no skip/disable, no schema change.
- **ADR-7** — `.md` peer untouched; JSON authoritative; never touch `tomo.sources`.
- **ADR-8** — run-log `I##` deep-link → plain text + Fixer pointer line.
- **ADR-9** — re-run via existing executor + single atomic `processJSON` write path.

**Implementation Context**:
```bash
npm test                 # vitest unit + integration
npm run build            # tsc -noEmit -skipLibCheck && esbuild production (the real typecheck gate)
npm run lint             # eslint (eslint-plugin-obsidianmd)
HASHI_DEPLOY_VAULT=1 npm run build   # deploy into test/Hashi for manual QA
```
> Reminder (memory): scoped vitest skips typecheck — run the **full `npm run build`** at integration.
> After a branch/merge, new-diagnostics can be **stale** — trust the build, not the language server.

---

## Implementation Phases

Each phase is a separate file. Tasks follow red-green-refactor: **Prime** → **Test** (red) →
**Implement** (green) → **Validate** (refactor + verify).

- [ ] [Phase 1: Data spine — port, adapter, atomic writer, transforms](phase-1.md)
- [ ] [Phase 2: Outcome source + fail-closed edit gate](phase-2.md)
- [ ] [Phase 3: The Fixer view — cards, gate wiring, re-run](phase-3.md)
- [ ] [Phase 4: Entry points + run-log change](phase-4.md)
- [ ] [Phase 5: Integration, E2E & full-suite gate](phase-5.md)

---

## Traceability (PRD feature → tasks)

| PRD feature | Tasks |
|-------------|-------|
| F1 Open the Fixer (command + apply-modal + log pointer) | T4.1, T4.2, T4.3 |
| F2 Per-action cards (intent + outcome, failed-first) | T3.2, T2.1 |
| F3 Fail-closed edit gate | T2.1, T2.2, T3.2 |
| F4 Edit target fields (validated, verbatim) | T1.1, T1.3, T3.2 |
| F5 Skip/disable | DESCOPED (ADR-6) — no tasks |
| F6 Jump to affected note | T3.2 (noteNavigation reuse) |
| F7 Re-run (idempotent, refresh) | T3.3, T1.2 |
| F8 `.md` untouched / JSON authoritative | T1.1, T1.2, T4.3, T5.1 |

---

## Plan Verification

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
| All phase files exist and are linked from this manifest | ✅ |
