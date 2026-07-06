---
title: "Phase 1: Domain Core — EditModel + pure transforms"
status: pending
version: "1.0"
phase: 1
---

# Phase 1: Domain Core — EditModel + pure transforms

## Phase Context

**GATE**: Read the referenced files before starting.

**Specification References**:
- `[ref: SDD/§5 — EditModel (the full wire shape)]`
- `[ref: SDD/§6 — Editable surface by tab]`
- `[ref: SDD/§7 — Picker & affordance contracts (validPlacements)]`
- `[ref: SDD/§9 — SuggestionsDoc adapter port]`
- `src/schema/suggestions-wire.schema.json` (vendored, `schema_version: "1"`)

**Key Decisions**:
- ADR-S2: every edit is a pure `EditModel → EditModel` transform that sets `dirty`; `meta`/read-only/untouched sections ride along untouched (own-the-whole-document).
- Force-Atomic is **one decision per source** — synced by `stem`/`source_stem` (SDD §6).
- The editor is deliberately **more constrained than the wire** — `inside` placement is callout-only (SDD §7, ADR-026 §0).

**Dependencies**: none. This phase is pure TypeScript, no Obsidian imports — testable against `FakeSuggestionsDoc` (Constitution L1).

---

## Tasks

Establishes the whole testable domain: the model types, the adapter port + fake, and every pure edit transform with authorization AND rejection coverage.

- [ ] **T1.1 EditModel types + schema version gate** `[activity: domain-modeling]`

  1. Prime: read `src/schema/suggestions-wire.schema.json` + SDD §5 `[ref: SDD/§5]`.
  2. Test: a `schema_version:"1"` doc validates; an unknown version **fails loud** (mirrors the executor precedent); the tightened `daily_updates` shape (`additionalProperties:false`) rejects an unknown daily field.
  3. Implement: `src/types/suggestions.ts` (the §5 interfaces incl. typed `DailyUpdate`/`DailyLogEntry`/`DailyTracker`/`DailyLogLink`) + a version-`const` guard reading the vendored schema.
  4. Validate: unit tests pass; lint + tsc clean.
  5. Success: unknown `schema_version` rejected fail-loud `[ref: SDD/§9]`; model mirrors the schema field-for-field `[ref: SDD/§5]`.

- [ ] **T1.2 `SuggestionsDoc` port + `FakeSuggestionsDoc`** `[activity: domain-modeling]`

  1. Prime: SDD §9 adapter contract `[ref: SDD/§9]`.
  2. Test: fake `load()` returns an `EditModel`; `save()` captures the whole model; unknown/read-only fields survive a load→save round-trip.
  3. Implement: `src/vault/SuggestionsDoc.ts` (interface) + `test/__mocks__/FakeSuggestionsDoc.ts` seeded from the real `1115` run.
  4. Validate: round-trip test green.
  5. Success: fake unblocks T1.3–T1.8 and Phase 3 without Obsidian `[ref: SDD/§9]`.

- [ ] **T1.3 Suggestion field transforms (op 1, op 4, note fields)** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: SDD §5–§6 `[ref: SDD/§6]`.
  2. Test: select a candidate MOC clears the previous selection (op 1); `＋ Add MOC` appends a `source:"user"` candidate; `decision` flips approve↔skip (op 4); `title`/`template`/`location`/`tags`/`keepSource`/`deleteSource` edits set `dirty`; a suppressed note exposes **no** MOC UI transform.
  3. Implement: `src/suggestions/transforms/suggestion.ts` (pure `EditModel → EditModel`).
  4. Validate: authorization + rejection unit tests.
  5. Success: op 1 re-point `[ref: PRD/F2]`; op 4 decision `[ref: PRD/F5]`; note fields `[ref: PRD/F6]`.

- [ ] **T1.4 Force-Atomic stem-sync** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: SDD §6 "Force-Atomic is one decision per source" `[ref: SDD/§6]`.
  2. Test: toggling `suggestions[].force_atomic` flips the matching `daily_updates[].log_entries[].force_atomic_note` by `stem`/`source_stem`, and vice-versa; unrelated stems unaffected; the `call-mueller` dual-appearance case (S01 + daily entry) stays consistent.
  3. Implement: `src/suggestions/transforms/forceAtomicSync.ts`.
  4. Validate: both-directions + isolation tests.
  5. Success: no contradictory Force-Atomic state reachable `[ref: PRD/F7]`.

- [ ] **T1.5 Proposed-MOC graph ops (rename / reparent / decision / merge)** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: SDD §6 Proposed MOCs + ADR-026 §5 id-based refs `[ref: SDD/§6]`.
  2. Test: rename edits one node's `name`, membership unchanged; merge A→B unions `member_ids` by **id** and drops A; same-`name` "Merge into…" collapses; reject a merge that would orphan an id.
  3. Implement: `src/suggestions/transforms/proposedMoc.ts`.
  4. Validate: authorization + rejection unit tests.
  5. Success: rename/merge as a graph op `[ref: PRD/F4]`.

- [ ] **T1.6 `validPlacements(anchorType)`** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: SDD §7 SpotPicker + `anchorResolver` behaviour `[ref: SDD/§7]`.
  2. Test: callout → `{inside, before, after}`; heading/line → `{before, after}`; `inside` is **rejected** on heading/line (would author an unexecutable suggestion).
  3. Implement: `src/suggestions/validPlacements.ts` (pure).
  4. Validate: full truth-table incl. rejection cases.
  5. Success: only executor-honourable placements offered `[ref: PRD/F3]` `[ref: SDD/§7]`.

- [ ] **T1.7 Daily edit transforms (content / position / time / accept)** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: SDD §6 Daily + the tightened `daily_updates` schema `[ref: SDD/§6]`.
  2. Test: edit `content`/`position`/`time` sets `dirty`; `time` only meaningful when `position == at_time` (cleared/ignored otherwise); accept toggles on `trackers`/`log_entries`/`log_links`; untouched daily siblings preserved.
  3. Implement: `src/suggestions/transforms/daily.ts`.
  4. Validate: authorization + rejection (at_time gating) tests.
  5. Success: daily editing per the confirmed v1 surface `[ref: PRD/F8]`.

- [ ] **T1.8 Tag-handler toggle transform** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: SDD §6 Tag-Handler + §5 `TagGroup` `[ref: SDD/§6]`.
  2. Test: flipping `approved`/`keep_source` on a group sets `dirty`; not-approved reads as skipped; read-only context (`handler`/`target_path`/`marker`/`source_paths`/`preview`) is untouched by the transform; unrelated groups unaffected.
  3. Implement: `src/suggestions/transforms/tagHandler.ts` (pure `EditModel → EditModel`).
  4. Validate: authorization + rejection unit tests.
  5. Success: tag-handler approval as a testable transform `[ref: PRD/F9]` `[ref: SDD/§6]`.

- [ ] **T1.9 `suggestionsStore` (`Store<T>`)** `[activity: domain-modeling]`

  1. Prime: SDD §2 component diagram (store between adapter and view) `[ref: SDD/§2]`.
  2. Test: `subscribe` fires on a transform; `dirty` reflects real edits; a no-op leaves `dirty` false.
  3. Implement: `src/suggestions/store.ts` wrapping the transforms from T1.3–T1.8.
  4. Validate: subscription + dirty-tracking tests.
  5. Success: view can `subscribe` + dispatch intents `[ref: SDD/§2]`.

- [ ] **T1.10 Phase Validation** `[activity: validate]`

  - Run all Phase 1 tests. Confirm zero Obsidian imports in `src/suggestions/` + `src/types/suggestions.ts` (Constitution L1 — pure core). `npm test` + `npm run lint` + `npm run build` green.
