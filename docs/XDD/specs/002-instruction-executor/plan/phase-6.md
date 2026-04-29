---
title: "Phase 6: Wire-up, Integration & Release Gate"
status: pending
version: "1.0"
phase: 6
---

# Phase 6: Wire-up, Integration & Release Gate

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- PRD: F1 (invocation entry points), all 95 ACs (traceability) — `[ref: PRD/F1; PRD/§Feature Requirements]`
- SDD: Runtime View; Quality Requirements; Acceptance Criteria; ADR-9 (manual test vault) — `[ref: SDD/Runtime View; Primary Flow]` `[ref: SDD/Architecture Decisions; ADR-9]`

**Key Decisions** (affecting this phase):
- ADR-9: live tests + manual QA against `../temp/Privat-Test` complete the test pyramid
- v0.1 release gate (architecture-06 §10) requires the Tomo `applied:false` round-trip — Tomo v0.7.0+ already integrated (spec README decisions log)
- Manifest `isDesktopOnly: false → true` is owned by 001's plan; this plan re-asserts it as a release-gate check

**Dependencies**: Phases 1–5 (everything implemented and unit-/live-tested in isolation).

---

## Tasks

This phase wires every surface together in `main.ts`, exercises the full system end-to-end against a temp-directory live vault, runs the manual QA checklist against `../temp/Privat-Test`, and produces the release-gate traceability artifact.

- [x] **T6.1 Command + file-menu registration** `[activity: integration]`

  1. Prime: Read PRD F1 invocation rules `[ref: PRD/F1]`. Read SDD `commands/registerCommands.ts` directory entry `[ref: SDD/Directory Map; commands]`.
  2. Test: `test/unit/commands/registerCommands.test.ts`:
     - "Execute instructions document" command registered with the right id and label
     - Command callback resolves invocation kind: active `.md` peer → `{ kind: "single-file", sourcePath }`; active `.json` instructions file → same; any other active file (or no active file) → `{ kind: "batch" }`
     - File-menu handler injects "Execute instructions…" entry on `.md` peer files only
     - File-menu handler does NOT inject the entry on `.json` files (per PRD F1 explicit rule)
     - Invocation is debounced at the executor's single-run lock — no second concurrent dispatch from a double-click
  3. Implement: `src/commands/registerCommands.ts` — `addCommand` + `registerEvent('file-menu', handler)`. Helper `resolveActiveFile(workspace, settings)` returns the right `Invocation` shape.
  4. Validate: Tests pass; dry-run command registration in jsdom (mock `Plugin.addCommand`).
  5. Success:
     - [x] All PRD F1 invocation paths covered `[ref: PRD/F1]`
     - [x] No invocation path on `.json` right-click `[ref: PRD/F1]`

- [x] **T6.2 main.ts wire-up** `[activity: integration]`

  1. Prime: Read existing `src/main.ts` (after 001 has wired its surfaces). Read SDD "Building Block View" diagram + "Building Block View — Components" `[ref: SDD/Building Block View]`.
  2. Test: `test/unit/main.test.ts` — simulate plugin lifecycle:
     - `onload`: 002 wiring instantiates `ObsidianVaultFS`, `SchemaValidator` (which compiles ajv at module load against the bundled schema — no `validator.gen.js` import per ADR-1 v2), `HookRunner`, `InstructionExecutor`, `ExecutionModal` (modal class only — instance created on demand), `StatusBar`, `SettingsTab` (extension, not replacement), `registerCommands`, `registerEvent('file-menu')`
     - `onunload`: subscriptions unsubscribed; status bar item removed; commands removed; no orphan listeners
     - Plugin does NOT instantiate the executor more than once (singleton)
  3. Implement: Modify `src/main.ts` to wire 002 alongside 001 (do not refactor 001 wiring). Add a `cleanups: Array<() => void>` array used in `onunload`.
  4. Validate: All main.ts tests pass; full unit suite `npm test` green; build `npm run build` clean.
  5. Success:
     - [x] Plugin loads without error in jsdom `[ref: SDD/Building Block View]`
     - [x] Plugin unloads cleanly with zero listener leaks `[ref: SDD/Cross-Cutting Concepts; Performance]`

- [ ] **T6.3 End-to-end live test — fixtures + executor.live.test.ts** `[activity: testing]`

  1. Prime: Read SDD test split + fixture layout `[ref: SDD/Directory Map; test/fixtures/instructions]`. Read PRD ACs covering halt-on-dependency, partial-resume, batch-mode.
  2. Test: ~~Build out `test/live/executor.live.test.ts` using `FsPromisesVaultFS`~~ — **OBSOLETE** per ADR-9 v2 (revised 2026-04-25). The integration gate is now manual QA in `../temp/Privat-Test` (Phase 6 T6.4) — a node-fs adapter cannot exercise the Obsidian-specific semantics that matter (`fileManager.renameFile` link preservation, `vault.process`, `MetadataCache`). The scenarios listed below are now the manual-QA scenario list in T6.4.
     - **happy-path**: 8-action mixed-kind set; all succeed; `applied: true` everywhere; run log has 8 lines; peer `.md` ticked best-effort
     - **partial-resume**: pre-mark 5 of 12 actions as `applied: true`; run; only 7 execute; banner-equivalent reasoning verified by counting writes
     - **halt-on-dependency**: `create_moc I03` fails (target folder simulated as restricted); dependent `link_to_moc` records as `skipped-dependency`; non-dependent actions still run
     - **batch-multi-file**: 3 instruction sets in inbox; merged execution; per-file headers in run log
     - **schema-invalid-version**: file with `schema_version: 2` fails F2; other files in batch proceed
     - **peer-missing**: `.md` peer not on disk; run still completes; warning recorded; `applied: true` written to JSON
     - **silent-mode**: no modal subscribed; Notice still fires; run log written
     - **cancellation**: cancel between actions; remaining marked `skipped-cancelled`
  3. Implement: `test/fixtures/instructions/<scenario>/` directories with input `.json` + initial files + expected outputs. Use small, hand-readable fixtures (10-20 actions max per scenario except batch).
  4. Validate: `npm run test:live` green for all 8 scenarios; runtime budget < 30s total.
  5. Success:
     - [ ] All 8 fixture scenarios pass live `[ref: PRD/F1, F2, F4, F5, F6, F7]`
     - [ ] Test runtime within budget `[ref: SDD/Quality Requirements]`

- [ ] **T6.4 Manual QA checklist + test-vault deployment** `[activity: validate]`

  1. Prime: Read SDD ADR-9 manual-vault clause `[ref: SDD/Architecture Decisions; ADR-9]`. Confirm `../temp/Privat-Test` exists and has the plugin folder structure (`.obsidian/plugins/miyo-tomo-hashi/`).
  2. Test: Author `docs/XDD/specs/002-instruction-executor/plan/manual-qa-checklist.md` listing every PRD AC that requires real-Obsidian observation (modal layout, status bar color, hook disclosure dialog, settings UI, file menu entry visibility, run log file appearance in inbox, etc.). Each row: AC ref, expected, observed, passed (Y/N), notes.
  3. Implement:
     - In `esbuild.config.mjs`, uncomment the `VAULT_PLUGIN_DIR = "../temp/Privat-Test/.obsidian/plugins/miyo-tomo-hashi"` block (or add a flag-gated equivalent) so `npm run build` copies output into the test vault.
     - Run the build. Open `../temp/Privat-Test` in Obsidian (Insider or stable). Walk through the manual checklist with at least one Tomo-emitted instruction set in the inbox.
  4. Validate: All checklist rows marked passed; observations recorded for any failures; deviations logged in spec README.
  5. Success:
     - [ ] Manual checklist 100% passed in real Obsidian `[ref: SDD/ADR-9]`
     - [ ] Build deployment to test vault wired and documented `[ref: SDD/Implementation Context]`

- [ ] **T6.5 PRD AC traceability table + spec finalization + Phase 6 Validation** `[activity: validate]`

  1. Prime: Read PRD §Feature Requirements (F1–F11) — count ACs by `grep -c '^  - \[ \]' requirements.md` and use that as the gate (do NOT hard-code a per-feature breakdown — it drifts when ACs are added or removed). The PRD's Output Schema row holds the current canonical total; the traceability matrix MUST cover that exact count.
  2. Test: Build a traceability matrix file `docs/XDD/specs/002-instruction-executor/plan/traceability.md`:
     - Rows: every PRD AC (count taken from PRD Output Schema at run time)
     - Columns: AC ID (Fx.y) | description | covering test file(s) | covering live-test scenario(s) | covering manual-QA row(s) | status (✅ / ❌)
     - Every AC must have at least one ✅ across the test/live/manual columns
  3. Implement:
     - Run `npm run build && npm test && npm run test:live && npm run lint` — confirm full green
     - Walk the PRD; for each AC, fill in the table
     - If any AC has no coverage, add a TDD-style task to the relevant phase (out-of-band) and re-run the table
     - Update `docs/XDD/specs/002-instruction-executor/README.md` `Documents` table: mark `plan/` as draft → ready
     - Append a final entry to the spec README Decisions Log dating Phase 6 close
  4. Validate: Full traceability matrix at 100% coverage; all status rows ✅; spec README reflects ready-for-implementation state.
  5. Success:
     - [ ] 100% of PRD ACs traced to at least one test/live/manual artifact (count gate from PRD Output Schema) `[ref: PRD/Feature Requirements]`
     - [ ] Spec readiness assessed by xdd-meta = HIGH `[ref: SDD/Validation Checklist]`

  - **Phase 6 Validation**: Final command run `npm run build && npm test && npm run test:live && npm run lint`. All green. Manifest `isDesktopOnly: true` (sanity re-check). Tomo handoff status `done` (it was when we drafted; sanity-check). Outbox/inbox clean. Spec 002 ready for the implement workflow.
