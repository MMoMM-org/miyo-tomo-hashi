---
title: "Phase 5: Integration, E2E & full-suite gate"
status: pending
version: "1.0"
phase: 5
---

# Phase 5: Integration, E2E & full-suite gate

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Runtime View/Primary Flow]` the full repair loop · `[ref: SDD/Acceptance Criteria]` (EARS)
- `[ref: PRD/Success Metrics]` quality gates (verbatim round-trip, no `.md`/`tomo.sources` mutation)
- `[ref: SDD/Risks and Technical Debt]` gotchas to assert against

**Carried from Phase 3 — re-evaluate here:**
- **`InstructionFixerView.ts` is 603 LOC**, over the Constitution L2 "~300–500 LOC of dense logic"
  guideline. T3.2b already extracted the pure gate-section grouping into `sections.ts` (100 LOC,
  DOM-free, 17 unit tests). The remainder is view rendering + leaf lifecycle + save handling, which
  is one coherent responsibility; splitting it further mid-phase would fragment DOM construction
  across files for no legibility gain. **Explicit L2 rationale, to be re-checked once T3.3 lands**
  — if the re-run bridge pushes it materially past ~650, split the render methods out.
- **Bundle ceiling was raised 850 → 900 KB at T3.1** (user-approved) because wiring the Fixer into
  `main.ts` made the previously tree-shaken Phase 1–2 modules reachable. Currently 868.3 KB. The
  documented next levers if it tightens: ajv standalone code-gen, then lazy-loading xterm.js (only
  the spec-001 chat path needs it). Measure the finished feature here and decide whether to apply a
  lever or re-lower the ceiling.

**Key Decisions**:
- The end-to-end loop is the real proof: execute (with a failure) → open Fixer → repair target field
  → save (verbatim) → re-run → applied. Assert the `.md`/`tomo.sources` invariants explicitly.
- Full `npm run build` (whole-repo tsc) is the real typecheck gate — scoped vitest skips it.

**Dependencies**: Phases 1–4 complete.

---

## Tasks

Proves the whole feature works together and locks the invariants against regression.

- [ ] **T5.1 End-to-end repair loop (integration test)** `[activity: integration-testing]`

  1. Prime: Read `test/integration/garden-audit-e2e.test.ts` (the sibling E2E shape) + `test/__mocks__/{obsidian,FakeVaultFS}` `[ref: SDD/Runtime View/Primary Flow]`
  2. Test (against FakeVaultFS + obsidian mock): seed an instruction set whose one action fails (e.g. `link_to_moc` anchor/target missing); run the executor → summary has 1 `failed`; open the Fixer → the failed card is `editable`, applied ones `frozen`; repoint the target field → Save → assert the JSON changed ONLY that field and the `.md` peer content + `tomo.sources` are byte-unchanged; re-run → the repaired action now `applied`, refreshed in place; assert an unedited round-trip elsewhere is a no-op.
  3. Implement: `test/integration/instruction-fixer-e2e.test.ts`. Vendor a **real** (anonymized) instruction-set fixture with a genuine failed action as the drift guard.
  4. Validate: integration test passes; lint clean; types check.
  - Success:
    - [ ] Full loop: execute → fix → save → re-run → applied `[ref: PRD/F7]` `[ref: SDD/Acceptance Criteria]`
    - [ ] `.md` content + `tomo.sources` never mutated across the loop `[ref: PRD/F8-AC1,AC2]`

- [ ] **T5.2 Fail-closed integration + cold-open** `[activity: integration-testing]` `[parallel: true]`

  1. Prime: `[ref: SDD/Runtime View/Secondary Flow]` cold open · `[ref: SDD/ADR-4]`
  2. Test: open the Fixer on a set with **no run this session and no matching run-log** → every action `read-only-no-signal`, the view offers "Run"; a stale/other-set run-log present → still `NO_TRUSTED_SIGNAL` (no optimistic mapping); after "Run", failed actions unlock.
  3. Implement: extend the E2E suite with the cold-open + stale-log scenarios.
  4. Validate: integration test passes.
  - Success:
    - [ ] Cold open with no trusted signal edits nothing until Run `[ref: PRD/F3-AC3]` `[ref: SDD/ADR-4]`

- [ ] **T5.3 Docs + full-suite gate** `[activity: validate]`

  1. Prime: grep results from T4.4 (run-log/`I##`/deep-link doc references)
  2. Test/Do: update user docs (README + any action-reference/hooks/troubleshooting sites) for the
     Instruction Fixer command + the run-log change; run the **full** `npm run build` + `npm test` +
     `npm run lint`; if any action-kind enumeration site was touched, reconcile the count/list.
  3. Implement: doc edits; reference the spec + ADR-027 in the PR body (Constitution Code Quality L1).
  4. Validate: whole suite green; lint clean; build clean; docs consistent (run `/validate` for
     PRD↔SDD↔Plan drift).
  - Success:
    - [ ] Full build + suite + lint green; docs updated; spec/ADR-027 referenced `[ref: PRD/Success Metrics]`
    - [ ] Manual-QA note: deploy via `HASHI_DEPLOY_VAULT=1 npm run build` into `test/Hashi` for the user's snapshot baseline
