---
title: "Phase 2: Adapter & transforms"
status: pending
version: "1.0"
phase: 2
---

# Phase 2: Adapter & transforms

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/ADR-2]` — mirror the ObsidianSuggestionsDoc adapter/dirty/digest pattern
- `[ref: SDD/ADR-5]` — editor sets decision.action for broken_up
- `[ref: SDD/Implementation Examples]` — apply-decision write + emit_digest passthrough; broken_up action-gating trace
- Reuse: `src/suggestions/ObsidianSuggestionsDoc.ts`, `src/vault/SuggestionsDoc.ts`, `src/vault/FakeVaultFS.ts`, `src/util/store.ts`

**Key Decisions**: ADR-2 (adapter pattern), ADR-5 (action-setting), dirty NOT gated on the digest.

**Dependencies**: Phase 1 (types + validator + fixture).

---

## Tasks

Establishes the read-modify-write adapter and the pure edit transforms — the whole editable core with no UI.

- [ ] **T2.1 GardenAuditDoc port + ObsidianGardenAuditDoc adapter** `[activity: backend-api]`

  1. Prime: Read `ObsidianSuggestionsDoc.ts` (load→validate→`{doc,dirty}`; save dirty-gate; verbatim `JSON.stringify(doc,null,2)+"\n"`; write-failure notify+rethrow) and `SuggestionsDoc.ts` port `[ref: SDD/ADR-2]`.
  2. Test (against `FakeVaultFS`): load returns `{doc,dirty:false}` on a valid wire; load throws on bad JSON and on schema reject (Constitution L1 denial path); save is a no-op when `!dirty`; save writes the wire verbatim with `emit_digest` unchanged and top-level `approved:true`; save-failure notifies and rethrows.
  3. Implement: `src/vault/GardenAuditDoc.ts` (port `{load,save}`); `src/garden-audit/ObsidianGardenAuditDoc.ts` (VaultFS-injected, `Notice` injectable, stateful `docPath`).
  4. Validate: happy + failure/denial unit tests pass; lint + typecheck clean.
  5. Success: verbatim round-trip incl. `emit_digest` never recomputed `[ref: SDD/ADR-2; PRD/F7]`; Save sets `approved:true` `[ref: PRD/F7; SDD/EARS "WHEN the user Saves"]`; load rejects invalid wire `[ref: PRD/F8]`.

- [ ] **T2.2 Garden-audit transforms (pure setters)** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: Read `src/suggestions/transforms/*` setter convention + the `Store<T>` no-op-on-same-ref idiom `[ref: SDD/Application Data Models]`.
  2. Test: each setter returns a NEW model with `dirty:true` — `setSelected`, `setRepoint`, `setReplace`, `setFileUnder`, `setSuggestRequested`; **action rule (ADR-5)**: setting a non-empty `repoint` sets `decision.action="add_relationship"`, clearing it to empty sets `"edit_note_text"`, and a selected broken_up finding is never left `action:null`; **dirty NOT gated on digest**: a `setSuggestRequested`-only change still yields `dirty:true`; advisory findings expose no setter (or setters are no-ops that never fabricate a `decision`).
  3. Implement: `src/garden-audit/transforms.ts` (pure `Model → Model`).
  4. Validate: unit tests pass incl. the action-gating and suggest-only-dirty cases.
  5. Success: broken_up always carries a valid `action` when selected `[ref: SDD/ADR-5; SDD/EARS "IF a selected broken_up finding is saved"]`; suggest-only edits enable Save `[ref: PRD/F5; SDD/EARS "WHEN the user toggles Suggest targets"]`.

- [ ] **T2.3 Phase validation** `[activity: validate]`

  - Run all Phase 2 tests; `npm run build` + `npm run lint` clean. Confirm the adapter+transforms form a complete editable core testable without any UI.
