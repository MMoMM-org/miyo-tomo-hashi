---
title: "Phase 1: Data spine — port, adapter, atomic writer, transforms"
status: completed
version: "1.0"
phase: 1
---

# Phase 1: Data spine — port, adapter, atomic writer, transforms

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Interface Specifications]` — `InstructionSetDoc` port, `instructionFixerTransforms`, `markActionFields`
- `[ref: SDD/ADR-1]` reuse wire · `[ref: SDD/ADR-5]` target fields · `[ref: SDD/ADR-9]` single write path
- `[ref: SDD/Implementation Gotchas]` — `additionalProperties:false` → verbatim round-trip mandatory

**Key Decisions**:
- Reuse `src/schema/{types,validator}.ts` + `instructions.schema.json` as-is — no new wire.
- The Fixer's field write is a **sibling in `jsonAppliedWriter`** (`markActionFields`), not a new writer.
- Transforms are pure, keyed by `action.id`, whitelisted to the 7-kind target fields, same-ref no-op.

**Dependencies**: none (foundation). Enables Phases 2–4.

---

## Tasks

Establishes the load/save/edit data spine the view builds on — everything testable against
`FakeVaultFS` + the obsidian mock, no UI.

- [x] **T1.1 `InstructionSetDoc` port + `ObsidianInstructionSetDoc` adapter** `[activity: backend-api]`

  1. Prime: Read `src/vault/GardenAuditDoc.ts`, `src/garden-audit/ObsidianGardenAuditDoc.ts`, `src/schema/validator.ts` `[ref: SDD/Interface Specifications]`
  2. Test: `load` valid set → `{doc, dirty:false}`; `load` invalid/corrupt → throws with validator message; `save` dirty-gated (no-op when `dirty:false`); **verbatim round-trip** — load a fixture, save, assert byte-identical (all untouched fields incl. `tomo`, `applied`, unknown-but-schema-allowed ride along); `save` writes `_instructions.json` ONLY (never `.md`).
  3. Implement: `src/vault/InstructionSetDoc.ts` (port) + `src/instruction-fixer/ObsidianInstructionSetDoc.ts` (adapter over `VaultFS`, `validate` from `schema/validator.ts`, upsert write via `writeFile`).
  4. Validate: unit tests pass; lint clean; `tsc` types check.
  - Success:
    - [x] Unedited load→save is a byte-identical no-op that re-validates clean `[ref: PRD/F4-AC3]` `[ref: SDD/ADR-1]`
    - [x] Save touches only the JSON channel `[ref: PRD/F8-AC1]`

- [x] **T1.2 `markActionFields` atomic writer** `[activity: backend-api]` `[parallel: true]`

  1. Prime: Read `src/executor/jsonAppliedWriter.ts` (`markActionsApplied`, `processJSON` pattern) `[ref: SDD/ADR-9]`
  2. Test: patches only the matching `id` (`actions.map(a => a.id===id ? {...a, ...patch} : a)`); other actions untouched; `applied` monotonicity preserved (patch never lowers `applied`); atomic per-path (2-space indent + trailing newline like the sibling); no-op patch leaves file unchanged.
  3. Implement: add `markActionFields(vault, sourcePath, actionId, patch)` to `src/executor/jsonAppliedWriter.ts` (one `processJSON` transform; reuse the module's serialization).
  4. Validate: unit tests pass; lint clean; types check.
  - Success:
    - [x] Single atomic write path shared with the executor — no second writer `[ref: SDD/ADR-9]`
    - [x] Only the target action's whitelisted fields change `[ref: PRD/F4]`

- [x] **T1.3 `instructionFixerTransforms.setTargetField`** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: Read `src/garden-audit/transforms.ts` (same-ref no-op idiom, `updateDecision` helper) + the 7-kind target-field roster `[ref: SDD/ADR-5]`
  2. Test: editing a whitelisted target field of an existing action flips `dirty:true` and returns a NEW model; editing a **non-whitelisted** field or a **view-only kind** returns the SAME reference (rejected, no dirty); unknown `id` → same reference no-op; empty/whitespace handling per field semantics (e.g. anchor value).
  3. Implement: `src/instruction-fixer/transforms.ts` — `setTargetField(model, actionId, fieldKey, value)`; a per-kind whitelist map (the 7 kinds ↔ their editable fields) drives acceptance.
  4. Validate: unit tests pass (both accept + reject); lint clean; types check.
  - Success:
    - [x] Only the 7 repair kinds' target fields are writable; all else same-ref rejected `[ref: PRD/F4-AC4]` `[ref: SDD/ADR-5]`
    - [x] Pure, DOM-free, same-ref-on-no-op (Store `===` change detection) `[ref: SDD/Interface Specifications]`

- [x] **T1.4 Phase Validation** `[activity: validate]`

  - Run all Phase 1 tests; `npm run build` (full tsc) + `npm run lint` clean. Confirm the per-kind
    whitelist matches the SDD ADR-5 roster exactly (drift guard for the fix-field set).
