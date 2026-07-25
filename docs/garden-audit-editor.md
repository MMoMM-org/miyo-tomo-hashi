# Garden-Audit Editor

The Garden-Audit Editor is a structured review surface for the `_garden-audit.json`
documents Tomo publishes after a `/garden-audit` vault scan — dead links, broken
`up::` parents, orphaned notes, stale MOCs, and duplicate stems. It's a parallel
view to the [Suggestions Editor](suggestions-editor.md): both open through the same
**Open Tomo editor** command, dispatched by filename suffix, and both use the same
"Save is the approve" model.

> Screenshots pending.

## Opening it

Run **Open Tomo editor** from the command palette (`Ctrl/Cmd+P`):

| Active file | Behaviour |
|---|---|
| A `_garden-audit.json` (or its `.md` peer) | Opens that run directly |
| A `_suggestions.json` (or its `.md` peer) | Opens the [Suggestions Editor](suggestions-editor.md) instead |
| Anything else (or nothing) | Opens a picker over every garden-audit and suggestions run in the vault |
| No Tomo run exists anywhere | Shows *"No Tomo runs found — open a `_suggestions.json` or `_garden-audit.json` (or its .md) first"* |

The editor is a **singleton leaf** — reopening it retargets the existing leaf to the
newly resolved run rather than spawning a duplicate.

## Tier sections

Findings render in three tier sections, in wire order within each tier:

| Tier | Checks | Fixable? |
|---|---|---|
| **Integrity** | `broken_up`, `dead_link` | Yes |
| **Structure** | `unparented`, `orphan` | Yes |
| **Advisory** | `duplicate_stem`, `stale_moc` | No — read-only |

Each tier header shows a live count. For the Integrity and Structure tiers, that's
an **"X of Y" apply-progress** meter — **Y** is the number of fixable findings in
the tier, **X** is how many are currently set to Apply. Findings arrive **unselected**
(Apply is opt-in), so X starts at 0 and rises as you review. The Advisory tier has
nothing actionable, so it shows a plain count instead.

## Fixable cards (Integrity / Structure)

Each fixable finding — `broken_up`, `dead_link`, `unparented`, `orphan` — renders an
interactive card:

- **Apply / Skip** toggle.
- **Target control** — a text input that accepts a bare stem or a `[[wikilink]]`
  (including a note that doesn't exist yet), a vault-note **picker** button, and a
  first-class **empty** state. What empty means depends on the check, shown as a
  caption with a hover tooltip:

  | Check | Empty target means |
  |---|---|
  | `dead_link` | **Unlink** — strips the `[[ ]]` brackets but keeps the display text, at every occurrence. |
  | `broken_up` | **Remove** — removes just the broken link from the `up::` line. If it was the only link, `up::` is left empty; the field itself is kept, never deleted. |
  | `unparented` / `orphan` | **Fallback** — Tomo files the note under the first scan candidate, or skips the finding if there is none. |

- **Candidate chips** beneath the target field — scored suggestions from Tomo's LLM
  pass (`decision.candidates`) and, for orphan/unparented findings, a separate row of
  scan candidates. Clicking a chip writes its stem into the target field and
  **auto-selects Apply** — candidates are never applied automatically; the explicit
  target always wins, and the chip matching the committed target is highlighted.
- **Committing a target** — typed, picked, or via a chip — on a currently-**skipped**
  finding auto-selects Apply, since setting a target expresses intent to apply it.
- **"No scan candidate"** hint — on an orphan/unparented card with no scan candidate,
  a note states plainly that an empty target has no fallback there.
- **Suggest targets** toggle — flags a finding for LLM enrichment. This is a two-run
  flow:
  - Requested but not yet run → a **pending** hint: *run `/garden-audit --suggest` in
    Tomo, then reopen*.
  - `--suggest` ran and found nothing → a distinct **"no suggestions found"** note.
- **Dead-link context** — `dead_link` cards show the surrounding body context inline
  (the occurrence line plus its nearest heading), read locally from the note, so you
  can judge the link without opening it.
- **Note navigation** — clicking a finding's affected-note title opens the note
  **beside** the editor (a split, not replacing it); hovering it shows Obsidian's
  native page hover-preview.

## Advisory cards

`duplicate_stem` and `stale_moc` findings render as strictly **read-only**, dimmed
cards — they show their detail (colliding paths for duplicates, last-modified for
stale MOCs), and only the affected-note link is interactive. There is no Apply
toggle, target control, candidate chips, or Suggest toggle on these cards.

## The two-run suggest flow

A banner at the top of the editor reflects the state of any pending or completed
suggest requests:

- **Pending** — while at least one finding is awaiting `--suggest`, the banner says
  suggestions were requested and to run `/garden-audit --suggest` in Tomo, then
  reopen. It also warns that saving now **parks** the run — it won't be applied until
  suggestions are generated.
- **Generated** — once `--suggest` has run, the banner reports how many findings got
  new suggestions and that they're **highlighted** below (an accent border and a
  "New" badge). Review them, then Save.

## Saving — Save is the approve

**Save** writes the edited wire back to `_garden-audit.json` and, in the normal case,
marks the run **approved** for `/inbox`:

- The wire is written **verbatim** — the change-signal Tomo reads is carried
  unchanged, never recomputed.
- If a **Suggest is still pending** on any finding, Save **parks** the run instead of
  approving it, so Tomo's `/inbox` won't apply a half-finished review before
  `--suggest` completes.

An **Edited** badge appears once the model is dirty; **Revert** reloads from disk and
discards in-memory edits. After saving, run `/inbox` in Tomo — Pass 2 builds an
instruction set from the approved run, and the instruction executor applies it.

## Errors and empty states

- A malformed or mismatched wire shows a clear load error and never enters an
  editable state.
- A clean vault (no findings at all) shows a "no findings" empty state.
- A run that's all-advisory (no fixable findings) still renders every tier —
  including the advisory cards — but leads with a note that there's nothing to
  apply.

## See also

- [Commands reference](commands-reference.md) — the **Open Tomo editor** command
- [Instruction executor](instruction-executor.md) — runs the `_instructions.json` Tomo renders from an approved run
- [Action reference](action-reference.md) — `resolve_dead_link`, `remove_up_link`, `link_to_moc`, and `add_relationship`, the actions this editor's decisions drive
- [How it works](how-it-works.md) — where the editor sits in the Tomo → Hashi flow
