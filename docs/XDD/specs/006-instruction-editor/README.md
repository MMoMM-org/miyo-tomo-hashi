# Specification: 006-instruction-editor

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-07-26 |
| **Current Phase** | Implemented |
| **Last Updated** | 2026-07-27 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | 7 active Must-have features (F5 descoped), 26 Gherkin ACs, 0 clarification markers, 0 open questions |
| solution.md | completed | ADR-1..9 all confirmed; parallel `InstructionFixerView` reusing spec-005 infra; fail-closed outcome-sourced gate; target-fields-only edit; no schema change; constitution self-check passed |
| plan/ | completed | 5 phases, 15 deliverable tasks (TDD), 4 parallel; full F→task traceability; validated (2 agents) — alignment PASS on all 8 code claims |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-26 | Spec 006 created for the Instruction-Set Editor (Track 2) | Charter `docs/design/instruction-editor-charter.md` accepted by Kokoro as **ADR-027** (amends ADR-009 §3 + architecture §6.8); all four Tomo cross-repo confirms answered. Fully unblocked. |
| 2026-07-26 | **Framing (ADR-027, load-bearing): a repair bench, not an editing surface.** | "Repair bench for Hashi's own failed mechanical work, not an editing surface over Tomo's output. The user approved an *intent*; execution failed on a mechanical detail; the repair restores the approved intent rather than introducing a new one." This framing must carry into PRD/SDD — it is what makes the capability defensible. |
| 2026-07-26 | **Tightening ① — edit unlocks ONLY for attempted-but-not-applied actions** (ADR-027 amends charter's "failed/skipped or inspect before applying") | Editable iff last outcome is `failed`/`skipped`. `applied:true` = frozen (monotonic `applied` already guarantees it, no new check). Never-attempted = not editable. **No trustworthy outcome signal (missing/stale/unmappable run log) = fail closed** — render read-only + offer to run. **Viewing is unrestricted and a distinct capability from editing** (open/render any set at any time incl. pre-run). Consequence: ADR-B outcome-sourcing is promoted from UX nicety to **load-bearing input**; the fail-closed rule keeps it safe. |
| 2026-07-26 | **Tightening ② — `.md` peer left untouched; JSON authoritative post-repair** (ADR-027) | Write ONLY the JSON channel; no re-render, no annotation. The existing `[x] Applied` tick via `peerCheckboxSync` continues (ADR-018 behaviour, not removed). `_instructions.md` is the **approval receipt** — re-rendering it would erase the record of what was approved. Accepted consequence: post-repair the `.md` describes the original failed form while the JSON carries the repaired one; **the JSON is authoritative for what Hashi executes**. Deliberately asymmetric with ADR-026 (whose `.md` is a live Tomo round-trip surface). |
| 2026-07-26 | **Confirmed as-proposed (ADR-027): Hashi never authors actions** | Curated per-kind fix-fields + skip/disable only — no add/remove/reorder, no free-form JSON. Promoted to a **charter-level** line: it is what keeps Hashi an executor. Reuse map/dispatch/re-run all Hashi's; monotonic `applied` gives re-run idempotency for free. Mechanism (outcome sourcing, validation depth, rendering) is Hashi's per ADR-026 §0. **No `schema_version` bump** — repair edits existing fields within the current wire. |
| 2026-07-26 | **Tomo confirms answered (all four)** | #1 constrained edit + re-run is Hashi's domain — validate against vendored `hashi-instructions.schema.json`, treat set immutable-except-Hashi-owned-writes. #2 **NO** — Tomo does not re-read pending/applied instruction sets → **resolves ADR-027's only contingency; Decision ② is a free trade**. ⚠️ Caveat: never alter the `.md` frontmatter `tomo.sources` block (the one thing Tomo reads). #3 **NONE** — no integrity check over the instruction `.json`; edits invalidate nothing, no re-stamp; `action_count` not re-validated post-emit. #4 **(b)** — drop deep-linking into headings, surface intent in the editor; Tomo's rich headings stay, no Tomo change. |
| 2026-07-26 | Branch `feat/instruction-editor` updated onto released main (0.18.0) | Merged `origin/main` (garden-audit editor infra spec-006 reuses). Verified clean: `npm run build` green, 129 test files / 1966 tests pass. |
| 2026-07-26 | Research (Light/Standard): reuse-surface + executor/run-log agents | Two focused Explore agents. Findings drive the SDD; key results below (accelerator + three forks). |
| 2026-07-26 | **Accelerator: reuse the EXISTING instruction wire** (`src/schema/`) | `instructions.schema.json` (`schema_version:"2"`, `additionalProperties:false`), `types.ts` (`InstructionSet` + 14-variant `Action` union, discriminant `action`, ids `I##`), and `validator.ts` (`validate`/`validateInstructionSet`) already exist and match the adapter contract. spec-006 reuses them as-is — no new wire, no `schema_version` bump (ADR-027). New `InstructionSetDoc` port mirrors `GardenAuditDoc`; adapter plugs onto `validate`. Verbatim round-trip is mandatory (strict `additionalProperties:false`). |
| 2026-07-26 | **Fork ①: command collision — `_instructions.json` already owned by Execute** | `execute-instructions-document` / "Execute instructions document" claims the suffix via `resolveActiveInvocation`. "Open Tomo editor" must add a 3rd suffix branch (`dispatchOpenSuggestionsEditor` + merged picker list). Two commands over one file (open-to-repair vs. execute). No garden-audit precedent → SDD ADR. |
| 2026-07-26 | **Fork ②: doc model does not transfer — define editable-per-kind + skip/disable** | Garden-audit findings carry a tidy editable `decision` block; instructions are a 14-kind union with per-variant fields, **no `decision`/`selected`/`tier`**. "Editable" = curated per-kind fix-fields. **Skip/disable has no existing field** and `additionalProperties:false` blocks an undeclared field → SDD decides: reuse an existing mechanism vs. add one additive optional Hashi-owned field within schema_v2 (no bump). Tomo #3 (no integrity check, JSON never re-read) makes an additive field safe if chosen. |
| 2026-07-26 | **Fork ③: fail-closed is concrete — no durable outcome store** | Only durable per-action signal is binary `applied` (monotonic false→true); `failed`/`skipped-dependency`/`skipped-cancelled`/never-run **all collapse to `applied:false`**. Rich `ActionOutcome` (6 states incl. `pending`) lives only in-memory (`executionStore`) during a run or in a transient `tomo-hashi-run-log_YYYY-MM-DDTHHMM.md` (table `\| I## \| kind \| summary \| outcome \| error \|`) that may not exist (clean run under `only-after-failed` writes none). Edit unlocks ONLY on a trusted `failed`/`skipped-*` for that exact `I##` (in-session summary or source-matched newest run-log); bare `applied:false` = no trustworthy signal → read-only + offer Run. |
| 2026-07-26 | **Write path + boundary confirms (from research)** | `jsonAppliedWriter.processJSON` is the atomic, per-path-serialized fix-field write extension point — the editor reuses it (or a sibling in that module), not a second writer, to avoid racing the executor's applied flush. `peerCheckboxSync` writes ONLY the `- [x] Applied` line (never frontmatter/content) — confirms Decision ②. Correction: `TargetControl` does NOT per-field-validate (validation is once at adapter `load`); spec validates schema-shape at save. `noteNavigation` + `HOVER_LINK_SOURCE="miyo-tomo-hashi"` transfer verbatim. |
| 2026-07-26 | **PRD approved (user)** — continue to SDD | 8 Must-have features, 30 Gherkin ACs, 0 clarification markers. F3 (fail-closed edit gate) is the load-bearing feature; F8 locks the `.md`-untouched / JSON-authoritative boundary. 3 open forks handed to SDD. |
| 2026-07-26 | **The feature is an "Instruction Fixer", not a full editor** (user, design phase) | Reframed via dialogue. It only *fixes* failed actions so they can re-run — it never edits/disables the set at large. Named **Instruction Fixer**. |
| 2026-07-26 | **ADR-3: entry via command + apply-modal option + run-log pointer; NOT click-to-open** (user a/b/c/d) | (a) "Open Instruction Fixer" option on the execute-result surface instead of opening the log; (b) an informational pointer line in the run log; (c) an "Open instruction fixer" command. (d) the Fixer shows ALL failed actions, not a clicked one. No `obsidian://` handler, no click-on-row. Sidesteps the `_instructions.json` command collision entirely; "Execute" untouched. |
| 2026-07-26 | **ADR-5: editable surface = target fields on 7 repair kinds** (user) | Mechanical failure = "what the action points at isn't there" → repoint the target. `link_to_moc`, `insert_under_marker`, `replace_section`, `add_relationship`, `edit_note_text`, `remove_up_link`, `resolve_dead_link`. All other kinds view-only. Validated schema-shape at Save; verbatim round-trip (strict `additionalProperties:false`). |
| 2026-07-26 | **ADR-6: no skip/disable; no schema change** (user) | A skipped action is just `applied:false`; unfixed actions stay unapplied and re-attempt harmlessly. Dissolves the additive-field question → zero schema touch (Fork ② resolved without editing the schema). PRD Feature 5 descoped. |
| 2026-07-26 | **ADR-8: run-log `I##` deep-link dropped → plain text; add Fixer pointer line** (user) | The malformed nested-`[[]]` deep-link (the origin bug) is removed (Tomo confirm #4 = (b)); log otherwise unchanged. |
| 2026-07-26 | **SDD complete — ADR-1..9 confirmed; constitution self-check passed** | Parallel `InstructionFixerView` reusing spec-005 infra (adapter/transforms/noteNavigation verbatim; `TargetControl` generalized off `FindingCheck`); outcome-sourced fail-closed gate (in-session `executionStore` summary \| source-matched newest run-log \| else read-only + offer run); re-run via existing `InstructionExecutor` + atomic `processJSON`. No external surface; local-only; no new deps. |
| 2026-07-26 | **PLAN complete + validated** (user approved SDD → PLAN) | 5 TDD phases, 15 deliverable tasks (4 parallel): (1) data spine — port/adapter/`markActionFields`/transforms; (2) outcome source + fail-closed gate; (3) Fixer view — cards/gate/re-run; (4) entry points + run-log change; (5) integration/E2E + full-suite gate. Two validation agents: cross-doc consistency (found + fixed an incomplete F5-scrub + stale AC count) and plan↔code alignment (**PASS on all 8 code claims** — renderIdCell bug present, jsonAppliedWriter/executionStore/ActionOutcome shapes, all 7 repair kinds' field names exact; 2 doc fixes: `TargetControl` needs generalization not verbatim reuse, Store path is `util/store.ts`). All findings resolved. |

| 2026-07-27 | **Implementation complete** | Instruction Fixer shipped on `feat/instruction-editor` (5 phases, 18 tasks). Build + lint clean; **140 test files / 2308 tests**; bundle **870.9 KB** under the 900 KB ceiling raised at T3.1 (spec-001 CON-7 ≤1000 KB unaffected). New: `src/vault/InstructionSetDoc.ts`, `src/instruction-fixer/{ObsidianInstructionSetDoc,transforms}.ts`, `src/ui/instruction-fixer/{InstructionFixerView,openInstructionFixer,fixerContract,index,outcomeSource,sections,renderFixerBody}.ts` + `cards/{renderActionCard,targetFields}.ts`; `markActionFields` added to `executor/jsonAppliedWriter.ts`; `TargetControl` generalized off `FindingCheck` (garden-audit's 149 tests unmodified). Run-log `I##` deep-link removed — **the origin bug**. Entry: command + execute-result option + log pointer. Docs: new `docs/instruction-fixer.md` + 4 updates. **No schema change, no `schema_version` bump** (ADR-6). |

## Follow-ups (non-blocking)

- **`docs/run-log.md`'s "Structure" example block is stale** (found by the T5.3 doc-accuracy
  review; **pre-dates spec-006**, only its H1 was touched here). The example shows a
  frontmatter-free "Field | Value" table, a `## Counts` section, an `## Actions` heading, and
  glyph outcomes in Title-Case columns. `runLog.ts` actually emits YAML frontmatter
  (`started:`/`ended:`/`totals:`), then one `## <sourcePath>` section per source with a lowercase
  `| I## | kind | summary | outcome | error |` table and textual outcome strings.
  Spec-006 made this more visible rather than causing it: `docs/instruction-fixer.md` now
  cross-links `run-log.md` as "the outcome table the Fixer parses", so a reader following that
  link lands on an example that doesn't match reality. Worth its own small doc fix.

- **Report back to Kokoro:** Tomo confirm #2 = **NO** → ADR-027 Decision ④ (`.md` untouched) divergence is a free trade; Kokoro asked to reconcile ADR-027 §"Open" on this answer. Send a short `_outbox/for-kokoro/` handoff.

## Open Questions (from charter — resolve in SDD)

| # | Question | Proposed resolution |
|---|----------|---------------------|
| OQ1 | Does opening the editor auto-run, or show last-log outcomes until the user hits Run? | Auto-load last-run outcomes (read-only until an edit); "Run" refreshes. Aligns with ADR-B (run log = no side effects). |
| OQ2 | Outcome mapping robustness: run log maps by `I##`; do edits renumber ids? | Ids are Tomo-assigned; edits don't renumber. Keep `I##` stable as the join key. |
| OQ3 | Validation depth on a fix-field edit: schema-shape only, or semantic? | v1 = schema-shape (vendored per-kind schema) + optional soft "anchor not found" hint. Mechanism is Hashi's (ADR-026 §0). |
| OQ4 | Multi-source runs: a run can span several instruction files. | v1 scopes one set per view. |
| OQ5 | **Command collision:** `_instructions.json` is already owned by "Execute instructions document". How do open-to-repair and execute coexist? | Add a 3rd suffix branch to "Open Tomo editor" dispatch; both commands act on the same file with distinct verbs. Execute stays the run path; the editor adds review+fix+run. Confirm with user in SDD (ADR-A refined). |
| OQ6 | **Skip/disable representation:** no `selected`/disable field exists and the schema is `additionalProperties:false`. | SDD decides: (a) reuse an existing mechanism, or (b) add one additive optional Hashi-owned field (e.g. `disabled`) declared in schema_v2 — no `schema_version` bump; safe because Tomo never re-reads the instruction JSON (#3). Executor must honour it (skip disabled actions on re-run). |
| OQ7 | **Editable-per-kind surface:** which of the 14 action kinds get curated fix-fields, and which fields? | Prioritize the kinds whose mechanical failure is user-fixable (anchor/target/path/match/replace) — e.g. `link_to_moc.anchor`, `insert_under_marker.anchor`, `resolve_dead_link.target`/`replace`, `edit_note_text.match`/`replace`, `add_relationship.marker`/`line`. Enumerate in SDD; all others view-only + skip/disable. |

## Context

**What:** A review-and-repair surface over a Tomo `_instructions.json` set. After `/execute`,
some actions fail or are skipped; today, fixing one failed action means a full Tomo re-run. The
instruction editor lets the author see each action's **intent + last-run outcome inline**, **fix
small mechanical problems** (a curated per-kind fix-field, or skip/disable), and **re-run** —
closing the review → apply → fix → re-apply loop **without pulling Tomo back in**.

**Framing (load-bearing, from ADR-027):** this is a **repair bench for Hashi's own failed
mechanical work**, not an editing surface over Tomo's output. The user approved an *intent*;
execution failed on a mechanical detail; the repair **restores the approved intent** rather than
introducing a new one. This is why the two boundaries below are charter-level, not v1 convenience.

**Contract source of truth:**
- Kokoro **ADR-027** (`global/decisions/ADR-027-hashi-instruction-editor.md`) — amends ADR-009 §3
  + architecture §6.8. Inbox: `_inbox/from-kokoro/2026-07-25_kokoro-to-hashi_instruction-editor-accepted.md`.
- Tomo confirms — `_inbox/from-tomo/2026-07-25_tomo-to-hashi_instruction-editor-contract-confirms-answered.md`.
- Charter — `docs/design/instruction-editor-charter.md` @ `feat/instruction-editor`.
- Wire schema — vendored `hashi-instructions.schema.json` (validate edits against it).

**Two charter-level boundaries (ADR-027):**
1. **Edit unlocks only for attempted-but-not-applied actions** (last outcome `failed`/`skipped`);
   `applied:true` frozen; never-attempted = no; **no trustworthy outcome signal = fail closed**
   (read-only + offer to run). Viewing is unrestricted and distinct from editing. → outcome
   sourcing (ADR-B) is **load-bearing**.
2. **`.md` peer untouched; JSON authoritative post-repair.** Write only the JSON channel; the
   `[x] Applied` tick via `peerCheckboxSync` stays. Never touch the `.md` `tomo.sources` block
   (Tomo reads it).

**Reuse (from spec-005 garden-audit editor, now on main):** parallel view + suffix dispatch
(ADR-1/ADR-6), `ObsidianGardenAuditDoc` load/validate/verbatim-write adapter pattern (ADR-2),
`Store<{doc,dirty}>` + pure `transforms.ts`, `GardenAuditTab` cards + `noteNavigation`
(open-beside/hover), `TargetControl` field-edit + per-kind Ajv validation, the existing
`InstructionExecutor` + `jsonAppliedWriter` + run log for re-run.

**Related:** ADR-009 (Hashi charter), ADR-018 (trash-on-completion), ADR-025 §4 (Hashi owns the
instruction-set schema), ADR-026 (Pass-1 suggestions editor precedent + §0 mechanism principle),
spec-002 (instruction executor), spec-005 (garden-audit editor — reused infra).

---
*This file is managed by the xdd-meta skill.*
