---
title: "Phase 6: Dead-link context & note navigation"
status: in_progress
version: "1.0"
phase: 6
---

# Phase 6: Dead-link context & note navigation

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/ADR-4]` — dead-link context derived locally, async + cached
- `[ref: PRD/F3 (dead-link context AC), F9 (open-beside + hover)]`
- `[ref: SDD/System-Wide Patterns — Performance]` — off main thread, cached
- Reuse: `src/ui/suggestions-view/openNote.ts`, `SuggestionsTab` note-link idiom, `VaultFS.cachedRead`

**Key Decisions**: ADR-4 (local async context; `dead_link` only in v1); F9 (side-split open + hover-preview).

**Dependencies**: Phase 5 (cards to attach context/links to).

---

## Tasks

Adds the inline dead-link context and the open-beside / hover-preview note navigation.

- [x] **T6.1 Dead-link context extractor (async, cached)** `[activity: backend-api]`

  1. Prime: Read `VaultFS.cachedRead` + the metadataCache-race guidance (resolve from content, not `vault.metadata()`) `[ref: SDD/ADR-4; SDD/Implementation Gotchas]`.
  2. Test: given a note body containing `[[dead_target]]`, returns the occurrence line(s) + nearest preceding heading; multiple occurrences handled; a missing/moved note degrades gracefully (returns a "note not found" marker, never throws); results cached per note path; extraction is async and does not block the caller.
  3. Implement: `src/garden-audit/deadLinkContext.ts` (async, per-note cache; literal search on `[[dead_target]]`).
  4. Validate: context unit tests pass (happy + missing-note degrade + cache hit).
  5. Success: dead-link relationship visible without hover `[ref: PRD/F3 dead-link context; SDD/EARS "WHEN a dead_link finding renders"]`; off-main-thread `[ref: Constitution Perf L1]`.

- [ ] **T6.2 Note navigation — open-beside + hover-preview** `[activity: frontend-ui]`

  1. Prime: Read `openNote.ts` + Obsidian split-leaf open + the `hover-link` trigger convention `[ref: PRD/F9]`.
  2. Test (obsidian mock): clicking a finding's note reference opens the note in a side-split leaf (not replacing the editor leaf); the reference is registered so Obsidian hover-preview is available; a missing target renders as plain text + "note not found" and does not throw.
  3. Implement: wire the note-reference click → side-split open, and the hover-preview trigger, in the card renderer.
  4. Validate: navigation unit tests pass (open-beside, hover, missing-note).
  5. Success: click opens beside, hover previews `[ref: PRD/F9; SDD/EARS "WHEN the user clicks a finding's note reference"]`.

- [ ] **T6.3 Phase validation** `[activity: validate]`

  - Run all Phase 6 tests; `npm run build` + `npm run lint` clean. Verify context + navigation work and degrade gracefully.
