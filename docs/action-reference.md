# Action Reference

The instruction executor dispatches each action in an `_instructions.json` to a handler keyed by the action's `action` discriminant. There are sixteen kinds; each has its own outcome semantics, idempotency rule, and failure surface.

| Action | What it does | Idempotency probe | Halt-on-fail effect |
|---|---|---|---|
| [create_moc](#create_moc) | Create a new MOC at `destination` from a template | Destination exists | Marks dependent `link_to_moc` as `skipped-dependency` |
| [move_note](#move_note) | Rename source → destination (note files only) | Destination exists, source missing → `skipped-already` | None — independent action |
| [move_asset](#move_asset) | Rename source → destination (attachments only) | Destination exists, source missing → `skipped-already` | None — independent action |
| [link_to_moc](#link_to_moc) | Append `- [[note]]` bullet to a MOC's named section | Bullet already present | None |
| [insert_under_marker](#insert_under_marker) | Insert a multi-line block at a marker in any note | Identical block already present | None |
| [replace_section](#replace_section) | Overwrite a heading section's body in any note | Body already equals content | None |
| [add_relationship](#add_relationship) | Add a wikilink under a frontmatter relationship key | Wikilink already present | None |
| [edit_note_text](#edit_note_text) | Literal find-and-replace in a note's **body only** — never frontmatter (repoint/remove dead links, strip broken inline `up::` lines) | Match not found anywhere | None |
| [edit_frontmatter](#edit_frontmatter) | Set or remove a YAML property, guarded by an expected current value | Value already correct → `skipped-already` | None |
| [remove_up_link](#remove_up_link) | Remove one link from a note's `up::` line, preserving the field | No up:: line, or link not on it | None |
| [resolve_dead_link](#resolve_dead_link) | Alias-aware unlink/repoint of a dead wikilink in a note's body | Target not present in any wikilink form | None |
| [update_tracker](#update_tracker) | Set a frontmatter scalar on a tracker note | Field already at target value | None |
| [update_log_entry](#update_log_entry) | Append/insert a line in a daily log at a positional anchor | Exact line already present | None |
| [update_log_link](#update_log_link) | Replace one wikilink with another inside a log entry | Replacement wikilink already present | None |
| [delete_source](#delete_source) | Move source to system trash | Source already missing | None |
| [skip](#skip) | Explicit no-op, recorded for traceability | Always `skipped-already` | None |

All idempotency probes run *before* writing — if the target state is already in place, the handler returns `skipped-already` without touching the vault.

---

## `create_moc`

Create a new Map-of-Content note at `destination`. Body is rendered from a small template (frontmatter + named sections). Used for the most common Tomo workflow: an inbox note becomes a MOC for a new topic.

| Field | Type | Notes |
|---|---|---|
| `destination` | string | Vault-relative path. Must end in `.md`. Parent folder is auto-created. |
| `title` | string | Goes into the H1 + `title:` frontmatter. |
| `tags` | string[] | Frontmatter `tags`. Empty array allowed. |

**Outcome:**
- `applied` — file created.
- `skipped-already` — destination exists and matches the template (re-runnable).
- `failed` — destination exists but content diverges (you've edited it manually); Hashi refuses to overwrite.

If `applied`, the `_instructions.json` gets `applied: true` for this action. Subsequent `link_to_moc` actions in the same run target this newly-created MOC by path.

## `move_note`

Rename a note from `source` → `destination`. Uses `app.fileManager.renameFile` so backlinks are preserved automatically.

**Note files only.** Both endpoints must be `.md`, `.canvas` or `.base` — the three kinds Obsidian treats as documents rather than attachments. Attachments belong to [`move_asset`](#move_asset).

The restriction is not cosmetic. After the rename this action strips Tomo's frontmatter block, and that step reads the file as a UTF-8 *string* and writes it back. On binary content the round trip replaces invalid byte sequences with `U+FFFD` and persists them — a destroyed image reported as `applied`. Rather than skip the strip for unknown types, `move_note` refuses them outright, so a producer routing an attachment here finds out instead of half-succeeding. The frontmatter strip itself now runs for `.md` only: a `.canvas` is JSON and a `.base` is YAML, and a YAML document legitimately opens with `---`.

| Field | Type | Notes |
|---|---|---|
| `source` | string | Source path, vault-relative. Must be a note file. |
| `destination` | string | Destination path, vault-relative. Must be a note file. Parent folder auto-created. |
| `title` | string | Final title of the note (also the stem of the destination filename). |

**Outcome:**
- `applied` — moved.
- `skipped-already` — `destination` exists, `source` does not (already moved on a previous run).
- `failed` — `destination` exists AND `source` also exists. Inconsistent state; Hashi refuses to choose. Resolve manually before re-running.
- `failed` — either endpoint is not a note file. The message names the offending path(s) and the allowed set.
- `failed` — the destination filename contains a character Obsidian rejects. The producer must emit Obsidian-safe names; Hashi validates and rejects, never repairs.

## `move_asset`

Rename an attachment — image, PDF, audio, anything that is not a note — from `source` → `destination`. Uses `app.fileManager.renameFile`, so embeds (`![[foto.png]]`) and links pointing at the file are rewritten automatically.

**Attachments only.** Neither endpoint may be `.md`, `.canvas` or `.base`. Notes belong to [`move_note`](#move_note), and each kind refuses the other's domain so a mis-routed file fails loudly in either direction rather than half-working.

The reason this is a separate kind rather than a flag on `move_note` is that `move_note` strips Tomo's frontmatter after its rename, and that step round-trips the file content through a UTF-8 string — which silently replaces invalid byte sequences with `U+FFFD` on binary content. `move_asset` never reads the file at all: it renames, and nothing else.

Deliberately minimal. `move_note`'s note-shaped extras (`title`, `parent_mocs`, `tags`, `source_inbox_item`) carry no meaning for a binary and are rejected by the schema. Cleanup of a source inbox item is `delete_source`'s job here exactly as it is for notes.

| Field | Type | Notes |
|---|---|---|
| `source` | string | Source path, vault-relative. Must not be a note file. |
| `destination` | string | Destination path, vault-relative. Must not be a note file. Parent folder auto-created. |
| `applied` | boolean | Optional. Hashi writes `false` → `true`; never re-emitted as `true` by Tomo. |

**Outcome:**
- `applied` — moved.
- `skipped-already` — `destination` exists, `source` does not (already moved on a previous run).
- `failed` — `destination` exists AND `source` also exists. Inconsistent state; Hashi refuses to choose.
- `failed` — either endpoint is a note file. The message names the offending path(s).
- `failed` — the destination filename contains a character Obsidian rejects.

## `link_to_moc`

Append `- [[note]]` to a named section of a MOC. The section is identified by callout-style heading (e.g., `[!blocks] Key Concepts`, `[!connect] Your way around`).

| Field | Type | Notes |
|---|---|---|
| `moc_path` | string | Path to the MOC. |
| `note_path` | string | Note to link. The bullet uses the basename for the link target. |
| `section` | string | Section heading after the callout marker — e.g., `Key Concepts`. |

**Outcome:**
- `applied` — bullet appended.
- `skipped-already` — the exact bullet already exists in the section.
- `skipped-dependency` — the MOC does not exist AND no `create_moc` earlier in this run targeted it (or that `create_moc` failed). The error references the failed `create_moc` ID.
- `failed` — MOC exists but the named section can't be located. Hashi will not invent a section.

## `insert_under_marker`

Insert a multi-line markdown block beneath a marker in **any** vault note (the `link_to_moc` insert primitive generalised to arbitrary notes). Tomo composes the full block and decides the position; Hashi inserts as-is and **never replaces** existing content.

| Field | Type | Notes |
|---|---|---|
| `target_path` | string | Vault-relative path of an existing note. Modify-only — Hashi never creates it. |
| `anchor` | object | `{ type, value }`. `type` ∈ `callout` \| `heading` \| `line` \| `block`. See [Anchor resolution](#anchor-resolution). |
| `placement` | string | `inside` \| `before` \| `after` (relative to the matched marker). |
| `content` | string | Multi-line block (`\n`-joined). Written verbatim for `before`/`after`/heading-`inside`; each line gets a `> ` prefix only for callout-`inside`. |

**Placement × marker:** `inside` + callout → appended to the callout body (`> ` per line); `inside` + heading → appended at the end of the heading's section (above the next same-or-higher heading, or EOF); `inside` + `line`/`block` → unsupported (fails gracefully); `before`/`after` → verbatim, relative to the marker, any type. A `block` anchor (table header + separator rows) + `after` lands a new row as the **first** table data row — the newest-first table-insert case.

**Outcome:**
- `applied` — block inserted.
- `skipped-already` — a byte-identical block is already present.
- `failed` — target missing, anchor value null, marker not resolvable, or `inside` + `line`/`block`. File untouched.

## `replace_section`

**Overwrite** the body of a heading section in any note — the deliberate counterpart to `insert_under_marker`. It intentionally breaks the "append, never replace" invariant, which is why it is its own opt-in action kind rather than a mode on an insert. Heading-scoped for v1.

| Field | Type | Notes |
|---|---|---|
| `target_path` | string | Vault-relative path of an existing note. Modify-only. |
| `anchor` | object | `{ type: "heading", value }`. **Must** be a `heading` anchor in v1; other types fail gracefully. |
| `content` | string | Multi-line block that replaces the section body (line after the heading down to the next same-or-higher heading, or EOF). The heading line itself is preserved. |

**Outcome:**
- `applied` — section body overwritten.
- `skipped-already` — the section body already equals `content` byte-for-byte.
- `failed` — target missing, anchor value null, non-heading anchor, or heading not found. File untouched (never a blind write).

## `add_relationship`

Add a wikilink under a frontmatter relationship key on a note. Used to wire up "this note relates to that note" without touching body text.

| Field | Type | Notes |
|---|---|---|
| `note_path` | string | Note whose frontmatter is updated. |
| `key` | string | Frontmatter key (e.g., `related`, `parents`, `children`). Created if missing. |
| `target` | string | Path or basename of the related note. Stored as `[[basename]]`. |

**Outcome:**
- `applied` — wikilink appended to the array under `key`.
- `skipped-already` — wikilink already in the array.
- `failed` — frontmatter is malformed (cannot parse), or `key` exists but is a non-array scalar (Hashi refuses to coerce types).

## `edit_note_text`

**Literal** find-and-replace inside a note's **body** (never frontmatter). Introduced by Tomo's garden-audit workflow to repoint or remove dead `[[wikilinks]]` and strip broken inline `up::` lines — operations the placement-oriented actions cannot express.

| Field | Type | Notes |
|---|---|---|
| `path` | string | Vault-relative path of the note to edit. Modify-only. |
| `match` | string | **Literal** substring to find in the body — not a regex or glob. Matched byte-for-byte; `[`, `]`, `(`, `.`, `*` etc. are literal characters. |
| `replace` | string | Literal replacement written verbatim. `""` deletes the match. |
| `occurrence` | `"first"` \| `"all"` | Optional (default `"first"`). `"first"` replaces the first literal hit; `"all"` replaces every hit. |

### Body only — this action cannot edit frontmatter at all

The leading YAML frontmatter block (`--- … ---`) is **frozen**. This is not a
soft preference or a best-effort skip: no `match` is ever sought or replaced
inside it, in any run. If a value you need to change lives in a YAML property —
`up:`, `related:`, `status:`, **any** key — this action is the wrong tool and
always will be. It targets inline Dataview-style `up::` lines in the *body*,
which is a different thing that happens to look similar.

Two consequences worth stating plainly, because one of them used to bite
silently:

- A `match` that appears in **both** frontmatter and body: the body hit is
  replaced, the frontmatter occurrence is left exactly as it was.
- A `match` that appears **only** in frontmatter: this is a **`failed`**
  outcome, deliberately. Reporting a no-op success there would graduate the
  action to `applied: true` and filter it out of every later run, leaving the
  note permanently wrong with nothing reported. The failure message names the
  path and says why.

Editing, adding or removing frontmatter properties is
[`edit_frontmatter`](#edit_frontmatter)'s job.

**Deletion (`replace: ""`):** a whole-line match collapses its now-empty line, so repeated runs never accumulate blank lines; an inline match just loses the substring.

**Outcome:**
- `applied` — the body was edited.
- `skipped-already` — the `match` was not found **anywhere in the note**, or an empty `match` was supplied. A no-op success — never fails the batch on a stale single match, since the note may have been fixed by hand between report and apply.
- `failed` — target note missing. File untouched.
- `failed` — the `match` was found only in the frozen frontmatter. See above; this is a structural limit of the action, not a transient condition, so retrying will not help.

Use [`edit_frontmatter`](#edit_frontmatter) for anything inside the block.

## `edit_frontmatter`

Set or remove a YAML property on a note. The **only** action that touches frontmatter — [`edit_note_text`](#edit_note_text) freezes the block, which is why a link living in `up:` used to be unrepairable.

Works on the **parsed** value through Obsidian's `processFrontMatter`, never on YAML text. Literal string surgery on a parsed format is how documents get corrupted, and avoiding it is the whole reason this is a separate kind rather than a flag on the text editor.

**Markdown only.** Obsidian documents `processFrontMatter` as "Must be a Markdown file"; a `.canvas` or `.base` target is rejected before the vault is touched.

### What a write does to the rest of the block

Obsidian re-serialises the whole frontmatter block from its parsed form, so a write
touches more than the one key. Measured against a real vault, not inferred:

| | |
|---|---|
| **YAML comments** | **Lost.** Every `#` line in the block is gone after any write |
| Key order | Preserved; a removed key simply disappears from its position |
| New keys | Appended at the end of the block |
| Nested maps | Survive intact |
| Lists | Written as block sequences, values quoted (`- "[[A]]"`) |
| Untargeted keys | Values unchanged |
| A note with no block | One is created at the top of the file |

The comment loss is the one to know about, because nothing warns you: a note whose
frontmatter carries explanatory `#` lines will come out of a successful
`edit_frontmatter` without them. This is Obsidian's own serialiser, not something Hashi
chooses — the alternative would be editing YAML as text, which is the corruption vector
this kind exists to avoid. If a note's frontmatter comments matter, keep that note out of
the audit's reach.

| Field | Type | Notes |
|---|---|---|
| `path` | string | Vault-relative path. Must be `.md`. |
| `property` | string | The YAML key. **Any** key — nothing is treated specially. |
| `operation` | `"set"` \| `"remove"` | `set` writes `value`, creating the key when absent — that is also how a property is **added**. `remove` deletes it. |
| `value` | any JSON | The whole new value: scalar, list or map. Required for `set`, ignored for `remove`. |
| `expected` | any JSON | **Required.** See below. |

### `expected` — the guard, and why it is not optional

Tomo reads the current value and emits the complete replacement; there are no
list-item operations. That means an instruction set carries an assumption about
what the note holds — and notes change between the audit and the apply.

`expected` is compared **deep-equal** against the value found at the moment of
writing. If it does not match, the action **fails and writes nothing**. A vault
that moved on is never silently clobbered.

- `expected: null` means **"the property must not exist"**. That is how an add
  is expressed. A property holding a literal YAML `null` is a *different* thing
  and does not satisfy it — so a literal null cannot be expressed as an
  expectation.
- List order is significant: `[A, B]` does not match `[B, A]`. Map key order is
  not.
- It is required rather than optional deliberately. A producer that forgets it
  gets a loud schema rejection instead of a silent default — which matters,
  because instruction sets are not always machine-generated.

When it fails, the repair path is the **Instruction Fixer**: `path`, `property`,
`value` and `expected` are all editable there, with `value` and `expected` shown
as JSON. Two buttons read straight from the target note so nothing has to be
transcribed:

- **Choose…** on *Property* lists the keys the note actually has, with a preview
  of each value. Picking one sets `property` **and** `expected` together — a
  pick that changed the key while leaving the old expectation behind would hand
  you an action guaranteed to fail.
- **Read from note** on *Expected current value* pulls in whatever that property
  holds right now. This is the short path out of a failed expectation: the
  action failed *because* the note holds something else, and this puts that
  something else in the field. If the property has since been deleted, it fills
  in `null` — which is exactly the right instruction.

**Outcome:**
- `applied` — the property was written or removed.
- `skipped-already` — the expectation held and the value was already what `set` wanted, or `remove` found nothing to delete. Idempotent re-run.
- `failed` — the expectation did not match. **Nothing written, and the file is not opened for writing at all** — which matters because opening it would re-serialise the block and cost the note its comments (see above) even though no value changes. The message names the *shapes* involved, never the values (Privacy L2 — the run log carries metadata only).
- `failed` — target is not a markdown note, the note is missing, or its YAML could not be parsed.

## `remove_up_link`

Remove **one** link from a note's `up::` line while preserving the field itself — the field-level counterpart to `edit_note_text`'s whole-line replacement. Introduced for garden-audit's `broken_up` cleanup: `edit_note_text` can only match/replace the whole line verbatim, so it silently no-oped whenever the `up::` line carried more than one link.

| Field | Type | Notes |
|---|---|---|
| `path` | string | Vault-relative path of the note whose `up::` line is edited. Modify-only. |
| `link` | string | Bare stem of the link to remove (no `[[ ]]`), e.g. `Deleted MOC`. |

**Locator:** the same marker/callout/bullet locator `add_relationship` uses, with the marker fixed to the literal `up::`.

**Removal:** the `[[link]]` occurrence is removed from the line, including a dangling separator — whitespace-tolerant around commas:
- `up:: [[A]], [[X]]` → `up:: [[A]]` (drop the trailing link)
- `up:: [[X]], [[A]]` → `up:: [[A]]` (drop the leading link)
- `up:: [[A]], [[X]], [[B]]` → `up:: [[A]], [[B]]` (drop a middle link)

**Field preservation:** when the removed link was the only one, the line becomes an empty `up:: ` — it is **never** deleted. `up::` is a required structural field; an emptied `up::` correctly resurfaces the note as unparented on the next garden-audit scan, whereas deleting the line would drop the note from the structure model entirely.

**Outcome:**
- `applied` — the `up::` line was rewritten.
- `skipped-already` — no `up::` line exists, OR `link` is not present on it (this also covers the idempotent re-run case, where a prior run already removed the link). A no-op success — never fails the batch.
- `failed` — target note missing. File untouched.

## `resolve_dead_link`

Alias-aware unlink/repoint of a dead wikilink in a note's **body**. Supersedes `edit_note_text` for dead-link fixes: `edit_note_text` matches the whole `[[…]]` text literally, so it silently no-oped whenever the dead link carried a display alias — Tomo never sees the note body or its alias text, so this resolution is delegated to Hashi.

| Field | Type | Notes |
|---|---|---|
| `path` | string | Vault-relative path of the note whose body is edited. Modify-only. |
| `target` | string | Bare dead-link target to find (no `[[ ]]`, no alias), e.g. `023 Sparks MOC`. |
| `replace` | string | `""` unlinks (keeps the display text). A `[[New]]` wikilink repoints to `New` (display preserved). |

**Forms matched:** every occurrence of `target` across all wikilink forms in the body — bare `[[target]]`, aliased `[[target|display]]`, and embed `![[target]]`. Matching is anchored to the full link-target slot, so a shorter target never matches inside a longer one (`[[Old MOC]]` is untouched by target `MOC`).

**Unlink (`replace: ""`):** drops the `[[ ]]`, keeping the DISPLAY text when there was an alias — `[[t|Nice]]` → `Nice` — else the bare target — `[[t]]` → `t`, `![[t]]` → `t` (an embed unlink mirrors a bare unlink: the `!` and brackets are dropped, the target survives as plain text).

**Repoint (`replace: "[[New]]"`):** rewrites the target to `New`, preserving any display — `[[t|Nice]]` → `[[New|Nice]]`, `[[t]]` → `[[New]]`.

Every occurrence in the body is replaced.

**Outcome:**
- `applied` — the body was edited.
- `skipped-already` — `target` was not found in any wikilink form (the note may have been fixed by hand, or a prior run already resolved it — idempotent re-run). A no-op success — never fails the batch.
- `failed` — target note missing. File untouched.

## `update_tracker`

Set a frontmatter scalar field on a tracker-style note. Used for status-style flags (e.g., `status: stable`, `priority: high`).

| Field | Type | Notes |
|---|---|---|
| `note_path` | string | Tracker note to update. |
| `field` | string | Frontmatter key (top-level; nested keys not supported in v0.1). |
| `value` | string \| number \| boolean | New value. |

**Outcome:**
- `applied` — frontmatter mutated.
- `skipped-already` — current value strictly equals target value.
- `failed` — frontmatter unparseable, or `field` exists with an array/object value (Hashi will not overwrite a complex value with a scalar).

## `update_log_entry`

Append (or insert at a specific time) a line in a daily log file. Hashi uses positional anchors — `before_first_line`, `after_last_line`, `at_time` — so the resulting line lands in a deterministic spot regardless of how the rest of the log was edited.

| Field | Type | Notes |
|---|---|---|
| `log_path` | string | Daily-log note. Section to update is `## Log` (configurable via the SDD-defined section locator). |
| `line` | string | Full markdown line to insert. Hashi does not transform it. |
| `position` | object | `{ kind: "after_last_line" }` \| `{ kind: "before_first_line" }` \| `{ kind: "at_time", iso: "..." }` |

**Outcome:**
- `applied` — line inserted at the resolved position.
- `skipped-already` — exact line already present in the log section.
- `failed` — log section missing, or `at_time` references an ISO timestamp that doesn't fit the existing log's chronology (Hashi will not silently misorder).

## `update_log_link`

Replace one wikilink with another inside an existing log entry. Used when a note has been renamed and the daily log needs its references updated. Pairs naturally with `move_note`.

| Field | Type | Notes |
|---|---|---|
| `log_path` | string | Log note. |
| `from_link` | string | Existing wikilink target (basename). |
| `to_link` | string | Replacement wikilink target. |

**Outcome:**
- `applied` — replaced.
- `skipped-already` — `to_link` already present and `from_link` no longer present (already done on a previous run).
- `failed` — `from_link` not found in the log file. (Refuses to silently noop.)

## `delete_source`

Move a source file to the system trash via `app.vault.trash(file, true)`. Used at the end of a workflow when the inbox note has been promoted into MOC + entries and no longer needs to live in the inbox.

| Field | Type | Notes |
|---|---|---|
| `path` | string | File to trash. |

**Outcome:**
- `applied` — moved to system trash.
- `skipped-already` — file does not exist (already trashed in a prior run).
- `failed` — Obsidian's trash call rejected (permissions, missing trash folder, etc.).

> **Known platform quirk:** files with `:` in their name on non-macOS platforms may resolve to `skipped-already` even when the file is still visible in Obsidian — `vault.trash()` fails to see them. Workaround: rename via `move_note` first, or trash manually.

## `skip`

An explicit no-op. Used by Tomo when generating an instruction set where some action would be redundant in the current vault but should still be tracked for transparency.

| Field | Type | Notes |
|---|---|---|
| `reason` | string | Human-readable explanation, recorded in the run log. |

**Outcome:** Always `skipped-already`.

---

## Anchor resolution

Several actions (`link_to_moc`, `insert_under_marker`, `replace_section`, `update_log_entry`, `update_log_link`) need to find a section or line *inside* a markdown file. The shared `anchorResolver` does this with conservative parsing. An `anchor` is `{ type, value }`, with four `type`s:

- `callout` — matches the callout opening line by `[!type] Title` (case-insensitive); body extends through consecutive `>`-prefixed lines.
- `heading` — matches heading text (without leading `#`s), case-sensitive, any level.
- `line` — matches the first body line that **contains** the value (substring).
- `block` — matches **N consecutive lines** (the value's `\n`-joined lines), each exact after trimming trailing whitespace. For unique multi-row markers a single `line` anchor cannot express — e.g. a table's header row + separator row together, where the separator (`| --- | --- |`) alone is non-unique. `inside` is unsupported for `block`.

- A failed match is always a `failed` outcome (or `skipped-dependency` for the MOC-creation case) — Hashi never *creates* sections or guesses positions.

This is intentional. The instruction set is a precise contract from Tomo; if the vault has drifted from what Tomo expected, you should see the failure rather than have Hashi paper over it.

## Path safety

Every action's `destination` / `path` / `from` / `to` runs through the same deny-list before any write:

- Reject if path resolves under `.obsidian/`, `.git/`, `.trash/`, or the configured **Hooks directory**
- Reject if the path escapes the vault root (canonical realpath check via `node:fs/promises` — desktop-only, manifest enforces this)
- Reject if the path contains `..` segments, absolute prefixes, or Windows drive letters

A path-safety failure is always `failed`, not `skipped`. The deny-list is hard-coded — there's no setting to disable it.
