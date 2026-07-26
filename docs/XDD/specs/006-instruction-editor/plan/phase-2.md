---
title: "Phase 2: Outcome source + fail-closed edit gate"
status: pending
version: "1.0"
phase: 2
---

# Phase 2: Outcome source + fail-closed edit gate

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Runtime View/Complex Logic — the fail-closed edit gate]` (the algorithm)
- `[ref: SDD/ADR-4]` outcome-sourced fail-closed gate · `[ref: SDD/Interface Specifications]` `outcomeSource`
- `[ref: SDD/Runtime View/Secondary Flow]` cold open → NO_TRUSTED_SIGNAL

**Key Decisions**:
- **No durable per-action outcome store exists** — `failed`/`skipped-*`/never-run all collapse to
  `applied:false` on disk. Trusted signal = in-session `executionStore` summary, else a **confidently
  source-matched** newest run-log; bare `applied:false` is never trusted.
- Fail closed: unlock editing ONLY on a trusted `failed`/`skipped-*` for that exact `I##` and `!applied`.

**Dependencies**: Phase 1 (types/model). This is the load-bearing safety subsystem — build and test
it in isolation before wiring the view (Phase 3).

---

## Tasks

Delivers the trustworthy-outcome resolver and the gate that decides per-action editability — the
safety spine of the whole feature. Pure logic, no UI; test authorize AND reject exhaustively.

- [ ] **T2.1 `resolveOutcomes` — outcome source** `[activity: domain-modeling]`

  1. Prime: Read `src/executor/executionStore.ts` (in-memory `Store<RunState>`, summary state), `src/executor/state.ts` (`ActionOutcome`, `RunState`), `src/executor/runLog.ts` (frontmatter `sources:`, table `| I## | kind | summary | outcome | error |`) `[ref: SDD/ADR-4]`
  2. Test:
     - in-session summary present & covers `sourcePath` → returns `Map<I##, ActionOutcome>` (all 5 outcome kinds mapped incl. `skipped-dependency` dependsOn, `failed` reason)
     - no summary, newest run-log whose `sources:` **includes the exact set path** → parses table → map
     - no summary, no run-log → `NO_TRUSTED_SIGNAL`
     - run-log exists but `sources:` does NOT confidently include this path (stale/other set) → `NO_TRUSTED_SIGNAL` (do not map optimistically)
     - malformed validation-failure row (no `I##`) is ignored, not mis-mapped
  3. Implement: `src/ui/instruction-fixer/outcomeSource.ts` — `resolveOutcomes(set, sourcePath, deps)`; run-log discovery (newest by filename timestamp among `sources`-matching logs) + table-row parse; `deps` injects the vault + executionStore accessor for testability.
  4. Validate: unit tests pass; lint clean; types check.
  - Success:
    - [ ] Bare `applied:false` with no trusted source yields `NO_TRUSTED_SIGNAL` `[ref: PRD/F3-AC3]` `[ref: SDD/ADR-4]`
    - [ ] Fuzzy/stale run-log never mis-maps outcomes `[ref: SDD/Implementation Gotchas]`

- [ ] **T2.2 `editGate` — per-action editability** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: Re-read `[ref: SDD/Runtime View/Complex Logic]` (the exact algorithm + traced walkthrough)
  2. Test (authorize + reject, per the traced example I07/I09/I12):
     - `applied === true` → `frozen-applied` (regardless of outcome)
     - outcome `failed` OR `skipped-*` AND `!applied` → `editable`
     - outcome `undefined`/`pending` (never attempted) → `read-only-no-signal`
     - `NO_TRUSTED_SIGNAL` → `read-only-no-signal`
  3. Implement: `editGate(action, outcomeResult, appliedFlag)` in `outcomeSource.ts` returning the 3-state enum.
  4. Validate: unit tests pass; lint clean; types check.
  - Success:
    - [ ] Editable only on trusted failed/skipped + `!applied`; every other state read-only `[ref: PRD/F3-AC1..3]` `[ref: SDD/ADR-4]`
    - [ ] Both authorize AND reject paths covered (Constitution Testing L1) `[ref: SDD/Quality Requirements]`

- [ ] **T2.3 Phase Validation** `[activity: validate]`

  - Run all Phase 2 tests; `npm run build` + `npm run lint`. Confirm the gate's truth table matches
    the SDD algorithm line-for-line (this is the security guarantee — no drift permitted).
