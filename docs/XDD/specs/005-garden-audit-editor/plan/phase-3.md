---
title: "Phase 3: Discovery & command dispatch"
status: completed
version: "1.0"
phase: 3
---

# Phase 3: Discovery & command dispatch

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/ADR-6]` — one command dispatches by suffix
- `[ref: SDD/Internal API Changes]` — GARDEN_AUDIT_JSON_RE, resolveGardenAuditDocPath, listGardenAuditDocs
- `[ref: SDD/Building Block View]` — opener, doc picker, registerView wiring
- Reuse: `src/commands/registerCommands.ts` (`resolveSuggestionsDocPath`, `registerSuggestionsEditorCommand`), `src/ui/suggestions-view/{openSuggestionsEditor,index}.ts`, `pickers/SuggestionsDocPicker.ts`, `src/main.ts`

**Key Decisions**: ADR-6 (suffix dispatch, keep command id `open-suggestions-editor` + suggestions VIEW_TYPE stable).

**Dependencies**: Phase 1 (validator, for the opener to load). Phase 4's view can stub-open until it exists; dispatch/resolver are independently testable.

---

## Tasks

Enables finding and routing a garden-audit run to the (new) garden-audit view via the existing command.

- [x] **T3.1 Discovery resolver + lister** `[activity: backend-api]`

  1. Prime: Read `resolveSuggestionsDocPath` + `SUGGESTIONS_JSON_RE` + `listSuggestionsDocs` `[ref: SDD/Internal API Changes]`.
  2. Test: `GARDEN_AUDIT_JSON_RE` matches `*_garden-audit.json`; `resolveGardenAuditDocPath` maps `.json`→itself and `.md` peer→`.json` sibling, and returns null for unrelated/suggestions files; `listGardenAuditDocs` returns every `*_garden-audit.json` sorted.
  3. Implement: add the regex + `resolveGardenAuditDocPath` + `listGardenAuditDocs` to `registerCommands.ts`.
  4. Validate: pure-function unit tests (no Obsidian) pass.
  5. Success: garden-audit runs are discoverable and disjoint from suggestions discovery `[ref: PRD/F1; SDD/EARS "dispatch by suffix"]`.

- [x] **T3.2 Command dispatch by suffix + opener + doc picker** `[activity: frontend-ui]`

  1. Prime: Read `dispatchOpenSuggestionsEditor` + `registerSuggestionsEditorCommand` + `openSuggestionsEditor.ts` + `SuggestionsDocPicker.ts` `[ref: SDD/ADR-6]`.
  2. Test (deps injected, no real workspace): with a `_garden-audit.*` active, the command opens the garden-audit view; with a `_suggestions.*` active, it opens the suggestions view; with neither active, it offers a picker over garden-audit + suggestions runs (or the existing notice when none).
  3. Implement: extend the open command to route by suffix; `src/ui/garden-audit-view/openGardenAuditEditor.ts` (mirror opener, reveal-or-retarget existing leaf); `GardenAuditDocPicker` (FuzzyFieldPicker subclass).
  4. Validate: dispatch unit tests pass (both routes + picker fallback).
  5. Success: one "Open Tomo editor" command serves both surfaces `[ref: PRD/F1; SDD/EARS "WHEN a _suggestions.* is active"]`; command id unchanged (hotkeys) `[ref: SDD/Implementation Boundaries]`.

- [x] **T3.3 View registration wiring** `[activity: frontend-ui]`

  1. Prime: Read `main.ts` registerView block (~lines 574) `[ref: SDD/Directory Map]`.
  2. Test (main integration test): `registerView` is called with `VIEW_TYPE_GARDEN_AUDIT_EDITOR`; the open command is registered; existing suggestions registrations unaffected.
  3. Implement: `src/ui/garden-audit-view/index.ts` (`VIEW_TYPE_GARDEN_AUDIT_EDITOR = "miyo-garden-audit-editor"` + exports); wire `registerView` + the opener in `main.ts`.
  4. Validate: main integration test passes; `npm run build` clean.
  5. Success: the garden-audit view type is registered without disturbing existing views `[ref: SDD/ADR-1]`.

- [x] **T3.4 Phase validation** `[activity: validate]`

  - Run all Phase 3 tests; `npm run build` + `npm run lint` clean. Confirm dispatch + registration wired (view body can be a placeholder until Phase 4).
