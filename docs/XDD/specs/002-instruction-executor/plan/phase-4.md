---
title: "Phase 4: Orchestrator, Hooks, Run Log"
status: completed
version: "1.0"
phase: 4
---

# Phase 4: Orchestrator, Hooks, Run Log

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- PRD: F1 (invocation), F5 (applied state), F6 (partial-resume), F7 (run log), F8 (hooks) — `[ref: PRD/F1, F5, F6, F7, F8]`
- SDD: InstructionExecutor Service Surface; Planner; jsonAppliedWriter; peerCheckboxSync; runLog; HookRunner; ADRs 3, 4, 7, 8, 10 — `[ref: SDD/Interface Specifications; InstructionExecutor]` `[ref: SDD/Implementation Examples; Atomic JSON Write; Hook Loader]`

**Key Decisions** (affecting this phase):
- ADR-3: hooks fresh-loaded per run via `delete require.cache[resolved]`
- ADR-7: applied-flag write through `vault.process` with stable formatting
- ADR-8: per-run log file with YAML frontmatter + per-source-file headings
- ADR-10 (revised 2026-04-25): hook context = `{ action, app, logger }` — no `runState`, no narrowed `HookVault` facade
- Single-run lock at the orchestrator; halt-on-dependency rule lives here

**Dependencies**: Phases 1–3 (settings, types, path safety, VaultFS adapters, schema validator, all 8 handlers).

---

## Tasks

This phase wires the orchestrator that drives a run: source resolution, schema validation, action dispatch, JSON applied-flag write, peer best-effort tick, run log, hook invocation. The orchestrator owns the single-run lock, the cancellation flag, halt-on-dependency, and `executionStore` state transitions.

- [x] **T4.1 Planner — source resolution + canonical order + applied filter** `[activity: domain-modeling]`

  1. Prime: Read PRD F1 (invocation rules), F6 (partial-resume) `[ref: PRD/F1, F6]`. Read SDD "Planner" directory entry `[ref: SDD/Directory Map]` and Primary Flow `[ref: SDD/Runtime View; Primary Flow]`.
  2. Test: `test/unit/executor/planner.test.ts`:
     - `resolveSingle(activeFilePath)` — given an `.md` peer, returns the sibling `_instructions.json`. Given a `_instructions.json`, returns it directly. Given an unrelated file, returns null.
     - `resolveBatch(inboxFolder)` — returns all `_instructions.json` in folder, alphabetical order. Empty folder → empty array. Missing folder → throws typed error.
     - `computeRemaining(sets)` — applies canonical order across kinds; preserves monotonic `I##` within each kind; filters out actions with `applied: true`; returns `ActionRecord[]` with `fileId` and `summary` populated.
     - Halt-on-dependency *graph* construction: when a `link_to_moc` references a MOC created by an in-set `create_moc`, the planner records the dependency edge for the orchestrator to honor on failure.
  3. Implement: `src/executor/planner.ts`.
  4. Validate: Test suite green; types clean.
  5. Success:
     - [x] PRD F1 resolution matrix covered `[ref: PRD/F1]`
     - [x] PRD F6 partial-resume drives off `applied` field `[ref: PRD/F6]`
     - [x] Dependency graph available for halt-on-dependency in T4.4 `[ref: PRD/F4; SDD/Acceptance Criteria; F4 Action kinds]`

- [x] **T4.2 JsonAppliedWriter + PeerCheckboxSync** `[activity: domain-modeling]`

  1. Prime: Read PRD F5 (full AC list) `[ref: PRD/F5]`. Read SDD "Atomic JSON Applied-Flag Write" example `[ref: SDD/Implementation Examples; Example: Atomic JSON Applied-Flag Write]`.
  2. Test:
     - `test/unit/executor/jsonAppliedWriter.test.ts`:
       - Setting `applied: true` on `I03` does NOT change other actions
       - JSON is reformatted with 2-space indent + trailing newline
       - Writer is atomic (concurrent writes serialize via `vault.process`)
       - Writer never sets `applied: false`
     - `test/unit/executor/peerCheckboxSync.test.ts`:
       - Peer present + heading `### I03 — …` + unticked checkbox → ticks the checkbox; the result is `outcome: "ticked"`
       - Peer present + heading missing for `I03` → outcome: `"heading-missing"` (no error, no write)
       - Peer absent → outcome: `"peer-missing"` (no error, no write)
       - Peer present + checkbox already `- [x]` (pre-ticked) → outcome: `"already-ticked"` (no write)
       - Soft-warn semantics: a tick failure NEVER throws
  3. Implement: `src/executor/jsonAppliedWriter.ts` and `src/executor/peerCheckboxSync.ts` per SDD examples.
  4. Validate: Both test suites pass; lint clean.
  5. Success:
     - [x] Applied-flag writes are atomic + monotonic `[ref: PRD/F5; SDD/ADR-7]`
     - [x] Peer tick is best-effort with all four outcome paths covered `[ref: PRD/F5]`

- [x] **T4.3 RunLogWriter** `[activity: domain-modeling]`

  1. Prime: Read PRD F7 (run log file format + retention) `[ref: PRD/F7]`. Read SDD ADR-8 (Markdown + frontmatter + table) `[ref: SDD/Architecture Decisions; ADR-8]`. Read `src/util/filenames.ts` from T1 plan (or create here if not yet).
  2. Test: `test/unit/executor/runLog.test.ts`:
     - Filename builder: `tomo-hashi-run-log_YYYY-MM-DDTHHMM.md` with `_2`, `_3` suffix on collision
     - Header includes start/end timestamps, mode, source filenames, totals (applied / skipped-already / skipped-dependency / skipped-cancelled / failed)
     - Body groups records by source file with `## <filename>` sub-heading
     - Each row includes `I##`, kind, payload summary, outcome, error message (if failed)
     - Retention `always` → log file kept regardless of failures
     - Retention `only-after-failed` + 0 failures → log file deleted at finalize
     - Retention `only-after-failed` + ≥1 failure → log file kept
     - Validation-only failures (file rejected at schema step) appear as the only entry for that file
  3. Implement: `src/executor/runLog.ts` — `RunLogWriter` class with `start(meta)`, `appendRecord(record)`, `finalize(retention)` API. Writes through `VaultFS` only.
  4. Validate: All run-log tests pass.
  5. Success:
     - [x] All PRD F7 ACs covered `[ref: PRD/F7]`
     - [x] Retention rule applied at finalize `[ref: PRD/F7]`

- [x] **T4.4.0 Hook fixture set** `[activity: testing]` (added 2026-04-25 — gives T4.4 a concrete file-loaded surface so the production loader's `require.cache` eviction path is actually exercised, not faked)

  1. Prime: Read PRD F8 hook semantics (return shape, throw vs errors[], pre/post commit, timeout, kill-switch, cache-eviction). Hooks are loaded from disk via `createRequire(import.meta.url)`; mocking the loader at the test boundary defeats the point.
  2. Test: This task IS the test surface — there is no production code to write here. The fixtures land under `test/fixtures/hooks/` and are imported by HookRunner tests in T4.4 via the production loader, not via `vi.mock`.
  3. Implement — author the following fixture files (each tiny, single-purpose):
     - `test/fixtures/hooks/before-create_moc-throws.js` — exports a function that throws synchronously
     - `test/fixtures/hooks/before-create_moc-returns-errors.js` — returns `{ errors: ["nope"] }`
     - `test/fixtures/hooks/after-move_note-returns-warnings.js` — returns `{ warnings: ["ok with caveat"] }`
     - `test/fixtures/hooks/after-move_note-returns-info.js` — returns `{ info: ["fyi"] }`
     - `test/fixtures/hooks/before-update_tracker-infinite-loop.js` — `while(true) {}` to exercise the 30 s timeout
     - `test/fixtures/hooks/before-update_tracker-malformed.js` — `module.exports = "not a function"` (loader must reject gracefully)
     - `test/fixtures/hooks/after-link_to_moc-async-resolves.js` — async function that awaits then returns undefined
     - `test/fixtures/hooks/before-skip-uses-app.js` — exercises `ctx.app.vault` to prove `app` is reachable from a hook
     - `test/fixtures/hooks/before-create_moc-transitive-import.js` — `require("./_helper.js")` to prove the cache-eviction caveat in ADR-3 is observable (the entry file is evicted but `_helper.js` is not — assertion in T4.4)
     - `test/fixtures/hooks/_helper.js` — single-line module imported by the transitive-import fixture above
  4. Validate: All fixture files exist; each runs without import errors when required directly with Node.
  5. Success:
     - [x] Eight hook scenarios + one helper module land under `test/fixtures/hooks/` `[ref: PRD/F8]`
     - [x] T4.4's HookRunner test suite consumes these fixtures via the production loader, not via inline mocks `[ref: SDD/ADR-3]`

- [x] **T4.4 HookRunner + HookContext + HookDisclosureModal hookup point** `[activity: integration]`

  1. Prime: Read PRD F8 (full AC list) `[ref: PRD/F8]`. Read SDD "Hook Loader with Per-Run Cache Eviction" example + ADR-3, ADR-10 `[ref: SDD/Implementation Examples; Hook Loader]` `[ref: SDD/Architecture Decisions; ADR-3, ADR-10]`. Read T4.4.0 fixture set above — every test in this task loads fixtures via the production loader.
  2. Test: `test/unit/hooks/HookRunner.test.ts`:
     - Discovery: hook files matching `{before,after}-<kind>.js` are found in the configured directory
     - Loading: hooks are loaded fresh per run (cache evicted; second run sees an edit made between runs)
     - Multiple hook files for the same `(kind, phase)` key → only the first alphabetical is loaded; the duplication is logged
     - Invocation context shape: `{ action, app, logger }` — assert each property (per ADR-10 v2; no `vault` facade, no `runState`)
     - Return-shape semantics: `undefined` → ok; `{ info: [...] }` → logged; `{ warnings: [...] }` → logged; `{ errors: [...] }` → action fails
     - Throw semantics: pre-hook throws → action fails (skip the action); post-hook throws → action's vault state already committed; failure recorded separately
     - Timeout: 30s timeout fires; treated as throw
     - Kill-switch (`hooksPolicy === "disabled"`) → no hook loaded or invoked (per F8 v2 — no separate `disableAllHooks` toggle)
     - Per-hook *ask*-mode decisions live in an in-memory map, not persisted
  3. Implement: `src/hooks/HookRunner.ts` + `src/hooks/HookContext.ts`. The `HookDisclosureModal` is referenced by `HookRunner` via a callback (Modal class itself is built in Phase 5 T5.3 — Phase 4 stubs the callback signature).
  4. Validate: All hook tests pass; types clean.
  5. Success:
     - [x] All PRD F8 ACs except UI ones (F5: disclosure modal — Phase 5) `[ref: PRD/F8]`
     - [x] Hook context matches ADR-10 exactly `[ref: SDD/ADR-10]`
     - [x] Cache-evict mechanism verified by edit-between-runs test `[ref: SDD/ADR-3]`

- [x] **T4.5 InstructionExecutor + executionStore** `[activity: domain-modeling]`

  1. Prime: Read SDD "InstructionExecutor Service Surface" `[ref: SDD/Interface Specifications; InstructionExecutor]`. Read Runtime View Primary Flow + Complex Logic `[ref: SDD/Runtime View]`.
  2. Test: `test/unit/executor/InstructionExecutor.test.ts`. Each test injects `FakeVaultFS` + scripted hook runner + scripted validator:
     - Single-file invocation runs the right action set and writes `applied:true` per success
     - Batch invocation merges across files in alphabetical order
     - Single-run lock: second invocation while running → second `execute()` rejects fast with the right message; no second run starts
     - Halt-on-dependency: `create_moc I03` fails → all `link_to_moc` actions whose graph parent is `I03` are recorded as `skipped-dependency`; non-dependent actions still run
     - Halt-on-independent-failure does NOT propagate (a `delete_source` failure on a different file does not affect later actions)
     - Cancellation: `cancel()` between actions → in-flight action commits; remaining recorded as `skipped-cancelled`
     - Validation-only failure for a file in batch: that file's actions don't run; other files in batch proceed
     - Run log written before lock release
     - Pre-hook throw → action skipped, `applied` stays false
     - Post-hook throw → action committed (`applied:true`), hook failure logged separately
     - Mode `silent` → no modal subscription required; `executionStore` still updates
     - `executionStore` transitions traced: idle → preparing → previewing/running → summary → idle. Plus a separate sub-test for the `validation-failed` branch: idle → preparing → validation-failed → idle (covers the 6th state from SDD `RunState` line 530).
  3. Implement:
     - `src/executor/executionStore.ts` — `Store<RunState>` instance + derived slices (e.g., `kind`, `currentProgress`)
     - `src/executor/InstructionExecutor.ts` — orchestrator class implementing the full lifecycle from §Complex Logic of the SDD
  4. Validate: Full executor test suite passes; lint clean.
  5. Success:
     - [x] Single-run lock prevents concurrent runs `[ref: PRD/F1; SDD/CON-6]`
     - [x] Halt-on-dependency rule honored across batch `[ref: PRD/F4]`
     - [x] Cancellation safe between actions `[ref: PRD/F3]`
     - [x] All PRD F-feature behaviors covered at the executor layer `[ref: PRD/F1, F4, F5, F6, F7, F8]`

  - **Phase 4 Validation**: After T4.5, run `npm test && npm run test:live && npm run lint && npm run build`. Confirm orchestrator + planner + applied-writer + peer-sync + run log + hook runner all pass; live tests still green; build clean.
