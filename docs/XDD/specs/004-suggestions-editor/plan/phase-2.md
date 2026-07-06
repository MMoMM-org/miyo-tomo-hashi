---
title: "Phase 2: SuggestionsDoc Adapter — full-document round-trip"
status: completed
version: "1.0"
phase: 2
---

# Phase 2: SuggestionsDoc Adapter — full-document round-trip

## Phase Context

**GATE**: Read the referenced files before starting.

**Specification References**:
- `[ref: SDD/§4 — Save, emit_digest, "own the whole document"]`
- `[ref: SDD/§9 — SuggestionsDoc adapter (full-document round-trip)]`
- `src/schema/suggestions-wire.schema.json`

**Key Decisions**:
- ADR-S4: carry `emit_digest` **verbatim** (never recompute, never strip); save the **whole** object; dirty-gated write; re-render `_suggestions.md` as a courtesy view.
- ADR-S5: one wire-aware file; version-`const` gate fail-loud on unknown `schema_version`.
- Read/write via the Obsidian **vault API** (Hashi's normal path; Tomo reaches the file via Kado, Hashi does not) `[ref: SDD/§4]`.

**Dependencies**: Phase 1 (T1.1 model + T1.2 port). This phase supplies the **real** `ObsidianSuggestionsDoc` behind the Phase-1 port; can run in parallel with Phase 3 (which uses `FakeSuggestionsDoc`).

---

## Tasks

Delivers the single wire-aware adapter and the mandatory data-safety tests — the load-bearing "no dropped section" guarantee (PRD F10).

- [x] **T2.1 `ObsidianSuggestionsDoc.load()`** `[activity: backend-api]`

  1. Prime: SDD §9 load contract + the vendored schema `[ref: SDD/§9]`.
  2. Test: parse the **whole** JSON → `EditModel` keeping every read-only/unknown field; unknown `schema_version` **fails loud** and signals fall-back to the markdown path (ADR-025 discipline); a real `1115`-run file loads without loss.
  3. Implement: `src/suggestions/ObsidianSuggestionsDoc.ts` `load()` (Obsidian vault read of the `.json`).
  4. Validate: load + version-gate tests against real emission.
  5. Success: version gate fail-loud `[ref: PRD/F10]` `[ref: SDD/§9]`.

- [x] **T2.2 `ObsidianSuggestionsDoc.save()`** `[activity: backend-api]`

  1. Prime: SDD §4 save semantics `[ref: SDD/§4]`.
  2. Test: `save()` writes the **whole** model with `emit_digest` byte-identical; re-renders `_suggestions.md` as a courtesy view; on write failure emits a `Notice`, keeps `dirty`, and does not mutate the model in place; a byte-identical (no-edit) save keeps the digest matching so Tomo stays on the markdown path.
  3. Implement: `ObsidianSuggestionsDoc.save()` + `_suggestions.md` re-render.
  4. Validate: save + failure-path tests.
  5. Success: `emit_digest` carried verbatim; courtesy md re-rendered; failure handled `[ref: PRD/F10]` `[ref: SDD/§4]`.

- [x] **T2.3 Round-trip fidelity tests (own-the-whole-document)** `[activity: test-strategy]`

  1. Prime: SDD §9 mandatory tests `[ref: SDD/§9]`.
  2. Test (against **real** `0949`/`1115` emissions, not hand fixtures):
     (a) load → edit one field → save → `emit_digest` **byte-identical**;
     (b) load → save-no-edit → canonical round-trip so Tomo's digest still matches;
     (c) a doc with `daily_updates` + `tag_handler_groups` the UI never touches saves them **byte-for-byte** (the schema's `additionalProperties:false` catches a dropped daily field).
  3. Implement: `test/integration/suggestions-roundtrip.test.ts` with vendored real-run fixtures.
  4. Validate: all three cases green.
  5. Success: **zero data-loss on save** — the load-bearing KPI `[ref: PRD/Success Metrics]` `[ref: PRD/F10]`.

- [x] **T2.4 Phase Validation** `[activity: validate]`

  - Run all Phase 2 tests against real Tomo emissions. `npm test` + `npm run lint` + `npm run build` green. Confirm no wire-schema knowledge leaked outside `src/suggestions/ObsidianSuggestionsDoc.ts` + `src/schema/` (ADR-S5 — one wire-aware file).
