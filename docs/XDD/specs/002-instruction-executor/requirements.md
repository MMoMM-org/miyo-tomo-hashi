---
title: "Instruction Executor — apply Tomo's _instructions.json to the vault"
status: draft
version: "2.0"
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

- [x] Problem is validated by evidence (architecture-06 §6, §10; ADR-009 §3, §6.1, §6.2, §6.3; 5-perspective research synthesis 2026-04-24 captured in research.md; user revision round 2026-04-25)
- [x] Context → Problem → Solution flow makes sense
- [x] Every persona has at least one user journey
- [x] All MoSCoW categories addressed (Must/Should/Could/Won't)
- [x] Every metric has corresponding tracking/verification path
- [x] No feature redundancy
- [x] No technical implementation details included
- [x] A new team member could understand this PRD

---

## Output Schema

### PRD Status Report

| Field | Value |
|-------|-------|
| specId | 002-instruction-executor |
| title | Instruction Executor — apply Tomo's _instructions.json to the vault |
| status | DRAFT |
| clarificationsRemaining | 0 |
| acceptanceCriteria | 95 |

### Section Status

| Section | Status | Detail |
|---------|--------|--------|
| Product Overview | COMPLETE | Vision adjusted for inbox-batch invocation and `.json` as source of truth |
| User Personas | COMPLETE | Single v0.1 persona (PKM Author), shared with 001 |
| User Journey Maps | COMPLETE | Inbox batch primary; partial-resume secondary; failure investigation via run log tertiary |
| Feature Requirements | COMPLETE | 11 Must-Have, 0 Should-Have, 0 Could-Have for executor |
| Detailed Feature Specifications | COMPLETE | Execution lifecycle (orchestrator + 8 kinds + applied-flag write-back + run log + hooks) |
| Success Metrics | COMPLETE | Acceptance-test coverage + v0.1 release gate participation |
| Constraints and Assumptions | COMPLETE | Schema v1 with new `applied` field; Tomo handoff is a hard prerequisite |
| Risks and Mitigations | COMPLETE | 5 risks centered on schema field rollout, hook trust, deny-list completeness |
| Open Questions | COMPLETE | Empty — settled in user revision round 2026-04-25 |
| Supporting Research | COMPLETE | 5-perspective synthesis in research.md; revision delta documented in spec README decisions log |

---

## Product Overview

Hashi v0.1 has **two independent features**. This PRD covers feature 2 (Instruction Executor). Feature 1 (Tomo Connection & Chat Window) is specified in `docs/XDD/specs/001-session-view/` and is a separate surface that does not share state with this executor. After the 2026-04-24 brainstorm pivot, 002 has no runtime coupling to 001 — it does not require a live Tomo connection.

### Vision
Give the MiYo user a one-command path — from anywhere — to turn Tomo's reviewed `_instructions.json` files into deterministic vault edits. Safe, idempotent, partial-resume-aware, with an honest written record of every run.

### Problem Statement
Today, when Tomo produces an instruction set (a `_instructions.json` plus a companion `.md` peer for human reading), there is no plugin-side way to apply it. The user must read the `.md` peer and perform each proposed edit by hand: move files, append bullets to MOCs, update tracker fields on the daily note, add log entries, move the source to trash. A single review can produce 25+ actions. Doing this manually is slow, error-prone, and fights against the "proposal-first" design — the review step (in Tomo) becomes wasted if the applied step (in Obsidian) is unreliable.

Architecture-06 §10 names the v0.1 release gate explicitly: *live Tomo Docker connection + chat working end-to-end + at least one base instruction-execution operation working against a live Tomo-produced `_instructions.json`*. Without the executor, the gate cannot pass.

Concrete consequences of the gap:
- 25-action sets require 25 hand edits — users skip sets rather than apply them, collapsing MiYo's core loop.
- Hand-applied edits drift from the proposed plan and invalidate Tomo's downstream assumptions.
- Partial-application is unrecoverable — no way to tell "I already did 10; resume from 11".
- Failures are silent — the user has no record of which actions ran and which did not.

### Value Proposition
One command — *"Execute instructions document"* — runs the executor against either the active instruction document or every `_instructions.json` in the configured Tomo inbox folder, in a single merged preview. Tomo's `.json` is the durable applied-state record (Hashi writes `applied: true` per action on success). A per-run log file in the inbox captures successes and failures in human-readable form, with retention controlled by the user. The `.md` peer (for users who don't run Hashi) still ticks best-effort — but it is never a fail-stop. Path safety (deny-list + vault-root containment) and schema validation fail closed before any vault write. A status-bar 橋 icon turns green during execution and red after a failed run. Hooks let power users extend the executor for cases like alias-rewrite-after-move under a Templater-equivalent trust model with an enable/disable/ask setting and a master kill-switch.

## User Personas

### Primary Persona: The Solo PKM Author
- **Demographics:** Single user of the MiYo system (the project owner in v0.1). Desktop Obsidian on macOS (Linux theoretical; Windows user-contribution per architecture-06). Power user, comfortable with Obsidian's Plugin API and writing small JavaScript files. Moderate-to-high technical expertise.
- **Goals:** Turn reviewed instruction sets into applied edits in one action — whether they have one set open, or twenty waiting in the inbox. See what will happen before it happens (when they want). Resume from where a prior run left off. Learn what failed after an unattended run without re-reading the full `.md` peer. Extend the executor with custom behavior (hooks) when needed (e.g., alias rewrite after a note is moved).
- **Pain Points:** Hand-applying 25-action sets takes minutes and loses intent. Silent partial-application drifts from Tomo's plan. Plugin-level "applied yes/no" is invisible without a UI. Obsidian's undo does not span multi-file operations (move + MOC append + tracker update + log entry). Writing alias-rewrite-after-move logic today means a separate Templater template that has nothing to do with the instruction set that triggered the move.

### Secondary Personas
None in v0.1. Multi-user, cross-vault, and remote-instruction-source scenarios are out of scope (spec README §Explicitly NOT in 002).

## User Journey Maps

### Primary User Journey: "Drain the inbox in one go"
1. **Awareness:** Tomo has produced one or more `_instructions.json` files in the configured inbox folder over the last few days. User has reviewed them in Tomo's review step and decided to apply them.
2. **Consideration:** User opens Obsidian. Rather than open each peer file individually, they invoke "Execute instructions document" from the command palette with no instruction file currently active.
3. **Adoption:** A single preview modal opens. It lists every action from every `_instructions.json` in the inbox, merged in canonical execution order with file headers (`📄 2026-04-22_inbox-review` … `📄 2026-04-24_inbox-review`). User clicks **Execute N actions**.
4. **Usage:** Modal transforms to progress view. Actions run in canonical order, per-file. As each action commits, Tomo's `.json` is updated with `applied: true` for that action; the matching `- [ ] Applied` checkbox in the `.md` peer is best-effort ticked. The status-bar 橋 icon shows the green running state throughout. At the end: *"✓ 47 applied · 0 failed · 22.4s"*.
5. **Retention:** The inbox now contains a `tomo-hashi-run-log_2026-04-25T1742.md` file alongside the original `.json`s, listing every action with its outcome. User closes the modal. Re-invoking the command shows *"0 of 47 remaining — all actions already applied"*.

### Secondary User Journey: "Resume a partially-applied set"
1. **Awareness:** User started a 25-action set yesterday and the run was interrupted at action 11 (computer slept; modal closed). The `.json` records `applied: true` on actions I01–I10 and `applied: false` on I11–I25.
2. **Consideration:** User opens the peer `.md` (or invokes the command from anywhere — same result if only this one set has remaining work).
3. **Adoption:** Preview modal opens with a banner: *"15 of 25 actions remaining (10 already applied — re-run safe)"*. Already-applied rows render greyed-out with a ✓ glyph; remaining rows render normally.
4. **Usage:** User clicks **Execute 15 actions**. Executor skips the 10 already-`applied` rows and runs the 15 remaining in canonical order. Each success updates `applied: true` in the `.json`.
5. **Retention:** User learns that partial-resume is transparent and safe. The `.json` remains the durable record across sessions, restarts, and crashes — no separate state file, no fragile checkbox parsing.

### Tertiary User Journey: "Investigate failures via the run log"
1. **Awareness:** A 40-action run completed in *Silent* mode at 03:00. User returns to Obsidian and sees a `Notice`: *"Hashi: 37 applied, 3 failed in tomo-hashi-run-log_2026-04-25T0300.md."*
2. **Consideration:** User wants to know what failed.
3. **Adoption:** User opens the named log file in the inbox. The header shows the timestamp and source file(s). The body lists every action with its outcome — each failure has its `I##`, action kind, payload summary, and the error message. Successes are listed too (since retention is set to *Always keep* in this user's vault).
4. **Usage:** User reads the three errors, decides whether they are recoverable (missing target file, payload ambiguity) or design issues to surface back to Tomo. They may forward the log file to Tomo's next session (`@tomo-hashi-run-log_2026-04-25T0300.md please figure out what went wrong`).
5. **Retention:** User knows that every Silent run leaves a complete written record + a Notice — the two channels together make unattended execution honest. The log file is the canonical post-mortem artifact; Tomo can read it directly.

## Feature Requirements

### Must Have Features

#### F1: Invocation and Source Resolution
- **User Story:** As the PKM Author, I want to invoke the executor either against the active instruction file or against every `_instructions.json` in the inbox, so that I can apply one set at a time *or* drain the whole inbox with one keystroke.
- **Acceptance Criteria:**
  - [ ] Given the active editor's file is an `.md` peer for a Hashi instruction set (a `.md` whose sibling `_instructions.json` exists), When I invoke "Execute instructions document" from the command palette, Then the executor processes that ONE instruction set only.
  - [ ] Given the active editor's file is an `_instructions.json`, When I invoke the command, Then the executor processes that ONE instruction set only.
  - [ ] Given no Hashi instruction file is active (any other file open, or no file open), When I invoke the command, Then the executor processes ALL `_instructions.json` files in the configured Tomo inbox folder, merged into a single preview in canonical order with per-file headers.
  - [ ] Given I right-click an `.md` peer in the file explorer, When the context menu opens, Then an "Execute instructions…" entry is present, and invoking it has the same effect as the palette command on that file.
  - [ ] The right-click menu does NOT appear on `_instructions.json` files (the user does not normally interact with the JSON directly).
  - [ ] Given a run is already in progress (any document, any batch), When I invoke the executor again, Then a `Notice` "Execution already in progress" is shown and no second run starts. There is no run queue.
  - [ ] The executor is NEVER triggered automatically on file creation, file change, or vault load — invocation is always an explicit user action.
  - [ ] Given the configured Tomo inbox folder does not exist, When I invoke a batch run (no active instruction file), Then a `Notice` "Tomo inbox folder not found: <path>" is shown and no run starts.
  - [ ] Given the configured Tomo inbox folder exists but contains zero `_instructions.json` files, When I invoke a batch run, Then a `Notice` "Tomo inbox is empty — nothing to execute" is shown and no run starts.

#### F2: Schema Validation (fail-closed before any vault write)
- **User Story:** As the PKM Author, I want the executor to refuse to run on malformed or version-mismatched instruction sets before any edit happens, so that broken input cannot corrupt my vault.
- **Acceptance Criteria:**
  - [ ] Given an `_instructions.json` has `schema_version === 1` and the payload conforms to schema v1 (including the new optional per-action `applied` field), When I invoke the executor, Then validation passes and the preview opens.
  - [ ] Given the `_instructions.json` has any other `schema_version` value (missing, 0, 2, "1.1", any non-integer-1), When I invoke the executor, Then validation fails closed with an error *"Schema version mismatch — expected 1, got X"* for that file. No preview, no vault write, no hook run for that file.
  - [ ] Given the `_instructions.json` is not valid JSON, When I invoke the executor, Then validation fails closed with an error naming the parse failure for that file.
  - [ ] Given the JSON is valid but fails schema v1 (unknown `kind`, missing required field, wrong type, duplicate `I##`), When I invoke the executor, Then validation fails closed listing up to 10 schema diagnostics for that file.
  - [ ] In a batch run, a single validation-invalid file does NOT stop the batch. Valid files in the same batch proceed normally; the invalid file is recorded as such in the run log and surfaced in the preview header.
  - [ ] Given any validation failure, When the error surfaces, Then a `Notice` is fired AND the preview modal (if it opened for the batch) shows the failure in its per-file header. The peer `.md` is NEVER written to as a result of validation failure.
  - [ ] Validation completes in under 200 ms per file for instruction sets of ≤ 100 actions on typical desktop hardware.

#### F3: Tri-State Execution Mode and Modal
- **User Story:** As the PKM Author, I want three execution modes — confirm, auto-run with preview, silent — so I can match the executor's ceremony to how much I trust the current run.
- **Acceptance Criteria:**
  - [ ] Given the plugin is installed, When I open MiYo Tomo Hashi settings, Then an *Execution mode* radio group is visible with three options — **Confirm before run** (default), **Auto-run with preview**, **Silent** — and the selection persists across Obsidian sessions.
  - [ ] Given *Confirm before run* is selected, When I invoke the executor on valid input, Then the modal opens listing all actions, shows a "N of M remaining" banner if partial-resume applies, and execution does NOT start until I click **Execute**. **Cancel** aborts before any vault write. Esc has the same effect as Cancel.
  - [ ] Given *Auto-run with preview* is selected, When I invoke the executor on valid input, Then the modal opens listing all actions, shows the same banner, AND execution starts immediately (no Execute click required). The modal stays open in progress mode. **Cancel** halts the run after the current action commits; **Close** is disabled until the run finishes; Esc behaves as Cancel during the run and Close after it.
  - [ ] Given *Silent* is selected, When I invoke the executor on valid input, Then no modal opens; execution starts immediately; on completion an Obsidian `Notice` summarizes the outcome (applied / failed counts + run log file name) — this is the only on-screen cue in this mode.
  - [ ] Modal buttons across all three modes use the labels **Execute** (pre-run), **Cancel** (during-run halt), **Close** (post-run dismiss). The label "Dismiss" does NOT appear anywhere.
  - [ ] The *Silent* option in settings has helper text: *"Runs without any visible preview. A Notice and a run log file are the only cues. Use only when you trust Tomo's review step."*
  - [ ] The preview modal's footer in *Confirm* and *Auto-run with preview* contains the disclosure: *"Approval lives in Tomo's review step. This preview is informational."*
  - [ ] The execution mode is a UX affordance, not an authorization gate: schema validation (F2), path safety (F9), and deny-list checks run identically in all three modes.
  - [ ] Given I `Cancel` an *Auto-run with preview* run while it is in progress, When the in-flight action commits, Then the executor halts before the next action; remaining actions are logged as *"Skipped — run cancelled"*; the `.json` is updated only for actions that committed; the run log records the cancellation.

#### F4: Execute the 8 Action Kinds in Canonical Order
- **User Story:** As the PKM Author, I want the executor to perform each of the 8 action kinds described in Tomo's consumer contract, in the canonical order, against the absolute paths Tomo emits, so that applied edits match the reviewed plan exactly.
- **Acceptance Criteria:**
  - [ ] Within each `_instructions.json`, the executor processes actions in canonical order: `create_moc` → `move_note` → `link_to_moc` → `update_tracker` → `update_log_entry` → `update_log_link` → `delete_source` → `skip`. Within each kind-block, actions execute in monotonic `I##` order.
  - [ ] In a batch run (multiple files), files are processed in alphabetical order by filename; canonical order applies within each file.
  - [ ] All target paths in every action payload are absolute vault-relative paths emitted by Tomo. Hashi does NOT resolve daily-note locations, MOC folders, or any other path — Tomo owns path resolution upstream.
  - [ ] `create_moc`: Given source exists and target is absent, Then the file is moved + renamed to the target path with incoming links preserved. Given target present and source absent, Then no-op (idempotent). Given both present, Then fail *"Inconsistent state — both source and destination present"*; no overwrite.
  - [ ] `move_note`: same semantics as `create_moc`.
  - [ ] `link_to_moc`: Given the target MOC exists (on disk or created earlier in this run via in-set fallback) and the named section is resolvable, Then a bullet line is appended inside the section (end of matched callout, or first editable callout per in-set fallback). Given the identical bullet already exists in that section, Then no-op. Given the MOC is unreachable, Then fail *"MOC target missing"*.
  - [ ] `update_tracker`: Given the target file exists and the tracker field is reachable in the specified mode (`inline_field` / `callout_body` / `checkbox`), Then the field is set to the target value. Given it already holds that value, Then no-op. Given a different value, Then fail *"Tracker field differs from target — not overwriting"*.
  - [ ] `update_log_entry`: Given the target file exists, Then a prose line is inserted at the specified position (`after_last_line` / `before_first_line` / `at_time HH:MM`). Given identical line at that position, Then no-op.
  - [ ] `update_log_link`: Given the target file exists, Then a wikilink line `- [[stem]]` is inserted at the specified position; if `at_time`, prefix is `HH:MM - `. Given identical line, Then no-op.
  - [ ] `delete_source`: Given source exists, Then it is moved to Obsidian trash (system trash when available, else vault-local `.trash/`) — never hard-deleted. Given source already gone, Then no-op.
  - [ ] `skip`: Always a no-op that still ticks `applied: true` and contributes to the progress count.
  - [ ] Destination folder auto-creation: When a move-style action's destination folder does not exist, the executor creates it before the move.
  - [ ] Halt-on-dependency-broken: When a `create_moc I0X` fails, any later `link_to_moc` whose target MOC is that `I0X` is not attempted; it is recorded *"Skipped — dependency I0X failed"* with the ⊘ glyph.
  - [ ] Halt-on-independent-failure: When an action fails for a reason unrelated to later actions, execution continues with the next action.
  - [ ] Every successful action updates the source `_instructions.json` per F5.

#### F5: Applied-State in `_instructions.json` (Source of Truth)
- **User Story:** As the PKM Author, I want the `_instructions.json` itself to record what has been applied, so that state is co-located with the plan, deterministic to read, and trivially handed back to Tomo for follow-up.
- **Acceptance Criteria:**
  - [ ] Schema v1 includes an optional per-action `applied` boolean field. Tomo's renderer emits `applied: false` on every action by default. Hashi reads the field; absence is treated as `applied: false`.
  - [ ] Given an action succeeds, When the executor records the outcome, Then the action's `applied` field in the source `_instructions.json` is set to `true` and the file is saved. This write is atomic (no partial JSON).
  - [ ] Given an action fails or is skipped (dependency / halt / cancel), When the executor records the outcome, Then the `applied` field remains `false`.
  - [ ] Given an action's `applied` field is already `true` when the executor encounters it, When the executor processes that action, Then the action is skipped as already-applied — no re-execution, no error.
  - [ ] The executor NEVER unsets `applied: true` back to `false`. Re-runs are additive only.
  - [ ] The `.md` peer (if present alongside the `.json`) is updated **best-effort** as a side observation: when an action commits, the matching `- [ ] Applied` checkbox under heading `### I## — …` is changed to `- [x] Applied` if the heading and checkbox both exist. Failure to find the heading or write the peer NEVER fails the run — the action remains successful and `applied: true` in the `.json`.
  - [ ] The `.md` peer is NEVER required, NEVER validated for `I##` consistency, and NEVER written to except for the best-effort tick described above.
  - [ ] All JSON writes go through Obsidian's `Vault` API; no raw `fs` writes.

#### F6: Partial-Resume via JSON Applied Flags
- **User Story:** As the PKM Author, I want re-running the executor on a partially-applied set to resume from where it left off, driven by the `.json`'s `applied` flags, so that interrupted runs do not become a burden.
- **Acceptance Criteria:**
  - [ ] Given an `_instructions.json` contains any actions with `applied: true`, When I invoke the executor, Then the preview (or the immediate run in *Silent* mode) shows a banner *"N of M remaining (X already applied — re-run safe)"* at the top.
  - [ ] In a batch run, the banner aggregates across files: *"Batch: 47 of 60 remaining across 3 files"*.
  - [ ] Given previously-applied rows exist, When the preview lists actions, Then those rows are visible at reduced opacity with a ✓ glyph — they are NOT filtered out of the display.
  - [ ] Given all rows are already `applied: true`, When I invoke the executor, Then the banner reads *"0 of M remaining — all actions already applied"*; the Execute button is disabled in *Confirm* mode; the run ends immediately with a Notice in *Auto-run* and *Silent* modes; no vault write occurs.
  - [ ] The `.md` peer's checkbox state has NO bearing on partial-resume — the `.json`'s `applied` flag is the sole authority. Hand-ticked checkboxes in the `.md` peer are ignored for resume purposes.

#### F7: Per-Run Log File
- **User Story:** As the PKM Author, I want every run to leave a per-run log file in the inbox, so that successes and failures have a durable, human- and AI-readable record I can hand back to Tomo for follow-up.
- **Acceptance Criteria:**
  - [ ] Every executor run, regardless of execution mode, produces a Markdown log file at `<tomo-inbox>/tomo-hashi-run-log_YYYY-MM-DDTHHMM.md`. Filename uses the run's start timestamp in local time, minute-precision.
  - [ ] If two runs start in the same minute (rare), a numeric suffix `_N` is appended to disambiguate.
  - [ ] The log file header records: run start timestamp, run end timestamp, execution mode (Confirm / Auto-run / Silent), source(s) (filename(s) of the `_instructions.json`(s) processed), and totals (applied / skipped-already / skipped-dependency / skipped-cancelled / failed).
  - [ ] The log file body lists every action attempted, in execution order, with `I##`, kind, a one-line payload summary, outcome, and (on failure) the error message.
  - [ ] In a batch run, the body is grouped by source file with `## <filename>` sub-headings.
  - [ ] A plugin setting *Run log retention* with two values controls cleanup: **Always keep** (executor never deletes log files; user manages cleanup) and **Only after failed runs** (executor deletes the log file at run end if the run had zero failures). Default: *Always keep*.
  - [ ] Given retention is *Only after failed runs* and a run completes with zero failures, When the run ends, Then the log file is deleted.
  - [ ] Given retention is *Only after failed runs* and a run completes with at least one failure, When the run ends, Then the log file is kept.
  - [ ] Schema-validation-only failures (F2 fail before any action runs for a file) are still recorded in the run log — the file's section in the log shows the validation failure as the only entry.
  - [ ] The run-end Notice references the log file by filename: *"Hashi: A applied, F failed in tomo-hashi-run-log_<timestamp>.md"*. In *Silent* mode this is the only on-screen cue.
  - [ ] No failure is silent: every failed action appears in the modal's error banner (when applicable), in the run summary, and in the log file.
  - [ ] Given the run log file cannot be written (vault permission denied, disk full, or any I/O failure), When the run completes, Then a `Notice` warning *"Hashi: run completed but log file could not be written: <reason>"* is fired and the rest of the run is unaffected (vault state from each successful action is durable in the source `.json`'s `applied` flags).

#### F8: Hooks with Disclosure Setting and Kill-Switch
- **User Story:** As the PKM Author, I want to extend the executor with small Node scripts in a configurable directory, with an enable/disable/ask setting and a master kill-switch, so I am never surprised by what a cloned vault ran on my behalf.
- **Acceptance Criteria:**
  - [ ] A plugin setting *Hooks directory* holds the vault-relative path where hook files live. Default: `.tomo-hashi/hooks/`. The setting accepts any vault-relative path; absolute paths and traversal are rejected and revert to default.
  - [ ] Hook files matching `{before,after}-<action-kind>.js` (e.g., `after-move_note.js`, `before-create_moc.js`) in the configured directory are discovered at run time. There is exactly one hook per `(action-kind, phase)` pair — multiple files for the same key are an error logged in the run log; only the first alphabetical match is loaded for that run.
  - [ ] Hooks are loaded fresh at the start of every run (no in-memory caching across runs). Editing a hook file between runs takes effect on the next run with no manual reload.
  - [ ] A plugin setting *Hooks: enabled | disabled | ask* (default *ask*) governs hook execution.
    - *enabled*: discovered hooks run without prompting.
    - *disabled*: discovered hooks are silently skipped (action runs without them).
    - *ask*: on first detection of a hook in a session, a disclosure modal opens showing the hook path, file size, and three choices: **Enable**, **Enable once**, **Disable**. The choice is remembered for the session; the next session re-prompts.
  - [ ] A separate plugin setting *Disable all hooks* (independent kill-switch) overrides everything: when on, no hook runs regardless of per-hook decisions or the *Hooks* setting.
  - [ ] Hash-based change detection (sha256 disclosure re-prompt) is NOT implemented in v0.1. The user opts in at the directory level via the setting; per-file granularity is in the *ask* mode only.
  - [ ] Hook invocation context: each hook receives `{ action, vault: { read, write, exists, getAbstractFileByPath }, app, runState, logger }` where:
    - `action` is the current action payload (read-only).
    - `vault` is the executor's narrowed facade.
    - `app` is the full Obsidian `App` instance — documented escape hatch.
    - `runState` is a `Record<string, unknown>` shared across all hooks in the same run; reset on each new run; readable and writable.
    - `logger` is `{ info, warn, error }` writing into the run log.
  - [ ] Hook return value: a hook may return `undefined` (silent OK) or an object `{ info?: string[], warnings?: string[], errors?: string[] }`. `errors[]` causes the action to fail with reason *"hook returned errors: <messages>"*. `warnings[]` and `info[]` are recorded in the run log without affecting outcome. Throwing is the hard-failure path (see below).
  - [ ] Hook failure semantics: a `before-…` hook that throws (or returns `errors[]`) causes the action to be skipped with reason *"before-hook threw: <message>"*; the action's `applied` stays `false`. An `after-…` hook that throws (or returns `errors[]`) — the vault write has already committed and `applied: true` is still written, but a separate failure entry *"after-hook threw: <message>"* appears in the run log so the user can investigate.
  - [ ] Hook invocation is wrapped in a 30-second timeout per hook; a hook that exceeds it is killed and treated as a hook failure per the semantics above.
  - [ ] At normal log level: log only run start, run end, totals, and per-action outcomes. Per-hook detail is at debug level only — gated by a plugin setting *Debug logging* (default off).
  - [ ] README and the settings pane both display, in plain language: *"Hooks are Node scripts with full access to your vault, files, network, and shell. Only enable hooks from sources you trust, the same way you would treat a Templater template."*
  - [ ] The plugin never passes any instruction-set field or user-supplied string to `eval`, `Function`, `exec`, or a shell.

#### F9: Path Safety and Deny-List
- **User Story:** As the PKM Author, I want the executor to refuse to operate on sensitive vault locations regardless of what the instruction set says, so that bad input cannot damage my Obsidian / plugin / git / trash state.
- **Acceptance Criteria:**
  - [ ] Validation order for every action is: JSON schema (F2) → path normalization → vault-root containment → deny-list → per-action payload guard → execute. A failure at any stage aborts only that action with a named error (not the whole run, unless F2 fails for the whole file).
  - [ ] Every path in every action payload is normalized via Obsidian's `normalizePath` and resolved via `Vault.getAbstractFileByPath`. Absolute paths, `..` segments after normalization, empty segments, and Windows drive letters are rejected with *"Path escapes vault root"*.
  - [ ] The following deny-list patterns, matched after normalization, cause any action targeting them to fail with *"Path is on deny-list"*: `^\.obsidian(/|$)`, `^\.git(/|$)`, `^\.trash(/|$)`. The deny-list also includes the configured Hooks directory (whatever the user set it to). Deny-list is fixed for v0.1 in all other respects (not user-configurable).
  - [ ] The deny-list applies equally to source paths, destination paths, and any other path field in any action.
  - [ ] Symbolic links that escape the vault root resolve to outside-vault targets and are rejected by the containment check.
  - [ ] Deny-list and containment checks run in all three execution modes — they are not tied to the UI.

#### F10: Status-Bar 橋 Indicator
- **User Story:** As the PKM Author, I want a 橋 (bridge) icon in the status bar that changes color while a run is in progress and after a failure, so I always know whether Hashi is currently executing or last-failed.
- **Acceptance Criteria:**
  - [ ] Given the plugin is installed, When Obsidian renders the status bar, Then a status-bar item displaying the 橋 kanji is present (alongside spec 001's 友 icon, which is independent).
  - [ ] Given no run is active and the previous run had no failures (or no run has happened yet), When I view the status bar, Then the 橋 icon is in its idle color (default theme color).
  - [ ] Given a run is in progress, When the run is active, Then the 橋 icon is rendered green (the *running* state) — the change is an immediate class swap with no animation.
  - [ ] Given a run ends with at least one failure, When the run ends, Then the 橋 icon is rendered red (the *error* state) for ~10 seconds, then returns to the idle color.
  - [ ] Given a run ends with zero failures, When the run ends, Then the 橋 icon returns directly to the idle color.
  - [ ] Given I hover the icon, When the tooltip appears, Then it shows *"Hashi: idle"* (idle), *"Hashi: running — N of M actions"* (running), or *"Hashi: last run had F failures — see <log filename>"* (error).
  - [ ] Given I click the icon while a run is active, When the click is handled, Then the active run's modal (if any) is focused. Click while idle or error is a no-op.
  - [ ] The 橋 icon SHALL NOT animate (no pulse, no opacity transition); state changes are immediate class swaps. No `prefers-reduced-motion` handling is needed.
  - [ ] Screen readers announce run-state changes via an ARIA live region (`polite`).

#### F11: Plugin Settings
- **User Story:** As the PKM Author, I want every executor knob in one settings tab, so I can configure my workflow once and forget about it.
- **Acceptance Criteria:**
  - [ ] The plugin settings tab includes the following settings, in this order, with the named defaults:
    - **Tomo inbox folder** (text) — vault-relative path. Default: empty (must be set before batch invocation works).
    - **Execution mode** (radio: Confirm before run / Auto-run with preview / Silent). Default: *Confirm before run*.
    - **Run log retention** (radio: Always keep / Only after failed runs). Default: *Always keep*.
    - **Hooks directory** (text) — vault-relative path. Default: `.tomo-hashi/hooks` (no trailing slash).
    - **Hooks** (radio: enabled / disabled / ask). Default: *ask*.
    - **Disable all hooks** (toggle, kill-switch). Default: off.
    - **Debug logging** (toggle). Default: off.
  - [ ] All settings persist via Obsidian's `data.json`; no other state is stored outside the vault.
  - [ ] Given the *Tomo inbox folder* is empty or points at a non-existent path, When I attempt a batch invocation, Then a `Notice` *"Tomo inbox folder is not configured — set it in settings"* is shown and no run starts.
  - [ ] Per-hook *ask*-mode decisions (Enable / Enable once / Disable) live **in memory** for the current Obsidian session only; they do NOT persist across Obsidian restarts. After a plugin reload or Obsidian restart, the next invocation that would run a previously-Enabled hook re-prompts via the disclosure modal.
  - [ ] Radio and toggle controls (Execution mode, Run log retention, Hooks policy, Disable all hooks, Debug logging) are domain-bounded by Obsidian's `Setting` API — no invalid value is reachable through the UI. Text inputs (Tomo inbox folder, Hooks dir) reject absolute paths, traversal sequences, and Windows drive letters; on rejection they revert to the previous value and fire a `Notice` naming the rejected pattern.

### Should Have Features

None in v0.1.

### Could Have Features

None in v0.1.

### Won't Have (This Phase)

- **Audit journal** — ADR-009 §6.3 explicitly declined for v0.1; no consumer exists for it without rollback.
- **Rollback / undo across multi-file runs** — recovery paths are: (a) Obsidian's per-file undo for single-edit reversal, (b) the Obsidian core *File Recovery* plugin (recommended in README setup) for accidental losses, (c) the user's regular vault backups. *(Documentation note: the README will plug [obsidian-archivist](https://github.com/MMoMM-org/obsidian-archivist) as a complement once it is public.)*
- **LLM-driven MOC sub-structure insertion** for `link_to_moc` — v0.1 appends at end of matched callout or falls back to first editable callout. Smart section selection is Tomo backlog item F-30.
- **Cross-vault operations** — never. All paths are scoped to the invoking vault by design.
- **Remote instruction sources** (URL-loaded JSON, etc.) — never. Hashi only consumes Tomo-emitted vault files.
- **Hook sandboxing** — never. v0.1 is full-privilege, Templater-equivalent. The trust model is "user enables, user owns".
- **Hook signing or sha256 change detection** — never. The *enabled / disabled / ask* setting plus the kill-switch are sufficient. Per-file integrity tracking is overkill for a single-user vault.
- **Daily-note plugin path resolution** (core Daily Notes / Periodic Notes / etc.) — never. Tomo emits absolute vault-relative paths; Hashi is path-agnostic about what those targets represent.
- **First-run example hook file** — out of scope. Hooks require documentation to be useful; an undocumented example helps no one. Users copy from the README when they need to write one.
- **Per-invocation execution-mode override** — never. The setting is the setting; one-shot overrides multiply surface area without value.
- **Run queue** — never. One run at a time, period.
- **User-configurable deny-list** — fixed in v0.1.
- **Hook hot-reload watching** — not needed. Hooks are loaded fresh at the start of every run.
- **Persisting per-hook *ask*-mode decisions across Obsidian sessions** — out of scope; the prompt re-fires next session.
- **Spec 001 status-bar popover extension** — 002 has its own 橋 indicator (F10). Each spec owns its own status-bar surface.

## Detailed Feature Specifications

### Feature: Execution Lifecycle (orchestrator + 8 kinds + JSON applied write-back + run log + hooks)

**Description:** The executor owns the end-to-end lifecycle from invocation to run-log finalization. It is a single orchestrator that drives: (1) source resolution (one file or whole inbox), (2) per-file schema validation, (3) preview / mode-driven progress UI, (4) ordered action execution with per-action pre/post hooks, (5) per-success applied-flag write-back to the source `.json`, (6) best-effort `.md` peer checkbox tick, (7) per-action failure recording, (8) run log file finalization with retention applied.

**User Flow (observable states):**
1. User invokes executor. Orchestrator resolves source(s) per F1: active instruction file → that one; otherwise → all `_instructions.json` in the configured inbox folder.
2. Single-run lock engages globally. Status-bar 橋 swaps to the green *running* class.
3. For each source file: orchestrator reads the `.json`, validates schema v1 (F2). Validation failures are recorded in the per-file header for the modal (Confirm / Auto-run modes) and written into the run log. The file is then skipped — no action runs.
4. Orchestrator computes the merged remaining-actions list across all valid files. Applied-flags from each `.json` drive partial-resume (F6).
5. Orchestrator consults *Execution mode* (F3). Confirm mode: shows preview, waits. Auto-run mode: shows preview, starts immediately. Silent mode: starts immediately, no modal.
6. For each action in canonical order: load the action's hooks (if any in the configured Hooks directory; F8 disclosure flow may pause here in *ask* mode). Run pre-hook → run handler (F4) → run post-hook → on success, write `applied: true` to the source `.json` (F5) and best-effort tick the `.md` peer.
7. Per failure: row glyph advances to ✗, sticky banner accumulates (when modal visible), execution continues with the next independent action (F4 halt-on-dependency applies to dependents).
8. Run completes (or is cancelled). Orchestrator finalizes the run log file (F7). If retention is *Only after failed runs* and the run was clean, the log file is deleted. Run-end Notice fires. Single-run lock releases. Status-bar 橋 returns to idle.

**Business Rules:**
- Exactly one run at a time, globally. Second invocation while a run is in progress fires a Notice and is dropped (no queue).
- Every vault write goes through Obsidian's Plugin API (`vault.process` for content edits, `fileManager.renameFile` for link-preserving moves, `vault.trash` for deletions, `vault.modify` / `vault.process` for `.json` applied-flag writes).
- Writes are atomic at the file level — the executor never leaves a file in a half-written state.
- The `.json`'s `applied` field is the sole authority for "applied" state. The `.md` peer's checkbox is a side observation.
- Path safety (F9) runs before every vault write, in all three execution modes.
- Hook invocation is gated by F8 (Hooks setting + kill-switch).
- The executor does NOT persist anything outside the vault (no IndexedDB, no global state file). Plugin settings live in Obsidian's per-plugin `data.json`.

**Edge Cases:**
- Inbox folder is misconfigured or empty → batch run aborts with a Notice; one-file runs (active instruction file) still work.
- A `.json` in the inbox is malformed → that file is skipped per F2; other files in the batch proceed; the run log records the failure.
- Mid-run cancellation in *Auto-run with preview* mode → executor halts after the current action commits; remaining actions logged as *"Skipped — run cancelled"*; partial-resume on next invocation picks up cleanly.
- `.md` peer is missing for a `.json` → no warning, no error; the `.json`'s `applied` flag is still written; a debug-level note records the missing peer.
- `.md` peer is present but lacks the `### I## — …` heading for an action → the best-effort tick silently fails for that action; debug-level log entry; action remains successful with `applied: true`.
- Peer `.md` is open in another editor pane while the executor ticks → use `vault.process` so Obsidian reconciles the open editor without fighting user input.
- Tomo emits a `.json` without the `applied` field on actions → Hashi treats absence as `applied: false` and writes `applied: true` on success regardless. (Tomo v0.7.0 ships the field; this graceful-tolerance path is a defensive safety net, not the v0.1 happy path.)
- Schema v2 instruction set ships from Tomo before Hashi upgrades → F2 fails closed, version-mismatch error pointing at the schema-version-pinning contract.
- Hook file is a valid JS module but exports nothing → executor treats it as "no hook defined" and proceeds without error.
- Hook's infinite loop → 30-second timeout kills it; action treated as hook failure per F8.
- User toggles *Disable all hooks* mid-run → does NOT apply to the in-flight run; new runs honour the new setting.
- Two runs scheduled in the same minute (rare) → second run-log file gets `_2` suffix (F7 disambiguation).
- `_instructions.json` contains 0 actions → preview shows "0 of 0 remaining"; *Execute* disabled; no-op; no `.json` write; run log records the empty file.
- Single `skip` action → executes, sets `applied: true`, no other side effect; counts as 1 applied in the summary.
- Inbox contains 50 `_instructions.json` files at once → batch preview shows 50 file headers; merged list may be long; modal must scroll. (Performance note: F2 budget of 200 ms/file means worst-case 10 s validation for 50 files — acceptable for v0.1; SDD may decide to validate lazily.)
- Obsidian closes mid-run → in-memory state is lost, but each `applied: true` was committed atomically before its action's checkbox tick, so the next run sees correct state. The run log is finalized only at run end; an interrupted run leaves a partial log file (orphaned write-attempts), which the user can delete or rename to keep history.

## Success Metrics

### Key Performance Indicators

MiYo v0.1 is a private single-user system; cohort adoption metrics do not apply. Success is acceptance-coverage based:

- **Adoption:** v0.1 release gate (architecture-06 §10) — executor runs end-to-end against a live Tomo-produced `_instructions.json` containing at least one base instruction-execution operation, with the `applied` field round-trip verified. Success = gate passed.
- **Engagement:** The owner can complete the primary user journey (inbox-batch drain) and the secondary (partial-resume) without touching the filesystem directly. Success = journey is achievable end-to-end.
- **Quality:** 100% of the acceptance criteria in this PRD pass in automated tests. Unit tests (vitest + jsdom with fake VaultFS) cover every action handler, the planner, the JSON applied-writer, the schema validator, the run-log writer, and the hook runner. Live tests cover end-to-end execution against a temp vault.
- **Safety:** Zero vault writes occur on any malformed or schema-mismatched input (F2 fail-closed assertion). Verified by fixture tests.
- **Unattended honesty:** Every failure in a *Silent* run is recorded in both the run-end Notice and the run log file (F7 assertion). Verified by fixture tests.
- **Tomo handoff round-trip:** The `applied` field round-trips correctly: Tomo writes `false`, Hashi flips to `true` on success, Tomo's next session can read both states. Verified by an integration fixture authored alongside the Tomo handoff.

### Tracking Requirements

No telemetry in v0.1. "Tracking" means verification points for the automated test suite:

| Event | Properties | Purpose |
|-------|------------|---------|
| invocation.source | surface (palette / file-menu); active-file-kind (md-peer / json / other / none); resolved-files-count | Verify F1 resolution rules for one-file vs batch |
| invocation.declined | reason (run-in-progress / inbox-not-configured / inbox-empty) | Verify rejection paths |
| validation.outcome | filename; outcome (ok / version-mismatch / parse-error / schema-diagnostics); diag-count | Verify F2 fail-closed for every variety |
| preview.mode | mode (confirm / auto-run / silent); partial-resume (true/false); remaining/total; file-count | Verify tri-state honored and banner renders correctly (F3, F6) |
| action.start | source-file; kind; I##; hook-pre (true/false) | Verify canonical order (F4) and per-action hook firing (F8) |
| action.outcome | source-file; kind; I##; result (applied / skipped-already / skipped-dependency / skipped-cancelled / failed); reason | Verify idempotency, halt-on-dependency, failure isolation |
| json.applied_write | source-file; I##; prior-state (false / undefined) | Verify F5 atomic write of `applied: true` |
| md_peer.tick | source-file; I##; outcome (ticked / heading-missing / peer-missing) | Verify F5 best-effort behavior |
| hook.disclosure | path; decision (enable / enable-once / disable) | Verify F8 *ask* mode |
| hook.invocation | path; action-kind; I##; phase (before / after); duration-ms; outcome (ok / threw / timeout / returned-errors) | Verify F8 hook semantics |
| path.denied | path; reason (deny-list / containment / absolute / traversal) | Verify F9 for every variety |
| run.summary | applied; skipped-already; skipped-dependency; skipped-cancelled; failed; duration-ms; mode; files-processed | Verify run stats and Notice content (F7) |
| run_log.write | path; size; retention-action (kept / deleted-clean) | Verify F7 retention |
| status_bar.state | state (idle / running); progress (N/M when running) | Verify F10 |

---

## Constraints and Assumptions

### Constraints
- **Schema:** `_instructions.json` `schema_version === 1` exactly. Schema v1 includes the new optional per-action `applied: boolean` field. Tomo's renderer must emit this field before Hashi's v0.1 release — captured as an outbound handoff in `_outbox/for-tomo/`.
- **Platform:** Desktop Obsidian only. `manifest.json` currently has `"isDesktopOnly": false` — known drift (shared with spec 001) that MUST be corrected to `true` before any release. Spec 001's plan phase owns the fix.
- **Single-vault scope:** The executor operates only on files inside the invoking vault root.
- **Obsidian API version:** Relies on `Vault.process` (Obsidian ≥ 1.4). `manifest.json` declares `minAppVersion: 1.5.7`, sufficient.
- **No external inbound surface:** No ports, no webhooks, no MCP. Inviolable for v0.1 — shared with spec 001's architectural commitment.
- **Trust model:** The executor trusts the user absolutely (single-user private system). It does NOT trust the instruction set — it validates schema and path safety for defense-in-depth even though Tomo's review step is the authorization gate.
- **Hook trust model:** Templater-equivalent — full plugin privilege. The compensating control is the *enabled / disabled / ask* setting + the kill-switch. No sandboxing, no signing, no per-file integrity tracking.
- **Dependencies:** SDD must add a JSON schema validator (research recommendation: ajv 8.x in standalone-codegen mode). No other new runtime deps required by this PRD.
- **Idempotency semantics:** Re-apply where states match = no-op. Inconsistent state (both source and destination present for move-style actions) = fail, never overwrite. These semantics are authored by Tomo's consumer contract and honored by every handler.
- **Durable state:** The source `_instructions.json` carries cross-session `applied` state. Per-run log files in the inbox carry historical detail. Plugin settings live in Obsidian's per-plugin `data.json`. No other Hashi-owned state files.

### Assumptions
- The user has reviewed each instruction set in Tomo's review step before invoking the executor. The preview is a UX affordance, not a substitute for review.
- **Tomo's renderer ships the `applied: false` field per action before Hashi's v0.1 release.** This is a blocking prerequisite captured in `_outbox/for-tomo/`. Hashi tolerates absence (treats missing as `false`) but the v0.1 release gate requires the round-trip working.
- The user has populated the *Tomo inbox folder* setting before invoking a batch run. One-file runs (active instruction file) work without it.
- Tomo emits absolute vault-relative paths in every action payload (no daily-note resolution in Hashi).
- Tomo writes `_instructions.json` files into the configured inbox folder. Hashi does not assume a specific filename pattern beyond the `.json` extension and presence of a `schema_version: 1` field.
- Users who write hooks take the Templater-equivalent trust posture seriously. The setting + kill-switch are detective + opt-in, not preventive.
- Out-of-sandbox paths referenced in this PRD (the Tomo repo, Kokoro's ADR-009, architecture-06) are not directly readable in the current research environment; their authoritative summaries in spec README + research.md are treated as authoritative. SDD phase should re-check once the Tomo repo is reachable.

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Tomo doesn't ship the `applied` field by v0.1 release | High — partial-resume becomes lossy; round-trip to Tomo broken | Low (handoff is small and the user controls the Tomo timeline) | Outbound handoff in `_outbox/for-tomo/` authored at PRD phase exit; v0.1 release gate explicitly verifies round-trip |
| Tomo ships schema v2 before Hashi upgrades | High — every new instruction set fails closed on Hashi side | Medium — active development on both sides | Fail-closed with explicit version-mismatch error per file; outbound handoff requesting `CHANGELOG.md` entries on every schema change |
| Hook clone attack (user clones a vault that includes malicious hook files) | High — full-privilege hooks can exfiltrate, overwrite, exec | Low in single-user v0.1, Medium if shared vaults emerge | *Hooks: ask* default + kill-switch + README/settings disclosure language; no sha256 tracking |
| Deny-list is not comprehensive | Medium — a future `.hidden/credentials/` directory could be written | Low for v0.1 (fixed vault structure) | v0.1 deny-list covers `.obsidian`, `.git`, `.trash`, plus the configured Hooks directory; documented as "fixed for v0.1" |
| Schema validation too permissive — payload conforms to schema but is semantically wrong (e.g., `link_to_moc` targeting a non-MOC file) | Medium — surfaces as per-action failure rather than pre-check | Medium | Per-action handlers validate semantics at execute time; schema validator enforces structure but not semantics; future schema-v2 may tighten |

## Open Questions

None. All research-phase questions and the 2026-04-25 user revision round were settled before this version. Any new clarifications surfacing during SDD will be recorded in the spec README's Decisions Log.

---

## Supporting Research

### Competitive Analysis
Not applicable. MiYo is a private PKM system. Reference points from the Obsidian plugin ecosystem: **Templater** (explicit hook trust-model analogue — arbitrary JS executed with plugin privilege; user-trusted by convention, not sandboxed), **Dataview** inline fields (syntax the `update_tracker` inline_field mode mimics), Obsidian core **File Recovery** plugin (recommended in README setup as a complement to vault backups), [obsidian-archivist](https://github.com/MMoMM-org/obsidian-archivist) (planned README mention as a backup tool once public).

### User Research
Single-user system; formal research not applicable. A 5-perspective agent-team research phase (Requirements, Technical, Security, Integration, UX) was executed on 2026-04-24 and is synthesized in `docs/XDD/specs/002-instruction-executor/research.md`. A user revision round on 2026-04-25 inverted the "`.md` peer as source of truth" assumption to "`.json` is source of truth, `.md` peer is best-effort", introduced inbox-batch invocation, replaced in-peer error blocks with per-run log files, dropped sha256 hook disclosure, dropped daily-note plugin resolution, dropped the example hook, and added a status-bar 橋 indicator. Surviving conclusions from the original research:
- Ports-and-adapters architecture (mirroring spec 001's ADR-5) is the right fit for "keep handlers pure, isolate Obsidian API at the edge". Handlers are testable against an in-memory `FakeVaultFS`.
- `fileManager.renameFile` is required (not `vault.rename`) for link preservation.
- JSON schema validation is best handled by ajv 8.x in standalone-codegen mode.

### Outbound Handoffs (PRD-phase)

The following handoffs MUST be authored at PRD-phase exit and tracked through plan-phase implementation:

- `_outbox/for-tomo/2026-04-25_hashi-to-tomo_applied-field.md` — **status: done** (Tomo v0.7.0, commit `f3ad49d`, branch `feat/applied-field-instructions`). `applied: false` is now stamped on every action by `build_actions()` in `tomo/scripts/instruction-render.py`; shared `$defs/applied_field` added to `tomo/schemas/instructions.schema.json` across all 8 variants; round-trip test in `tests/test-008-phase1.py`; consumer doc updated. Schema stays v1 (the field is additive and optional). The graceful-tolerance path in F5 (treat absent as `false`) remains as a defensive safety net but is not the v0.1 path.

### Market Data
Not applicable. Private plugin, single user.

### References
- Spec README: `docs/XDD/specs/002-instruction-executor/README.md`
- Research synthesis: `docs/XDD/specs/002-instruction-executor/research.md` (5 perspectives; 2026-04-24)
- Spec 001 README + requirements.md (pattern source for PRD structure, ports-and-adapters, `Store<T>`, unit + live test split)
- Spec 001 decisions log — 2026-04-24 brainstorm pivot (decoupled 002 from 001)
- ADR-009 §3 Instruction-Set Execution Model, §6.1 Hook Delivery, §6.2 Preview Modal, §6.3 No Audit Journal (external; summarized in spec README)
- Architecture 06 §6 Instruction-Set Execution Model, §10 v0.1 Release Gate (external; summarized in spec README)
- Tomo consumer contract: `/Volumes/Moon/Coding/MiYo/Tomo/docs/instructions-json.md` (not reachable from research sandbox — work from spec README summaries; SDD to re-verify)
- Tomo JSON Schema: `/Volumes/Moon/Coding/MiYo/Tomo/tomo/schemas/instructions.schema.json` (same caveat)
- Onboarding handoff: `_inbox/from-kokoro/2026-04-23_kokoro-to-hashi_onboarding-charter-contract-and-v01-scope.md`
