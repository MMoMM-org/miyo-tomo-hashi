# Action Reference

The instruction executor dispatches each action in an `_instructions.json` to a handler keyed by the action's `action` discriminant. There are nine kinds; each has its own outcome semantics, idempotency rule, and failure surface.

| Action | What it does | Idempotency probe | Halt-on-fail effect |
|---|---|---|---|
| [create_moc](#create_moc) | Create a new MOC at `destination` from a template | Destination exists | Marks dependent `link_to_moc` as `skipped-dependency` |
| [move_note](#move_note) | Rename source → destination | Destination exists, source missing → `skipped-already` | None — independent action |
| [link_to_moc](#link_to_moc) | Append `- [[note]]` bullet to a MOC's named section | Bullet already present | None |
| [add_relationship](#add_relationship) | Add a wikilink under a frontmatter relationship key | Wikilink already present | None |
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

Rename a note from `from` → `to`. Uses `app.fileManager.renameFile` so backlinks are preserved automatically.

| Field | Type | Notes |
|---|---|---|
| `from` | string | Source path, vault-relative. |
| `to` | string | Destination path, vault-relative. Parent folder auto-created. |

**Outcome:**
- `applied` — moved.
- `skipped-already` — `to` exists, `from` does not (already moved on a previous run).
- `failed` — `to` exists AND `from` also exists. Inconsistent state; Hashi refuses to choose. Resolve manually before re-running.

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

Several actions (`link_to_moc`, `update_log_entry`, `update_log_link`) need to find a section or line *inside* a markdown file. The shared `anchorResolver` does this with conservative parsing:

- Section headings match by exact label after stripping callout markers (`[!blocks] X` matches section `X`).
- Lines match exactly, including leading whitespace. No fuzzy matching.
- A failed match is always a `failed` outcome (or `skipped-dependency` for the MOC-creation case) — Hashi never *creates* sections or guesses positions.

This is intentional. The instruction set is a precise contract from Tomo; if the vault has drifted from what Tomo expected, you should see the failure rather than have Hashi paper over it.

## Path safety

Every action's `destination` / `path` / `from` / `to` runs through the same deny-list before any write:

- Reject if path resolves under `.obsidian/`, `.git/`, `.trash/`, or the configured **Hooks directory**
- Reject if the path escapes the vault root (canonical realpath check via `node:fs/promises` — desktop-only, manifest enforces this)
- Reject if the path contains `..` segments, absolute prefixes, or Windows drive letters

A path-safety failure is always `failed`, not `skipped`. The deny-list is hard-coded — there's no setting to disable it.
