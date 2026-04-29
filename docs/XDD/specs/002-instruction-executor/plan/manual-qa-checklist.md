---
title: "Manual QA Checklist — 002 Instruction Executor"
status: pending
version: "1.0"
generated: 2026-04-29
target_vault: ../temp/Privat-Test
---

# Manual QA Checklist

> Run this checklist in real Obsidian against `../temp/Privat-Test` before
> declaring v0.1 release-gate met. Build deploy enabled via
> `HASHI_DEPLOY_PRIVAT=1 npm run build`. At least one Tomo-emitted
> instruction set must be present in the configured inbox folder.
>
> This file is the **manual-observation gate** for v0.1 — every PRD AC that
> requires real-Obsidian eyes-on-screen verification has a row here. ACs
> that are pure unit-testable (data validation, schema parsing, return
> values) are NOT in this file — they are covered by the unit suite.

## Setup

- [ ] Run `HASHI_DEPLOY_PRIVAT=1 npm run build` — confirm `[deploy] Plugin copied` log line in output
- [ ] Reload `../temp/Privat-Test` in Obsidian (close + reopen vault, or `Ctrl+P` → "Reload app without saving")
- [ ] Enable `miyo-tomo-hashi` in Settings → Community plugins
- [ ] Open Settings → MiYo Tomo Hashi; configure `tomoInboxFolder` to a folder with at least one `*_instructions.json` file (use a Tomo-emitted file or a fixture)
- [ ] Configure `hooksDir` to an empty folder (or one containing a `before-create_moc.cjs` test hook for the hook-disclosure path)
- [ ] Pick `executionMode: confirm` for the first walk-through; you will revisit `auto-run` and `silent` later
- [ ] Open DevTools (Ctrl+Shift+I) and watch the Console panel for errors throughout

## End-to-end scenarios

> These are full workflow walks (not single ACs). Replaces the obsolete
> T6.3 live-test scenario list per ADR-9 v2.

| Scenario | Walk | Pass | Notes |
|----------|------|------|-------|
| happy-path | 8-action mixed-kind set; all succeed; `applied: true` everywhere; run log shows 8 lines; peer `.md` ticked best-effort | | |
| partial-resume | Pre-mark 5 of 12 actions as `applied: true` in the JSON; run; only 7 execute; banner reads "7 of 12 remaining (5 already applied — re-run safe)" | | |
| halt-on-dependency | `create_moc I03` fails (target folder restricted); dependent `link_to_moc` records as `skipped-dependency`; non-dependent actions still run | | |
| batch-multi-file | 3 instruction sets in inbox; merged execution; per-file headers in run log; banner aggregates across files | | |
| schema-invalid-version | File with `schema_version: 2` fails F2; other files in batch proceed; invalid file shown as failure in preview header | | |
| peer-missing | `.md` peer not on disk; run still completes; warning recorded; `applied: true` written to JSON | | |
| silent-mode | `executionMode: silent`; no modal; Notice fires at end; run log written | | |
| cancellation | Click Cancel mid-run in auto-run mode; remaining actions logged as `skipped-cancelled`; run log records cancellation | | |

## Invocation paths (PRD F1)

| AC | Expected | Observed | Pass | Notes |
|----|----------|----------|------|-------|
| F1.palette.md-peer | With active editor on an `.md` peer file: command palette → "Execute instructions document" runs the executor against that one set | | | |
| F1.palette.json | With active editor on an `_instructions.json`: command runs against that one set | | | |
| F1.palette.batch | With no active file (or unrelated file): command runs batch invocation across `tomoInboxFolder` | | | |
| F1.menu.md-peer | Right-click on `.md` peer in file explorer → "Execute instructions…" entry visible | | | |
| F1.menu.json-hidden | Right-click on `.json` instructions file → entry NOT visible (per PRD F1) | | | |
| F1.menu.unrelated-hidden | Right-click on regular `.md` note (no peer `.json`) → entry NOT visible | | | |
| F1.lock.notice | Invoke executor while a run is in progress → Notice "Execution already in progress"; no second run starts | | | |
| F1.inbox-missing | With `tomoInboxFolder` set to a non-existent path: invoke batch → Notice "Tomo inbox folder not found: <path>"; no run starts | | | |
| F1.inbox-empty | With `tomoInboxFolder` set to an empty folder: invoke batch → Notice "Tomo inbox is empty — nothing to execute"; no run starts | | | |
| F1.no-auto | Confirm executor never runs on file save / file create / vault load — only explicit user action triggers it | | | |

## Schema validation (PRD F2)

| AC | Expected | Observed | Pass | Notes |
|----|----------|----------|------|-------|
| F2.batch-isolated | One invalid `.json` in batch does NOT stop the batch; valid files proceed; invalid file appears in preview header | | | |
| F2.notice-on-fail | On any validation failure: Notice fires AND modal per-file header shows the failure; peer `.md` is NOT written | | | |
| F2.preview-on-pass | Schema v1 happy file: validation passes, preview opens cleanly | | | |

## Modal — preview mode (PRD F3, F6)

| AC | Expected | Observed | Pass | Notes |
|----|----------|----------|------|-------|
| F3.confirm.opens | `executionMode: confirm` → modal opens listing all actions before any vault write | | | |
| F3.confirm.banner-resume | With pre-applied actions: banner shows "N of M remaining (X already applied — re-run safe)" | | | |
| F3.confirm.execute | Click Execute → run starts | | | |
| F3.confirm.cancel-pre | Click Cancel before run starts → modal closes; no vault write occurred | | | |
| F3.confirm.esc-pre | Press Esc before run starts → same effect as Cancel | | | |
| F3.autorun.opens | `executionMode: auto-run` → modal opens AND run starts immediately, no Execute click required | | | |
| F3.autorun.cancel-mid | Click Cancel mid-run → run halts after current action commits; remaining marked `skipped-cancelled` | | | |
| F3.autorun.close-disabled | While run is in progress: Close button is disabled | | | |
| F3.autorun.esc-mid | Press Esc during run → behaves as Cancel; after run → behaves as Close | | | |
| F3.silent.no-modal | `executionMode: silent` → no modal opens; run starts immediately | | | |
| F3.silent.notice | Silent run completes → Notice with applied/failed counts and run log filename | | | |
| F3.button-labels | Modal buttons are exactly **Execute** / **Cancel** / **Close** — the word "Dismiss" does NOT appear anywhere | | | |
| F3.silent-helper | Settings panel: Silent option has helper text "Runs without any visible preview…" | | | |
| F3.disclosure-footer | Confirm + Auto-run modal footer shows: "Approval lives in Tomo's review step. This preview is informational." | | | |

## Modal — progress mode (PRD F3, F4)

| AC | Expected | Observed | Pass | Notes |
|----|----------|----------|------|-------|
| F3.progress.row-glyphs | Per-action rows update with running glyph → ✓ on success / ✗ on fail / ⊘ on skipped-dependency / ✓-faded on already-applied | | | |
| F3.progress.error-banner | On any action failure: sticky error banner accumulates, listing failed actions | | | |
| F3.progress.canonical-order | Actions visibly run in canonical order: create_moc → move_note → link_to_moc → update_tracker → update_log_entry → update_log_link → delete_source → skip | | | |
| F3.progress.batch-headers | Batch run: per-file `📄 <filename>` sub-headers visible in modal between file groups | | | |

## Modal — summary mode (PRD F3, F7)

| AC | Expected | Observed | Pass | Notes |
|----|----------|----------|------|-------|
| F3.summary.totals | After run: summary shows applied / skipped-already / skipped-dependency / skipped-cancelled / failed counts + duration | | | |
| F3.summary.log-link | Summary references the run log filename and is clickable / openable | | | |
| F3.summary.close | Close button available and dismisses modal | | | |

## Partial-resume (PRD F6)

| AC | Expected | Observed | Pass | Notes |
|----|----------|----------|------|-------|
| F6.banner.single | Single file with some applied: banner reads "N of M remaining (X already applied — re-run safe)" | | | |
| F6.banner.batch | Batch: banner aggregates "Batch: N of M remaining across K files" | | | |
| F6.row-faded | Already-applied rows render at reduced opacity with ✓ glyph; NOT filtered out of view | | | |
| F6.all-applied.disabled | All actions already applied + confirm mode: banner reads "0 of M remaining — all actions already applied"; Execute disabled | | | |
| F6.all-applied.silent | All applied + silent mode: run ends immediately with Notice; no vault write | | | |
| F6.peer-checkbox-ignored | Hand-ticked checkboxes in `.md` peer have NO bearing on resume — JSON `applied` flag is sole authority | | | |

## 8 action kinds — observable outcomes (PRD F4, F5)

| AC | Expected | Observed | Pass | Notes |
|----|----------|----------|------|-------|
| F4.create_moc.move | `create_moc`: source file moves + renames to target; incoming links preserved (verify by `[[link]]` to source still resolves) | | | |
| F4.create_moc.idempotent | Re-run create_moc on already-applied state: no-op, no error | | | |
| F4.create_moc.both-present | Both source AND target on disk → fail "Inconsistent state — both source and destination present"; no overwrite | | | |
| F4.move_note.preserves-links | `move_note`: incoming links to the note still resolve after move (use Ctrl+click to verify) | | | |
| F4.link_to_moc.append | `link_to_moc`: bullet appended inside the matched callout in the MOC | | | |
| F4.link_to_moc.duplicate | Re-run with identical bullet already present: no-op | | | |
| F4.link_to_moc.missing-moc | MOC target missing → action fails with "MOC target missing" | | | |
| F4.update_tracker.set | `update_tracker`: target field is set to target value (verify in tracker file) | | | |
| F4.update_tracker.idempotent | Re-run with same value: no-op | | | |
| F4.update_tracker.differs | Existing field has DIFFERENT value: applied; field overwritten to target value (Tomo's intent wins on overwrite) | | | |
| F4.update_tracker.inline-bracketed | `inline_field` matcher recognises bracketed form `[Sport:: true]` mid-prose; matched form preserved byte-for-byte on overwrite | | | |
| F4.update_tracker.inline-paren | `inline_field` matcher recognises parenthesized form `(Sport:: true)` mid-prose; matched form preserved byte-for-byte on overwrite | | | |
| F4.update_tracker.inline-bullet | `inline_field` matcher recognises bullet-prefixed line `- Sport:: true`; bullet/indent preserved on overwrite | | | |
| F4.update_tracker.multi-word | `inline_field` + `callout_body` match multi-word field names verbatim (`For Me`, `Learned Words`) | | | |
| F4.update_log_entry.insert | `update_log_entry`: line shape `- <content>` for after/before; `- HH:MM: <content>` for at_time | | | |
| F4.update_log_link.insert | `update_log_link`: line shape `- [[stem]]` for after/before; `- HH:MM: [[stem]]` for at_time (aligned with `update_log_entry`) | | | |
| F4.delete_source.trash | `delete_source`: source goes to Obsidian trash (system trash where available, else `.trash/`) — never hard-deleted | | | |
| F4.delete_source.idempotent | Re-run when source already gone: no-op | | | |
| F4.skip.no-op | `skip` action: ticks `applied: true`, contributes to count, no other side effect | | | |
| F4.dest-folder-create | Move-style action whose destination folder doesn't exist → folder is auto-created before the move | | | |
| F4.halt-on-dep.broken | `create_moc I0X` fails → later `link_to_moc` targeting `I0X` records as "Skipped — dependency I0X failed" with ⊘ glyph | | | |
| F4.halt-on-dep.independent | Action fails for unrelated reason → execution continues with next action | | | |
| F5.json-applied-write | Successful action: source `.json` file shows `applied: true` for that I## (verify by reopening the file) | | | |
| F5.peer-checkbox-tick | Successful action: matching `- [ ] Applied` under `### I## — …` heading in `.md` peer flips to `- [x] Applied` | | | |
| F5.peer-missing-no-fail | `.md` peer file missing entirely: action still completes; `applied: true` still written to JSON | | | |
| F5.peer-heading-missing | Peer present but no matching `### I## — …` heading: tick silently fails; action remains successful | | | |

## Status bar 橋 indicator (PRD F10)

| AC | Expected | Observed | Pass | Notes |
|----|----------|----------|------|-------|
| F10.present | 橋 kanji icon visible in status bar (alongside spec 001's 友 icon) | | | |
| F10.idle.color | No active run + no recent failure: 橋 in idle color (default theme) | | | |
| F10.running.green | Run in progress: 橋 turns green; class swap is immediate (no animation) | | | |
| F10.error.red | Run completed with at least one failure: 橋 turns red for ~10 seconds, then back to idle | | | |
| F10.clean.idle | Run completed with zero failures: 橋 returns directly to idle (no red flash) | | | |
| F10.tooltip.idle | Hover while idle: tooltip "Hashi: idle" | | | |
| F10.tooltip.running | Hover during run: tooltip "Hashi: running — N of M actions" | | | |
| F10.tooltip.error | Hover after failure: tooltip "Hashi: last run had F failures — see <log filename>" | | | |
| F10.click.running | Click 橋 while run active: focuses the run's modal | | | |
| F10.click.idle.noop | Click 橋 while idle: no menu, no popover (deliberate no-op) | | | |
| F10.click.error.noop | Click 橋 while in red error state: no-op (filename is in tooltip) | | | |
| F10.no-animation | Confirm: no pulse, no opacity transition — only immediate class swaps | | | |
| F10.aria-live | Screen reader (VoiceOver `Cmd+F5`): run-state changes announced via ARIA live region (polite) | | | |

## Hook disclosure modal (PRD F8 ask-mode)

| AC | Expected | Observed | Pass | Notes |
|----|----------|----------|------|-------|
| F8.disc.opens | With `hooksPolicy: ask` and a hook file in `hooksDir`: disclosure modal opens on first matching action | | | |
| F8.disc.path | Modal shows vault-relative hook path | | | |
| F8.disc.size | Modal shows file size in bytes | | | |
| F8.disc.enable | "Enable" button: hook runs; future actions in this session do NOT re-prompt for the same hook | | | |
| F8.disc.enable-once | "Enable once": hook runs this turn; next action that would invoke it re-prompts | | | |
| F8.disc.disable | "Disable": hook does NOT run; action proceeds without it; next invocation re-prompts | | | |
| F8.disc.esc | Press Esc → closes modal as if "Disable" was pressed | | | |
| F8.disc.session-only | Reload Obsidian → previously-Enabled hooks re-prompt on next invocation (decisions are session-only) | | | |

## Hook execution (PRD F8 enabled)

| AC | Expected | Observed | Pass | Notes |
|----|----------|----------|------|-------|
| F8.exec.context | Hook receives `{ action, app, logger }`; verify by writing a hook that logs `Object.keys(arguments[0])` | | | |
| F8.exec.return-undefined | Hook returns undefined: silent OK; action proceeds | | | |
| F8.exec.return-info | Hook returns `{ info: ['msg'] }`: messages appear in run log; action proceeds | | | |
| F8.exec.return-warnings | Hook returns `{ warnings: ['msg'] }`: messages appear in run log; action proceeds | | | |
| F8.exec.return-errors | Hook returns `{ errors: ['msg'] }`: action fails with reason "hook returned errors: <messages>" | | | |
| F8.exec.before-throws | `before-…` hook throws: action skipped with reason "before-hook threw: <message>"; `applied` stays `false` | | | |
| F8.exec.after-throws | `after-…` hook throws: vault write already committed; `applied: true` is written; separate failure entry "after-hook threw: …" appears in run log | | | |
| F8.exec.timeout | Hook with infinite loop: killed at 30s timeout; treated as hook failure | | | |
| F8.exec.kill-switch | Set `hooksPolicy: disabled` → hooks silently skipped on next run; action runs without them | | | |
| F8.exec.fresh-load | Edit a hook file between two runs → next run picks up the change with no manual reload | | | |
| F8.exec.duplicate-keys | Two hook files for same `(kind, phase)` → error logged in run log; only first alphabetical loaded | | | |

## Path safety / deny-list (PRD F9 — observe error-surfacing)

| AC | Expected | Observed | Pass | Notes |
|----|----------|----------|------|-------|
| F9.deny.obsidian | Action targeting `.obsidian/...` path: fails with "Path is on deny-list" | | | |
| F9.deny.git | Action targeting `.git/...`: same | | | |
| F9.deny.trash | Action targeting `.trash/...`: same | | | |
| F9.deny.hooks-dir | Action targeting the configured hooks directory: same | | | |
| F9.containment.absolute | Action with absolute path / `..` traversal: fails "Path escapes vault root" | | | |
| F9.symlink-escape | Vault-internal symlink pointing outside the vault: fails with `path-symlink-escape` (realpath check) — note: hard to set up, skip if no clean way to construct one | | | |
| F9.modes-equal | Same path-safety errors fire identically in confirm / auto-run / silent modes | | | |

## Run log file (PRD F7)

| AC | Expected | Observed | Pass | Notes |
|----|----------|----------|------|-------|
| F7.filename | Log file appears in inbox at `tomo-hashi-run-log_YYYY-MM-DDTHHMM.md`; timestamp is run start, local time, minute precision | | | |
| F7.collision-suffix | Two runs in the same minute: second log file has `_2` suffix | | | |
| F7.header | Log header records: run start, run end, execution mode, source filename(s), totals (applied / skipped-already / skipped-dependency / skipped-cancelled / failed) | | | |
| F7.body | Log body lists every action attempted with I##, kind, payload summary, outcome; failure entries include the error message | | | |
| F7.payload-verbatim | Free-text fields (`update_tracker.value`, `update_log_entry.line`) appear verbatim — no fingerprint, no truncation, no redaction | | | |
| F7.batch-grouping | Batch run: body grouped by source file with `## <filename>` sub-headings | | | |
| F7.retention.always-keep | `runLogRetention: always-keep` + zero-failure run → log file remains in inbox | | | |
| F7.retention.only-failed | `runLogRetention: only-after-failed-runs` + zero-failure run → log file is deleted at run end | | | |
| F7.retention.only-failed-keeps | Same setting + at-least-one-failure run → log file is kept | | | |
| F7.schema-fail-recorded | Schema-validation-only failure (F2 fail): file's section in log shows the validation failure as the only entry | | | |
| F7.notice-references-log | Run-end Notice text mentions log filename: "Hashi: A applied, F failed in tomo-hashi-run-log_<timestamp>.md" | | | |
| F7.write-failure-notice | Disable inbox folder write permission, run executor: Notice "Hashi: run completed but log file could not be written: <reason>"; vault state still consistent (durable in JSON `applied` flags) | | | |

## Settings tab (PRD F11)

| AC | Expected | Observed | Pass | Notes |
|----|----------|----------|------|-------|
| F11.tab-present | Settings → MiYo Tomo Hashi tab is visible | | | |
| F11.order | Settings appear in this order: Tomo inbox folder, Execution mode, Run log retention, Hooks directory, Hooks (policy), Debug logging | | | |
| F11.inbox.text | "Tomo inbox folder" is a text field; default empty | | | |
| F11.exec-mode.radio | "Execution mode" is a radio with three options; default "Confirm before run" | | | |
| F11.retention.radio | "Run log retention" is a radio with two options; default "Always keep" | | | |
| F11.hooks-dir.text | "Hooks directory" is a text field; default `.tomo-hashi/hooks` (no trailing slash) | | | |
| F11.hooks.radio | "Hooks" is a radio with three options (enabled / disabled / ask); default "ask"; helper text confirms `disabled` is the kill-switch | | | |
| F11.debug.toggle | "Debug logging" is a toggle; default off | | | |
| F11.persist | Change each setting; reload Obsidian; values persist via `data.json` | | | |
| F11.inbox-empty.notice | Inbox empty/non-existent + batch invocation → Notice "Tomo inbox folder is not configured — set it in settings" | | | |
| F11.text-rejection | Enter absolute path or `..` traversal in inbox/hooks-dir: input reverts to previous value AND Notice names the rejected pattern | | | |

## Edge cases — PRD edge case bullets

| AC | Expected | Observed | Pass | Notes |
|----|----------|----------|------|-------|
| edge.empty-inbox | Configured inbox folder is empty → batch run aborts with Notice; one-file runs still work | | | |
| edge.malformed-json | One `.json` in inbox is malformed → that file skipped per F2; other files proceed; run log records failure | | | |
| edge.peer-open-in-pane | `.md` peer is open in another editor pane while executor ticks → `vault.process` reconciles cleanly; no fight with user input | | | |
| edge.applied-field-missing | Tomo emits a `.json` without per-action `applied` field → Hashi treats absence as `false` and writes `true` on success | | | |
| edge.schema-v2 | Schema v2 file → F2 fails closed; user-facing message points at the version mismatch | | | |
| edge.hook-empty-export | Hook file exports nothing → executor treats as "no hook defined" and proceeds without error | | | |
| edge.hook-infinite-loop | Hook with infinite async hang → 30s timeout kills it (already covered in F8.exec.timeout but verify edge surfaces no console error) | | | |
| edge.kill-switch-mid-run | Flip `hooksPolicy: disabled` mid-run → does NOT apply to in-flight run; new runs honor the new value | | | |
| edge.two-runs-same-minute | Trigger second run quickly so it starts in the same minute → run log gets `_2` suffix | | | |
| edge.zero-action-set | `_instructions.json` with 0 actions → preview shows "0 of 0 remaining"; Execute disabled; no JSON write; run log records the empty file | | | |
| edge.50-files | 50 `.json` files in inbox at once → batch preview shows 50 file headers; modal scrolls; total runtime acceptable | | | |
| edge.obsidian-closes-mid-run | Force-quit Obsidian mid-run; reopen; verify each `applied: true` already committed before quit is durable in JSON; partial run log present (orphaned write attempts OK) | | | |
| edge.symlink-out | Vault contains symlink pointing outside vault root → action targeting it fails `path-symlink-escape` (also covered in F9) | | | |

## Release gate

- [ ] All checklist rows above marked Y in Pass column
- [ ] No deviations discovered that contradict shipped spec — any issues logged in `docs/XDD/specs/002-instruction-executor/README.md` Decisions Log
- [ ] Tomo `applied: false` round-trip verified end-to-end (Tomo writes `false`; Hashi flips to `true`; Tomo's next session reads both states correctly) — architecture-06 §10
- [ ] Manifest `isDesktopOnly: true` confirmed (already shipped per spec 001)
- [ ] No console errors in DevTools after a full run

## Notes / observations

(Free-form section. Record any deviations, surprises, or follow-up items
discovered while walking the checklist. Items here feed back into the spec
README Decisions Log if they contradict shipped behavior.)
