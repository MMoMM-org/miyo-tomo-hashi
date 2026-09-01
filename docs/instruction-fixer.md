# Instruction Fixer

The Instruction Fixer is a repair bench for **Hashi's own failed mechanical work** — not
another editing surface over Tomo's output. When `/execute` finishes with a failed or
skipped action, the intent behind it was already approved; what broke is a mechanical
detail (a wrong anchor, a moved target, a stale match string). The Fixer lets you correct
that one detail and re-run, instead of going back to Tomo to regenerate the whole
instruction set for a one-line fix. It never adds, removes, or reorders actions, and never
accepts free-form JSON — only a curated set of target fields on the action kinds where a
mechanical mismatch is the realistic failure mode.

> Screenshots pending.

## Opening it

Three entry points (no click-to-open, no `obsidian://` handler):

| Entry point | Behaviour |
|---|---|
| Command palette → **"Open instruction fixer"**, with an `_instructions.json` (or its `.md` peer) active | Opens that set directly |
| Command palette → **"Open instruction fixer"**, with nothing relevant active | Opens a picker over every `_instructions.json` in the vault. Empty vault shows *"No instruction sets found — open a _instructions.json (or its .md) first"* |
| Execute-result surface → **"Open instruction fixer"** button, shown once a run finishes with ≥1 failed/skipped action | Opens the Fixer on that run's source, with the run's outcomes still fresh in-session. A multi-source run shows one button per failing source, labelled `Open instruction fixer: <name>` |
| Run log | An informational pointer line only — *"Errors can be viewed and repaired in the Instruction Fixer (command: 'Open instruction fixer')."* No link, nothing clickable |

The editor is a **singleton leaf** — reopening it (from any entry point) retargets the
existing leaf to the newly resolved set rather than spawning a duplicate.

All three entry points name the same action **"Open instruction fixer"** (sentence case),
matching every other button on the execute-result surface ("View errors", "Cancel",
"Execute", "Close").

## The fail-closed edit gate

This is the part to understand before anything else looks like a bug: **opening the Fixer
does not automatically make anything editable.**

Hashi keeps no durable per-action outcome record. On disk, `failed`, `skipped-*`, and
never-run all collapse to the same thing — `applied` simply isn't `true` yet. So the Fixer
only unlocks a field for editing when it has a *trusted* signal that the action actually
failed or was skipped: either this session's own run summary (freshest, right after a run)
or a run log that confidently matches this exact set by path. **With no trusted signal,
every action renders read-only and the editor offers "Run" instead of guessing.**

That's deliberate, not a bug: guessing wrong would risk unlocking editing on an action that
already succeeded, which would defeat the whole point of the surface. The cost of being
wrong the safe way is one extra click on Run; the cost of being wrong the other way is
Hashi silently letting you alter work that never needed fixing. If you open a cold set (no
recent run, no matching run log) and can't edit anything, this is why — run it once, and
the Fixer unlocks whatever actually failed.

**Viewing is unrestricted and is a separate capability from editing.** Every action's
intent and current field values render regardless of gate state — you can always open a
set to read what it does, even when nothing on the card is editable.

## Sections

Actions are grouped by their gate result, failed/skipped first:

| Section | Gate result | Meaning |
|---|---|---|
| **Needs repair** | `editable` | Trusted `failed` or `skipped-*` outcome, not yet applied — target fields are editable |
| **Applied** | `frozen-applied` | `applied: true` — nothing to repair; frozen read-only |
| **Not attempted** | `read-only-no-signal` | Never run, or no trusted signal for this action specifically — read-only |

When there is **no trusted signal for the whole set**, these three sections collapse into
one **"All actions"** group, read-only, under a banner: *"No trusted outcome for this set.
Hashi can't tell which actions failed until it runs them."* with a **Run** button. The
banner is suppressed only when every action already has `applied: true` — there's nothing
left to run, and those cards freeze the same way regardless of the missing signal.

## Cards

Every action — editable or not — renders its `I##`, kind, a plain-text intent line (no
deep-link into the `.md` heading; that was the original bug this feature replaces), an
outcome badge, and its key fields. Card body order is fixed: intent → failure reason →
target fields → note link.

- **Intent line** names both WHERE an action writes and WHAT it writes there — e.g.
  `Link "- [[Weekly review]]" into Systems (MOC), after heading "Maintenance"`, not just
  the target. Earlier versions named only the target, which left no way to tell which note
  a `link_to_moc`/`insert_under_marker`/`replace_section` card was actually about to link
  or insert.
- **Outcome badge** shows the trusted outcome's kind verbatim (`applied`, `failed`,
  `skipped-already`, …), or `—` when there's no signal for that action.
- **Failure reason** appears under the intent line it explains — the error text from a
  `failed` outcome, or the blocking action id for a `skipped-dependency` outcome.
- **Target fields** render as editable controls only on cards whose gate is `editable`;
  everywhere else they render as read-only text, same values, no control.
- **Note link** — clicking a card's affected-note link opens it beside the editor (a
  split, not a replace); hovering shows Obsidian's native page preview. A target that
  doesn't resolve degrades to inert `(note not found)` text rather than erroring.

### Editable target fields, by kind

Only 8 of the 16 action kinds carry a repairable target field (the ones where a mechanical
mismatch — "what this points at isn't there anymore" — is the realistic failure mode):

| Kind | Editable target fields |
|---|---|
| `link_to_moc` | Target MOC (stem), Target MOC path, Anchor |
| `insert_under_marker` | Target note (path), Anchor |
| `replace_section` | Target note (path), Section heading |
| `add_relationship` | Target MOC path, Marker, Line |
| `edit_note_text` | Note (path), Match, Replace |
| `remove_up_link` | Note (path), Link (stem) |
| `resolve_dead_link` | Note (path), Dead link (stem), Replace |

Every other kind — `create_moc`, `move_note`, `update_tracker`, `update_log_entry`,
`update_log_link`, `delete_source`, `skip` — renders view-only, regardless of gate. There
is no free-form or per-field override for these; if one of them fails, the fix path is
still a Tomo regeneration.

Changing a target field marks the model dirty and activates **Save**; committing a value
on a currently-editable card is the only way to produce a pending edit — nothing here adds,
removes, or reorders actions.

### Choosing from the target note

Fields that point *into* another note offer a **Choose…** button rather than free typing:

| Field | What the button offers |
|---|---|
| Target note / MOC / path fields | any note in the vault (fuzzy search) |
| **Anchor** (`link_to_moc`, `insert_under_marker`) | the target note's own headings, callouts and body lines |
| **Section heading** (`replace_section`) | the target note's headings only |
| **Marker** (`add_relationship`) | the target MOC's Dataview field openers (`up::`, `down::`) and body lines |
| **Property** (`edit_frontmatter`) | the target note's own frontmatter keys, each with a preview of its current value |

One field carries a button that is **not** a chooser: *Expected current value* on
`edit_frontmatter` offers **Read from note**, which opens nothing and simply pulls in
whatever that property holds right now. It is labelled differently because it behaves
differently — a button saying "Choose…" that opens no chooser is a small lie you pay for
by clicking it to find out. If the property has since been deleted it fills in `null`,
which is the wire's way of saying "this property must not exist" and therefore exactly
the right instruction.

The anchor picker lists each spot once per **placement** it legally allows, and picking a
row commits the anchor's type, its value and the placement together. That is deliberate:
those three are only valid in combination — `inside` works on a callout, and on a heading
for `insert_under_marker`, but never on a plain line — and three separate dropdowns would
let you build a combination the executor rejects. Every row you can see is one the executor
can resolve.

`replace_section` shows headings without a placement, because it always overwrites the
section body; its wire carries no placement field at all.

Picking a **Marker** rewrites the FRONT of the **Line** field to match — whatever comes after
the old marker is kept verbatim. Marker says *where* to write, Line says *what relationship*
to establish there; picking `up::` when the target note actually uses `parent::` turns
`up:: [[@]]` into `parent:: [[@]]`, keeping the `[[@]]` link exactly as it was. If Line
doesn't currently start with the Marker value on record — Tomo's own multi-link aggregation
can produce that — Hashi can't tell where the split is, so only Marker changes and Line is
left exactly as it was rather than guessed at. Each row's secondary text shows the line's
current content so you can see what a pick is about to match before you commit to it.

Picking a **Property** commits *Expected current value* alongside it, for the same reason.
The expectation is compared against the note at apply time, so changing the key while
leaving the old key's expectation behind would produce an action guaranteed to fail — the
picker would be manufacturing the very breakage it exists to repair.

Two things the pickers deliberately do *not* do:

- **Block anchors** (several consecutive lines matched exactly) are never constructed. There
  is no sensible way to enumerate the combinations, so the field stays free text — an
  existing block anchor is still editable by hand.
- The note is read **at the moment you press the button**, not when the card was drawn, and
  the structure is parsed from the file's content rather than Obsidian's metadata cache. A
  repair you saved a second ago is therefore already reflected. If the target note can't be
  read — the usual reason being that it's the thing that went missing — you get a notice
  naming it instead of an empty picker.

## Saving — JSON only, `.md` peer untouched

Unlike the Suggestions and Garden-Audit editors, **Save is not an approval step** — the
Fixer only repairs mechanical detail on an intent that was already approved earlier in the
Tomo → Hashi flow. Save:

- Writes **only** `_instructions.json`. The `.md` peer — the human-readable approval
  receipt — and its `tomo.sources` frontmatter are never touched.
- Validates the edited set against the vendored instruction schema before writing; an
  invalid edit is **rejected with a message** and never written.
- Writes through the same atomic per-action patch path the executor uses to flush
  `applied: true` — every field the editor didn't touch round-trips verbatim.
- After a repair and re-run, the `.md` peer may still describe the original failed form
  while the JSON carries the repaired one. **The JSON is authoritative for what Hashi
  executes** — this divergence is expected, not a sync bug.

An **Edited** badge appears once the model is dirty; **Revert** reloads from disk and
discards in-memory edits. If a Save is rejected partway through a multi-action patch loop,
the message distinguishes "nothing was written" from "N of M repairs landed" so you know
whether to just retry Save or revert first — the document itself always stays schema-valid
either way.

## Re-running

**Re-run** delegates to the same executor and atomic write path as "Execute instructions
document" — there is no second writer. It's idempotent: already-`applied` actions are
skipped, and only the actions you repaired (or any still-unapplied ones) run. Outcomes
refresh in place afterward, and a now-applied card freezes into the Applied section
immediately, without reopening the editor.

**Re-running with unsaved edits is refused, not silently skipped.** The executor reads the
set from disk, so a pending in-memory repair simply wouldn't be part of the run — clicking
Re-run with dirty edits shows *"Save your repairs before re-running — the run reads the set
from disk."* and does nothing else. Save first, then re-run.

While a run is in flight, the whole document freezes — no edits, no Save/Revert/Re-run —
because the run is rewriting the same file this leaf holds open. When it finishes (whether
it succeeded or the run itself errored), the leaf reloads from disk unconditionally, so the
cards and outcomes you see afterward always reflect what's actually on disk.

## Errors and empty states

- No document open yet → *"Open a Tomo _instructions.json (or its .md) first."*
- A malformed or schema-invalid set → a load error; the view never enters an editable
  state over bad data.
- An empty set (no actions) → *"No actions in this instruction set."*
- Closing the leaf with unsaved repairs → a confirm modal: *"This instruction set has
  unsaved repairs. Closing now discards them."*

## See also

- [Commands reference](commands-reference.md) — the **Open instruction fixer** command
- [Instruction executor](instruction-executor.md) — the executor and run log this editor
  reads outcomes from and re-runs through
- [Run log](run-log.md) — the pointer line and the outcome table the Fixer parses when no
  in-session run summary is available
- [Action reference](action-reference.md) — all 16 action kinds; the 8 with a repairable
  target field are marked above
