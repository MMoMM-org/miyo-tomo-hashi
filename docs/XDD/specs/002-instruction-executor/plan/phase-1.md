---
title: "Phase 1: Foundation"
status: completed
version: "1.0"
phase: 1
---

# Phase 1: Foundation

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- PRD: `docs/XDD/specs/002-instruction-executor/requirements.md` — Constraints; F11 Plugin Settings; F9 Path Safety
- SDD: `docs/XDD/specs/002-instruction-executor/solution.md` — Constraints (CON-1..CON-10); Implementation Context; Application Data Models; Plugin Settings; Directory Map
- Project: `CLAUDE.md`, `src/CLAUDE.md` (TDD gate), `test/CLAUDE.md`, `tsconfig.json`, `package.json`, `esbuild.config.mjs`, `manifest.json`

**Key Decisions** (affecting this phase):
- ADR-1 (revised 2026-04-25): ajv 8.x at runtime — no prebuild, no committed generated artifact, no `json-schema-to-ts` dep
- ADR-2: vendored schema from Tomo v0.7.0+ at `src/schema/instructions.schema.json`
- 002 reuses 001's `Store<T>` from `src/util/store.ts` — file must exist (created by 001 Phase 1 T1.3) or be extracted on demand here

**Dependencies**: None within 002. External: `src/util/store.ts` exists (created by 001's Phase 1 T1.3) — if not, T1.5 below extracts it.

---

## Tasks

This phase vendors the Tomo schema, wires up the prebuild ajv-codegen pipeline, defines core types, extends `PluginSettings` and the settings UI for the seven new fields, builds the path-safety utility, and extends the Obsidian test mock.

- [x] **T1.1 Vendor schema + add ajv tooling** `[activity: platform]`

  1. Prime: Read SDD CON-2 (build), ADR-1 (ajv standalone), ADR-2 (vendored schema) `[ref: SDD/Constraints; CON-2]` `[ref: SDD/Architecture Decisions; ADR-1, ADR-2]`. Read the Tomo schema source. **Important**: the Tomo repo is on the same machine; copy `tomo/schemas/instructions.schema.json` from a Tomo v0.7.0+ checkout (commit `f3ad49d` or later — see spec README decisions log) into `src/schema/`.
  2. Test: Add a regression test `test/unit/schema/vendored-schema.test.ts` that:
     - Reads `src/schema/instructions.schema.json` and asserts `schema_version` constant equals 1
     - Asserts `$defs/applied_field` is present (Tomo v0.7.0+ structural marker)
     - Asserts every action variant under `oneOf` references `$defs/applied_field`
  3. Implement:
     - Copy `tomo/schemas/instructions.schema.json` into `src/schema/instructions.schema.json`
     - `package.json` dependencies: add `"ajv": "^8.17.1"` (runtime). No build-script changes; ajv compiles the schema at module load.
     - `npm install`
  4. Validate: `npm test` regression passes (validator.ts compiles ajv against bundled schema at module load); `npm run lint` clean.
  5. Success:
     - [ ] Vendored schema file present and asserted by regression test `[ref: SDD/ADR-2]`
     - [ ] `src/schema/validator.ts` compiles ajv against bundled schema at module load `[ref: SDD/ADR-1 (revised 2026-04-25)]`

- [x] **T1.2 Define core types** `[activity: domain-modeling]`

  1. Prime: Read SDD "Application Data Models" — `Action`, `InstructionSet`, `RunState`, `ActionOutcome` (single end-to-end outcome type — `HandlerOutcome` was collapsed into it on 2026-04-25), `ExecutionMode` `[ref: SDD/Interface Specifications; Application Data Models]`.
  2. Test: Write `test/unit/schema/types.test.ts` and `test/unit/executor/state.test.ts`:
     - `ActionKind` is the exact 8-element string-literal union expected
     - `Action` discriminated union narrows correctly on `kind`
     - `InstructionSet` requires `schema_version: 1` and an `actions` array
     - `RunState` discriminates correctly across 6 states (idle / preparing / previewing / running / summary / validation-failed)
     - `ActionOutcome` discriminates across applied / skipped-already / skipped-dependency / skipped-cancelled / failed
     - Exhaustive switch over each union compiles
  3. Implement:
     - Create `src/schema/types.ts` — `ActionKind`, `InstructionSet`, `Action` union (use `json-schema-to-ts` `FromSchema<typeof schema>` if convenient, otherwise hand-write aligned types — verified by the regression test against the vendored schema)
     - Create `src/executor/state.ts` — `RunState`, `ActionRecord`, `ActionOutcome`, `RunCounts`, `ExecutionMode`
  4. Validate: All type tests compile and pass; `npm run build` typechecks cleanly; no `any`.
  5. Success:
     - [ ] Types usable in downstream phases `[ref: SDD/Application Data Models]`
     - [ ] Discriminated unions enforce exhaustive handling `[ref: SDD/Application Data Models]`

- [x] **T1.3 Extend PluginSettings + Settings tab UI** `[activity: frontend-ui]`

  1. Prime: Read PRD F11 (all 7 settings + defaults) `[ref: PRD/F11]`; read SDD "Plugin Settings" `[ref: SDD/Plugin Settings]`; read existing `src/settings/SettingsTab.ts` and `src/types/index.ts`.
  2. Test: Write `test/unit/settings/SettingsTab.test.ts`:
     - All 7 new settings render with correct labels + defaults (Tomo inbox folder, Execution mode radio, Run log retention radio, Hooks dir, Hooks policy radio, Disable all hooks toggle, Debug logging toggle)
     - Changing a setting calls `plugin.saveSettings()` exactly once
     - The tomoInboxFolder text input rejects absolute paths and rolls back to previous value (path-safety boundary at the settings layer)
     - The hooksDir text input has the same rollback for absolute paths
     - Per-hook *ask*-mode decisions (Enable / Enable once / Disable) DO NOT survive a plugin reload — simulate a `plugin.unload()` + `plugin.onload()` cycle and verify the next would-be hook invocation re-prompts via the disclosure callback `[ref: PRD/F11]`
  3. Implement:
     - Modify `src/types/index.ts`: extend `PluginSettings` with the 7 new fields + corresponding `DEFAULT_SETTINGS` entries (per SDD Plugin Settings section)
     - Modify `src/settings/SettingsTab.ts`: render 7 new `Setting` controls in a clearly labeled "Instruction executor" section below 001's connection settings
  4. Validate: Tests pass; manual smoke (open settings in dev): all 7 controls render; persistence round-trips.
  5. Success:
     - [ ] All 7 settings persist via `data.json` `[ref: PRD/F11]`
     - [ ] Per-hook ask-mode decisions NOT persisted in `data.json` `[ref: PRD/F11]`
     - [ ] Path-safety boundary at the settings layer prevents misconfig `[ref: PRD/F9, F11]`

- [x] **T1.4 Path-safety utility** `[activity: domain-modeling]`

  1. Prime: Read PRD F9 (full AC list) `[ref: PRD/F9]`; read SDD `src/util/paths.ts` directory entry `[ref: SDD/Directory Map]`.
  2. Test: Write `test/unit/util/paths.test.ts`:
     - `normalizeAndContain(vault, path)` accepts vault-relative paths
     - Rejects absolute paths (`/foo`, `C:\foo`, `D:foo`)
     - Rejects `..`-traversal (`a/../b`, `../etc`, `a/b/../../etc`)
     - Rejects empty segments (`a//b`)
     - Rejects symlink-escape (when vault has a symlink pointing outside)
     - `denyListMatch(path, hooksDir)` matches `.obsidian/foo`, `.git/bar`, `.trash/baz`, `<hooksDir>/anything`
     - Does NOT match similarly-prefixed paths (`my.obsidiania/foo`, `git-stuff/bar`)
     - Per-action validation order: schema → normalize → contain → deny-list → execute (assertion ordering only, function names checked by reference)
  3. Implement: Create `src/util/paths.ts`:
     - `normalizeAndContain(rawPath: string): { ok: true; vaultRelativePath: string } | { ok: false; reason: string }`
     - `denyListMatch(vaultRelativePath: string, hooksDir: string): boolean`
     - The deny-list patterns are constants in this module: `^\.obsidian(/|$)`, `^\.git(/|$)`, `^\.trash(/|$)`, plus the runtime-injected `hooksDir`
  4. Validate: All path-safety tests pass; ESLint clean.
  5. Success:
     - [ ] Path safety table covers every PRD F9 AC `[ref: PRD/F9]`
     - [ ] Deny-list correctly handles configurable `hooksDir` `[ref: PRD/F8, F9]`

- [x] **T1.5 Ensure `Store<T>` available + extend obsidian test mock** `[activity: testing]`

  1. Prime: Read 001's SDD State Store section `[ref: 001/SDD/State Store (typed Store<T> helper)]`. Check if `src/util/store.ts` already exists. Read existing `test/__mocks__/obsidian.ts`.
  2. Test: Write/extend `test/unit/__mocks__/obsidian-shape.test.ts`:
     - Asserts presence of `Modal` (with `open`, `close`, `contentEl`, `onOpen`, `onClose`)
     - Asserts `Vault.process` (vi.fn that returns Promise<void>)
     - Asserts `FileManager.renameFile` (vi.fn)
     - Asserts `Vault.trash` (vi.fn)
     - Asserts `Vault.createFolder` (vi.fn that swallows already-exists)
     - Asserts `MetadataCache.getFileCache` (vi.fn returning `{ headings: [], sections: [] }` by default)
     - Asserts `Plugin.registerEvent` and `Plugin.addStatusBarItem`
  3. Implement:
     - **If `src/util/store.ts` does not yet exist** (001 Phase 1 hasn't shipped): extract the `Store<T>` helper here per 001's SDD code sketch (no `derived<T,U>` — that was dropped in 001's 2026-04-25 simplification). Document in spec README that this was extracted on demand for 002.
     - Extend `test/__mocks__/obsidian.ts`: add `Modal`, `vault.process`, `vault.trash`, `vault.createFolder`, `fileManager.renameFile`, `metadataCache.getFileCache`, `addStatusBarItem`. The mock should let tests inject return values per call.
  4. Validate: Mock-shape tests pass; existing 001 tests (if any) still pass.
  5. Success:
     - [ ] `Store<T>` available at `src/util/store.ts` `[ref: 001/SDD/ADR-4; 002/SDD/Solution Strategy]`
     - [ ] Obsidian mock covers every API the executor uses `[ref: SDD/Code Context; test/__mocks__/obsidian.ts]`

- [x] **T1.6 Phase 1 Validation** `[activity: validate]`

  - Run `npm run build && npm test && npm run lint`. All green. Confirm: vendored schema present + asserted; types compile across the new modules; settings render and persist; path-safety utility passes its full table; obsidian mock covers the Phase 2+ API surface.
  - If `src/util/store.ts` was extracted on-demand here, append a deviation record to the plan README's Deviations section noting the extraction.
