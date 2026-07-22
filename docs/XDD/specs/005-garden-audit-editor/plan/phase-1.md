---
title: "Phase 1: Contract foundation — schema, types, validator, fixture"
status: pending
version: "1.0"
phase: 1
---

# Phase 1: Contract foundation — schema, types, validator, fixture

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Application Data Models]` — GardenAuditWire / Finding / Decision / GardenAuditModel
- `[ref: SDD/ADR-7]` — vendor schema + Ajv2020 validator
- `[ref: SDD/Complex Logic — change-detection]` — the emit_digest field set (Hashi does not implement it, but the round-trip must preserve it)
- `[ref: README/Open Questions OQ3]` — stale fixtures; regenerate current-shape
- Reuse: `src/schema/suggestions-validator.ts`, `src/schema/suggestions-wire.schema.json`, `src/schema/types.ts`

**Key Decisions**: ADR-7 (vendor + Ajv), ADR-2 (whole-doc model wraps the wire verbatim incl. emit_digest).

**Dependencies**: none (foundation). Everything downstream depends on this.

---

## Tasks

Establishes the typed, validated garden-audit wire contract and a trustworthy test fixture.

- [ ] **T1.1 Garden-audit wire types + vendored schema** `[activity: domain-modeling]`

  1. Prime: Read Tomo's authoritative `/Volumes/Moon/Coding/MiYo/Tomo/tomo/schemas/garden-audit-wire.schema.json` and `src/schema/types.ts` for the hand-aligned-types convention `[ref: SDD/Application Data Models]`.
  2. Test: type-level tests (mirror `test/unit/schema/types.test.ts`) — the 6 `check` literals, `tier` union, `decision` per-check optional target fields (`repoint`/`replace`/`file_under`), `candidates {stem,score}[]`, `suggest_requested`, top-level `approved`, opaque `emit_digest`; advisory findings have no `decision`.
  3. Implement: copy the schema to `src/schema/garden-audit-wire.schema.json` (verbatim from Tomo); create `src/types/garden-audit.ts` (`GardenAuditWire`, `Finding`, `Decision`, `GardenAuditModel`).
  4. Validate: `npm run build` typechecks; the copied schema is byte-identical to Tomo's source.
  5. Success: types mirror the authoritative schema `[ref: SDD/Application Data Models]`; advisory findings are `decision`-less at the type level `[ref: PRD/F6]`.

- [ ] **T1.2 Ajv2020 validator (accept + reject)** `[activity: backend-api]` `[parallel: true]`

  1. Prime: Read `src/schema/suggestions-validator.ts` (Ajv2020 `{allErrors, allowUnionTypes}`, `validate()` discriminated outcome) `[ref: SDD/ADR-7]`.
  2. Test: accepts the verified handoff §2 example; rejects — missing `emit_digest`, wrong `schema_version`, `additionalProperties` on `decision`, and the **stale pre-spec-030 fixture shape**; a clear doc-typed error message on failure.
  3. Implement: `src/schema/garden-audit-validator.ts` compiling the vendored schema; `validate(raw) → {ok,data}|{ok:false,message}`.
  4. Validate: unit tests pass (accept + every reject path — Constitution L1); lint + typecheck clean.
  5. Success: invalid wire fails loud `[ref: PRD/F8; SDD/EARS "IF the wire fails schema validation"]`; both authorization (accept) and rejection proven `[ref: Constitution L1 Testing]`.

- [ ] **T1.3 Current-shape fixture + emit_digest round-trip** `[activity: test]`

  1. Prime: Read `README/OQ3` and confirm the two vault fixtures are stale-shape; read Tomo's `build_wire_payload` locally to regenerate `[ref: README/Open Questions OQ3]`.
  2. Test: a round-trip test — parse a current-shape wire → serialize (`JSON.stringify(doc,null,2)+"\n"`) → `emit_digest` and all fields byte-identical (no field dropped, digest untouched); the stale fixtures are (correctly) rejected by the validator.
  3. Implement: add `test/fixtures/garden-audit/current-wire.json` (regenerated from Tomo `build_wire_payload`, or the handoff §2 example whose digest is verified); keep the stale vault fixtures only as reject-cases.
  4. Validate: round-trip test green; digest matches its stored value.
  5. Success: a trustworthy unedited baseline exists `[ref: README/OQ3]`; verbatim round-trip proven `[ref: SDD/ADR-2]`.

- [ ] **T1.4 Phase validation** `[activity: validate]`

  - Run all Phase 1 tests; `npm run build` + `npm run lint` clean. Verify the vendored schema matches Tomo's authoritative copy and the validator accepts §2 / rejects stale.
