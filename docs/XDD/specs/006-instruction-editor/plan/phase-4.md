---
title: "Phase 4: Entry points + run-log change"
status: pending
version: "1.0"
phase: 4
---

# Phase 4: Entry points + run-log change

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/ADR-3]` entry points (command + apply-modal option + log pointer; no click-to-open)
- `[ref: SDD/ADR-8]` run-log `I##` deep-link → plain text + Fixer pointer line
- `[ref: SDD/Run-log change]` exact before/after for `renderIdCell`

**Key Decisions**:
- Dedicated **"Open instruction fixer"** command — sidesteps the `_instructions.json` collision with
  "Execute instructions document" (which stays untouched). No `obsidian://` handler, no click-on-row.
- The execute-result surface gains an **"Open Instruction Fixer"** option when a run has failures.
- The run log drops the malformed `I##` deep-link (origin bug) → plain `I##`; adds one pointer line.

**Dependencies**: Phase 3 (the view + opener must exist to be launched).

---

## Tasks

Wires the three user-facing entry points and performs the one-line run-log cleanup that started the
whole feature. Entry tasks are independent of each other and can run in parallel.

- [ ] **T4.1 "Open instruction fixer" command** `[activity: frontend-ui]` `[parallel: true]`

  1. Prime: Read `src/commands/registerCommands.ts` (command registration; how "Open Tomo editor" / "Execute instructions document" resolve the active doc) `[ref: SDD/ADR-3]`
  2. Test: command opens the Fixer on an active `_instructions.json` (or `.md` peer); with none active, offers a picker of instruction sets; **"Execute instructions document" behavior is unchanged** (regression assert); command id stable.
  3. Implement: register `open-instruction-fixer` ("Open instruction fixer") → `openInstructionFixer`; add an `INSTRUCTIONS_JSON_RE` resolver + `listInstructionsDocs` helper (mirror the garden-audit resolver).
  4. Validate: unit tests pass; lint clean; types check.
  - Success:
    - [ ] Command opens the Fixer; Execute untouched `[ref: PRD/F1-AC1,AC4]` `[ref: SDD/ADR-3]`

- [ ] **T4.2 Execute-result surface "Open Instruction Fixer" option** `[activity: frontend-ui]` `[parallel: true]`

  1. Prime: Read the execute-result/summary surface reached after "Execute instructions document" (the modal/notice that today offers the run log) `[ref: SDD/ADR-3]`
  2. Test: after a run with ≥1 failed/skipped action, the surface offers "Open Instruction Fixer"; choosing it opens the Fixer on the just-run set (outcomes fresh from the in-session summary); no option/covered gracefully when zero failures (or offered harmlessly — per SDD); listeners cleaned up by hand (Modal ≠ Component).
  3. Implement: extend the execute-result surface with the option → `openInstructionFixer(setPath)`.
  4. Validate: unit tests pass; lint clean; types check.
  - Success:
    - [ ] Failed run offers "Open Instruction Fixer" instead of only the log `[ref: PRD/F1-AC2]` `[ref: SDD/ADR-3]`

- [ ] **T4.3 Run-log `I##` deep-link removal + Fixer pointer line** `[activity: backend-api]` `[parallel: true]`

  1. Prime: Read `src/executor/runLog.ts` (`renderIdCell`, `loadPeerHeadings`, frontmatter/body builders) `[ref: SDD/ADR-8]` `[ref: SDD/Run-log change]`
  2. Test: `renderIdCell` emits plain `I##` (no `[[peerStem#heading|I##]]`, no nested-`[[]]`); the log body carries the informational Fixer pointer line; **existing run-log tests updated** to the new cell format; log otherwise structurally unchanged (table columns, totals, `sources:`).
  3. Implement: simplify `renderIdCell` → plain id text (drop `loadPeerHeadings` deep-link dependency if now unused); add the pointer line to the run-log body builder.
  4. Validate: unit tests pass (incl. updated run-log expectations); lint clean; types check.
  - Success:
    - [ ] `I##` cell is plain text; pointer line present; log otherwise stable `[ref: PRD/F2-AC4]` `[ref: PRD/F1-AC3]` `[ref: SDD/ADR-8]`

  > **DO NOT remove the wikilink fallback in `outcomeSource.parseIdCell` when landing this.**
  > Phase 2's `parseIdCell` (`src/ui/instruction-fixer/outcomeSource.ts`) deliberately accepts BOTH
  > the plain `I##` form and the legacy `[[<peerStem>#<heading>|I##]]` form. Run logs already written
  > to users' vaults before this task lands still carry the wikilink form, and the Fixer must keep
  > resolving outcomes from them — dropping the fallback would silently turn every pre-existing log
  > into `NO_TRUSTED_SIGNAL`. Keep both branches and keep their tests. (Surfaced by the Phase 2
  > drift check, which flagged the dual parse as undocumented.)

- [ ] **T4.4 Phase Validation** `[activity: validate]`

  - Run all Phase 4 tests; `npm run build` + `npm run lint`. Grep docs for any run-log/`I##`
    deep-link references to update (README/action-reference/hooks/troubleshooting — the doc-site
    lesson) and note them for Phase 5 doc updates.
