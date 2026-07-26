---
title: "Phase 3: The Fixer view — cards, gate wiring, re-run"
status: pending
version: "1.0"
phase: 3
---

# Phase 3: The Fixer view — cards, gate wiring, re-run

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Building Block View]` components + directory map · `[ref: SDD/Runtime View/Primary Flow]`
- `[ref: SDD/ADR-2]` view/adapter · `[ref: SDD/ADR-5]` target-field cards · `[ref: SDD/ADR-9]` re-run
- `[ref: SDD/User Interface & UX]` failed-first, dirty/Save/Re-run, note-nav

**Key Decisions**:
- Mirror `GardenAuditEditorView` (setState-docPath handoff, `Store` subscription, save/dirty
  reference-identity race guard). Reuse `noteNavigation` **verbatim**; **generalize** `TargetControl`
  (today coupled to garden-audit's `FindingCheck` union via its `Record<FindingCheck,string>` empty
  caption maps — decouple to a caller-supplied key set) — the `targetFields` descriptor map (T3.2)
  is the generalization vehicle.
- Cards dispatch by `action.action`; the gate (Phase 2) decides editable vs read-only per card.
- Re-run delegates to the existing `InstructionExecutor`; outcomes refresh in place.
- **Carried from Phase 1 (T1.5 review):** `save()` writes one atomic `markActionFields` patch per
  changed action, so atomicity is **per-action, not per-save**. A mid-loop failure leaves the set
  partially repaired but always schema-valid, and recovers by re-saving the same model (`pristine`
  is deliberately not advanced on the throw path) or by reloading. The adapter's single `notify()`
  today cannot tell the user "nothing landed" from "some actions landed — retry to finish". The
  view owns that distinction: surface it when wiring the Save button.

**Dependencies**: Phase 1 (adapter/transforms), Phase 2 (outcome source + gate).

---

## Tasks

Delivers the visible Fixer: a view that loads a set, shows failed actions first with their outcome +
target-field controls, and re-runs. Testable against the obsidian mock (side-effect `import "obsidian"`).

- [ ] **T3.1 `InstructionFixerView` + opener + registration** `[activity: frontend-ui]`

  1. Prime: Read `src/ui/garden-audit-view/{GardenAuditEditorView,openGardenAuditEditor,index}.ts`, `src/main.ts` (registerView triad, HOVER_LINK_SOURCE) `[ref: SDD/ADR-2]`
  2. Test: `VIEW_TYPE_INSTRUCTION_FIXER` registered; `setState({docPath})` loads + renders; `openInstructionFixer` reveals-or-creates one leaf (one active doc); empty/load-error states; save/dirty race guard (edit-during-save, revert-during-save) mirrors the garden-audit guard.
  3. Implement: `src/ui/instruction-fixer/{index.ts,InstructionFixerView.ts,openInstructionFixer.ts,fixerContract.ts}`; wire `Store<InstructionFixerModel>`, adapter (Phase 1), outcomeSource (Phase 2); register in `main.ts`.
  4. Validate: unit tests pass; lint clean; types check.
  - Success:
    - [ ] Command/opener opens the Fixer on a set and reuses one leaf `[ref: PRD/F1-AC1,AC5]`
    - [ ] Save writes verbatim JSON only, guarded against races `[ref: PRD/F8-AC1]` `[ref: SDD/ADR-2]`

- [ ] **T3.2 Per-kind target-field cards + gate wiring + note nav** `[activity: frontend-ui]`

  1. Prime: Read `src/ui/garden-audit-view/{tabs/GardenAuditTab,TargetControl,noteNavigation}.ts` `[ref: SDD/ADR-5]` `[ref: SDD/User Interface & UX]`
  2. Test: each of the 7 repair kinds renders its correct target field(s) via `TargetControl`; view-only kinds render read-only (no control); **failed/skipped ordered first**; each card shows `I##`, kind, **plain-text intent** (no deep-link), outcome + error; a card whose gate is `editable` commits edits through `setTargetField` (Phase 1) and activates Save; `frozen-applied`/`read-only-no-signal` cards expose no editable control; note link opens-beside + hover-preview, inert on unresolved.
  3. Implement: `src/ui/instruction-fixer/cards/{renderActionCard.ts,targetFields.ts}` — dispatch by `action.action`; `targetFields` descriptor map (7 kinds ↔ fields ↔ control config) that also supplies the per-field caption set, **generalizing** `TargetControl` off garden-audit's `FindingCheck` coupling (decouple its `Record<FindingCheck,string>` empty-caption maps to a caller-supplied key set, or wrap the plain-function widget core); consume the gate result to render editable vs read-only; reuse `renderNavigableNoteLink` + `HOVER_LINK_SOURCE` verbatim.
  4. Validate: unit tests pass; lint clean; types check.
  - Success:
    - [ ] Cards show intent + outcome, failed-first, no deep-link `[ref: PRD/F2-AC1]` `[ref: PRD/F2-AC4]`
    - [ ] Editable only where the gate says so; target-field edit commits `[ref: PRD/F3]` `[ref: PRD/F4-AC1]`
    - [ ] Note jump: open-beside + hover, inert on unresolved `[ref: PRD/F6]`

- [ ] **T3.3 Re-run bridge + outcome refresh** `[activity: frontend-ui]`

  1. Prime: Read `src/executor/InstructionExecutor.ts` (entry, summary) + how the executor is invoked by the execute command `[ref: SDD/ADR-9]`
  2. Test: Re-run invokes `InstructionExecutor` on the saved set; already-`applied` actions skip (monotonic); the repaired action applies; outcomes **refresh in place** from the new summary; a now-applied action becomes `frozen-applied`; re-run uses the atomic write path (no second writer).
  3. Implement: a re-run action in the view that calls the executor and re-derives outcomes/gate on completion (re-`resolveOutcomes` from the fresh in-session summary).
  4. Validate: unit tests pass; lint clean; types check.
  - Success:
    - [ ] Re-run is idempotent (applied skip) and refreshes outcomes `[ref: PRD/F7-AC1,AC2]` `[ref: SDD/ADR-9]`
    - [ ] `.md` peer checkbox tick preserved; no `.md` content/`tomo.sources` write `[ref: PRD/F8-AC2]`

- [ ] **T3.4 Phase Validation** `[activity: validate]`

  - Run all Phase 3 tests; `npm run build` + `npm run lint`. Verify CSS uses `hashi-se-*`/editor
    idioms and Obsidian CSS-lint rules (border-bottom over text-decoration); `createEl` multi-class
    uses array form.
