# Charter — Instruction-Set Editor (Track 2)

> Status: **Draft charter** (2026-07-25). Seeds a Kokoro ADR (amends Hashi charter ADR-009)
> + a Hashi XDD spec. Not yet approved. Authored from the garden-audit-editor session.

## One-liner

Extend the Tomo editor to **open an `_instructions.json` set**, show each action's **intent +
last-run outcome inline**, let the user **fix small problems and re-run** — closing the
review → apply → fix → re-apply loop **without pulling Tomo back in**.

## Motivation

Surfaced from a run-log bug: the log deep-linked each `I##` row to the instruction `.md`
heading, and Tomo's enriched headings (`### I01 — Repoint dead link [[X]] in [[Y]]`) made the
`#anchor` unparseable (nested `[[]]`). The deeper realization (user): the deep-link was a proxy
for *"let me see what this action should do and why it failed, and get to the doc that produced
the error."* The real answer isn't a better link into a machine-output `.md` — it's a **surface
that shows intent + outcome and lets you act**. Today, fixing a single failed action (e.g. I07
`anchor not found: Maintenance`) means going back to Tomo for a full re-run.

## v1 vision — the core flow

1. Author runs `/execute`; some actions fail or are skipped (or they want to inspect before applying).
2. **Open the `_instructions.json` in the instruction editor** ("Open Tomo editor" dispatches by
   the `_instructions` suffix — ADR-6 extension).
3. Each action renders as a **card**: `I##`, kind, a human **intent** line (the summary Hashi
   already builds in `planner.buildSummary`), its key fields, and the **last-run outcome**
   (applied / skipped-* / failed + error reason). Failed first.
4. Author **jumps to the affected document(s)** per card (open-beside + hover — reuse
   `noteNavigation`), to see *why* (e.g. `@.md` has no "Maintenance" section).
5. Author **fixes small problems**: correct a fix-field (anchor, target, replace, …) or
   **skip/disable** an action — validated against the vendored per-kind schema.
6. Author **re-runs** (re-execute the edited set). The executor's monotonic `applied`
   (false→true only) makes this idempotent — already-applied actions skip, the fixed one applies.
   Outcomes refresh in place.

## Why it's feasible (the fundament already exists)

- **Hashi already mutates the instruction set**: `jsonAppliedWriter.ts` writes `applied:true` into
  the JSON, `peerCheckboxSync.ts` ticks the `.md` peer checkbox. Editing other fields extends this
  existing write path — it is *not* a new boundary crossing.
- **Re-run safety exists**: `applied` is monotonic (schema: "Hashi only writes false→true; Tomo
  never re-emits true"). A re-run of an edited set applies only the not-yet-applied/edited actions.
- **Discovery + execute exist**: `execute-instructions-document` already finds `*_instructions.json`
  and runs them; the executor + its state store + run log already produce per-action outcomes.
- **Editor infrastructure exists** (spec-005 / spec-004): `tabContract`, `Store<{doc,dirty}>`, the
  `ObsidianXDoc` adapter pattern (load→validate→{doc,dirty}, verbatim write), card rendering,
  `noteNavigation` (open-beside/hover), the dirty/Save affordance, ConfirmModal, `hashi-se-*` CSS.
  An instruction set is a new `doc_type` slotting into the same machinery.

## Scope

### In (v1)
- Instruction-editor view + `_instructions.*` suffix dispatch (parallel view, mirrors ADR-1).
- Per-action cards: intent line + fields + **last-run outcome** (source: read the run log for
  this set, or run/dry-run live — see OQ2).
- Jump-to-affected-document (open-beside + hover), per card.
- **Skip/disable** an action (a minimal, safe edit — mark it not-to-run).
- **Edit a constrained set of per-kind "fix fields"** (e.g. `anchor` for link_to_moc /
  insert_under_marker; `target`/`replace` for resolve_dead_link; `marker`/`line` for
  add_relationship), each validated against the vendored schema before write.
- **Re-run** from the editor (invoke the existing executor); outcomes refresh.
- Verbatim round-trip of untouched fields (own-the-whole-document, like the garden-audit adapter).

### Out (v1 — later / won't)
- Free-form JSON editing of arbitrary fields (a raw editor is a separate, riskier mode).
- Adding/removing/reordering actions (v1 edits or skips existing ones only).
- Any Tomo re-ingestion of the edited set — the instruction set is terminal on the Hashi side.
- Cross-set editing / batch fix across multiple instruction files.
- Editing the human `.md` peer (Hashi writes only the JSON channel + the `applied` checkbox tick).

## Reuse map (from spec-005 garden-audit editor)
| Need | Reuse |
|------|-------|
| View + suffix dispatch | ADR-1 parallel view + ADR-6 one-command-by-suffix |
| Load/validate/verbatim-write adapter | `ObsidianGardenAuditDoc` pattern (ADR-2) |
| Whole-doc model + pure transforms + dirty | `Store<{doc,dirty}>` + `transforms.ts` idiom |
| Cards, note links, open-beside/hover | `GardenAuditTab` cards + `noteNavigation` |
| Field-edit auto-select / validation | `TargetControl` + per-kind validation against `instructions.schema.json` |
| Re-run | existing `InstructionExecutor` + `jsonAppliedWriter` + run log |

## Key decisions to make (ADR seeds)
- **ADR-A — dispatch:** `_instructions.*` opens the instruction editor via "Open Tomo editor"
  (today that suffix routes to `execute`). Keep `/execute` as the run path; the editor adds
  a *review + fix + run* surface. Decide: does opening auto-load the last run's outcomes?
- **ADR-B — outcome source:** read the last run log (`tomo-hashi-run-log_*.md`) and map by `I##`,
  vs. run a live (dry?) execution to populate outcomes. Run log = no side effects but may be stale;
  live run = fresh but executes. Likely: show last-known from the log, "Run" refreshes.
- **ADR-C — editable surface:** a curated per-kind fix-field set (safe, validated) vs. broader
  editing. v1 = curated + skip/disable.
- **ADR-D — state/contract:** the instruction set's `tomo.state` (`pending-apply`) + the source
  `checksum` in frontmatter are Tomo-authored. Editing the JSON must not violate what Tomo keys on.
  Since Hashi already writes `applied`, the precedent is set — but a *field edit* (changing an
  action's semantics) is new. Needs Tomo confirm (see cross-repo).

## Cross-repo contract (Kokoro ADR + Tomo handoff)
- **Kokoro:** amends Hashi charter ADR-009 (Hashi executes Tomo's instruction sets) to include
  *review + constrained edit + re-run* of instruction sets. → a Kokoro ADR.
- **Tomo handoff — confirm:** (1) Is Hashi editing an action's fix-fields (beyond the existing
  `applied` write) acceptable, or does Tomo expect its instruction output immutable? (2) Does any
  Tomo triage re-read a `pending-apply`/applied instruction set (→ would a Hashi edit confuse it)?
  (3) The frontmatter `checksum` is over the *source* wire, not the instruction set — confirm no
  integrity check over the instruction JSON that a Hashi edit would break. (4) Should instruction
  headings carry a machine-stable anchor (e.g. `^I01` block-ref) if we ever want to deep-link —
  or is intent-in-the-editor enough (then Tomo's rich headings stay, no change needed)?

## Open questions
- **OQ1** — Does opening the editor auto-run, or show last-log outcomes until the user hits Run?
- **OQ2** — Outcome mapping robustness: the run log maps by `I##`; if the user edits + the set
  changes, keep `I##` stable (they do — ids are Tomo-assigned, edits don't renumber).
- **OQ3** — Validation depth on a fix-field edit: schema-shape only, or semantic (e.g. does the
  new anchor exist in the target note)? v1 = schema-shape + optional soft "anchor not found" hint.
- **OQ4** — Multi-source runs: a run can span several instruction files; v1 scope one set per view.

## Path to formalization
1. This charter → **Kokoro ADR** (via handoff `_outbox/for-kokoro/…`) amending ADR-009.
2. **Tomo handoff** with the four cross-repo confirms above.
3. On answers: `tcs-workflow:xdd` scaffolds `docs/XDD/specs/006-instruction-editor/` → PRD → SDD
   (ADR-A..D) → PLAN, on a fresh `feat/instruction-editor` branch.
