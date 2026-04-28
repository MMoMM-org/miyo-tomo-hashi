---
title: "Implementation Plan — Instruction Executor"
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
| specId | 002-instruction-executor |
| title | Instruction Executor |
| status | DRAFT |
| phases | 6 |
| totalTasks | 31 |
| parallelTasks | 4 (Phase 3 T3.1 helpers; Phase 5 T5.1 / T5.2 / T5.3 UI surfaces) |
| specReferences | 95 PRD ACs + 70+ SDD section refs across the 31 tasks |
| clarificationsRemaining | 0 |

### Phase Status

| Phase | Name | Status | Tasks | File |
|-------|------|--------|-------|------|
| 1 | Foundation | completed | 6 | [phase-1.md](phase-1.md) |
| 2 | Vault Boundary & Schema | pending | 5 | [phase-2.md](phase-2.md) |
| 3 | Action Handlers | pending | 6 | [phase-3.md](phase-3.md) |
| 4 | Orchestrator, Hooks, Run Log | pending | 5 | [phase-4.md](phase-4.md) |
| 5 | UI Surfaces | pending | 4 | [phase-5.md](phase-5.md) |
| 6 | Wire-up, Integration & Release Gate | pending | 5 | [phase-6.md](phase-6.md) |

---

## Specification Compliance Guidelines

### How to Ensure Specification Adherence

1. **Before Each Phase**: Read the Specification References section in the phase file; verify every `[ref: …]` still points to a valid spec location.
2. **During Implementation**: Reference specific SDD sections in each task; rely on the TDD gate (test must fail first).
3. **After Each Task**: Run the task's Validate step; confirm Success criteria are met before checking off.
4. **Phase Completion**: All tasks in the phase closed; the phase's final `Phase Validation` task runs `npm run build && npm test` (and `npm run test:live` for phases that add live tests) and records the result.

### Deviation Protocol

When implementation requires changes from the specification:
1. Document the deviation with clear rationale in the spec README's Decisions Log.
2. Obtain approval before proceeding (user confirmation; auto mode does NOT cover spec-level deviations).
3. Update SDD when the deviation improves the design; bump SDD version.
4. Record all deviations in this plan's notes section below for traceability.

### Deviations recorded during implementation

- **2026-04-28 (T1.2)** — `InstructionSet.schema_version` typed as `"1"` (string literal), not `1` (number). Reason: actual vendored schema declares `{"const": "1"}` (string). SDD code excerpt at `Application Data Models` is incorrect on this point; T1.1's regression test already locks the runtime value as `"1"`.
- **2026-04-28 (T1.2)** — `Action` discriminated union uses field `action` (matches schema `$defs/*.properties.action.const`), not `kind`. Plan task wording "narrows on `kind`" was loose; actual discriminant per schema is `action`. `ActionRecord.kind` (executor-internal wrapper) is unchanged — it remains `kind: ActionKind`. Both fields coexist on different types.
- **2026-04-28 (T1.2)** — `InstructionSet` requires 3 fields the SDD code excerpt omitted: `type`, `generated`, `profile` (all in the schema's top-level `required` array alongside `schema_version` and `actions`). Hand-aligned types include them. SDD `Application Data Models` excerpt was abbreviated.
- **2026-04-28 (T1.2)** — `Readable<T>` (in `src/executor/state.ts`) typed as `import("../util/store").Store<T>` directly. Reason: 001's `src/util/store.ts` (lines 4–5) explicitly documents "no `Readable<T>` interface (per ADR-4 v3, 2026-04-25 simplification)". The SDD excerpt referencing `import("../util/store").Readable<T>` was written before 001's ADR-4 v3.
- **2026-04-28 (T1.3)** — 6 settings implemented, not 7. The plan draft included a `disableAllHooks` toggle but the SDD "Plugin Settings" section and PRD F11 are explicit: `hooksPolicy: 'disabled'` IS the kill-switch. A separate boolean would duplicate semantics and create a conflicting control. Removed.
- **2026-04-28 (T1.3)** — New tests added to existing `test/unit/ui/settings/SettingsTab.test.ts` (as additional `describe` blocks) rather than creating a new file at `test/unit/settings/SettingsTab.test.ts` per the plan draft. Rationale: the existing 001 SettingsTab tests are in this file; splitting tests for the same component across two files would fragment coverage. Codebase consistency wins.
- **2026-04-28 (T1.3)** — "Execution mode", "Run log retention", and "Hooks" controls implemented as `addDropdown()` rather than radio buttons. Obsidian's `Setting` API has no native radio control. Dropdown is the idiomatic Obsidian choice for fixed-arity enumerated values, consistent with other community plugins.
- **2026-04-28 (T1.3)** — `saveSettings()` method added to `TomoHashiPlugin` in `src/main.ts`. This follows the Kado sibling-plugin pattern and keeps SettingsTab wiring simple (plugin reference already available; no closure juggling). The settings-layer persist function `saveSettings(plugin, settings)` from `settingsPersistence.ts` is still the implementation backing it.
- **2026-04-28 (T1.3)** — `SettingsTab._handlers` test seam added (a `HandlerMap` populated during `display()`). Tests fire onChange callbacks directly via this map rather than simulating DOM input events. This avoids production test hooks while keeping tests independent of the obsidian mock's DOM event chain.
- **2026-04-28 (T2.1)** — Contract test added 2 assertions (`readJSON` round-trip, `create` round-trip) beyond the 8 in the plan, to match the full SDD port surface. The plan task description abbreviated the 11-method port to 8 behavioral assertions; the SDD-verbatim interface has `readJSON` and `create` as distinct methods each requiring contract coverage. Both assertions were added to `test/unit/vault/VaultFS.contract.test.ts`; `runContractTests` now exports 10 `describe` blocks (8 plan + 2 SDD-extras).

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
- `docs/XDD/specs/002-instruction-executor/requirements.md` — PRD v2.0 (11 Must-features, 95 ACs)
- `docs/XDD/specs/002-instruction-executor/solution.md` — SDD v1.0 (10 ADRs confirmed)
- `docs/XDD/specs/002-instruction-executor/research.md` — 5-perspective research synthesis
- `docs/XDD/specs/002-instruction-executor/README.md` — Scope + full Decisions Log

**Sister-spec dependency**:
- `docs/XDD/specs/001-session-view/solution.md` — confirmed ADR-3 (plain TS), ADR-4 (`Store<T>`), ADR-5 (ports & adapters), ADR-10 (vitest split). 002 inherits all four.
- `src/util/store.ts` — created by 001's plan Phase 1 T1.3. **002 depends on this file existing.** If 002 starts before 001 completes Phase 1, T1.5 of 002 must extract the helper as a shared util on demand (deviation gets logged).

**Key Design Decisions** (full rationale in SDD):
- **ADR-1** (revised 2026-04-25) Schema validation = ajv 8.x **at runtime** (was: standalone codegen). Schema JSON is bundled and compiled at module load. ~35 KB bundle cost for ~50 lines of build-script + committed-artifact complexity saved.
- **ADR-2** Schema source = vendored copy in `src/schema/instructions.schema.json` from Tomo v0.7.0+; drift signaled by Tomo CHANGELOG handoff.
- **ADR-3** Hook loader = `createRequire(import.meta.url)` + per-run `delete require.cache[resolved]` for fresh load.
- **ADR-4** Action handlers = 8 pure async functions with shared `HandlerContext` (vault, clock). (Revised 2026-04-25: `runState` dropped — was shared with hooks, but hooks no longer use runState.)
- **ADR-5** Modal = single `ExecutionModal` class with state-machine UI (preview / progress / summary subviews).
- **ADR-6** Status bar 橋 = color states (idle / green=running / red=error); no animation.
- **ADR-7** JSON applied-flag write = `vault.process` for atomic edit; `JSON.stringify(v, null, 2) + "\n"` formatting.
- **ADR-8** Run log = per-run Markdown file with YAML frontmatter + per-source-file headings + per-action table.
- **ADR-9** (revised 2026-04-25) Test split = vitest unit (`FakeVaultFS`) + manual QA against `../temp/Privat-Test`. The previously-planned `FsPromisesVaultFS` adapter + `vitest live` run was dropped — node `fs/promises` cannot exercise the Obsidian-specific semantics that matter (`fileManager.renameFile` link preservation, `vault.process`, `MetadataCache`).
- **ADR-10** (revised 2026-04-25) Hook context = `{ action, app, logger }` only. No `runState` (speculative cross-hook state — add later if a real hook needs it). No `HookVault` narrowed facade (hooks have full plugin privilege per F8 trust model — narrowing decorates a permission the policy already grants).

**Implementation Context**:
```bash
# Build (no prebuild step — ajv compiles at runtime per ADR-1 v2)
npm run dev                 # esbuild watch mode
npm run build               # tsc --noEmit && esbuild production

# Testing (no test:live for FsPromisesVaultFS per ADR-9 v2 — that adapter was dropped)
npm test                    # vitest unit — jsdom + obsidian mock + FakeVaultFS
npm run test:watch          # vitest unit in watch mode
npm run test:coverage       # vitest unit with v8 coverage
# 001 retains npm run test:live for its real-Docker e2e — 002 has no live-test contribution

# Quality
npm run lint                # ESLint with obsidianmd rules
```

**Manual QA**: After Phase 6 automated tests pass, run the manual QA checklist (Phase 6 T6.4) against the local test vault at `../temp/Privat-Test` before declaring v0.1 release-gate met. The build copies output into the vault when the test-vault sample is uncommented in `esbuild.config.mjs`.

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
- [ ] [Phase 2: Vault Boundary & Schema](phase-2.md)
- [ ] [Phase 3: Action Handlers](phase-3.md)
- [ ] [Phase 4: Orchestrator, Hooks, Run Log](phase-4.md)
- [ ] [Phase 5: UI Surfaces](phase-5.md)
- [ ] [Phase 6: Wire-up, Integration & Release Gate](phase-6.md)

---

## Edge Cases → Tests

Every PRD edge-case bullet (PRD §F1–F11 *Edge Cases*) must trace to a test artifact OR be marked manual-QA-only with explicit justification. Update this matrix whenever an edge-case bullet is added/changed in the PRD.

| PRD edge case (F# / wording fragment) | Coverage | Where |
|---|---|---|
| F1: Inbox folder misconfigured / empty | unit | `test/unit/executor/planner.test.ts` (resolveBatch) |
| F2: Malformed `.json` in batch | unit | `test/unit/schema/validator.test.ts` |
| F3: Mid-run cancellation in Auto-run mode | unit | `test/unit/executor/InstructionExecutor.test.ts` (cancel-between-actions) |
| F4: `.md` peer missing | unit | `test/unit/executor/peerCheckboxSync.test.ts` (peer-missing case) |
| F4: `.md` peer present, heading missing | unit | `test/unit/executor/peerCheckboxSync.test.ts` (heading-missing case) |
| F4: Peer open in another editor pane during write | manual QA | T6.4 — open peer in second pane, run executor, observe vault.process reconciles |
| F4: Tomo emits `.json` without `applied` field | unit | `test/unit/schema/validator.test.ts` (graceful tolerance) |
| F4: Hook file is valid JS but exports nothing | unit | `test/unit/hooks/HookRunner.test.ts` (uses `before-update_tracker-malformed.js` fixture from T4.4.0) |
| F4: Hook infinite loop | unit | `test/unit/hooks/HookRunner.test.ts` (uses `before-update_tracker-infinite-loop.js` fixture; 30 s timeout) |
| F8: Schema v2 instruction set ships before Hashi upgrade | unit | `test/unit/schema/validator.test.ts` (version-mismatch returns single-message failure) |
| F8: User toggles hooks → disabled mid-run | unit | `test/unit/executor/InstructionExecutor.test.ts` (assert in-flight run unaffected; new run honors new policy) |
| F7: Two runs scheduled in same minute | unit | `test/unit/executor/runLog.test.ts` (filename `_2` suffix) |
| F1/F4: `.json` with 0 actions | unit | `test/unit/executor/InstructionExecutor.test.ts` (empty-actions branch) |
| F4: Single `skip` action | unit | `test/unit/actions/skipHandler.test.ts` |
| F1: Inbox contains 50 `_instructions.json` at once | unit + manual QA | unit asserts merged plan size; manual QA in T6.4 timing observation |
| F7: Obsidian closes mid-run | manual QA | T6.4 — kill Obsidian during a run; reopen; verify next invocation sees correct partial-applied state from `.json` |
| F9: Vault-internal symlink to outside vault | unit | `test/unit/util/paths.test.ts` (realpath rejection) |

## Plan Verification

| Criterion | Status |
|-----------|--------|
| A developer can follow this plan without additional clarification | ✅ |
| Every task produces a verifiable deliverable | ✅ |
| All PRD acceptance criteria map to specific tasks | ✅ (see Phase 6 traceability table) |
| All SDD components have implementation tasks | ✅ |
| Dependencies are explicit with no circular references | ✅ (Phase 1 → 2 → 3 → 4 → 5 → 6; Phase 3 helpers parallel; Phase 5 UI surfaces parallel) |
| Parallel opportunities are marked with `[parallel: true]` | ✅ (T3.1 helpers; T5.1 / T5.2 / T5.3 UI surfaces — 4 parallel tasks total) |
| Each task has specification references `[ref: ...]` | ✅ |
| Project commands in Context Priming are accurate | ✅ (verified from `package.json`; no `schema:build` script after ADR-1 v2 revision) |
| All phase files exist and are linked from this manifest as `[Phase N: Title](phase-N.md)` | ✅ |
