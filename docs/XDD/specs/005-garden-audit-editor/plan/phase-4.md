---
title: "Phase 4: View & tab shell"
status: completed
version: "1.0"
phase: 4
---

# Phase 4: View & tab shell

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/ADR-1]` — parallel view mirroring SuggestionsEditorView
- `[ref: SDD/Runtime View]` — open→render→save flow; dirty identity-guard; error surface
- `[ref: SDD/User Interface & UX]` — leaf-head meta, tier grouping, states
- Reuse: `src/ui/suggestions-view/SuggestionsEditorView.ts`, `tabContract.ts`, `src/util/store.ts`, `src/ui/ConfirmModal.ts`

**Key Decisions**: ADR-1 (parallel view), ADR-2 (Save=approve+verbatim digest, dirty-clear identity guard).

**Dependencies**: Phase 2 (adapter + store/transforms), Phase 3 (registration + opener).

---

## Tasks

Establishes the leaf view shell and the tier-grouped tab that hosts (Phase 5) the cards — plus save/revert/empty/error behavior.

- [x] **T4.1 GardenAuditEditorView lifecycle** `[activity: frontend-ui]`

  1. Prime: Read `SuggestionsEditorView` (onOpen/setState/loadAndRender/onClose, `renderLeafHead`, close-while-dirty `ConfirmModal`) `[ref: SDD/ADR-1; SDD/Runtime View]`.
  2. Test (obsidian mock; side-effect `import "obsidian"`): opens over a docPath and renders; leaf-head meta reads `run {run_id} · profile {profile} · {N} findings`; `getDisplayText()`/`getIcon()` return the garden-audit identity; close-while-dirty prompts.
  3. Implement: `src/ui/garden-audit-view/GardenAuditEditorView.ts` (mirror lifecycle; `Store<GardenAuditModel>`; injected `adapter` + `tabs`).
  4. Validate: view lifecycle unit tests pass; `cls` array form used; no `registerDomEvent`.
  5. Success: the view loads and renders a run `[ref: PRD/F1; SDD/EARS "WHEN ... Open Tomo editor"]`; header shows run/profile/findings `[ref: PRD/F2]`.

- [x] **T4.2 GardenAuditTab — tier-grouped shell** `[activity: frontend-ui]`

  1. Prime: Read `tabContract.ts` (EditorTab `id/label/count/render`) and `SuggestionsTab` section idiom `[ref: SDD/User Interface & UX]`.
  2. Test: renders three tier sections (Integrity/Structure/Advisory) with counts; findings in wire order; each finding shows its `id` (F01…); `count(model)` returns total findings.
  3. Implement: `src/ui/garden-audit-view/tabs/GardenAuditTab.ts` (tier headers + count pills + a placeholder per-finding row that Phase 5 fills).
  4. Validate: tab render unit tests pass.
  5. Success: findings grouped by tier with counts, wire order, ids `[ref: PRD/F2; SDD/EARS "SHALL group findings"]`.

- [x] **T4.3 Save / Revert / dirty affordance** `[activity: frontend-ui]`

  1. Prime: Read `SuggestionsEditorView.handleSave` (identity guard) + Revert (reload) `[ref: SDD/ADR-2]`.
  2. Test: Save calls `adapter.save`, sets `approved:true`, clears dirty only if store/model identity unchanged post-save; Revert reloads and discards; Save disabled + no badge when clean; both disabled while saving.
  3. Implement: wire Save/Revert/dirty in the view (reuse the chrome).
  4. Validate: save/revert/dirty unit tests pass (incl. concurrent-change guard).
  5. Success: Save writes decisions + approved, digest verbatim `[ref: PRD/F7; SDD/EARS "WHEN the user Saves"]`; clean state disables Save `[ref: PRD/F7]`.

- [x] **T4.4 Empty & error states** `[activity: frontend-ui]`

  1. Prime: Read the host empty-state + `adapter.load` try/catch error surface `[ref: SDD/Error Handling]`.
  2. Test: all-advisory run renders advisory cards + a "nothing to apply" line (NOT "no findings"); zero-findings renders a clean-vault empty state; an invalid/mismatched wire renders "Couldn't load garden audit: <reason>" and does not enter edit state.
  3. Implement: empty/error handling in the view/tab.
  4. Validate: empty + error unit tests pass.
  5. Success: advisory-only and clean states unambiguous `[ref: PRD/F8; SDD/EARS "IF the wire fails"]`; invalid wire fails loud `[ref: PRD/F8]`.

- [x] **T4.5 Phase validation** `[activity: validate]`

  - Run all Phase 4 tests; `npm run build` + `npm run lint` clean. Confirm the shell renders, saves, reverts, and handles empty/error — cards pending Phase 5.
