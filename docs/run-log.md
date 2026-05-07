# Run Log

Every executor run produces a markdown file in your configured **Tomo inbox folder**, alongside the `_instructions.json` it ran. The log captures every action's outcome, every hook line, and every error — it's the audit trail you can read in Obsidian without leaving your vault.

> Screenshot — generated run log rendered in Obsidian: header (start/end, mode, source files), per-bucket counts, and the per-action table with ID / kind / summary / outcome columns.
<p align="center">
  <img src="../assets/run-log.png" alt="Run log markdown rendered in Obsidian — header table, per-bucket counts, per-action breakdown with outcomes" width="800" />
</p>

## Filename

`tomo-hashi-run-log_YYYY-MM-DDTHHMM.md`

- ISO-style timestamp at the run's start moment
- Always lands in the **Tomo inbox folder** — the same folder the executor reads `_instructions.json` from. Easy to keep input + output paired.
- Multi-file batch runs produce one log covering the whole batch, not one per source file.

## Structure

```markdown
# Hashi run log — 2026-04-30T1407

| Field | Value |
|---|---|
| Started | 2026-04-30 14:07:12 |
| Ended | 2026-04-30 14:07:16 |
| Duration | 4.3 s |
| Mode | confirm |
| Source files | `100 Inbox/2026-04-23_1405_instructions.json` |
| Total actions | 25 |

## Counts

| Outcome | Count |
|---|---:|
| ✓ Applied | 18 |
| ⊘ Skipped (already) | 4 |
| ⊘ Skipped (dependency) | 1 |
| ⊘ Skipped (cancelled) | 0 |
| ✗ Failed | 2 |

## Actions

| ID | Kind | Summary | Outcome | Detail |
|---|---|---|:-:|---|
| I01 | create_moc | `Atlas/200 Maps/Topic.md` | ✓ | created |
| I02 | move_note | `100 Inbox/note.md → Atlas/100 Notes/note.md` | ✓ | moved |
| I03 | link_to_moc | `Atlas/200 Maps/Topic.md ← note.md (Key Concepts)` | ✓ | bullet appended |
| I04 | link_to_moc | `Atlas/200 Maps/Topic.md ← other.md (Key Concepts)` | ⊘ | already in section |
| I05 | update_tracker | `Atlas/300 Trackers/Tracker.md status=stable` | ⊘ | already at value |
| I06 | delete_source | `100 Inbox/note.md` | ✓ | trashed |
| I07 | link_to_moc | `Atlas/200 Maps/MissingMoc.md ← x.md (Key Concepts)` | ⊘ | dependency I00 (failed) |
…
```

The exact column set is stable across versions — additions go to the right, no rename or removal. A `Detail` cell may carry extra context (path-safety reason, hook IDs, dependency reference).

## Retention

Settings → **Run log retention** controls when log files are kept:

| Mode | Behaviour |
|---|---|
| **Always keep** *(default)* | Every run leaves a log file in the inbox folder. |
| **Only after failed runs** | Zero-failure runs delete their log at the end. Inbox folder stays clean for routine sweeps; you only get a log file when something needs attention. |

The retention check runs at the very end of a run, after the summary has been computed. A cancelled run is treated as a failure for retention purposes (so you can always inspect what was cancelled mid-flight).

## Hook output

When hooks run, their output is recorded inline:

```markdown
| I02 | move_note | `100 Inbox/note.md → Atlas/100 Notes/note.md` | ✓ | moved |
|     | hook | `after-move_note.cjs` | i | moved → Atlas/100 Notes/note.md; outgoing links: 3 |
```

Each hook line carries:
- The hook filename (relative to the hooks directory)
- One of `i` / `w` / `e` (info / warning / error) for the line's severity
- The line itself, truncated to 200 characters with `…` if longer

If a `before-` hook short-circuits the action (returns `errors: [...]`), the action row shows `✗` and the next row is the hook's error line.

## Validation failures

If a file fails schema validation, no actions run. The log records:

```markdown
## Validation failures

| File | Error |
|---|---|
| `100 Inbox/2026-04-23_1109_instructions.json` | unexpected discriminant value at /actions/3/action |
```

Other valid files in a batch run normally; their actions appear in the **Actions** section as usual.

## What's NOT in the log

By [constitution rule L2](../README.md#part-of-miyo) (audit logs record metadata only, never content):

- **No frontmatter values** that were written
- **No body text** of created or modified notes
- **No hook return-value contents** beyond the explicitly-logged `info` / `warnings` / `errors` strings the hook itself emits
- **No environment variables**, API tokens, or credentials

If a hook accidentally puts secret values into a log line via `ctx.logger`, those are recorded — Hashi can't introspect strings to redact them. Treat hook log output as you would any debug log.

## Inspecting via the modal

The execution modal's **View errors** button (visible only when failures > 0) opens the run log in Obsidian's active leaf and closes the modal. This avoids the modal-overlay-hides-the-log bug and gets you reading the failure context immediately.

You can also open the file from the file explorer or via Obsidian's quick-switch (`Ctrl/Cmd+O`) — it's just a normal markdown file in your vault.

## See also

- [Instruction Executor / Modal stages](instruction-executor.md#modal-stages) — where View errors is wired
- [Hooks](hooks.md) — what `ctx.logger` lines look like
- [Action reference](action-reference.md) — outcome semantics for each kind
