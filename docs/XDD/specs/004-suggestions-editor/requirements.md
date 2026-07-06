---
title: "Suggestions Editor — structured Pass-1 review surface for Tomo's suggestions document"
status: draft
version: "1.0"
---

# Product Requirements Document

## Validation Checklist

### CRITICAL GATES (Must Pass)

- [x] All required sections are complete
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Problem statement is specific and measurable
- [x] Every feature has testable acceptance criteria (Gherkin format)
- [x] No contradictions between sections

### QUALITY CHECKS (Should Pass)

- [x] Problem is validated by evidence (not assumptions) — grounded in real Tomo runs (`2026-07-06_0909/_0949/_1115`)
- [x] Context → Problem → Solution flow makes sense
- [x] Every persona has at least one user journey
- [x] All MoSCoW categories addressed (Must/Should/Could/Won't)
- [x] Every metric has corresponding verification method (see Tracking note — no telemetry per Constitution)
- [x] No feature redundancy (check for duplicates)
- [x] No technical implementation details included (op→field mapping, adapter, EditModel live in the SDD)
- [x] A new team member could understand this PRD

---

## Output Schema

See the **PRD Status Report** at the end of this session for the machine-readable status.

---

## Product Overview

### Vision

Give the vault owner a structured, safe editing surface — the "second face of the Tomo bridge" — to review and adjust Tomo's Pass-1 suggestions before approval, instead of hand-editing raw markdown checkboxes and frontmatter.

### Problem Statement

Today the owner reviews Tomo's Pass-1 output (`_suggestions.md`) as flat markdown: to re-point a note to a different MOC, choose where inside a MOC it lands, rename/merge Tomo's proposed MOCs, or change a note's lifecycle decision, they must hand-edit markdown checkboxes and YAML frontmatter by hand. This is slow, error-prone, and offers no guardrails:

- **No structural awareness** — the reviewer cannot see the target MOC's real heading/callout structure while choosing a spot, so anchors are guessed and can produce placements the executor cannot honour.
- **Invalid states are reachable** — raw frontmatter editing lets the reviewer author lifecycle transitions or placements that Pass-2 will reject or silently drop.
- **Membership is opaque** — proposed-MOC membership is expressed by ids in the underlying document; renaming or merging by hand means editing id lists correctly with no feedback.
- **Data-loss risk** — Pass-2 is JSON-only: if any field is edited, Tomo rebuilds its entire output from the JSON alone. A hand-edit that touches one field but doesn't preserve the rest of the document drops whole downstream sections (daily updates, tag-handler groups). Real runs carry 8 source items across 4 section types; a single mis-edit loses a section.

The consequence of not solving this: Pass-1 review stays a manual, unguarded chore, and the owner avoids adjustments that would improve their vault because the raw-editing cost and risk are too high.

### Value Proposition

The editor surfaces Tomo's suggestions as structured, tabbed cards with the *real* note structure and only the *valid* choices, and it owns the whole document on save so no untouched section is ever lost. The reviewer makes better adjustments faster, and every edit that reaches Pass-2 is one the executor can actually honour. It is a better tool for the *existing* review — not a new approval gate: approval stays the owner's `#MiYo-Tomo/proposed → confirmed` tag flip (ADR-009 unchanged).

## User Personas

### Primary Persona: The vault owner (PKM power user running Tomo)

- **Demographics:** Single technical Obsidian power user; runs Tomo Pass-1/Pass-2 on their own vault; comfortable with markdown and frontmatter but values guardrails; macOS primary.
- **Goals:** Review each Tomo run quickly; re-point suggestions to the right MOC; place notes at the right spot inside a MOC; rename/merge Tomo's proposed MOCs; set each note's keep/skip decision; adjust daily-log entries and tag-handler groups — all without breaking the document Pass-2 rebuilds from.
- **Pain Points:** Hand-editing markdown checkboxes and YAML is slow and unguarded; no visibility into the target MOC's real structure; easy to author an unexecutable placement or lose a whole section on save.

### Secondary Personas

None for v1. This is a single-user tool on the owner's own vault. Future MiYo users are out of scope for this phase; the editor introduces no external surface (no ports, no MCP) and no multi-user concerns.

## User Journey Maps

### Primary User Journey: Reviewing a Tomo Pass-1 run

1. **Awareness:** The owner runs Tomo Pass-1; a `_suggestions.json` (and courtesy `_suggestions.md`) appears in the vault.
2. **Consideration:** Rather than open the raw markdown, the owner opens the Suggestions Editor leaf beside the source note.
3. **Adoption:** The editor loads the run and presents four tabs (Suggestions, Proposed MOCs, Daily, Tag-Handler) with counts and empty states, so the owner sees the whole run at a glance without clutter.
4. **Usage:** The owner works through the tabs — selects/creates a MOC target, picks a spot using the MOC's real structure, renames or merges proposed MOCs, sets per-note decisions, adjusts daily entries, approves tag-handler groups — then saves. On save the editor writes the whole document back verbatim except the edits, carries Tomo's change signal through untouched, and re-renders the courtesy markdown.
5. **Retention:** Because edits are fast, structure-aware, and safe (no lost sections, no unexecutable placements), the owner uses the editor for every run instead of hand-editing — and adjusts more, improving the vault.

### Secondary User Journeys

**Escalation to chat.** When the reviewer needs something the editor cannot express (anything requiring Tomo to re-derive placement/structure), they escalate through the existing Session View chat (spec 001) — not a new feature in this editor.

## Feature Requirements

### Must Have Features

The minimum for the editor to replace hand-editing for Pass-1 review: the four deterministic operations, the full editable surface across the four tabs, and a save that never loses a section.

#### Feature 1: Tabbed review surface beside the note

- **User Story:** As the vault owner, I want Tomo's run presented as four tabbed lists beside the source note so that I can review everything without clutter and edit iteratively with Save semantics.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a `_suggestions.json` run, When I open the Suggestions Editor, Then it opens in a dockable workspace leaf beside the note (not a transient modal) and shows four tabs: Suggestions, Proposed MOCs, Daily, Tag-Handler.
  - [ ] Given a loaded run, When a tab's source list is empty (e.g. Proposed MOCs in the `0909` run), Then that tab shows a count of 0 and an empty state rather than an error.
  - [ ] Given I have made edits, When I close the leaf, Then I am warned about unsaved changes before the view closes.
  - [ ] Given no edits have been made, When I close the leaf, Then it closes without a save prompt.

#### Feature 2: Re-point a suggestion to a different MOC (op 1)

- **User Story:** As the vault owner, I want to pick any MOC — including a vault note Tomo did not propose — as a suggestion's target so that notes land in the MOC I actually want.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a worthy suggestion with candidate MOCs, When I select a different candidate, Then that candidate becomes the selected target and the previous selection is cleared.
  - [ ] Given a worthy suggestion, When I use "Add MOC" and fuzzy-pick any vault note, Then it is added as a user-sourced candidate and can be selected as the target.
  - [ ] Given a suppressed suggestion (worthiness below the atomic threshold), When I view its card, Then no MOC selection UI is shown (Tomo emits no candidate MOCs for it).

#### Feature 3: Choose the spot inside a MOC (op 2)

- **User Story:** As the vault owner, I want to choose where inside an existing MOC a note is inserted, using the MOC's real structure, so that the placement is one the executor can actually honour.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a selected existing MOC, When I open the spot picker, Then it shows the MOC's real current structure (headings, callouts) read from the note itself, not a possibly-stale snapshot.
  - [ ] Given I pick a callout anchor, When I choose placement, Then "inside", "before", and "after" are all offered.
  - [ ] Given I pick a heading or line anchor, When I choose placement, Then only "before" and "after" are offered and "inside" is not selectable (the executor hard-fails "inside" on non-callouts).
  - [ ] Given the selected target is a *proposed* MOC (no structure yet), When I open the spot picker, Then it offers membership/ordering only, not a section anchor picker.

#### Feature 4: Rename and merge proposed MOCs (op 3)

- **User Story:** As the vault owner, I want to rename a proposed MOC or merge one into another so that Tomo's proposed grouping matches how I actually organise.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a proposed MOC, When I edit its name inline, Then the change is recorded without altering its membership.
  - [ ] Given two proposed MOCs, When I merge A into B, Then B gains A's members and A is removed, with membership tracked by id (not display string).
  - [ ] Given a proposed MOC, When I view its member chips, Then each chip shows the member note's title (with the underlying id available on hover).
  - [ ] Given two proposed MOCs share a name, When I use "Merge into…", Then they collapse into one (Tomo unions on the same name).

#### Feature 5: Per-note and per-MOC decision (op 4)

- **User Story:** As the vault owner, I want to approve or skip each note and each proposed MOC so that only what I want is created.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a suggestion, When I view its decision control, Then it defaults from worthiness and I can flip it between approve and skip.
  - [ ] Given a proposed MOC, When I view its decision control, Then it defaults to skip and I must set it to approve for the MOC to be created.
  - [ ] Given only valid choices should be offered, When I set a decision, Then the editor never presents a transition the downstream rebuild would reject.

#### Feature 6: Editable note fields (title, template, location, tags)

- **User Story:** As the vault owner, I want to edit a note's title, template, location, and tags so that the created note is correct without a second pass.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a suggestion, When I edit its title, Then the title updates (the note stem is derived downstream by Tomo, not hand-entered).
  - [ ] Given a suggestion, When I pick a template, location (folder), or tags, Then each is chosen via a fuzzy picker over real vault values, not free text.

#### Feature 7: Force-Atomic kept consistent per source

- **User Story:** As the vault owner, I want a source's Force-Atomic setting to be a single decision even when the source appears both as a suggestion and as a daily-log entry, so that I cannot set two contradictory states.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a source that is both a suppressed suggestion and a daily-log entry (e.g. `call-mueller`), When I toggle Force-Atomic in either place, Then both reflect the same state.
  - [ ] Given a suppressed suggestion, When I view its card, Then the single real control is Force-Atomic, with the worthiness shown to explain the skip default.

#### Feature 8: Edit daily updates

- **User Story:** As the vault owner, I want to adjust daily-log entries so that inline logs land correctly and I control which are applied.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a daily-log entry, When I edit its content, position (after-last-line / before-first-line / at-time), or — only when position is at-time — its time, Then the change is recorded.
  - [ ] Given a daily date, When the daily note does not yet exist, Then the editor shows a "doesn't exist" state with a click-to-open link and never creates the note itself (Obsidian creates it on open).
  - [ ] Given a daily-only source, When I set its entry to Accepted, Then the source is applied and deleted downstream; When I leave it unchecked, Then the entry is not applied and the source is kept — with no separate delete control.

#### Feature 9: Approve tag-handler groups

- **User Story:** As the vault owner, I want to approve tag-handler groups and choose whether to keep the source so that captured items are routed correctly.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a tag-handler group, When I view its card, Then it shows read-only context (handler, target path, marker, source paths, preview) and offers Approve and Keep-source toggles.
  - [ ] Given a tag-handler group, When it is not approved, Then it is treated as skipped.

#### Feature 10: Safe save — own the whole document

- **User Story:** As the vault owner, I want saving to preserve every part of the document I did not edit so that no downstream section is ever lost.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a run with daily updates and tag-handler groups I never open, When I edit one suggestion field and save, Then those untouched sections round-trip byte-for-byte.
  - [ ] Given any save, When the document is written, Then Tomo's change signal is carried through verbatim — never recomputed, never stripped.
  - [ ] Given I made no real edit, When the view is idle, Then nothing is written and the document stays byte-stable so Tomo keeps the markdown path.
  - [ ] Given a save, When the JSON is written, Then the courtesy markdown read-view is re-rendered; and When the write fails, Then the editor shows a notice, keeps the unsaved state, and does not corrupt the in-memory model.
  - [ ] Given a document whose declared version is not the supported one, When the editor loads it, Then it fails loud and falls back to the markdown path rather than editing an unknown shape.

### Should Have Features

- **Click-to-open missing targets** — a missing MOC or daily note is a click-to-open link; creation happens outside the editor (Obsidian creates on open). No wire dependency.
- **Member-chip title hover** — hovering a proposed-MOC member chip reveals the underlying id; the chip itself shows the title.
- **Counts and empty states per tab** — every tab shows its item count and a clear empty state.

### Could Have Features

- Keyboard-driven navigation across cards and tabs.
- Bulk decision actions (approve/skip all worthy suggestions at once).

### Won't Have (This Phase)

- **Tomo-reasoning round-trips** — any operation that needs Tomo to re-derive placement or structure escalates to Session View instead.
- **Editing or creating existing (non-proposed) MOCs' structure** — only proposed MOCs' grouping is editable; existing MOCs are targets, not edit subjects.
- **A new approval gate or automated approver** — approval stays the owner's tag flip.
- **Ownership of the suggestions document schema** — Tomo owns it; the editor conforms.
- **"Apply daily update AND keep source note" as a decoupled control** — owner-signed-off deferral (2026-07-06). v1 keeps Accepted = apply-and-delete; revisit post-v1.

## Detailed Feature Specifications

### Feature: Choose the spot inside a MOC (op 2 — the most complex feature)

**Description:** When a suggestion targets an *existing* MOC, the reviewer chooses exactly where the link is inserted. The editor reads the target MOC's real current structure and offers only anchors and placements the executor can honour. When the target is a *proposed* MOC (which has no structure yet), the operation reduces to membership and ordering.

**User Flow:**
1. User selects an existing MOC as a suggestion's target.
2. User opens the spot picker.
3. System reads and displays the MOC's real current structure — headings, callouts — from the note itself.
4. User picks an anchor (a heading, a callout, a line, or a brand-new section).
5. System offers only the valid placements for that anchor type.
6. User picks a placement; the chosen spot is recorded on the suggestion.

**Business Rules:**
- Rule 1: The structure shown is the note's *real* current structure, read at pick time — not a snapshot that may be stale.
- Rule 2: Placement options are derived from anchor type: a callout anchor offers inside / before / after; a heading or line anchor offers before / after only.
- Rule 3: "Inside" is callout-only; it is never offered for headings or lines, because the executor hard-fails inside-placement on non-callouts.
- Rule 4: A proposed MOC has no structure, so the spot picker offers membership/ordering only, never a section anchor picker.

**Edge Cases:**
- Scenario: The MOC file changes on disk between selection and pick → Expected: the picker reads the current structure at open time, so the reviewer always chooses against what exists now.
- Scenario: The target MOC has no headings or callouts → Expected: the picker still offers "new section" and line placement, so a spot is always choosable.
- Scenario: The reviewer somehow selects a target with no structure and no membership context → Expected: the operation degrades to ordering only rather than presenting an empty/invalid picker.

## Success Metrics

> **Constitution note (L1 Privacy & Security):** MiYo components ship **no telemetry, analytics, or runtime tracking**. These metrics are therefore verified through the test suite and manual-QA runs against real Tomo emissions — **not** by instrumenting the running plugin. The "Tracking Requirements" table below records verification methods, not analytics events.

### Key Performance Indicators

- **Adoption:** The owner uses the editor for Pass-1 review instead of hand-editing markdown/frontmatter — verified by the editor covering every operation the review requires (the four ops + the full editable surface across all four tabs).
- **Engagement:** A full run (all four section types, real 8-item run) is reviewable end-to-end in the editor without dropping to raw markdown for any supported operation.
- **Quality (load-bearing):** Zero data-loss on save — a document with sections the UI never touches round-trips byte-for-byte, and the change signal is byte-identical after a no-edit save. This is the single most important success criterion.
- **Safety:** The editor never authors an unexecutable placement or an invalid lifecycle transition — every choice it offers is one the executor/rebuild honours.

### Tracking Requirements

| Verification | What it checks | Purpose |
|--------------|----------------|---------|
| Round-trip fidelity test | Load → edit one field → save → untouched sections byte-identical | Proves "own the whole document" (no lost section) |
| Change-signal passthrough test | Load → save-no-edit → change signal byte-identical | Proves the editor never false-triggers Pass-2 rebuild |
| Placement-validity unit tests | Valid-placements per anchor type, authorization AND rejection cases | Proves no unexecutable placement is offered |
| Manual-QA rows against real runs | Full `0909/0949/1115` runs reviewed in the editor | Proves end-to-end coverage on real Tomo emission |

## Constraints and Assumptions

### Constraints

- **Local-first, no telemetry, no external surface** — no ports, no MCP, no network (MiYo Constitution L1; ADR-009). Vault read/write via the Obsidian API only.
- **Deterministic-only (v1)** — no Tomo reasoning round-trip inside the editor.
- **Conform, do not own** — the editor conforms to Tomo's executable suggestions-wire schema (`schema_version: "1"`); it does not define or fork it.
- **Executor-bound operations** — every operation binds to what Hashi's executor already does (ADR-026 §0); the editor is deliberately *more* constrained than the raw wire.
- **Platform** — macOS primary; the editor is a desktop Obsidian plugin surface.

### Assumptions

- Tomo emits a `_suggestions.json` sibling next to each `_suggestions.md`, and Pass-2 is JSON-only (rebuilds from the JSON when it changed, else uses the markdown).
- The §8 wire fixes shipped by Tomo (real candidate MOCs on worthy notes; tag-handler context) are present — confirmed in the `1115` run.
- The reviewer approves via the existing `#MiYo-Tomo/proposed → confirmed` tag flip; the editor is not the approval gate.
- Kokoro will reconcile ADR-026 to match Tomo's implemented JSON-only + per-note-decision contract (drift handoff sent; Hashi conforms to Tomo meanwhile).

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Tomo ↔ Hashi wire drift (schema changes underneath the editor) | High | Medium | Fail-loud version gate; conform to Tomo's executable schema as source of truth; build/test against real Tomo emission, not hand fixtures |
| Data loss on save (partial round-trip drops a section) | High | Medium | "Own the whole document" requirement + mandatory round-trip-fidelity tests as a release gate |
| Stale structure read during spot pick (metadataCache rebuild race, #68) | Medium | Medium | Read the MOC's real structure from note content at pick time, not from a cached snapshot |
| Schema file unreadable in this checkout | Medium | High (present) | Vendor + verify the schema when the Tomo branch is reachable; treat as an open task, not a guess |
| Kokoro ADR-026 stays stale vs Tomo | Low | Medium | Drift handoff already sent; Hashi conforms to Tomo; reconciliation is a Kokoro-side doc task, no code impact |

## Open Questions

- [ ] Vendor and verify `suggestions-wire.schema.json` from the Tomo branch (unreadable in this checkout) before locking the read/write layer.
- [ ] Confirm Kokoro has absorbed the ADR-026 drift handoff (Pass-2 is JSON-only, not override; per-note `decision` is shipped) — external, Kokoro-side; does not block Hashi implementation.
- [ ] Post-v1 only: revisit the deferred "apply daily update + keep source note" decoupled control if the need arises.

---

## Supporting Research

### Competitive Analysis

There is no direct competitor: this is a bespoke review surface for one component (Tomo Pass-1) inside one plugin (Hashi). The realistic alternatives the editor replaces are (1) hand-editing the raw `_suggestions.md` markdown checkboxes and (2) hand-editing YAML frontmatter and id lists. Both are unguarded, structure-blind, and carry the data-loss risk the JSON-only rebuild introduces. The editor's differentiator is structure-awareness (real note structure at pick time), valid-choice-only affordances (bound to the executor), and whole-document safety on save.

### User Research

Grounded in real Tomo emissions rather than assumptions: three real runs (`2026-07-06_0909`, `_0949`, `_1115`) drove the design. The `1115` run confirms the shipped §8 fixes — worthy note S07 carries real candidate MOCs (`anchor: null` until a spot is resolved), and the tag-handler group carries full context (handler/target path/marker/source paths/preview). The runs span all four section types (suggestions worthy + suppressed, proposed MOCs, daily updates, tag-handler groups), which is what drove the tabbed layout ("nicht zuviel auf einmal, aber alles sichtbar").

### Market Data

Not applicable — single-user, self-hosted PKM tooling with no external surface and no market/telemetry dimension. Value is measured by the owner's own review workflow, not adoption metrics.
