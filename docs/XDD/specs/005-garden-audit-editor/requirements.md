---
title: "Garden-Audit review surface in the Tomo editor"
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

- [x] Problem is validated by evidence (real vault fixtures + shipped suggestions-editor precedent)
- [x] Context → Problem → Solution flow makes sense
- [x] Every persona has at least one user journey
- [x] All MoSCoW categories addressed (Must/Should/Could/Won't)
- [x] Every metric has corresponding tracking events
- [x] No feature redundancy (check for duplicates)
- [x] No technical implementation details included (HOW deferred to SDD)
- [x] A new team member could understand this PRD

---

## Product Overview

### Vision

Let the PKM author review knowledge-garden findings and pick fix targets in a
structured Obsidian editor — the same one-click confidence the suggestions
editor already gives for inbox review — instead of hand-editing a markdown
report.

### Problem Statement

garden-audit (a Tomo skill) scans the vault for health problems — dead links,
broken `up::` parents, orphaned/unparented notes, duplicate stems, stale MOCs —
and writes a two-artifact pair into the vault: a human `.md` report and a
machine `.json` wire. Today the only way to act on it is to **hand-edit the
markdown report**: tick check-boxes, type `[[targets]]` between brackets, tick
"Approved", then run `/inbox`. This is error-prone (a mistyped or misplaced
`[[link]]`, a missed box), gives no pick-from-vault assistance, and forces the
user to mentally parse prose formatting. A real run has 25 findings across three
severity tiers — enough that manual markdown editing is slow and mistake-prone.

Hashi already solved the equivalent problem for *suggestions* review with a
tabbed editor over the machine wire. garden-audit has no such surface, so it is
the last review flow still done by hand.

### Value Proposition

- **Pick, don't type.** Fix targets are chosen with a vault picker (with free-typed
  and "leave empty to remove" still available), eliminating mistyped wikilinks.
- **Structured over prose.** Findings are grouped by severity with clear per-finding
  controls, instead of a wall of markdown check-boxes.
- **Safe by construction.** The editor writes the machine wire and carries the
  change-signal (`emit_digest`) verbatim, so Tomo applies exactly the reviewed
  decisions; advisory findings can't be accidentally "fixed".
- **Consistent.** It reuses the existing "Tomo editor" surface, so the author
  learns one review idiom for both suggestions and garden-audit.

## User Personas

### Primary Persona: The PKM Author

- **Demographics:** Solo Obsidian power-user running the MiYo stack (Tomo + Hashi)
  on desktop; comfortable with markdown, MOCs, and Dataview `up::` links; not
  necessarily a programmer.
- **Goals:** Keep the knowledge garden healthy (no dead links, every note parented,
  MOCs fresh) with minimal fuss; review Tomo's findings and approve fixes quickly
  and correctly.
- **Pain Points:** Hand-editing the markdown report is slow and error-prone; no
  autocomplete for target MOCs/notes; easy to mistype a `[[link]]`, miss a box, or
  accidentally act on an advisory item that has no real fix.

### Secondary Personas

**The `.md`-only author (compatibility persona).** A user who does *not* open the
Hashi editor and edits the markdown report by hand. Not a new user of this
feature, but a hard constraint: this feature must not break their flow — Tomo
still accepts a hand-edited `.md`. Included to bound scope, not to serve directly.

## User Journey Maps

### Primary User Journey: Review and approve a garden-audit run

1. **Awareness:** The author runs `/garden-audit` in Tomo; a `_garden-audit.json`/`.md`
   pair appears in the inbox. They know from the suggestions flow that Hashi offers a
   review editor.
2. **Consideration:** They can either hand-edit the `.md` (old way) or open the Hashi
   editor over the run (new way). The editor wins when they want pick-assist and a
   structured view.
3. **Adoption:** They run "Open Tomo editor" with the run active; the garden-audit
   review surface opens.
4. **Usage:** They scan findings by tier, apply/skip each fixable finding, pick or type
   a target (or leave empty to remove), optionally mark findings for LLM suggestions,
   then Save (which approves the run). They run `/inbox`; Tomo applies exactly those
   decisions.
5. **Retention:** Because it is faster and safer than markdown editing and shares the
   suggestions-editor idiom, it becomes the default way to handle garden-audit runs.

### Secondary User Journey: Two-run LLM suggestion assist

1. On first review, the author can't decide a target for some orphans/links.
2. They tick **Suggest targets** on those findings and Save.
3. They run `/garden-audit --suggest` in Tomo (outside Hashi); Tomo enriches those
   findings with scored candidates and re-emits the pair.
4. They reopen the editor; candidates now render as scored chips.
5. They click a chip to populate the target field (or type their own), then Save and
   `/inbox`.

## Feature Requirements

### Must Have Features

The minimum for the editor to replace hand-editing a garden-audit report safely.

#### Feature 1: Discover and open a garden-audit review surface

- **User Story:** As the PKM author, I want to open a garden-audit run in the Tomo
  editor so that I can review its findings in a structured surface instead of the
  raw markdown.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a `_garden-audit.json` (or its `.md` peer) is the active file, When I run the "Open Tomo editor" command, Then the garden-audit review surface opens for that run.
  - [ ] Given no garden-audit run is active, When I run the command, Then I am offered a picker over every garden-audit run in the vault (falling back to a clear notice if none exist).
  - [ ] Given a suggestions run is active, When I run the same command, Then the suggestions review surface opens (the command routes by artifact type, not the garden-audit surface).

#### Feature 2: Findings grouped by severity tier with counts

- **User Story:** As the PKM author, I want findings grouped by severity so that I can
  triage integrity problems first and see how much work each tier holds.
- **Acceptance Criteria:**
  - [ ] Given a loaded run, When the surface renders, Then findings appear under three tier sections — Integrity (broken_up, dead_link), Structure (unparented, orphan), Advisory (duplicate_stem, stale_moc) — each with a count.
  - [ ] Given a loaded run, When findings render within a tier, Then they preserve the wire's order and each shows its finding id (e.g. F01) as the cross-reference to the markdown report.
  - [ ] Given a loaded run, When the surface header renders, Then it shows the run identifier, profile, and total finding count.

#### Feature 3: Per fixable finding — apply/skip and a fix target

- **User Story:** As the PKM author, I want to accept or skip each fixable finding and
  set its fix target with vault assistance so that the applied fix is correct.
- **Acceptance Criteria:**
  - [ ] Given a fixable finding, When it renders, Then it shows an Apply/Skip toggle defaulting to the wire's current selected state.
  - [ ] Given a fixable finding, When I toggle Apply/Skip, Then the run is marked edited (dirty) and the decision is recorded for that finding.
  - [ ] Given a broken_up finding, When I set the target, Then I can pick a MOC from the vault, type a target directly, or leave it empty (= remove the broken line).
  - [ ] Given a dead_link finding, When I set the target, Then I can pick/type a replacement note or leave it empty (= **unlink**: strip the `[[ ]]` brackets but keep the text, for every occurrence — not a full deletion of the link text). The empty-state label reflects "unlink", not "remove".
  - [ ] Given a dead_link finding, When it renders, Then it shows the surrounding body context of each occurrence (the line/snippet where the dead link appears in the note, with its nearest heading if any) so the relationship is visible inline without needing hover-preview.
  - [ ] Given an unparented or orphan finding, When I set the target, Then I can pick/type a MOC to file the note under, or leave it empty (= fall back to the scan candidate or skip if none).
  - [ ] Given any fixable finding, When I type a target that is not an existing vault note (e.g. a not-yet-created note), Then the typed value is accepted as the target.

#### Feature 4: Display-only candidates (click-to-pick, never auto-applied)

- **User Story:** As the PKM author, I want to see scored candidate targets and pick one
  with a click so that I don't have to type common fixes — while staying in control.
- **Acceptance Criteria:**
  - [ ] Given a finding with candidate targets (scan candidates for orphans/unparented, or LLM candidates after a suggest run), When it renders, Then the candidates appear as scored chips beneath the target field.
  - [ ] Given a candidate chip, When I click it, Then its target is written into the finding's target field (it becomes the explicit target).
  - [ ] Given both a set target field and candidates, When Tomo later reads the run, Then the explicit target field is what applies — candidates are never auto-applied.

#### Feature 5: Request LLM suggestions and make the two-run flow legible

- **User Story:** As the PKM author, I want to flag findings I can't resolve for LLM
  help and understand the round-trip so that I know why and when candidates appear.
- **Acceptance Criteria:**
  - [ ] Given a fixable finding, When I toggle "Suggest targets", Then that request is recorded and the run is marked edited so I can Save it.
  - [ ] Given I ticked "Suggest targets" and saved, When candidates have not yet been produced, Then the finding shows a pending hint telling me to run `/garden-audit --suggest` in Tomo and reopen.
  - [ ] Given a suggest run returned no candidates for a finding, When I reopen, Then that finding shows a distinct "no suggestions found" note (so I know the LLM ran and came back empty, versus never ran).

#### Feature 6: Advisory findings are strictly read-only

- **User Story:** As the PKM author, I want advisory findings shown but not actionable so
  that I can't accidentally "fix" something that has no automated fix.
- **Acceptance Criteria:**
  - [ ] Given a duplicate_stem or stale_moc finding, When it renders, Then it shows its read-only detail (colliding paths / last-modified) and no Apply toggle, target field, candidates, or suggest control.
  - [ ] Given an advisory finding, When I interact with the surface, Then there is no control that could change its outcome (only its target note link is clickable to open the note).

#### Feature 7: Save approves the run; Revert discards; edits are visible

- **User Story:** As the PKM author, I want Save to record my decisions and mark the run
  ready for `/inbox`, and Revert to discard, so that my review is committed intentionally.
- **Acceptance Criteria:**
  - [ ] Given unsaved edits, When I Save, Then my decisions are written to the machine wire, the run is marked approved for `/inbox`, and the change-signal the run carried is preserved unchanged (never recomputed).
  - [ ] Given I saved with all decisions at their defaults (approve-only), When Tomo reads the run, Then it still applies the fixes (approval alone routes to the machine wire).
  - [ ] Given I changed only "Suggest targets" toggles (no apply-decision change), When I look at the surface, Then Save is still enabled and saving persists those requests.
  - [ ] Given unsaved edits, When I Revert, Then the surface reloads the run and discards my in-memory edits.
  - [ ] Given no unsaved edits, When the surface renders, Then Save is disabled and no "edited" indicator shows.

#### Feature 8: Empty and error states

- **User Story:** As the PKM author, I want clear empty and error states so that a clean
  vault, an advisory-only run, or a malformed run is unambiguous.
- **Acceptance Criteria:**
  - [ ] Given a run with only advisory findings, When it renders, Then the advisory findings show read-only and a reassurance line states there is nothing to apply (it does NOT render as "no findings").
  - [ ] Given a run with zero findings, When it renders, Then a clear "vault is clean / no findings" empty state shows.
  - [ ] Given a malformed or schema-mismatched wire, When I open it, Then the surface shows a clear "couldn't load garden audit: <reason>" error and does NOT enter an editable state over bad data.

#### Feature 9: Inspect the affected note (open-beside, hover-preview)

- **User Story:** As the PKM author, I want to see and open the note a finding affects
  right next to the editor so that I can judge the fix in context without losing my place
  in the review.
- **Acceptance Criteria:**
  - [ ] Given any finding, When I click its affected-note reference, Then the note opens in a pane beside the editor (a split to the side) rather than replacing the editor.
  - [ ] Given any finding, When I hover its affected-note reference, Then Obsidian's note hover-preview is available for it.
  - [ ] Given a dead_link finding, When it renders, Then its inline context snippet (Feature 3) lets me judge the link's relationship without opening or hovering at all.

### Should Have Features

- Dismissible top-of-surface banner explaining the `--suggest` round-trip once.
- Graceful degradation when a finding's target note was moved/deleted (render the path
  as plain text with a "note not found" note rather than breaking the card).
- Short/prefixed display of the long run identifier in the header.

### Could Have Features

- An inline hint on a typed target that does not yet exist in the vault ("will be
  created / repointed to a new note").
- A per-tier "apply all / skip all" convenience.
- **Surrounding body context for broken_up findings too** (where the `up::` line sits) —
  useful but lower value than dead-link context, since a broken parent link's relationship
  is usually self-evident from the note itself.

### Won't Have (This Phase)

- The precise view/tab architecture (parallel view vs. shared tabbed view) — that is an
  SDD decision (OQ1), not a product requirement.
- Running `/garden-audit --suggest` from inside Hashi — the LLM enrichment stays a Tomo
  step; Hashi only requests and renders.
- Editing the human `.md` report from the editor, or editing read-only `detail` fields.
- The `edit_note_text` / apply executor — already shipped; out of scope here.
- Changing the garden-audit wire schema — owned by Tomo; Hashi vendors and validates it.

## Detailed Feature Specifications

### Feature: The fix-target control (Feature 3, most complex)

**Description:** A single control per fixable finding that sets the value Tomo actually
applies (`repoint` for broken_up, `replace` for dead_link, `file_under` for
unparented/orphan). It must express three states the existing suggestions pickers
cannot: pick-from-vault, free-typed (including a not-yet-existing note), and explicitly
empty (= remove).

**User Flow:**
1. User sees the current target (or an explicit "(remove)" state when empty).
2. User either clicks a candidate chip, opens the vault picker, or types a value directly.
3. System records the value on that finding and marks the run edited.

**Business Rules:**
- An explicit target value always wins over any candidate; candidates are advisory input.
- An empty target is a meaningful, distinct state, but its meaning is **per check type** — the empty-state label must reflect the right one:
  - **dead_link** empty → **unlink** (strip the `[[ ]]` brackets, keep the text); NOT deleting the text.
  - **broken_up** empty → **remove** the broken `up::` line.
  - **unparented / orphan** empty → fall back to the scan candidate, or skip if none.
- A typed target need not resolve to an existing vault note.
- Setting a target marks the run edited (dirty) so it can be saved.

**Edge Cases:**
- Candidate clicked, then user types a different value → the typed value is the target.
- Target set, then cleared → the finding is in the "remove" state, not "unconfigured".
- Target note later missing at open time → render path as plain text + "note not found"; do not break the card.

## Success Metrics

### Key Performance Indicators

This is a single-user local tool; "success" is measured by correctness and adoption of
the editor over hand-editing, not revenue.

- **Adoption:** The author uses the editor (not markdown hand-editing) for garden-audit
  runs in manual QA.
- **Engagement:** A full 25-finding run can be reviewed and approved through the editor
  without touching the markdown.
- **Quality:** Zero mis-applied fixes — the decisions Tomo applies match exactly what the
  editor showed (change-signal carried verbatim); no malformed wire is ever silently applied.
- **Business Impact (proxy):** Fewer manual-QA defects from mistyped/misplaced links vs.
  the markdown-editing flow.

### Tracking Requirements

No telemetry (MiYo Constitution: no analytics/telemetry). "Tracking" is via the existing
metadata-only run log and manual QA, not event collection.

| Event | Properties | Purpose |
|-------|------------|---------|
| Run-log entry on `/inbox` apply | finding ids, actions, outcomes (metadata only) | Verify applied decisions match the reviewed run (quality KPI) — existing mechanism, not new to this feature |

## Constraints and Assumptions

### Constraints

- **Local-first, no external surface** — the editor reads/writes vault files only; no
  ports, no network, no telemetry (MiYo Constitution L1).
- **Desktop Obsidian** — consistent with the plugin's `isDesktopOnly` posture.
- **Wire schema is Tomo-owned** — Hashi vendors and validates `garden-audit-wire.schema.json`;
  the change-signal (`emit_digest`) is carried verbatim and never recomputed.
- **Reuse the existing editor infrastructure** (spec 004) — tab/card idiom, pickers,
  store, save/revert chrome, `hashi-se-*` styles; sentence-case UI text.
- **Constitution L1 testing** — every filesystem and validation path needs happy + failure/denial coverage.

### Assumptions

- The user opens the editor over a Tomo-emitted, current-shape garden-audit wire (the
  authoritative schema is verified; older-shape fixtures are correctly rejected).
- Tomo continues to consume the machine wire when it changed, else the `.md` (the
  two-channel contract holds; verified against Tomo's live parser).
- The `edit_note_text` / apply path already handles execution (shipped).
- **Dead-link context is derived locally by Hashi**, not carried in the wire: Hashi has the
  affected note's path plus the dead link text, so it reads the note body and extracts the
  surrounding snippet itself — no garden-audit wire change, always reflecting the note's
  current content (OQ5).

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Editor writes a decision Tomo silently skips (broken_up `action` gating) | High | Medium | OQ2 — editor sets `decision.action` deterministically; confirm the contract with Tomo before implementing the apply-write. |
| Recomputing/altering `emit_digest` erases the change-signal | High | Low | Carry the whole wire verbatim; only edit enumerated decision fields + top-level approved; test the round-trip. |
| Testing against stale fixtures gives false confidence | Medium | High | OQ3 — regenerate a current-shape fixture from Tomo's emitter / use the verified handoff example; validator rejects old shape (feature, not bug). |
| Target widget scope creep (pick + type + empty) | Medium | Medium | OQ4 — specify the composite control in the SDD; treat as the one genuinely new widget. |
| Architecture churn (generic-izing the suggestions view) | Medium | Medium | OQ1 — prefer a parallel view reusing shared machinery over forcing generics through a concrete 430-line view. |
| Reading many note bodies for dead-link context blocks the UI | Medium | Low | Extract context lazily/asynchronously off the main thread (MiYo Constitution Perf L1); cache per note; only dead_link findings need it (broken_up context is Could-have). |

## Open Questions

Tracked in the spec README (OQ1–OQ4); resolved in SDD. Restated here:

- [ ] OQ1 — parallel `GardenAuditEditorView` vs. a tab in the shared suggestions view.
- [ ] OQ2 — confirm with Tomo how `decision.action` is set for broken_up (editor-sets vs. Tomo-defaults).
- [ ] OQ3 — regenerate a current-shape wire fixture for tests.
- [ ] OQ4 — design the composite target control (pick + free-typed + empty).
- [ ] OQ5 — dead-link context: derive locally from the note body (proposed) vs. request a context snippet in the wire; and how the note reference opens beside / triggers hover-preview (Obsidian API details for SDD).

---

## Supporting Research

### Competitive Analysis

Prior art within the same product: Hashi's **suggestions editor** (spec 004) is the
direct precedent — a tabbed review surface over a Tomo machine wire with pick-assist,
Save = approve, and verbatim change-signal passthrough. This feature applies the same
proven pattern to garden-audit. No external competitor is relevant (single-user local
PKM tooling).

### User Research

Grounded in real artifacts, not assumptions: two real vault garden-audit report pairs
(`2026-07-22_1102` first run, `2026-07-21_1738` post-`--suggest`) show the exact
findings, tiers, and manual-editing affordances the user works with today, and the
markdown's own prose (tick boxes, `[[ ]]` slots, "Pick one" candidate lists) is the
mental model this editor structures.

### Market Data

Not applicable — internal single-user tooling. The relevant "market" signal is the
author's own established preference for the structured suggestions editor over manual
markdown review, which this feature extends to garden-audit.
