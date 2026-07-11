---
title: "Phase 4: Integration & Validation"
status: completed
version: "1.0"
phase: 4
---

# Phase 4: Integration & Validation

## Phase Context

**GATE**: Read the referenced files before starting.

**Specification References**:
- `[ref: SDD/§3 — Surface / lifecycle]`
- `[ref: SDD/§10 — Testing posture (Constitution L1/L2)]`
- `[ref: PRD/Success Metrics + Tracking Requirements]`

**Key Decisions**:
- No telemetry (Constitution L1) — success is verified via tests + manual-QA, not runtime analytics `[ref: PRD/Success Metrics]`.
- The view uses the **real** `ObsidianSuggestionsDoc` (Phase 2) swapped in for the fake.

**Dependencies**: Phases 1–3 complete.

---

## Tasks

Wires the editor into the plugin and proves the whole flow end-to-end on real Tomo runs.

- [x] **T4.1 Plugin wiring — view registration + open command** `[activity: backend-api]`

  1. Prime: SDD §3 + the plugin's existing view/command registration (chat-view precedent) `[ref: SDD/§3]`.
  2. Test: the `VIEW_TYPE` registers on load and unregisters on unload; a command-palette command opens the editor on the active `_suggestions.json`; integration test covers registration/discovery.
  3. Implement: register `SuggestionsEditorView` + wire `ObsidianSuggestionsDoc` (replace the fake); add the open command.
  4. Validate: registration/discovery integration test (Constitution L2 — reachable surface).
  5. Success: editor is reachable + opens a real run `[ref: PRD/F1]` `[ref: SDD/§3]`.

- [x] **T4.2 End-to-end integration test** `[activity: test-strategy]`

  1. Prime: PRD Tracking Requirements + SDD §10 `[ref: PRD/Success Metrics]`.
  2. Test: against a test vault / fake — open the `1115` run → make an edit in each tab (MOC select, spot pick, proposed rename, decision, daily content, tag-handler approve) → save → assert the `.json` reflects the edits, `_suggestions.md` re-rendered, `emit_digest` behaviour correct, and untouched sections byte-identical.
  3. Implement: `test/integration/suggestions-editor-e2e.test.ts`.
  4. Validate: full end-to-end path green.
  5. Success: end-to-end coverage on real emission `[ref: PRD/Success Metrics]`.

- [x] **T4.3 Manual-QA rows** `[activity: test-strategy]`

  1. Prime: `test/Hashi/SETUP.md` + the real `0949`/`1115` runs `[ref: PRD/Tracking Requirements]`.
  2. Test: deploy (`HASHI_DEPLOY_VAULT=1 npm run build`) and review both runs in the editor in a live Obsidian; record QA rows (worthy + suppressed cards, spot pick, merge, daily edit, tag-handler).
  3. Implement: QA checklist rows appended to the spec / test/Hashi notes.
  4. Validate: each supported operation exercised once on a real run.
  5. Success: reviewer covers a full run without dropping to raw markdown `[ref: PRD/Success Metrics — Engagement]`.

- [x] **T4.4 Final validation** `[activity: validate]`

  - Full suite green (`npm test`); `npm run lint`; `npm run build`. Re-run `/validate` for PRD ↔ SDD ↔ Plan drift. Confirm all 10 PRD features have passing tests and the deferred item ("apply daily + keep source") is **not** built (owner-signed-off out of v1).
