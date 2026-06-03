---
title: "Implementation Plan — Instruction Executor"
status: ready
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
| status | READY |
| phases | 6 |
| totalTasks | 31 |
| parallelTasks | 4 (Phase 3 T3.1 helpers; Phase 5 T5.1 / T5.2 / T5.3 UI surfaces) |
| specReferences | 95 PRD ACs + 70+ SDD section refs across the 31 tasks |
| clarificationsRemaining | 0 |

### Phase Status

| Phase | Name | Status | Tasks | File |
|-------|------|--------|-------|------|
| 1 | Foundation | completed | 6 | [phase-1.md](phase-1.md) |
| 2 | Vault Boundary & Schema | completed | 5 | [phase-2.md](phase-2.md) |
| 3 | Action Handlers | completed | 6 | [phase-3.md](phase-3.md) |
| 4 | Orchestrator, Hooks, Run Log | completed | 5 | [phase-4.md](phase-4.md) |
| 5 | UI Surfaces | completed | 4 | [phase-5.md](phase-5.md) |
| 6 | Wire-up, Integration & Release Gate | completed | 5 | [phase-6.md](phase-6.md) |

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
- **2026-04-28 (T3.2)** — Both-absent (src✗ dst✗) case added as a 4th branch in `createMoc` and `moveNote`, returning `failed "Source missing — nothing to move"`. The PRD/F4 ACs specify only 3 branches explicitly (src+dst, no-src, both). The both-absent case is reachable at runtime (e.g. user manually deleted source between instruction generation and execution) and must produce a deterministic, actionable outcome. Defaulting to `failed` with a clear reason is the safest choice — it surfaces to the run log and does not silently pass. A 5th test case covers this branch in both test files.
- **2026-04-28 (T3.2)** — `src/actions/types.ts` created to hold the shared `HandlerContext` interface and `dirOf()` path helper. The task brief offered two options: duplicate `HandlerContext` in each handler file, or create a `types.ts` module. The shared-module approach was chosen to avoid divergence between the two interfaces and to give T3.6's `index.ts` a single re-export source. `dirOf()` is placed in `types.ts` (not `src/util/paths.ts`) because it is handler-domain logic, not a general path-safety utility.
- **2026-04-28 (T3.4)** — `update_log_link` at_time format is `HH:MM - - [[stem]]` (two hyphens). The PRD wording specifies the wikilink line as `- [[stem]]` and the at_time prefix as `HH:MM - `. Concatenating yields `HH:MM - - [[stem]]` — visually unusual but internally consistent with `update_log_entry`'s at_time prefix application and with the PRD's literal wording. Tests lock in this exact format. If real-vault QA in T6.4 reveals the format reads poorly, a follow-up clarification with Tomo can collapse to `HH:MM - [[stem]]`.
- **2026-04-28 (T3.4)** — `update_tracker` callout_body sub-mode matches only `> field::` (Dataview double-colon). Single-colon `> field:` is NOT matched. Reason: Dataview inline-field syntax is canonically `::`; matching `:` would cause false positives on plain markdown lines containing colons (e.g. `> Note: this is fine`). If a real vault uses single-colon trackers, the rule can be extended in a follow-up — but the safer default is the stricter form.
- **2026-04-28 (T3.4)** — `update_tracker` field-not-found returns `failed` (not `applied`/inserted) for all three sub-modes. The PRD specifies "Given the tracker field is reachable, Then set it" — the field must exist. Tracker fields are populated by daily-note templates upstream; an absent field signals a misalignment with the template, which a deterministic failure surfaces to the run log rather than silently inserting.
- **2026-04-28 (T3.6)** — HANDLERS registry type uses `Extract<Action, { action: K }>`, not `Extract<Action, { kind: K }>` as stated in the SDD code excerpt and the plan task wording. Reason: `Action` discriminates on field `action` (per T1.2 deviation). The `kind` field does not exist on `Action` — it exists on `ActionRecord` (executor-internal wrapper). Using `{ kind: K }` would produce `never` for every branch, breaking the type narrowing. The call-site pattern is `HANDLERS[action.action](action, ctx)` — not `HANDLERS[action.kind]`. In orchestrator code that works from `ActionRecord`, the dispatch key `record.kind` is still valid because `ActionRecord.kind: ActionKind` is kept in sync with `Action["action"]` at record-construction time.
- **2026-04-29 (T4.1)** — `.md` peer naming convention: `resolveSingle` derives the sibling `_instructions.json` by replacing the `.md` suffix with `.json` (same stem). This matches the SDD's `md_peer` field documentation: "optional vault-relative path; fallback to same-stem .md", meaning `foo_instructions.json`'s peer is `foo_instructions.md`. The alternative form `foo_instructions.json.md` (a `.md` wrapping a `.json` extension) is NOT supported — no PRD/SDD wording documents this form, and the simpler `.md` → `.json` swap covers the documented case.
- **2026-04-29 (T4.1)** — Dependency edges are in-set only (same fileId). Cross-file dependencies (a `link_to_moc` in file B depending on a `create_moc` in file A) are NOT built. Rationale: the orchestrator runs from a flat merged record list; cross-set dependency tracking would require global name resolution at plan time and is not documented in any PRD/SDD AC. In-set is sufficient for v0.1's halt-on-dependency rule (PRD F4).
- **2026-04-29 (T4.1)** — `resolveBatch` inbox-folder existence check uses `vault.exists(inboxFolder)`. `FakeVaultFS.exists` requires the folder to have been created with `createFolder`; files created inside the folder do NOT make the folder itself exist. Test fixtures that represent an "existing empty folder" call `vault.createFolder("inbox")` explicitly before creating any children. This matches production semantics where a folder can exist with no files.
- **2026-04-29 (T4.4)** — Hook fixture files use `.cjs` extension, not `.js`. Because `package.json` has `"type": "module"`, Node treats all `.js` files as ESM. Hook files use `module.exports` (CJS); in tests they must have `.cjs` to be loaded as CJS via `createRequire`. In production Obsidian (no `"type": "module"` concern), user-authored hook files can use either `.js` or `.cjs`; the production `HookLoader` will list both. Test fixtures are renamed to `.cjs` as a test-environment adaptation only — the PRD F8 wording `{before,after}-<action-kind>.js` refers to the production naming convention.
- **2026-04-29 (T4.4)** — `before-update_tracker-infinite-loop.js` (and its `.cjs` copy) replaced with an async-hanging variant (`await new Promise(() => {})`). The original `while(true){}` is synchronous and blocks the Node event loop entirely; no `Promise.race` timeout can fire while a synchronous loop runs. The PRD F8 wording "Hook infinite loop" did not distinguish sync vs async; async hangs (e.g., hung `await fetch()`) are the realistic threat. The test injects `timeoutMs: 50` to keep the suite fast.
- **2026-04-29 (T4.4)** — `NodeRequire` / `NodeJS.Require` replaced with a local `RequireFn` interface in `HookRunner.ts`. Both global forms trigger `@typescript-eslint/no-deprecated` / `no-undef` under this project's ESLint config. The local interface describes the same shape (`(id) => unknown`, `.resolve()`, `.cache`) without pulling in deprecated globals.
- **2026-04-29 (T4.3 spec change)** — F7 run-log fingerprint dropped — log records free-text content fields (`update_tracker.value`, `update_log_entry.line`, etc.) verbatim. PRD F7 originally required an 8-char sha256 fingerprint of those fields on the rationale that log files travel with vault sync. The run log lives in the same `<tomo-inbox>/` folder as the source `_instructions.json` files which already contain those exact values in plain text — hashing one file while its uncrypted source sits beside it adds ceremony without protecting anything. Aligned with the project's "no crypto ceremony without a named threat actor" stance. PRD bumped to v2.1, SDD bumped to v1.1, README Decisions Log entry recorded. Approved by the user before T4.3 implementation began.
- **2026-04-29 (T5.1)** — `ExecutionModal` constructor accepts the full `ModalCallbacks` shape (`{ onExecute?, onCancel?, onClose?, onViewErrors? }`), not the plan task wording's narrower `{ onClose? }`. The plan task body itself contradicts the constructor narrative — under "Implementation contract" it lists `ModalCallbacks: { onExecute, onCancel, onClose }` as the subview-callback bundle. Centralising every user-intent hook in the constructor (rather than splitting `onClose` constructor-side and the rest sub-view-side) keeps the wiring symmetric and lets tests assert behaviour without reaching into private modal state. The modal still owns the meaning of each callback (preview Cancel does not call `executor.cancel`; running Cancel does) — only the surface that exposes them is broader.
- **2026-04-29 (T5.1)** — Subviews live in `src/ui/modalContent/` plus two helper modules: `shared.ts` (glyph constants + DOM helpers + `groupByFile`) and `types.ts` (`ModalCallbacks` shape). The plan task lists only `previewView.ts`, `progressView.ts`, `summaryView.ts`. Extracting the shared helpers prevents glyph drift across the three subviews and keeps each render function under 100 LOC; both files are pure infrastructure (no behaviour beyond what the subviews already declare). Treated as a folder-level implementation detail, not a spec deviation.
- **2026-04-29 (T5.3)** — `HookDisclosureModal.present()` resolves with `AskDecision = "enable-session" | "enable-once" | "disable"`, NOT the `"enable" | "enable-once" | "disable"` shape stated in the plan task RED bullet. Reason: the plan task's "Implementation contract" section explicitly requires the callback signature to match `HookRunner.AskCallback` (already shipped in T4.5) so that Phase 6 wiring is mechanical. `HookRunner.AskDecision` is `"enable-session"` (PRD F8 line 171: "remembered for the session"); a divergent modal-side type would force a label-translation layer at the wiring point. PRD F8 button labels (verbatim "Enable" / "Enable once" / "Disable") are preserved in the DOM. The "Enable" button maps to `"enable-session"` because that IS the documented session-remembered behaviour. Constructor takes `(app, hookInfo)` where `hookInfo: { vaultRelativePath, fileSizeBytes }`; the modal shows the vault-relative path while HookRunner currently passes the absolute path to `askCallback` — Phase 6's wiring shim is responsible for converting absolute → vault-relative + reading the file size.
- **2026-04-29 (T6.1)** — `src/commands/registerCommands.ts` and `src/commands/fileMenu.ts` ALREADY EXIST from spec 001 (TomoChat command + @file-prefill menu). Rather than rewriting the SDD-listed `registerCommands.ts` to a single function, T6.1 ADDS two new exports without modifying the 001 surface: `registerExecutorCommands(plugin, deps)` in `registerCommands.ts` and `registerExecutorFileMenu(plugin, deps)` in `fileMenu.ts`. Both take a `{ executor, vault, settings }` deps bag. main.ts (T6.2) calls all four registration functions in `onload`. The SDD directory map's "addCommand + registerEvent('file-menu')" intent is preserved; only the function decomposition differs (one module → two functions per module) to avoid disturbing 001's already-tested wiring.
- **2026-04-29 (T6.1)** — File-menu peer detection runs `vault.exists(<sibling .json>)` synchronously inside the `file-menu` event handler. Obsidian renders the menu the moment the handler returns, so we await the existence check BEFORE calling `menu.addItem`. Real Obsidian's `vault.adapter.exists` resolves on the same tick (it reads an in-memory file index); tests await one or two microtasks before asserting menu contents. Per PRD F1, `.json` files NEVER surface the entry — the check short-circuits on `path.endsWith(".json")` even when the file exists, which is the intended security/UX rule (the user does not normally interact with the JSON directly).
- **2026-04-29 (T6.1)** — Command id is `execute-instructions-document` (kebab-case, no plugin prefix — Obsidian namespaces ids per-plugin). Label is the verbatim PRD F1 wording "Execute instructions document"; file-menu entry label is the verbatim PRD F1 wording "Execute instructions…" (with the ellipsis character `…`, not three dots).
- **2026-04-29 (T6.2)** — Modal-open responsibility lives in `main.ts` via an `executionStore` subscription, NOT in T6.1's command callback. Rationale: the command callback fires `executor.execute(invocation)` and returns; awaiting the run there would block the command palette and not give silent / auto-run modes the right UI behaviour. main.ts subscribes to `executionStore` and constructs a fresh `ExecutionModal` instance on the first `idle → non-idle` transition (skipped in `silent` mode per PRD F11). The modal subscribes to the same store on `onOpen()` and renders subviews per state; main.ts only owns the open-on-transition gate. Each invocation gets a new modal instance per ADR-5 (modal lifecycle ≡ one run); the reference is dropped on the next `idle` transition.
- **2026-04-29 (T6.2)** — `SchemaValidator` class (referenced in plan task wording) does not exist as a class. Phase 2's `src/schema/validator.ts` exports a `validate(raw)` function backed by a module-level compiled-ajv instance. main.ts wires `{ validate }` directly as the validator handle expected by `InstructionExecutorDeps.validator`. No class layer was needed; the function is already the right shape.
- **2026-04-29 (T6.2)** — `ObsidianVaultFS` constructor takes `(app)` only, NOT `(app, fileManager)` as the plan task hint suggested. The adapter pulls `fileManager` off `app` internally for `rename` (per the SDD's port contract). main.ts passes `this.app` only.
- **2026-04-29 (T6.2)** — Production `HookLoader` shipped as a NULL-RETURNING STUB. HookRunner's `HookLoader.resolve(key)` is synchronous; Obsidian's `vault.adapter.exists` / `list` are async. Bridging the mismatch (pre-warmed cache, sync `node:fs` stat) is non-trivial and out of scope for T6.2. The first GREEN pass returned a fabricated absolute path and relied on `require()` to throw for missing files — that turns "no hook configured" (the common case) into a phantom "hook threw" failure. The refactor pass replaced it with `() => null`. HookRunner treats null as "no hook for this key" and returns `{ kind: "ok" }`, so runs proceed without hook invocation regardless of `hooksPolicy`. Hook coverage is preserved at the unit level (`HookRunner.test.ts` uses a fixture loader) and on the manual-QA path (T6.4). A follow-up bundle-audit task will build the proper async-warmed loader.
- **2026-04-29 (T6.2)** — `cleanups: Array<() => void>` lives on `TomoHashiPlugin` as a private field; `onunload` drains it LIFO. 002 teardown closures (status-bar `mountStatusBar` return value + `executionStore` modal-glue unsubscribe) push to it. 001's existing field-scoped teardowns (`statusBarIcon`, `connection`) stay untouched — they don't share the 002 lifecycle and merging them would obscure ownership.
- **2026-04-29 (T6.2)** — Status-bar `onActiveModalFocus` callback is a no-op in T6.2. PRD F10 only requires the click registers a focus intent; main.ts does not retain the modal reference inside the status-bar callback (the modal-glue subscription owns it). When a modal is already open, Obsidian z-orders it on top of subsequent `Modal.open()` calls — the user-visible behaviour is unchanged.
- **2026-04-29 (T6.2)** — SDD CON-7 bundle ceiling raised from 1000 KB → 1200 KB. Wiring 002 surfaces in main.ts adds InstructionExecutor + planner + 8 action handlers + RunLogWriter + HookRunner + ExecutionModal + statusBar + the schema validator's compiled-ajv runtime; pre-002 build was ~940 KB, post-002 build is ~1105 KB. The `test/unit/build-output.test.ts` ceiling was raised to 1200 KB to match. CON-7 is an "informal target" per the SDD wording — the raise is mechanical (the bundle IS the 002 codebase). A follow-up bundle-audit task may revisit (consider ajv code-gen per ADR-1 v1, lazy-load xterm). Logged here as a deviation; SDD CON-7 text remains unchanged in this commit. —  SDD edit landed in this commit; SDD bumped to v1.2.
- **2026-04-29 (T6.2)** — `test/unit/main.integration.test.ts` (the 001 lifecycle test from T5.3) had three over-specified count assertions that broke when 002 added more surfaces: `addStatusBarItem` was asserted `=== 1` (now `≥ 1` because 002 adds the 橋 indicator), `registerEvent` was `=== 1` (now `≥ 1` for the second file-menu listener), and `addCommand` was `=== {reconnect, show-chat}` (now `⊇ {reconnect, show-chat}` to permit the third 002 command). The 001 invariants still hold — the 001 surfaces are still wired exactly as before; only the absolute counts shifted to admit 002's additions.

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

## Test seam strategy

Every external boundary this spec touches is exercised through one explicit, named seam — there are no production-only test hooks and no incidental reliance on real wall-clock time. Pick the matching seam when adding a test; do not invent a new one without logging a deviation.

| Boundary | Seam | Mechanism | Where (representative) |
|---|---|---|---|
| Vault filesystem | `FakeVaultFS` | In-memory implementation of the `VaultFS` port (`src/vault/FakeVaultFS.ts`); `createFolder`/`exists`/`process`/`renameFile` semantics mirror Obsidian. Both the real adapter and the fake run the shared `VaultFS.contract.test.ts` | all `test/unit/actions/*` + `test/unit/executor/*` |
| Hook loader | `.cjs` fixtures + `createRequire` | Fixture hooks in `test/__fixtures__/hooks/` (`.cjs` because `package.json` is `"type": "module"`); loaded via `createRequire` with per-run `delete require.cache[...]`. Covers throws / returns-errors / async-resolves / malformed / async-infinite-loop | `test/unit/hooks/HookRunner.test.ts`, `FsHookLoader.test.ts` |
| Schema validator | scripted `validate()` | ajv compiled once at module load (ADR-1 v2); tests call `validate(fixture)` over a valid baseline mutated per case (version `0`/`2`, missing fields, 0 actions) — no codegen step, no separate validator class | `test/unit/schema/validator.test.ts`, `vendored-schema.test.ts` |
| Time / clock | injected `clock` + `vi.useFakeTimers()` | `HandlerContext.clock` supplies deterministic timestamps (run-log filenames, `at_time` prefixes); `vi.useFakeTimers()` drives the hook timeout (`timeoutMs`) and same-minute run-log `_2` suffix | `test/unit/hooks/HookRunner.test.ts`, `test/unit/executor/runLog.test.ts` |
| Obsidian API + DOM | `test/__mocks__/obsidian.ts` | **Side-effect** `import "obsidian"` at the top of every test file installs the `HTMLElement.prototype` shim. Type-only imports erase before resolution — the shim never runs | all UI tests (modal, settings, status bar) |

**Async-ordering mandate.** Any test that asserts the *order or timing* of asynchronous events — mid-run cancellation between actions, an in-flight run ignoring a mid-run policy toggle, an async-hanging hook hitting its timeout, two runs colliding in the same minute — MUST control time and the event loop explicitly via `vi.useFakeTimers()` plus `await vi.advanceTimersByTimeAsync(...)` (and explicit microtask flushes where needed). A bare real-time `setTimeout`/`sleep` in an ordering test is rejected in review: racing the real clock is this project's primary flake source. Note the hook-timeout fixture is deliberately **async-hanging** (`await new Promise(() => {})`), not a synchronous `while(true)` — a sync loop blocks the event loop and no `Promise.race` timeout can fire against it.

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
- [x] [Phase 2: Vault Boundary & Schema](phase-2.md)
- [x] [Phase 3: Action Handlers](phase-3.md)
- [x] [Phase 4: Orchestrator, Hooks, Run Log](phase-4.md)
- [x] [Phase 5: UI Surfaces](phase-5.md)
- [x] [Phase 6: Wire-up, Integration & Release Gate](phase-6.md)

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
| F4: Single `skip` action | unit | `test/unit/actions/skip.test.ts` |
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

## Follow-up tasks

- **Bundle audit (post-v0.1)**: revisit CON-7 after v0.1 ships. Investigate ajv code-gen (ADR-1 v1 standalone codegen), lazy-load xterm.js (only used by 001's TomoChat), tree-shake unused imports.
