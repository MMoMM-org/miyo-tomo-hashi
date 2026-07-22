# Specification: 005-garden-audit-editor

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-07-22 |
| **Current Phase** | Ready |
| **Last Updated** | 2026-07-22 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | 9 Must-have features, Gherkin ACs (auth + rejection paths); 0 clarification markers |
| solution.md | completed | Parallel-view architecture; ADR-1..7 all confirmed 2026-07-22; interfaces + EARS ACs |
| plan/ | completed | 7 phases, ~21 deliverable tasks (TDD), traceability F1..F9 → tasks; alignment verified (no drift) |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-22 | Spec 005 created for the Garden-Audit tab in the Tomo Editor | Tomo handoff 2026-07-22 fully specified the contract (verified against Tomo's authoritative local `garden-audit-wire.schema.json`); user chose XDD spec/plan before implementation. |
| 2026-07-22 | Extend the existing tabbed editor (spec 004), not a new view | Reuse tabContract + pickers + view infra; the editor is being generalized to "Tomo editor" (branch feat/rename-tomo-editor) hosting suggestions + garden-audit doc types. |
| 2026-07-22 | Write channel is the JSON `decision` blocks; carry `emit_digest` verbatim | Two-channel contract: `.json` = machine/Hashi channel (user never edits it), `.md` = human channel; Tomo consumes the JSON when an apply-decision field changed, else the `.md`. |
| 2026-07-22 | Research (Standard mode): Technical + Integration + UX agents | Findings synthesized below; two ground-truth findings + one architecture conflict recorded as open questions. |
| 2026-07-22 | **dead_link empty = UNLINK, not delete** (verified in Tomo `garden-audit-parser.py:288-301`) | Empty `replace` → `[[dead_target]]` is replaced by the bare `dead_target` (brackets stripped, text kept). Tomo-side, no wire change. Corrects the Integration agent's "empty ⇒ remove" wording. Editor must label the empty state "unlink (keep text)". broken_up empty = remove line; orphan/unparented empty = fallback/skip. |
| 2026-07-22 | **PRD review adds Feature 9 + dead-link context (OQ5)** | Note references open beside the editor on click + hover-preview; dead_link cards show surrounding body context inline (derived locally, off-main-thread). |
| 2026-07-22 | **OQ1 RESOLVED → parallel `GardenAuditEditorView`** (user decision) | Own view + `VIEW_TYPE_GARDEN_AUDIT_EDITOR`, reusing tabContract/pickers/Store/ConfirmModal/`hashi-se-*` CSS + the adapter pattern; one "Open Tomo editor" command dispatches by suffix. Avoids forcing generics through the concrete suggestions view. |
| 2026-07-22 | **SDD complete: ADR-1..7 all confirmed** (user) | ADR-2 mirror adapter pattern; ADR-3 composite target widget; ADR-4 local async dead-link context; ADR-5 editor sets `decision.action` for broken_up (+ **pending Tomo confirm handoff**); ADR-6 one command dispatches by suffix + Hashi does not write the `.md` in v1; ADR-7 vendor schema + Ajv validator (re-sync discipline). |

## Follow-ups (non-blocking)

- **Tomo confirm (ADR-5):** send a short handoff confirming the editor sets `decision.action` for broken_up (non-empty repoint → `add_relationship`, empty → `edit_note_text`) vs. Tomo defaulting a non-empty `repoint` to `add_relationship`. The editor-sets-action design is safe regardless; the confirm only lets us simplify. Not blocking PLAN/implementation.
- **Schema push (ADR-7 / OQ3):** `garden-audit-wire.schema.json` is local-only on Tomo; vendor from the local file now, re-verify + regenerate the current-shape test fixture when Tomo pushes.

## Open Questions (from research — resolve in SDD)

| # | Question | Proposed resolution |
|---|----------|---------------------|
| OQ1 | **Architecture: parallel view vs tab-in-view.** Technical recommends a parallel `GardenAuditEditorView` (different wire/model; generic-izing the concrete 430-line suggestions view = more churn/risk); UX assumed a tab in the same view. | Parallel `GardenAuditEditorView` + `VIEW_TYPE_GARDEN_AUDIT_EDITOR`, reusing tabContract/pickers/Store/ConfirmModal/`hashi-se-*` CSS/adapter pattern. One "Open Tomo editor" command dispatches by suffix (`_suggestions.*` vs `_garden-audit.*`) to the right view. Both present as "Tomo editor" surfaces. |
| OQ2 | **`broken_up` is `action`-gated in Tomo's `build_from_wire`.** It reads `repoint` only when `decision.action == "add_relationship"`; `edit_note_text` → removes the line; `null`/other → **finding silently skipped**. Handoff prose omitted this; fixtures ship `action: null`. | Editor sets `decision.action` deterministically: non-empty target → `add_relationship`; empty (remove) → `edit_note_text`. **Confirm with Tomo** (or ask Tomo to default a non-empty `repoint` to `add_relationship`). Non-blocking for PRD. |
| OQ3 | **The two vault fixtures are pre-spec-030 shape + old-digest** (no `approved`/`candidates`/`suggest_requested`; whole-payload digest). The new Ajv validator will (correctly) reject them; they can't serve as an unedited round-trip baseline. | Regenerate a current-shape fixture from Tomo's `build_wire_payload` (Tomo code is local) and/or use the handoff §2 example (digest verified to match `compute_garden_audit_digest`). |
| OQ4 | **Target widget** must be pick-from-vault AND free-typed (`[[Next Todos]]` need not exist) AND explicitly-emptyable ("remove"). Existing `FuzzySuggestModal` pickers can't express typed-new or empty. | New composite control: text input (accepts bare stem or `[[wikilink]]`) + a picker button that populates it from a vault note; empty = "remove" chip. |
| OQ5 | **Dead-link context + note navigation** (added 2026-07-22 during PRD review): dead_link cards should show the surrounding body context inline (so no hover needed to see the link's relationship), and any finding's note reference should open beside the editor on click + support hover-preview. | Derive context locally: Hashi has `target.path` + `detail.dead_target`, reads the note body (cachedRead), extracts the occurrence line(s) + nearest heading — no wire change, always fresh. Extract off the main thread (Perf L1). Open-beside via a side split leaf; hover-preview via Obsidian's `hover-link` trigger. Confirm Obsidian API details in SDD. |

## Context

**What:** A garden-audit review surface as a new `doc_type` tab in Hashi's Tomo Editor
(spec 004-suggestions-editor, view type `miyo-suggestions-editor`). garden-audit is a
Tomo skill that scans the vault for knowledge-garden health problems (dead links, broken
`up::` parents, orphans, stale MOCs) and emits a two-artifact pair — a human `.md` report
and a machine `.json` wire. This spec covers the Hashi-side editor over that wire.

**Contract source of truth:** Tomo handoff
`_inbox/from-tomo/2026-07-22_tomo-to-hashi_garden-audit-wire-schema-and-answers.md`
(done), verified against Tomo's authoritative local schema
`/Volumes/Moon/Coding/MiYo/Tomo/tomo/schemas/garden-audit-wire.schema.json`
(local-only, not yet pushed to `miyo-tomo` main).

**Key contract facts:**
- **Two-channel:** `.json` is Hashi's write channel (the user never edits it); `.md` is the
  human channel. Tomo reads the JSON when changed, else the `.md`.
- **Change-detection:** `emit_digest` covers apply-decision fields ONLY — per finding
  `id` + `decision.{selected, repoint, replace, file_under}`. `candidates`,
  `suggest_requested`, `approved`, and `detail` are EXCLUDED. Hashi carries `emit_digest`
  back **verbatim, never recomputes it**.
- **Q1 state gate:** top-level `approved: true` on Save; the `.md` `- [x] Approved` box
  still works (Tomo picks up on either — OR). `approved:true` forces the JSON path even
  when no apply-decision changed.
- **Q2 precedence:** an explicit target field (`repoint`/`replace`/`file_under`) always
  wins; `candidates[]` are display-only and never auto-applied.
- **6 check types:** `broken_up`, `dead_link` (integrity, fixable) · `unparented`,
  `orphan` (structure, fixable, → `file_under`) · `duplicate_stem`, `stale_moc`
  (advisory, not fixable).

**Scope:** vendor `garden-audit-wire.schema.json` + Ajv validator (sibling to
`suggestions-validator`); a `GardenAuditDoc` adapter (read/write JSON `decision` blocks,
carry `emit_digest` verbatim, set top-level `approved`); a `GardenAuditTab` (findings by
tier, per-finding Apply toggle + MOC/note picker for the per-check target field,
display-only `candidates` rendering, `suggest_requested` toggle); discovery by
`_garden-audit.json`/`.md` suffix in the "Open Tomo editor" command. Reuse the existing
`tabContract`, pickers (`MocPicker`/`VaultNotePicker`), and view infrastructure.

**Fixtures:** Tomo's §2 validated example + the real vault pairs
`test/Hashi/100 Inbox/2026-07-21_1738_garden-audit.*` (post-`--suggest`) and
`2026-07-22_1102_garden-audit.*` (first run).

**Related:** spec 004-suggestions-editor (the host editor); Tomo spec 030 garden-audit;
edit_note_text executor (spec 002 extension, shipped on `feat/edit-note-text-action`) is
the downstream apply path but out of scope here.

---
*This file is managed by the xdd-meta skill.*
