---
title: "Phase 3: Editor View + Pickers"
status: in_progress
version: "1.0"
phase: 3
---

# Phase 3: Editor View + Pickers

## Phase Context

**GATE**: Read the referenced files before starting.

**Specification References**:
- `[ref: SDD/§3 — Surface: leaf ItemView, four tabs]`
- `[ref: SDD/§6 — Editable surface by tab]`
- `[ref: SDD/§7 — Picker & affordance contracts]`

**Key Decisions**:
- ADR-S1: leaf `ItemView` mirroring `TomoChatView`; `onOpen` subscribe + `adapter.load`, `render` rebuilds the active tab from the store, `onClose` dirty-guard via `ConfirmModal`. `ItemView extends Component` → use `registerDomEvent`/`registerEvent`.
- Op 2 reads the **real** note structure (`markdownStructure`, race-safe #68), not `alt_headings`; placement gated by `validPlacements` (Phase 1 T1.6).
- Modal pickers do **not** extend `Component` → **no `registerDomEvent`** in them (memory: Modal/SettingTab caveat).

**Dependencies**: Phase 1 (store + transforms + `FakeSuggestionsDoc`). Runs against the fake, so it is **independent of Phase 2**. T3.1 (view scaffold) must land before the tab tasks; T3.2–T3.7 are then parallel.

---

## Tasks

Delivers the user-facing editor: the leaf view, four tabs, and the pickers — every PRD user-facing feature.

- [ ] **T3.1 `SuggestionsEditorView` leaf + tab chrome** `[activity: frontend-ui]`

  1. Prime: `src/ui/chat-view/TomoChatView.ts` + SDD §3 `[ref: SDD/§3]`.
  2. Test: registers a `VIEW_TYPE` and opens in a workspace leaf; renders 4 tabs (Suggestions / Proposed MOCs / Daily / Tag-Handler) with counts + empty states (Proposed empty in the `0909` run); `onClose` with `dirty` prompts `ConfirmModal`, clean closes silently.
  3. Implement: `src/ui/suggestions-view/SuggestionsEditorView.ts` + tab container.
  4. Validate: jsdom vs the obsidian mock (side-effect `import "obsidian"`); lifecycle tests.
  5. Success: tabbed surface + dirty-guard `[ref: PRD/F1]`.

- [ ] **T3.2 Suggestions tab — worthy vs suppressed cards** `[activity: frontend-ui]` `[parallel: true]`

  1. Prime: SDD §6 Suggestions `[ref: SDD/§6]`.
  2. Test: `suppressed:false` renders title/template/location/tags/candidate-MOCs + `＋ Add MOC`/keep-source/approve-skip; `suppressed:true` renders worthiness badge + the single Force-Atomic control and **no** MOC UI; toggling Force-Atomic reflects in the Daily tab (via T1.4).
  3. Implement: `src/ui/suggestions-view/tabs/SuggestionsTab.ts`.
  4. Validate: both card modes rendered from the `1115` run.
  5. Success: op 1 surface + note fields + Force-Atomic `[ref: PRD/F2]` `[ref: PRD/F6]` `[ref: PRD/F7]`.

- [ ] **T3.3 SpotPicker (op 2)** `[activity: frontend-ui]` `[parallel: true]`

  1. Prime: SDD §7 + `src/actions/markdownStructure.ts` + `anchorResolver.ts` `[ref: SDD/§7]`.
  2. Test: existing MOC → shows the note's **real** current structure at pick time; callout anchor offers inside/before/after; heading/line offers before/after only (no `inside`); a proposed MOC (no structure) offers membership/ordering only; a MOC with no headings/callouts still offers `new_section`/line placement.
  3. Implement: `src/ui/suggestions-view/pickers/SpotPicker.ts` (`SuggestModal`), reusing `markdownStructure` + `validPlacements`.
  4. Validate: structure-read + placement-gating tests (incl. rejection).
  5. Success: spot inside a MOC, executor-honourable only `[ref: PRD/F3]`.

- [ ] **T3.4 Fuzzy pickers (MOC / tags / template / location / parent)** `[activity: frontend-ui]` `[parallel: true]`

  1. Prime: SDD §7 fuzzy pickers + existing `InstancePickerModal`/`FolderSuggest` idioms `[ref: SDD/§7]`.
  2. Test: MOC picker offers any vault note (op 1, `source:"user"`); tags from `metadataCache.getTags()`; template + location (folder) + proposed-MOC parent pick over real vault values; each writes back through a Phase-1 transform.
  3. Implement: `src/ui/suggestions-view/pickers/` (`FuzzySuggestModal` subclasses).
  4. Validate: pick → transform → store round-trip.
  5. Success: user-added candidates + fuzzy field edits `[ref: PRD/F2]` `[ref: PRD/F6]`.

- [ ] **T3.5 Proposed MOCs tab** `[activity: frontend-ui]` `[parallel: true]`

  1. Prime: SDD §6 Proposed MOCs `[ref: SDD/§6]`.
  2. Test: inline name edit; parent via fuzzy picker; decision approve/skip (default skip); member chips render **titles** (id on hover); "Merge into…" collapses same-name.
  3. Implement: `src/ui/suggestions-view/tabs/ProposedMocsTab.ts`.
  4. Validate: rendered from a run carrying `proposed_mocs`; merge/rename via T1.5.
  5. Success: rename/merge UI `[ref: PRD/F4]`; per-MOC decision `[ref: PRD/F5]`.

- [ ] **T3.6 Daily tab** `[activity: frontend-ui]` `[parallel: true]`

  1. Prime: SDD §6 Daily + `src/actions/{updateLogEntry,updateLogLink,updateTracker}.ts` `[ref: SDD/§6]`.
  2. Test: per date, a click-to-open link with a vault-existence check (`"doesn't exist"` state; Hashi never creates the note); per log entry: editable content/position/time (time only when at_time)/accept/force-atomic; trackers accept; accepted daily-only source ⇒ auto-delete downstream (no separate control).
  3. Implement: `src/ui/suggestions-view/tabs/DailyTab.ts`.
  4. Validate: editing + existence-state tests from the `1115` daily entries.
  5. Success: daily editing `[ref: PRD/F8]`.

- [ ] **T3.7 Tag-Handler tab** `[activity: frontend-ui]` `[parallel: true]`

  1. Prime: SDD §6 Tag-Handler `[ref: SDD/§6]`.
  2. Test: renders read-only context (handler/target_path/marker/source_paths/preview) + Approve/Keep-source toggles; not-approved ⇒ treated as skipped.
  3. Implement: `src/ui/suggestions-view/tabs/TagHandlerTab.ts`.
  4. Validate: toggle + context render from the `1115` tag-handler group.
  5. Success: tag-handler approval `[ref: PRD/F9]`.

- [ ] **T3.8 Phase Validation** `[activity: validate]`

  - Run all Phase 3 tests (view + pickers against `FakeSuggestionsDoc`). Confirm no `text-decoration` style values in new CSS (use `border-bottom`, memory). `npm test` + `npm run lint` (incl. stylelint) + `npm run build` green.
