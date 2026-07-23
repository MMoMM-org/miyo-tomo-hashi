---
title: "Phase 5: Per-check cards & interaction"
status: in_progress
version: "1.0"
phase: 5
---

# Phase 5: Per-check cards & interaction

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/ADR-3]` — composite target control
- `[ref: SDD/ADR-5]` — action-setting for broken_up
- `[ref: SDD/User Interface & UX]` — per-check cards, candidates, suggest, advisory read-only
- `[ref: PRD/Detailed Feature Specifications]` — the target control + per-check empty semantics
- Reuse: `SuggestionsTab.ts` (decision control, `renderCandidateRow`, note links), `pickers/{MocPicker,VaultNotePicker}.ts`

**Key Decisions**: ADR-3 (target widget), ADR-5 (action), dead_link empty = unlink (label only), candidates display-only (explicit target wins).

**Dependencies**: Phase 2 (transforms), Phase 4 (tab shell). T5.1 (widget) precedes T5.2.

---

## Tasks

Delivers the interactive fixable cards and the strict read-only advisory cards.

- [x] **T5.1 Composite TargetControl widget** `[activity: frontend-ui]`

  1. Prime: Read the `mini-pick` field idiom + `MocPicker`/`VaultNotePicker` (return existing notes only) `[ref: SDD/ADR-3; PRD/Detailed Feature Specifications]`.
  2. Test: shows the current value or an explicit empty state; accepts a free-typed value (bare stem or `[[wikilink]]`) that need not exist; a picker button populates it from a vault note; the empty-state label is per check type (dead_link "unlink", broken_up "remove", orphan/unparented "fallback"); a change fires the target transform (dirty).
  3. Implement: `src/ui/garden-audit-view/TargetControl.ts` (text input + picker button; sentence-case; keyboard-accessible; bare `addEventListener`).
  4. Validate: widget unit tests pass (pick / type-new / empty / label-per-check).
  5. Success: pick + free-typed + explicit-empty all expressible `[ref: PRD/F3; SDD/ADR-3]`; empty label correct per check `[ref: README 2026-07-22 unlink decision]`.

- [x] **T5.2 Fixable cards (broken_up / dead_link / unparented / orphan)** `[activity: frontend-ui]`

  1. Prime: Read `SuggestionsTab.renderDecisionControl` (Apply/Skip segmented, `aria-pressed`) `[ref: SDD/User Interface & UX]`.
  2. Test per check type: Apply/Skip toggles `decision.selected`; broken_up uses a repoint TargetControl and sets `action` per ADR-5 (non-empty→add_relationship, empty→edit_note_text); dead_link uses a replace TargetControl (empty label "unlink") and shows `dead_target (count×)`; unparented/orphan use a file_under TargetControl; the target note title is an openable link.
  3. Implement: the three fixable card renderers in `GardenAuditTab` using `TargetControl` + the decision control + transforms.
  4. Validate: per-check card unit tests pass incl. the action-gating outcome.
  5. Success: each fixable finding is applyable/skippable/targetable `[ref: PRD/F3; SDD/EARS "WHEN the user toggles Apply/Skip"]`; broken_up never emits `action:null` `[ref: SDD/ADR-5]`.

- [x] **T5.3 Candidate chips (display-only, click-to-pick)** `[activity: frontend-ui]` `[parallel: true]`

  1. Prime: Read `renderCandidateRow` (but note: garden-audit candidates are single-write into a field, not multi-select) `[ref: SDD/User Interface & UX]`.
  2. Test: `decision.candidates` (LLM) and, for orphans, `detail.candidate_mocs` (scan) render as distinct scored chip rows; clicking a chip writes its stem into the TargetControl (target field) and NEVER auto-applies; the chip matching the committed target is highlighted; chips are `<button>`s (keyboard-activatable).
  3. Implement: candidate-chip rendering wired to the target transform.
  4. Validate: candidate unit tests pass (click-to-pick, explicit-wins, no auto-apply).
  5. Success: candidates are advisory input; explicit target wins `[ref: PRD/F4; SDD/EARS "WHEN the user clicks a candidate chip"]`.

- [ ] **T5.4 Suggest-targets toggle + two-run hints** `[activity: frontend-ui]` `[parallel: true]`
  > **BLOCKED (2026-07-23)** on Tomo handoff `_outbox/for-tomo/2026-07-23_hashi-to-tomo_garden-audit-suggest-state-and-wire-reupload.md`:
  > the wire cannot distinguish "suggest pending" from "suggest ran, returned empty" (both `suggest_requested:true, candidates:[]`;
  > `decision` is `additionalProperties:false`, so no speculative field). The "no suggestions found" AC needs a Tomo-side marker
  > (proposed: `decision.suggested:true`, digest-excluded) + the S.4 wire-reupload fix. Toggle + dirty + pending hint are buildable now.

  1. Prime: Read the `.md`'s Suggest wording + the pending/none states `[ref: SDD/User Interface & UX]`.
  2. Test: toggling "Suggest targets" sets `decision.suggest_requested` and marks dirty even though the digest is unchanged; a ticked-but-no-candidates finding shows the pending hint (run `/garden-audit --suggest` in Tomo, reopen); a suggest-returned-empty finding shows the distinct "no suggestions found" note.
  3. Implement: the suggest toggle + hint states in the fixable card.
  4. Validate: suggest-toggle unit tests pass incl. dirty-on-suggest-only.
  5. Success: two-run flow legible; suggest-only edits savable `[ref: PRD/F5; SDD/EARS "WHEN the user toggles Suggest targets"]`.

- [x] **T5.5 Advisory cards — strictly read-only** `[activity: frontend-ui]`

  1. Prime: Read the advisory `.md` rendering (stale_moc mtime, duplicate_stem dupes) `[ref: PRD/F6]`.
  2. Test: `duplicate_stem`/`stale_moc` cards render their read-only detail and expose NO Apply/target/candidate/suggest control; only the note link is interactive; asserted that no control can change their outcome.
  3. Implement: the advisory read-only card renderer (dimmed).
  4. Validate: advisory read-only unit tests pass (assert absence of controls).
  5. Success: advisory findings cannot be mutated `[ref: PRD/F6; SDD/EARS "WHILE rendering an advisory finding"]`.

- [ ] **T5.6 Phase validation** `[activity: validate]`

  - Run all Phase 5 tests; `npm run build` + `npm run lint` clean. Verify every check type renders correctly and advisory is inert.
