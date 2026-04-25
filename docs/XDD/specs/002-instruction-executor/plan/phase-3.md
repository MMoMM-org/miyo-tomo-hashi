---
title: "Phase 3: Action Handlers"
status: pending
version: "1.0"
phase: 3
---

# Phase 3: Action Handlers

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- PRD: F4 (all 8 action kinds + canonical order + halt-on-dependency) — `[ref: PRD/F4]`
- SDD: Action Handler Contract; sectionLocator example; ADR-4 (pure handler functions); Implementation Examples — `[ref: SDD/Interface Specifications; Action Handler Contract]` `[ref: SDD/Implementation Examples; Section Locator for link_to_moc]` `[ref: SDD/Architecture Decisions; ADR-4]`

**Key Decisions** (affecting this phase):
- ADR-4: 8 pure async functions, each `(action, ctx) => Promise<ActionOutcome>` (single end-to-end outcome type — `HandlerOutcome` was collapsed into `ActionOutcome` on 2026-04-25)
- ADR-7: every vault edit goes through `vault.process` (atomic)
- Handlers depend ONLY on `VaultFS` + `Clock` — zero `import 'obsidian'` lines
- Halt-on-dependency is the orchestrator's job (Phase 4), NOT the handler's. Handlers are stateless.

**Dependencies**: Phase 2 (`VaultFS`, `FakeVaultFS`, types).

---

## Tasks

This phase implements the eight pure action handlers + their two shared helpers (section locator, log position). Each handler is unit-tested against `FakeVaultFS`. The dispatch registry is built last and integrates them.

- [ ] **T3.1 Helpers — sectionLocator + logPosition** `[parallel: true]` `[activity: domain-modeling]`

  1. Prime: Read SDD "Section Locator for `link_to_moc`" example with traced walkthrough `[ref: SDD/Implementation Examples; Section Locator for link_to_moc]`.
  2. Test:
     - `test/unit/actions/sectionLocator.test.ts`:
       - Heading match — finds the right line range, terminates at next same-or-higher-level heading
       - Heading match at EOF — endLine === -1
       - Callout match (case-insensitive title)
       - Callout match for `> [!notes]`-style with body
       - No match — returns `null`
       - Heading and callout with the same name — heading wins (priority order)
     - `test/unit/actions/logPosition.test.ts`:
       - `after_last_line` — appends to EOF (with newline if missing)
       - `before_first_line` — prepends
       - `at_time HH:MM` — finds the right chronological position (existing `HH:MM`-prefixed lines lex-ordered)
       - `at_time HH:MM` with no existing time-prefixed lines — falls back to append at section/file end (per Tomo contract)
       - `at_time HH:MM` with multiple equal-time lines — inserts after the last one (defensive choice; documented)
  3. Implement:
     - `src/actions/sectionLocator.ts` — `locateSection(metadata, content, name): SectionRange | null`
     - `src/actions/logPosition.ts` — `insertAtPosition(content, line, position, atTime?): string`
  4. Validate: Both helper test suites pass; lint clean; type-check clean.
  5. Success:
     - [ ] Both heading and callout sections resolvable `[ref: PRD/F4]`
     - [ ] Three log positions implemented `[ref: PRD/F4]`

- [ ] **T3.2 Move handlers — create_moc, move_note** `[activity: domain-modeling]`

  1. Prime: Read PRD F4 ACs for `create_moc` and `move_note` `[ref: PRD/F4]`. Read SDD "Obsidian API Mapping per Action Kind" (research.md §1.4 / SDD references).
  2. Test:
     - `test/unit/actions/createMoc.test.ts` (against `FakeVaultFS`):
       - Source present + target absent → applied; result file at target path; source absent
       - Source absent + target present → skipped-already
       - Both source AND target present → failed *"Inconsistent state — both source and destination present"*
       - Destination folder missing → folder created before move
     - `test/unit/actions/moveNote.test.ts`: same matrix
  3. Implement:
     - `src/actions/createMoc.ts` — handler delegates to `vault.rename` (which the adapter routes to `fileManager.renameFile` for link preservation in the real adapter)
     - `src/actions/moveNote.ts` — same shape, different default destination convention
     - Both handlers call `vault.createFolder(dirOf(target))` before rename
  4. Validate: Tests pass; lint clean.
  5. Success:
     - [ ] Both handlers pass full idempotency matrix `[ref: PRD/F4]`
     - [ ] Inconsistent-state failure surfaces correct error string `[ref: PRD/F4]`

- [ ] **T3.3 link_to_moc handler** `[activity: domain-modeling]`

  1. Prime: Read PRD F4 ACs for `link_to_moc` `[ref: PRD/F4]`; SDD section-locator example `[ref: SDD/Implementation Examples; Section Locator]`.
  2. Test: `test/unit/actions/linkToMoc.test.ts`:
     - MOC exists, named heading section exists → bullet appended at end of section content
     - MOC exists, named callout exists → bullet appended at end of callout body
     - MOC exists, neither heading nor callout matches the name → in-set fallback to first editable callout, OR fail if no callout (per PRD F4 ACs)
     - MOC missing → failed *"MOC target missing"*
     - Identical bullet line already in section → skipped-already
     - Halt-on-dependency: this handler does NOT check whether the MOC was created earlier in this run — that's the orchestrator's responsibility
  3. Implement: `src/actions/linkToMoc.ts` — uses `sectionLocator` + `vault.process`.
  4. Validate: Tests pass; lint clean.
  5. Success:
     - [ ] Section + callout fallback path verified `[ref: PRD/F4]`
     - [ ] Idempotency on identical-bullet matches `[ref: PRD/F4]`

- [ ] **T3.4 Daily-note handlers — update_tracker + update_log_entry + update_log_link** `[activity: domain-modeling]`

  1. Prime: Read PRD F4 ACs for the three `update_*` kinds `[ref: PRD/F4]`. Note: Hashi does NOT resolve daily-note paths — Tomo emits absolute vault paths in payloads.
  2. Test:
     - `test/unit/actions/updateTracker.test.ts`: 3 sub-modes (inline_field / callout_body / checkbox); idempotency where field already at target value; conflict where field has a different value (failure path)
     - `test/unit/actions/updateLogEntry.test.ts`: 3 positions (after_last_line / before_first_line / at_time); idempotency on identical line
     - `test/unit/actions/updateLogLink.test.ts`: 3 positions; format `- [[stem]]`; `at_time HH:MM` adds `HH:MM - ` prefix; idempotency on identical link line
  3. Implement: three handler files in `src/actions/`. All three use `logPosition` helper from T3.1; tracker uses its own field-locator (one of three sub-modes).
  4. Validate: Full test matrix passes; lint clean.
  5. Success:
     - [ ] All three handlers honor PRD F4 idempotency + conflict semantics `[ref: PRD/F4]`
     - [ ] Position helpers shared cleanly `[ref: SDD/ADR-4]`

- [ ] **T3.5 Terminal handlers — delete_source + skip** `[activity: domain-modeling]`

  1. Prime: Read PRD F4 for `delete_source` and `skip` `[ref: PRD/F4]`.
  2. Test:
     - `test/unit/actions/deleteSource.test.ts`: source present → trashed via `vault.trash`; source absent → skipped-already; verifies `vault.trash` is called (not `vault.delete`)
     - `test/unit/actions/skip.test.ts`: always returns `{ kind: "applied" }`; no vault calls (assert FakeVaultFS records zero writes); the `skip` handler still ticks the `applied` flag (orchestrator's job, not handler's)
  3. Implement: `src/actions/deleteSource.ts`, `src/actions/skip.ts`.
  4. Validate: Both tests pass.
  5. Success:
     - [ ] `delete_source` uses Obsidian trash, never hard-delete `[ref: PRD/F4]`
     - [ ] `skip` is a no-op handler that still counts as applied `[ref: PRD/F4]`

- [ ] **T3.6 Handler dispatch registry + Phase 3 Validation** `[activity: domain-modeling]`

  1. Prime: Read SDD `HANDLERS` registry shape `[ref: SDD/Action Handler Contract]`.
  2. Test: `test/unit/actions/index.test.ts`:
     - `HANDLERS` has exactly 8 keys matching `ActionKind`
     - Each handler narrows correctly: `HANDLERS["create_moc"]` accepts `CreateMocAction` only
     - Calling `HANDLERS[action.kind](action, ctx)` dispatches to the correct handler (smoke test for each kind)
  3. Implement: `src/actions/index.ts` — exports `HANDLERS: { [K in ActionKind]: Handler<Extract<Action, { kind: K }>> }`. Re-exports the 8 handler functions.
  4. Validate: Run full Phase 3 test suite (`npm test`); confirm every PRD F4 AC has a corresponding test. Lint clean. Build clean.
  5. Success:
     - [ ] Dispatch registry covers all 8 kinds `[ref: PRD/F4; SDD/ADR-4]`
     - [ ] Phase 3 suite green; ready for orchestrator integration `[ref: SDD/Solution Strategy]`
