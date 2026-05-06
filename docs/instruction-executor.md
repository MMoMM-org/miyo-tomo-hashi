# Instruction Executor

The executor reads `_instructions.json` files emitted by Tomo, validates them, previews the actions, and applies them to your vault through Obsidian's Vault API. Every run is observable, idempotent, and produces a per-run log file.

> Screenshot — preview modal with two source files expanded, a dozen actions grouped under each, **Execute** button highlighted.
<p align="center">
  <img src="../assets/executor-preview.png" alt="Execution modal preview view — actions grouped by source file, each row showing kind + summary, Execute and Cancel buttons" width="800" />
</p>

## Triggering a run

Three entry points; the right one depends on what's active in Obsidian:

| Entry point | Behaviour |
|---|---|
| **Command palette → "Execute instructions document"** with an `_instructions.json` (or its `.md` peer) open | Single-file run against that set |
| **Command palette → "Execute instructions document"** with no relevant file active | **Batch** — runs every `*_instructions.json` in your configured inbox folder, in lexicographic order |
| **Right-click a `.md` peer → "Execute instructions…"** | Same as palette + active peer |

> Screenshot — file-menu open on a peer `.md` file, "Execute instructions…" entry highlighted.
<p align="center">
  <img src="../assets/file-menu-execute.png" alt="Right-click file menu showing Execute instructions… entry" width="560" />
</p>

The `_instructions.json` files themselves never get the file-menu entry — by design, you should interact with the human-readable `.md` peer.

## Execution modes

Settings → Execution mode controls what happens after the planner finishes loading the instruction sets:

| Mode | What happens | When to use |
|---|---|---|
| **Confirm before run** *(default)* | Modal opens at preview. Click **Execute** to start; **Cancel** anytime. | First-time setups; sensitive destinations |
| **Auto-run with preview** | Modal opens AND execution starts immediately. You can watch progress and **Cancel** mid-run. | Trusted Tomo instructions on routine inbox sweeps |
| **Silent** | No modal. A Notice summarises the result on completion. The run log file records everything. | Background batch runs after you've stabilised the setup |

## Modal stages

The same Modal instance carries the user across three (or four) stages — `contentEl` is rebuilt in place rather than the modal being closed and reopened.

### 1. Preview

For Confirm and Auto-run modes. Shows:

- One row per action, grouped by source `_instructions.json`
- Each row: action ID (e.g., `I07`), kind (`create_moc`), and a 1-line summary
- **Banner** for partial-resume runs: *"N of M remaining (X already applied — re-run safe)"*
- **Footer** disclosure: *"Approval lives in Tomo's review step. This preview is informational."*
- **Execute** + **Cancel** buttons

In Confirm mode the modal stops here until you click Execute. In Auto-run mode it advances to Progress immediately.

### 2. Progress

> Screenshot — progress view with rows partway through, some glyphs already ✓, the current row showing ⟳, and a sticky red error banner for one prior failure.
<p align="center">
  <img src="../assets/executor-progress.png" alt="Execution modal progress view — per-row glyphs animating ⏺ → ⟳ → ✓ / ✗, sticky error banner at top accumulating failures" width="800" />
</p>

- Each row's glyph updates ⏺ → ⟳ → (✓ / ✗ / ⊘) as actions complete
- A sticky error banner accumulates if anything fails (`aria-live="assertive"` so AT users hear it)
- Progress text: `Running — N of M actions`
- **Cancel** halts the run *after* the current action commits — never mid-write. Remaining actions are recorded as `skipped-cancelled`.

The progress view uses a **fast-path renderer** for `running → running` transitions (only the index advances): instead of rebuilding the DOM tree on every store tick, it updates per-row glyphs and the header text in place. This avoids O(N²) main-thread teardown across long runs.

### 3. Summary

> Screenshot — summary view with stats line `✓ 18 · ⊘ 5 · ✗ 2 (4.3s)`, View errors button, Close button, and the Run log path below.
<p align="center">
  <img src="../assets/executor-summary.png" alt="Execution modal summary view — stats line with applied/skipped/failed counts and elapsed time, run-log filename, View errors and Close buttons" width="720" />
</p>

- Stats line: `✓ <applied> · ⊘ <skipped> · ✗ <failed> (<elapsed>s)`
- Run log filename + path
- **View errors** (only when `failed > 0`) opens the run log in the active leaf and closes the modal
- **Close** dismisses the modal and resets executor state to idle

### 3'. Validation failed (alternative to Summary)

If schema validation fails for one or more files at planner-time, no actions run; the modal jumps to a validation-failed view that lists each rejected file with its error message. Other valid files in a batch still execute.

## Symbol legend

Five glyphs appear across preview, progress, and summary:

| Symbol | Meaning | Where |
|:---:|---|---|
| **✓** | **Applied** — vault was modified | Per-row glyph; summary stats |
| **✗** | **Failed** — error returned, nothing committed for that action | Per-row glyph; summary stats |
| **⊘** | **Skipped** — did not need to run, or was preempted | Per-row glyph; summary stats |
| **⏺** | **Pending** — queued, not yet executed | Preview + progress |
| **⟳** | **Running** — currently executing | Progress (current row only) |

### Three flavours of "skipped"

Sub-categorised in the run log; all roll up into the ⊘ count in the summary stats:

- **`skipped-already`** — target state is already in place (bullet already in MOC, tracker field already at target, source file already trashed). Re-running is therefore safe — this is idempotency working correctly.
- **`skipped-dependency`** — a `link_to_moc` references a MOC whose `create_moc` failed earlier in the same run; the dependent action halts.
- **`skipped-cancelled`** — you clicked Cancel; the in-flight action committed, all remaining actions are recorded as cancelled.

## Partial-resume

The `_instructions.json` is the source of truth. After every successful action, Hashi writes `applied: true` next to that action in the source JSON. Re-triggering an already-completed file:

1. Planner reads the JSON
2. For each action with `applied: true`, the planner enqueues it as already-done (renders at reduced opacity with ✓ in the preview)
3. Only the unapplied actions execute

The preview banner reads *"N of M remaining (X already applied — re-run safe)"* so you know the difference at a glance. If `N == 0`, the **Execute** button is disabled — there's nothing left to do.

This is what makes Hashi safe to re-trigger after Obsidian crashes mid-run, after you reorganise a destination folder mid-instruction-set, or after a hook fails halfway: the next run picks up where the last one stopped without re-doing committed work.

## Cancellation

Clicking Cancel during preview tears the run down without any side effect (nothing committed yet). Clicking Cancel during progress:

1. Marks the cancellation flag in the executor's RunState
2. Lets the in-flight action finish (Hashi never aborts mid-write)
3. Records every remaining action as `skipped-cancelled`
4. Closes the run with a Summary view showing partial counts

Esc on Confirm / Auto-run preview is equivalent to Cancel; Esc on Summary closes the modal.

## Halt-on-dependency

A `link_to_moc` action references a MOC by path. If the referenced MOC was supposed to be created earlier in the same run by `create_moc`, and that creation failed:

- The `link_to_moc` is recorded as `skipped-dependency`
- The error in the run log carries the failed `create_moc` ID for traceability

If the MOC already existed before the run, the `link_to_moc` proceeds normally regardless of any earlier failures. The dependency check is local to the *run*, not the schema.

## Status bar 橋

> Screenshot — status-bar 橋 icon in three states (idle / running / error). Composite or individual screenshots both fine.
<p align="center">
  <img src="../assets/status-bar-bridge.png" alt="Status bar 橋 icon — gray (idle), green (running), red (error window)" width="480" />
</p>

The 橋 (bridge) glyph carries the executor's state in the status bar:

| State | When | Tooltip |
|---|---|---|
| **idle** | No run, summary with 0 failures, ≥10 s after a failure | `Hashi: idle` |
| **running** | Run in progress | `Hashi: running — N of M actions` |
| **error** | Summary with ≥1 failure, or validation-failed; auto-clears after ~10 s | `Hashi: last run had N failures — see <log>` |

Click during running → focus the modal (PRD F10's "where's my modal" shortcut). Click during idle / error → no-op. Enter and Space mirror the click for keyboard activation.

## See also

- [Action reference](action-reference.md) — what each action kind does
- [Hooks](hooks.md) — extend each action with custom Node code
- [Run log](run-log.md) — format, retention, troubleshooting
