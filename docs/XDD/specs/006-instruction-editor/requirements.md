---
title: "Instruction-Set Editor — repair bench for failed mechanical actions"
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

- [x] Problem is validated by evidence (not assumptions) — run-log deep-link bug + ADR-027
- [x] Context → Problem → Solution flow makes sense
- [x] Every persona has at least one user journey
- [x] All MoSCoW categories addressed (Must/Should/Could/Won't)
- [x] Every metric has corresponding tracking events (QA/behavioural, local-only)
- [x] No feature redundancy (check for duplicates)
- [x] No technical implementation details included (design → SDD)
- [x] A new team member could understand this PRD

---

## Output Schema

### PRD Status Report

| Field | Value |
|-------|-------|
| specId | 006-instruction-editor |
| title | Instruction-Set Editor — repair bench for failed mechanical actions |
| status | IN_REVIEW |
| clarificationsRemaining | 0 |
| acceptanceCriteria | 26 (F5 descoped during design; entry-point ACs refined per ADR-3) |
| openQuestions | 0 (all 3 forks resolved in SDD — ADR-3/5/6) |

---

## Product Overview

### Vision
From a partly-failed `/execute`, the vault owner can see each action's intent and last-run
outcome, repair the small mechanical detail that broke it, and re-run — closing the
review → apply → fix → re-apply loop **without pulling Tomo back in for a one-line fix**.

### Problem Statement
Today, when a Tomo instruction set is executed and an action fails or is skipped (e.g. `I07`
"anchor not found: Maintenance"), the only recourse is to go back to Tomo for a **full re-run**
to fix a single mechanical detail. The failure is not a bad *intent* — the user already approved
the intent — it is a mechanical mismatch (a wrong anchor, a moved target, a stale match string).
There is no surface that shows *what an action was supposed to do, why it failed, and lets the
user act on it locally*. The gap surfaced concretely from a run-log bug: the log deep-linked each
`I##` row into the instruction `.md` heading, and Tomo's enriched headings (`### I01 — Repoint
dead link [[X]] in [[Y]]`) made the `#anchor` unparseable (nested `[[]]`). The deeper realization:
the deep-link was a proxy for "let me see what this action should do and why it failed, and act."

### Value Proposition
A **repair bench for Hashi's own failed mechanical work** — not an editing surface over Tomo's
output. The user approved an intent; execution failed on a mechanical detail; the repair
**restores the approved intent** rather than introducing a new one. This keeps Hashi an executor
(it never authors actions) while removing the expensive round-trip to Tomo for trivial fixes.
It reuses proven editor infrastructure (spec-005 garden-audit editor) and the existing instruction
wire, so the capability is small, safe, and idempotent by construction (monotonic `applied`).

## User Personas

### Primary Persona: The vault owner (Marcus / any Hashi user)
- **Demographics:** Single desktop Obsidian user running Tomo + Hashi; comfortable reviewing and
  approving AI-proposed vault operations; not editing raw JSON by hand.
- **Goals:** Apply an approved instruction set cleanly; when an action fails on a mechanical
  detail, fix it in place and re-run without regenerating the whole set through Tomo.
- **Pain Points:** A single failed action forces a full Tomo re-run; no local view of an action's
  intent + failure reason; the old run-log deep-link into the `.md` heading was broken and, even
  when it worked, only pointed at a machine artifact instead of letting the user *act*.

### Secondary Personas
None. This is a single-user, local-first surface; there is no reviewer/admin split.

## User Journey Maps

### Primary User Journey: Repair a failed action and re-run
1. **Awareness:** The user runs "Execute instructions document"; the run summary reports one or
   more actions `failed` or `skipped`.
2. **Consideration:** The user opens the `_instructions.json` with the "Open instruction fixer"
   command (or the "Open Instruction Fixer" option on the execute-result surface) to inspect what
   each action intended and why it failed — rather than immediately re-running Tomo.
3. **Adoption:** Each action renders as a card showing its `I##`, kind, a human intent line, its
   key fields, and its last-run outcome (failed/skipped first). The user jumps to the affected
   note to see *why* (e.g. no "Maintenance" section exists).
4. **Usage:** For a failed/skipped action, the user corrects the offending target field (e.g. the
   anchor or the target MOC), then re-runs from the editor. The monotonic `applied` flag makes
   re-run idempotent — already-applied actions skip; the repaired one applies.
5. **Retention:** The loop is fast enough that repairing a partial apply becomes routine, and the
   user stops treating a single failed action as a reason to regenerate the whole set.

### Secondary User Journeys

**Inspect before applying (view-only).** The user opens any instruction set — including one never
run — purely to read intent and fields. Viewing is unrestricted and distinct from editing; nothing
unlocks for editing until there is a trusted failed/skipped outcome signal.

## Feature Requirements

### Must Have Features

#### Feature 1: Open the Instruction Fixer (dedicated command + apply-modal option + run-log pointer)
- **User Story:** As a vault owner, I want to open the Instruction Fixer on a set that just failed,
  so that I can see and repair its errors without executing anything else or hunting through the log.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given an active `_instructions.json` (or its `.md` peer), When the user runs the "Open instruction fixer" command, Then the Instruction Fixer opens on that set.
  - [ ] Given an execute run finished with ≥1 failed/skipped action, When the execute-result surface is shown, Then it offers an "Open Instruction Fixer" option (instead of only opening the run log).
  - [ ] Given a run log is produced, When it renders, Then it carries an informational line telling the user errors can be viewed and fixed in the Instruction Fixer (no clickable per-row link).
  - [ ] Given an `_instructions.json` is active, When the user runs "Execute instructions document", Then execution still runs unchanged (the Fixer command does not replace or shadow the executor command).
  - [ ] Given the Fixer is already open, When the user opens another set, Then the existing Fixer leaf is revealed and reused (one active doc).

#### Feature 2: Per-action cards — intent, fields, and last-run outcome
- **User Story:** As a vault owner, I want each action shown as a card with its intent and outcome,
  so that I can see what it should do and why it failed without reading raw JSON.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a loaded set, When the editor renders, Then each action shows its `I##`, kind, a human intent line, and its key fields.
  - [ ] Given a trusted last-run outcome exists for an action, When the card renders, Then it shows that outcome (applied / skipped-* / failed + reason).
  - [ ] Given a mix of outcomes, When the deck renders, Then `failed` and `skipped` actions are ordered first.
  - [ ] Given an action's intent heading contains nested `[[wikilinks]]`, When the card renders the intent, Then it renders the intent as plain text in the editor (no deep-link into the `.md` heading — the origin bug is not reintroduced).

#### Feature 3: Outcome-sourced, fail-closed edit gate (load-bearing)
- **User Story:** As a vault owner, I want editing to unlock only for actions that actually failed
  or were skipped, so that I never accidentally alter an approved action that has no problem.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given an action whose trusted last outcome is `failed` or `skipped`, When its card renders, Then its target field(s) are editable.
  - [ ] Given an action with `applied: true`, When its card renders, Then it is frozen (read-only) with no editable fix-fields.
  - [ ] Given an action that has never been attempted (or there is no trusted outcome signal — missing, stale, or unmappable run log), When its card renders, Then it is read-only and the editor offers to run the set (fail closed).
  - [ ] Given a live in-session run reports `failed`/`skipped-*` for an action, When outcomes refresh, Then that action becomes editable without reopening the editor.

#### Feature 4: Edit a curated set of per-kind fix-fields
- **User Story:** As a vault owner, I want to correct the specific mechanical field that broke an
  action, so that a re-run can succeed.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given an editable (failed/skipped) action, When the user changes a curated fix-field (e.g. an anchor, target, path, or match/replace), Then the change is held in the editor as a pending edit and the Save affordance activates.
  - [ ] Given a pending fix-field edit, When the user saves, Then the edited set is validated against the vendored instruction schema before write, and an invalid edit is rejected with a message rather than written.
  - [ ] Given a saved fix-field edit, When the file is written, Then every field the editor did not touch round-trips verbatim (whole-document ownership; strict schema preserved).
  - [ ] Given an action kind with no curated fix-field, When its card renders, Then its fields are view-only.

#### Feature 5: ~~Skip / disable an action~~ — DESCOPED (see ADR-6, moved to Won't-have)
Removed during design. A "skipped" action is simply `applied: false` (its natural state); an
unfixed action stays unapplied and is not applied on re-run. The Fixer only *fixes* — it never
disables or edits the set at large. This avoids adding a field under the schema's
`additionalProperties: false` and keeps Hashi from authoring/altering action state beyond a target
repair. Heading retained (F6–F8 numbering stable for SDD traceability).

#### Feature 6: Jump to the affected document(s)
- **User Story:** As a vault owner, I want to open the note an action targets, so that I can see
  why it failed (e.g. a missing section).
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given an action card with a target note, When the user clicks the note link, Then the note opens beside the editor.
  - [ ] Given an action card with a target note, When the user hovers the note link, Then Obsidian's page preview appears.
  - [ ] Given a target note that does not resolve, When the card renders the link, Then it degrades to inert "(note not found)" text rather than erroring.

#### Feature 7: Re-run from the editor (idempotent); outcomes refresh
- **User Story:** As a vault owner, I want to re-run the edited set from the editor, so that my
  repair takes effect immediately.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a saved edited set, When the user re-runs from the editor, Then the existing executor runs the set and already-`applied` actions are skipped (monotonic `applied`).
  - [ ] Given a re-run completes, When outcomes refresh, Then each card shows its new outcome in place and a now-applied action becomes frozen.
  - [ ] Given a re-run, When it writes back, Then it uses the existing atomic JSON write path (no second, racing writer).

#### Feature 8: `.md` peer untouched; JSON authoritative
- **User Story:** As a vault owner, I want the human `.md` approval receipt left intact, so that the
  record of what I originally approved is preserved.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given any editor save, When the write completes, Then only the `_instructions.json` channel is written (no `.md` content re-render, no annotation).
  - [ ] Given a re-run applies an action, When the peer checkbox is synced, Then only the `- [x] Applied` line is ticked (the shipped `peerCheckboxSync` behaviour) and the `.md` `tomo.sources` frontmatter block is never modified.
  - [ ] Given a repaired-and-re-run set, When the user compares `.md` and `.json`, Then the `.md` may describe the original failed form while the JSON carries the repaired one, and the JSON is authoritative for what Hashi executes.

### Should Have Features
- **Soft "anchor not found" hint.** When the user edits a fix-field that names an anchor/section,
  the editor may surface a non-blocking hint if the anchor is not found in the target note
  (schema-shape validation still gates save; the hint is advisory only). Derived locally,
  off the main thread.

### Could Have Features
- **Source-doc attribution per card.** Surface which approved source doc produced each action
  (from Tomo provenance) as a read-only detail, to help the user judge a repair.

### Won't Have (This Phase)
- Free-form JSON editing of arbitrary fields (a raw editor is a separate, riskier mode).
- Adding, removing, or reordering actions — Hashi never authors actions; v1 repairs the target
  fields of existing ones only.
- Any Tomo re-ingestion of the edited set — the instruction set is terminal on the Hashi side.
- Cross-set / batch editing across multiple instruction files (v1 scopes one set per view).
- Editing the human `.md` peer content or its `tomo.sources` frontmatter block.
- A `schema_version` bump or any schema change — repairs edit existing target fields within the
  current wire.
- **Skip/disable an action** (ex-Feature 5, ADR-6) — no "do not run" marker; an unfixed action is
  just `applied: false` and is re-attempted harmlessly on re-run until fixed or the set is discarded.

## Detailed Feature Specifications

### Feature: Outcome-sourced, fail-closed edit gate (Feature 3 — the most complex)
**Description:** The edit gate decides, per action, whether the user may repair it. Because there
is no durable per-action outcome store, the gate must fail closed unless it has a trustworthy
signal that the action's last outcome was `failed` or `skipped`.

**User Flow:**
1. User opens an instruction set.
2. System determines, per action, whether a trusted last outcome exists (in-session run summary,
   or a confidently source-matched most-recent run log). `applied: true` → frozen.
3. System renders failed/skipped actions as editable and everything else as read-only; when no
   trusted signal exists at all, it offers to run the set.
4. User optionally runs the set; outcomes refresh and the gate re-evaluates.

**Business Rules:**
- Rule 1: `applied: true` ⇒ read-only (nothing to repair). Guaranteed by monotonic `applied`.
- Rule 2: trusted last outcome `failed` or `skipped-*` for that exact `I##` ⇒ editable.
- Rule 3: never-attempted, or no trusted outcome signal (missing/stale/unmappable) ⇒ read-only +
  offer to run (fail closed).
- Rule 4: viewing is always allowed and is a distinct capability from editing.

**Edge Cases:**
- No run log exists (clean run under `only-after-failed` retention wrote none) → Expected: whole
  set read-only, offer to run; do not guess from bare `applied:false`.
- A run log exists but its source paths don't confidently match this set → Expected: treat as no
  trusted signal (fail closed), do not map outcomes optimistically.
- `applied:false` with no run this session → Expected: read-only (ambiguous between failed,
  skipped, and never-run — the JSON alone cannot say).
- User edits a fix-field, then the action applies on re-run → Expected: card freezes; further
  edits blocked.

## Success Metrics

### Key Performance Indicators
Local, single-user plugin — success is functional correctness and safety, not adoption analytics.
- **Adoption:** The user repairs at least one failed action in the editor instead of re-running
  Tomo (qualitative; the loop is used at all).
- **Engagement:** A partial-apply is resolved end-to-end within the editor (fix → re-run → all
  actions applied or left unapplied) without a Tomo round-trip.
- **Quality:** Zero instances of the editor writing an action that was not failed/skipped
  (fail-closed holds); zero `.md` content/`tomo.sources` mutations; 100% verbatim round-trip of
  untouched fields (re-save re-validates clean). Test-enforced.
- **Business Impact:** Fewer full Tomo regenerations triggered by single mechanical failures.

### Tracking Requirements
No telemetry (Constitution L1 — local-first, no analytics). "Tracking" is the local run log +
test assertions, not event collection.

| Event | Properties | Purpose |
|-------|------------|---------|
| Action edited in editor | `I##`, kind, target field changed (metadata only) | Local run-log / test verification that only failed/skipped actions were edited |
| Re-run from editor | source path, per-`I##` outcome | Verify idempotency (applied actions skip) and outcome refresh |

---

## Constraints and Assumptions

### Constraints
- **Constitution L1 (Privacy):** local-first, no telemetry; audit/log metadata only, never note
  content. Main-thread responsiveness (derive hints off-thread).
- **ADR-027 boundaries:** edit unlocks only for attempted-but-not-applied actions (fail closed);
  `.md` peer untouched; Hashi never authors actions; no `schema_version` bump.
- **Tomo contract:** never alter the `.md` frontmatter `tomo.sources` block; validate against the
  vendored `instructions.schema.json` (`additionalProperties:false`, strict).
- **Reuse:** build on the spec-005 garden-audit editor infrastructure (now on main) and the
  existing instruction wire/validator/executor.

### Assumptions
- Instruction `I##` ids are Tomo-assigned and stable across a user edit (edits don't renumber).
- Tomo does not re-read the instruction `.json` after emit (verified — Tomo confirm #2 = NO), so a
  Hashi edit is invisible and safe to it.
- No integrity check exists over the instruction `.json` (verified — Tomo confirm #3 = NONE), so an
  edit invalidates nothing and needs no re-stamp.
- The user runs on desktop (Hashi is `isDesktopOnly`).

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Editor unlocks an action that wasn't failed/skipped (alters an approved action) | High | Low | Fail-closed gate (Feature 3); read-only unless a trusted failed/skipped signal; test both authorize and reject paths (Constitution Testing L1). |
| No trusted outcome signal misread as "editable" | High | Low | Bare `applied:false` never unlocks; require in-session summary or confidently-matched run log; else offer to run. |
| Verbatim round-trip drops a field → strict re-validation fails | Medium | Low | Whole-document ownership adapter (spec-005 pattern); re-save re-validates; test an unedited load→save round-trip. |
| Command collision: opening vs executing `_instructions.json` confuses the user | Low | Low | Resolved (ADR-3): a dedicated "Open instruction fixer" command + apply-modal option; "Execute" untouched; no click-to-open. |
| Racing the executor's applied-flush with a second writer | Medium | Low | Reuse the single atomic `processJSON` write path; no second writer (ADR-9). |

## Open Questions
_All three forks resolved in the SDD (design phase, 2026-07-26):_
- [x] **Entry points (ADR-3):** dedicated "Open instruction fixer" command + an "Open Instruction
  Fixer" option on the execute-result surface + an informational pointer line in the run log. No
  click-to-open; "Execute instructions document" untouched.
- [x] **Skip/disable (ADR-6):** descoped — a skipped action is just `applied: false`; no schema
  change, no new field.
- [x] **Per-kind fix-field roster (ADR-5):** the target fields on 7 repair kinds (`link_to_moc`,
  `insert_under_marker`, `replace_section`, `add_relationship`, `edit_note_text`, `remove_up_link`,
  `resolve_dead_link`); all other kinds view-only.

---

## Supporting Research

### Competitive Analysis
N/A — internal MiYo capability with no external competitor. The nearest prior art is Hashi's own
spec-005 garden-audit editor and spec-004 suggestions editor; this reuses their architecture.

### User Research
Evidence-driven from a real run-log deep-link bug (nested `[[]]` in enriched instruction headings)
and the user's realization that the broken deep-link was a proxy for "show me intent + outcome and
let me act." Formalized through the charter → Kokoro ADR-027 → Tomo's four cross-repo confirms.

### Market Data
N/A — single-user local-first PKM tooling.
