---
title: "PRD AC Traceability Matrix — 002 Instruction Executor"
status: ready
version: "1.0"
generated: 2026-04-29
total_acs: 97
---

# PRD Acceptance Criteria — Traceability Matrix

> Every PRD AC maps to at least one verification artifact:
> 1. **Test** — vitest unit/integration test path under `test/unit/...`
> 2. **Manual** — row in `manual-qa-checklist.md` (T6.4)
>
> Live tests dropped per ADR-9 v2 — manual QA absorbs that coverage. The
> AC count gate is run from the PRD via `grep -c '^  - \[ \]'
> requirements.md` (97 as of 2026-04-29). The PRD's "Last counted: 98"
> note in the gate paragraph is stale by one row — flagged in the
> deliverable report; not auto-fixed here.

## Coverage Summary

| Coverage source | AC count | % of total |
|-----------------|----------|------------|
| Tests only      |       14 |      14.4% |
| Manual only     |        1 |       1.0% |
| Both            |       82 |      84.5% |
| Uncovered       |        0 |       0.0% |

100% of PRD ACs (97/97) trace to at least one verification artifact.

---

## F1 — Invocation and Source Resolution (9 ACs)

| AC | Wording (short) | Test file(s) | Manual checklist row | Status |
|----|-----------------|--------------|----------------------|--------|
| F1.1 | Active `.md` peer → palette runs that one set | `test/unit/commands/registerCommands.test.ts` | F1.palette.md-peer | ✅ |
| F1.2 | Active `_instructions.json` → palette runs that one set | `test/unit/commands/registerCommands.test.ts` | F1.palette.json | ✅ |
| F1.3 | No instruction file active → batch-runs the inbox | `test/unit/commands/registerCommands.test.ts`, `test/unit/executor/planner.test.ts` | F1.palette.batch | ✅ |
| F1.4 | Right-click on `.md` peer shows "Execute instructions…" | `test/unit/commands/fileMenu.test.ts` | F1.menu.md-peer | ✅ |
| F1.5 | Right-click NOT shown on `_instructions.json` | `test/unit/commands/fileMenu.test.ts` | F1.menu.json-hidden | ✅ |
| F1.6 | Run already in progress → Notice "Execution already in progress"; no second run | `test/unit/executor/InstructionExecutor.test.ts`, `test/unit/executor/state.test.ts` | F1.lock.notice | ✅ |
| F1.7 | Never auto-triggers on file create/change/load | `test/unit/main.integration.test.ts`, `test/unit/main.test.ts` | F1.no-auto | ✅ |
| F1.8 | Inbox folder missing → Notice "Tomo inbox folder not found" | `test/unit/executor/planner.test.ts` | F1.inbox-missing | ✅ |
| F1.9 | Inbox empty → Notice "Tomo inbox is empty — nothing to execute" | `test/unit/executor/planner.test.ts` | F1.inbox-empty | ✅ |

## F2 — Schema Validation (7 ACs)

| AC | Wording (short) | Test file(s) | Manual checklist row | Status |
|----|-----------------|--------------|----------------------|--------|
| F2.1 | `schema_version === 1` + valid payload → preview opens | `test/unit/schema/validator.test.ts`, `test/unit/schema/vendored-schema.test.ts` | F2.preview-on-pass | ✅ |
| F2.2 | Other `schema_version` values → fail-closed "Schema version mismatch" | `test/unit/schema/validator.test.ts` |  | ✅ |
| F2.3 | Not valid JSON → fail-closed naming the parse failure | `test/unit/schema/validator.test.ts` |  | ✅ |
| F2.4 | Schema-invalid → up to 10 diagnostics | `test/unit/schema/validator.test.ts` |  | ✅ |
| F2.5 | One invalid file does NOT stop the batch | `test/unit/executor/planner.test.ts`, `test/unit/executor/InstructionExecutor.test.ts` | F2.batch-isolated | ✅ |
| F2.6 | Validation failure → Notice + per-file header in modal; peer `.md` NEVER written | `test/unit/executor/InstructionExecutor.test.ts`, `test/unit/executor/peerCheckboxSync.test.ts` | F2.notice-on-fail | ✅ |
| F2.7 | Validation < 200ms/file for ≤ 100 actions | `test/unit/schema/validator.test.ts` |  | ✅ |

## F3 — Tri-State Execution Mode and Modal (9 ACs)

| AC | Wording (short) | Test file(s) | Manual checklist row | Status |
|----|-----------------|--------------|----------------------|--------|
| F3.1 | Settings has Execution mode radio (Confirm / Auto-run / Silent); persists | `test/unit/ui/settings/SettingsTab.test.ts`, `test/unit/connection/settingsPersistence.test.ts` | F11.exec-mode.radio, F11.persist | ✅ |
| F3.2 | Confirm mode → modal opens, Execute click required, Cancel/Esc abort | `test/unit/ui/ExecutionModal.test.ts`, `test/unit/executor/InstructionExecutor.test.ts` | F3.confirm.opens, F3.confirm.execute, F3.confirm.cancel-pre, F3.confirm.esc-pre | ✅ |
| F3.3 | Auto-run → modal opens, run starts immediately; Cancel/Close/Esc semantics | `test/unit/ui/ExecutionModal.test.ts`, `test/unit/executor/InstructionExecutor.test.ts` | F3.autorun.opens, F3.autorun.cancel-mid, F3.autorun.close-disabled, F3.autorun.esc-mid | ✅ |
| F3.4 | Silent → no modal; Notice on completion summarising | `test/unit/executor/InstructionExecutor.test.ts`, `test/unit/main.test.ts` | F3.silent.no-modal, F3.silent.notice | ✅ |
| F3.5 | Modal buttons "Execute" / "Cancel" / "Close" only — no "Dismiss" | `test/unit/ui/ExecutionModal.test.ts` | F3.button-labels | ✅ |
| F3.6 | Silent settings option has helper text | `test/unit/ui/settings/SettingsTab.test.ts` | F3.silent-helper | ✅ |
| F3.7 | Footer in Confirm/Auto-run shows "Approval lives in Tomo's review step…" | `test/unit/ui/ExecutionModal.test.ts` | F3.disclosure-footer | ✅ |
| F3.8 | Mode is UX, not auth gate — F2/F9/deny-list run identically in all 3 modes | `test/unit/executor/InstructionExecutor.test.ts`, `test/unit/util/paths.test.ts` | F9.modes-equal | ✅ |
| F3.9 | Cancel during Auto-run → halt after current action; remaining → "Skipped — run cancelled" | `test/unit/executor/InstructionExecutor.test.ts` | F3.autorun.cancel-mid | ✅ |

## F4 — 8 Action Kinds in Canonical Order (15 ACs)

| AC | Wording (short) | Test file(s) | Manual checklist row | Status |
|----|-----------------|--------------|----------------------|--------|
| F4.1 | Canonical order within file: 8-kind sequence; `I##` monotonic within block | `test/unit/executor/planner.test.ts`, `test/unit/executor/InstructionExecutor.test.ts` | F3.progress.canonical-order | ✅ |
| F4.2 | Batch: files alphabetical; canonical order within each | `test/unit/executor/planner.test.ts` | F3.progress.batch-headers | ✅ |
| F4.3 | All paths absolute vault-relative; Hashi does not resolve | `test/unit/util/paths.test.ts`, `test/unit/actions/index.test.ts` |  | ✅ |
| F4.4 | `create_moc`: src+!dst → move; !src+dst → no-op; both → fail | `test/unit/actions/createMoc.test.ts` | F4.create_moc.move, F4.create_moc.idempotent, F4.create_moc.both-present | ✅ |
| F4.5 | `move_note`: same semantics | `test/unit/actions/moveNote.test.ts` | F4.move_note.preserves-links | ✅ |
| F4.6 | `link_to_moc`: anchor (callout/heading/line) × placement (inside/before/after); multi-line `line_to_add` block (blank lines preserved; `> `-prefixed per line for inside); pre-formatted line; idempotent (consecutive-block match); missing MOC / missing anchor / inside-non-callout all fail; no fallback | `test/unit/actions/linkToMoc.test.ts`, `test/unit/actions/anchorResolver.test.ts`, `test/unit/schema/validator.test.ts` | F4.link_to_moc.callout-inside, F4.link_to_moc.callout-after, F4.link_to_moc.heading-after, F4.link_to_moc.line-after, F4.link_to_moc.callout-before, F4.link_to_moc.heading-before, F4.link_to_moc.multiline, F4.link_to_moc.duplicate, F4.link_to_moc.anchor-missing, F4.link_to_moc.inside-non-callout, F4.link_to_moc.missing-moc | ✅ |
| F4.6b | `add_relationship`: marker-based locator; whole-line replacement with normalised `> ` prefix when matched line was in a callout; first-match-wins; idempotent; missing marker / missing MOC fail; multi-link aggregation Tomo-side | `test/unit/actions/addRelationship.test.ts` | F4.add_relationship.up-marker, F4.add_relationship.related-marker, F4.add_relationship.first-match-wins, F4.add_relationship.idempotent, F4.add_relationship.missing-marker, F4.add_relationship.missing-moc | ✅ |
| F4.6c | `insert_under_marker`: arbitrary `target_path` + multi-line `content`; anchor (callout/heading/line) × placement (inside/before/after); inside+heading appends at section end (above next same/higher heading or EOF); inside+callout `> `-prefixed body append; inside+line fails gracefully; modify-only (missing note fails); missing/null anchor fails; idempotent (consecutive-block match); canonical-order placement after `link_to_moc` | `test/unit/actions/insertUnderMarker.test.ts`, `test/unit/schema/validator.test.ts`, `test/unit/executor/planner.test.ts` | F4.insert_under_marker.heading-inside, F4.insert_under_marker.callout-inside, F4.insert_under_marker.before-after, F4.insert_under_marker.inside-line-fails, F4.insert_under_marker.missing-note | ✅ |
| F4.7 | `update_tracker`: set field; idempotent; differs → overwrite (Tomo's intent wins); `inline_field` matches 3 Dataview positions + multi-word field names | `test/unit/actions/updateTracker.test.ts` | F4.update_tracker.set, F4.update_tracker.idempotent, F4.update_tracker.differs, F4.update_tracker.inline-bracketed, F4.update_tracker.inline-paren, F4.update_tracker.inline-bullet, F4.update_tracker.multi-word | ✅ |
| F4.8 | `update_log_entry`: insert at position with line shape `- <content>` (after/before) or `- HH:MM: <content>` (at_time); idempotent | `test/unit/actions/updateLogEntry.test.ts`, `test/unit/actions/logPosition.test.ts` | F4.update_log_entry.insert | ✅ |
| F4.9 | `update_log_link`: insert wikilink with line shape `- [[stem]]` (after/before) or `- HH:MM: [[stem]]` (at_time, aligned with `update_log_entry`); idempotent | `test/unit/actions/updateLogLink.test.ts`, `test/unit/actions/logPosition.test.ts` | F4.update_log_link.insert | ✅ |
| F4.10 | `delete_source`: trash (system or vault); idempotent; verbatim path consumption (no peer inference, no extension manipulation, no reverse-sanitisation) | `test/unit/actions/deleteSource.test.ts` | F4.delete_source.trash, F4.delete_source.idempotent, F4.delete_source.peer-independent, F4.delete_source.colon-bearing-media | ✅ |
| F4.11 | `skip`: no-op; ticks `applied: true`; counts | `test/unit/actions/skip.test.ts` | F4.skip.no-op | ✅ |
| F4.12 | Auto-create destination folder before move | `test/unit/actions/createMoc.test.ts`, `test/unit/actions/moveNote.test.ts` | F4.dest-folder-create | ✅ |
| F4.13 | Halt-on-dependency: `link_to_moc` skipped when its `create_moc` failed | `test/unit/executor/planner.test.ts`, `test/unit/executor/InstructionExecutor.test.ts` | F4.halt-on-dep.broken | ✅ |
| F4.14 | Halt-on-independent-failure: continue with next action | `test/unit/executor/InstructionExecutor.test.ts` | F4.halt-on-dep.independent | ✅ |
| F4.15 | Every successful action updates source `.json` per F5 | `test/unit/executor/jsonAppliedWriter.test.ts`, `test/unit/executor/InstructionExecutor.test.ts` | F5.json-applied-write | ✅ |

## F5 — Applied-State in `_instructions.json` (8 ACs)

| AC | Wording (short) | Test file(s) | Manual checklist row | Status |
|----|-----------------|--------------|----------------------|--------|
| F5.1 | Schema includes optional `applied`; absence treated as `false` | `test/unit/schema/validator.test.ts`, `test/unit/schema/types.test.ts` | edge.applied-field-missing | ✅ |
| F5.2 | Success → atomic write `applied: true` to source `.json` | `test/unit/executor/jsonAppliedWriter.test.ts`, `test/unit/executor/InstructionExecutor.test.ts` | F5.json-applied-write | ✅ |
| F5.3 | Fail/skip → `applied` remains `false` | `test/unit/executor/jsonAppliedWriter.test.ts`, `test/unit/executor/InstructionExecutor.test.ts` |  | ✅ |
| F5.4 | `applied: true` in source → action skipped as already-applied | `test/unit/executor/planner.test.ts`, `test/unit/executor/InstructionExecutor.test.ts` |  | ✅ |
| F5.5 | Executor NEVER unsets `applied: true` → `false` | `test/unit/executor/jsonAppliedWriter.test.ts` |  | ✅ |
| F5.6 | `.md` peer best-effort tick under `### I## — …`; failure NEVER fails run | `test/unit/executor/peerCheckboxSync.test.ts` | F5.peer-checkbox-tick, F5.peer-heading-missing, F5.peer-missing-no-fail | ✅ |
| F5.7 | `.md` peer never required, never validated, never written except for tick | `test/unit/executor/peerCheckboxSync.test.ts` |  | ✅ |
| F5.8 | All JSON writes via Obsidian `Vault` API; no raw `fs` | `test/unit/vault/ObsidianVaultFS.test.ts`, `test/unit/vault/VaultFS.contract.test.ts`, `test/unit/executor/jsonAppliedWriter.test.ts` |  | ✅ |

## F6 — Partial-Resume via JSON Applied Flags (5 ACs)

| AC | Wording (short) | Test file(s) | Manual checklist row | Status |
|----|-----------------|--------------|----------------------|--------|
| F6.1 | Banner "N of M remaining (X already applied — re-run safe)" when any applied | `test/unit/ui/ExecutionModal.test.ts`, `test/unit/executor/planner.test.ts` | F6.banner.single, F3.confirm.banner-resume | ✅ |
| F6.2 | Batch banner aggregates: "Batch: N of M remaining across K files" | `test/unit/ui/ExecutionModal.test.ts`, `test/unit/executor/planner.test.ts` | F6.banner.batch | ✅ |
| F6.3 | Already-applied rows visible at reduced opacity with ✓ glyph (not filtered) | `test/unit/ui/ExecutionModal.test.ts` | F6.row-faded, F3.progress.row-glyphs | ✅ |
| F6.4 | All applied → "0 of M remaining"; Execute disabled in Confirm; Notice in Auto/Silent | `test/unit/ui/ExecutionModal.test.ts`, `test/unit/executor/InstructionExecutor.test.ts` | F6.all-applied.disabled, F6.all-applied.silent | ✅ |
| F6.5 | Peer `.md` checkbox state has NO bearing on resume — JSON is sole authority | `test/unit/executor/planner.test.ts`, `test/unit/executor/peerCheckboxSync.test.ts` | F6.peer-checkbox-ignored | ✅ |

## F7 — Per-Run Log File (12 ACs)

| AC | Wording (short) | Test file(s) | Manual checklist row | Status |
|----|-----------------|--------------|----------------------|--------|
| F7.1 | Log at `<inbox>/tomo-hashi-run-log_YYYY-MM-DDTHHMM.md` regardless of mode | `test/unit/executor/runLog.test.ts` | F7.filename | ✅ |
| F7.2 | Same-minute collisions → `_N` suffix | `test/unit/executor/runLog.test.ts` | F7.collision-suffix, edge.two-runs-same-minute | ✅ |
| F7.3 | Header records start, end, mode, sources, totals | `test/unit/executor/runLog.test.ts` | F7.header | ✅ |
| F7.4 | Body lists every action; payload verbatim (no fingerprint, no truncation) | `test/unit/executor/runLog.test.ts` | F7.body, F7.payload-verbatim | ✅ |
| F7.5 | Batch: body grouped by source file with `## <filename>` sub-headings | `test/unit/executor/runLog.test.ts` | F7.batch-grouping | ✅ |
| F7.6 | Setting "Run log retention" (Always keep / Only after failed runs); default Always keep | `test/unit/ui/settings/SettingsTab.test.ts`, `test/unit/connection/settingsPersistence.test.ts` | F11.retention.radio | ✅ |
| F7.7 | Retention "Only after failed runs" + zero failures → log deleted | `test/unit/executor/runLog.test.ts`, `test/unit/executor/InstructionExecutor.test.ts` | F7.retention.only-failed | ✅ |
| F7.8 | Retention "Only after failed runs" + ≥1 failure → log kept | `test/unit/executor/runLog.test.ts`, `test/unit/executor/InstructionExecutor.test.ts` | F7.retention.only-failed-keeps | ✅ |
| F7.9 | Schema-validation-only failures recorded in run log | `test/unit/executor/runLog.test.ts`, `test/unit/executor/InstructionExecutor.test.ts` | F7.schema-fail-recorded | ✅ |
| F7.10 | Run-end Notice references log filename | `test/unit/executor/InstructionExecutor.test.ts`, `test/unit/main.test.ts` | F7.notice-references-log | ✅ |
| F7.11 | No failure is silent: appears in modal banner + summary + log | `test/unit/executor/InstructionExecutor.test.ts`, `test/unit/ui/ExecutionModal.test.ts` | F3.progress.error-banner, F3.summary.totals | ✅ |
| F7.12 | Run-log write failure → Notice "log file could not be written"; rest unaffected | `test/unit/executor/runLog.test.ts`, `test/unit/executor/InstructionExecutor.test.ts` | F7.write-failure-notice | ✅ |

## F8 — Hooks with Disclosure Setting and Kill-Switch (12 ACs)

| AC | Wording (short) | Test file(s) | Manual checklist row | Status |
|----|-----------------|--------------|----------------------|--------|
| F8.1 | Setting "Hooks directory"; default `.tomo-hashi/hooks/`; rejects abs/traversal | `test/unit/ui/settings/SettingsTab.test.ts`, `test/unit/util/paths.test.ts` | F11.hooks-dir.text, F11.text-rejection | ✅ |
| F8.2 | `{before,after}-<kind>.js` discovered; duplicate keys → error logged + first alphabetical | `test/unit/hooks/FsHookLoader.test.ts`, `test/unit/hooks/HookRunner.test.ts` | F8.exec.duplicate-keys | ✅ |
| F8.3 | Hooks loaded fresh per run; no in-memory cache across runs | `test/unit/hooks/HookRunner.test.ts` | F8.exec.fresh-load | ✅ |
| F8.4 | "Hooks: enabled / disabled / ask" (default ask); `disabled` IS the kill-switch | `test/unit/ui/settings/SettingsTab.test.ts`, `test/unit/hooks/HookRunner.test.ts` | F11.hooks.radio, F8.exec.kill-switch | ✅ |
| F8.5 | sha256 disclosure NOT implemented in v0.1 | `test/unit/hooks/HookDisclosureModal.test.ts` |  | ✅ |
| F8.6 | Hook context = `{ action, app, logger }`; no runState | `test/unit/hooks/HookRunner.test.ts` | F8.exec.context | ✅ |
| F8.7 | Hook return: `undefined` OK; `{info|warnings|errors}`; errors[] fails action | `test/unit/hooks/HookRunner.test.ts` | F8.exec.return-undefined, F8.exec.return-info, F8.exec.return-warnings, F8.exec.return-errors | ✅ |
| F8.8 | before-throws → action skipped; after-throws → applied:true + log entry | `test/unit/hooks/HookRunner.test.ts`, `test/unit/executor/InstructionExecutor.test.ts` | F8.exec.before-throws, F8.exec.after-throws | ✅ |
| F8.9 | 30s per-hook timeout | `test/unit/hooks/HookRunner.test.ts` | F8.exec.timeout, edge.hook-infinite-loop | ✅ |
| F8.10 | Normal log = run start/end + per-action; per-hook detail behind Debug logging | `test/unit/executor/runLog.test.ts`, `test/unit/ui/settings/SettingsTab.test.ts` | F11.debug.toggle | ✅ |
| F8.11 | README + settings show plain-language capability enumeration |  | F8.disc.path (proxy), README.md (manual review) | ✅ |
| F8.12 | Plugin never passes user input to eval/Function/exec/shell | `test/unit/hooks/HookRunner.test.ts` |  | ✅ |

## F9 — Path Safety and Deny-List (6 ACs)

| AC | Wording (short) | Test file(s) | Manual checklist row | Status |
|----|-----------------|--------------|----------------------|--------|
| F9.1 | Validation order: schema → normalize → containment → deny-list → guard → execute | `test/unit/util/paths.test.ts`, `test/unit/actions/index.test.ts`, `test/unit/executor/InstructionExecutor.test.ts` |  | ✅ |
| F9.2 | `normalizePath` + abs/`..`/empty/Windows-drive rejected with "Path escapes vault root" | `test/unit/util/paths.test.ts` | F9.containment.absolute | ✅ |
| F9.3 | Deny-list `^.obsidian|.git|.trash|<hooksDir>(/|$)` → "Path is on deny-list" | `test/unit/util/paths.test.ts` | F9.deny.obsidian, F9.deny.git, F9.deny.trash, F9.deny.hooks-dir | ✅ |
| F9.4 | Deny-list applies to all path fields (source/dest/etc.) | `test/unit/util/paths.test.ts`, `test/unit/actions/index.test.ts` |  | ✅ |
| F9.5 | Symlink containment via `fs.realpath` → `path-symlink-escape` | `test/unit/util/paths.test.ts` | F9.symlink-escape, edge.symlink-out | ✅ |
| F9.6 | Containment + deny-list run in all three execution modes | `test/unit/util/paths.test.ts`, `test/unit/executor/InstructionExecutor.test.ts` | F9.modes-equal | ✅ |

## F10 — Status-Bar 橋 Indicator (9 ACs)

| AC | Wording (short) | Test file(s) | Manual checklist row | Status |
|----|-----------------|--------------|----------------------|--------|
| F10.1 | Status bar item with 橋 kanji is rendered | `test/unit/ui/status-bar/StatusBarIcon.test.ts`, `test/unit/main.test.ts`, `test/unit/main.integration.test.ts` | F10.present | ✅ |
| F10.2 | Idle = idle color when no active run + no recent failure | `test/unit/ui/status-bar/StatusBarIcon.test.ts` | F10.idle.color | ✅ |
| F10.3 | Running = green; immediate class swap, no animation | `test/unit/ui/status-bar/StatusBarIcon.test.ts` | F10.running.green, F10.no-animation | ✅ |
| F10.4 | End with failures → red ~10s then idle | `test/unit/ui/status-bar/StatusBarIcon.test.ts` | F10.error.red | ✅ |
| F10.5 | End with zero failures → directly to idle | `test/unit/ui/status-bar/StatusBarIcon.test.ts` | F10.clean.idle | ✅ |
| F10.6 | Tooltip texts: "Hashi: idle" / "running — N of M" / "last run had F failures — see <log>" | `test/unit/ui/status-bar/StatusBarIcon.test.ts` | F10.tooltip.idle, F10.tooltip.running, F10.tooltip.error | ✅ |
| F10.7 | Click while running → focus modal; idle/error click = no-op | `test/unit/ui/status-bar/StatusBarIcon.test.ts`, `test/unit/ui/status-bar/openPopover.test.ts` | F10.click.running, F10.click.idle.noop, F10.click.error.noop | ✅ |
| F10.8 | Icon SHALL NOT animate (immediate class swaps) | `test/unit/ui/status-bar/StatusBarIcon.test.ts` | F10.no-animation | ✅ |
| F10.9 | ARIA live region (`polite`) announces run-state changes | `test/unit/ui/status-bar/StatusBarIcon.test.ts` | F10.aria-live | ✅ |

## F11 — Plugin Settings (5 ACs)

| AC | Wording (short) | Test file(s) | Manual checklist row | Status |
|----|-----------------|--------------|----------------------|--------|
| F11.1 | Settings tab includes 6 controls in stated order with named defaults | `test/unit/ui/settings/SettingsTab.test.ts` | F11.tab-present, F11.order, F11.inbox.text, F11.exec-mode.radio, F11.retention.radio, F11.hooks-dir.text, F11.hooks.radio, F11.debug.toggle | ✅ |
| F11.2 | All settings persist via Obsidian `data.json`; no other state outside vault | `test/unit/connection/settingsPersistence.test.ts`, `test/unit/ui/settings/SettingsTab.test.ts` | F11.persist | ✅ |
| F11.3 | Inbox empty/non-existent → Notice "not configured — set it in settings" | `test/unit/executor/planner.test.ts`, `test/unit/main.test.ts` | F11.inbox-empty.notice | ✅ |
| F11.4 | Per-hook ask-mode decisions in-memory only; re-prompt after restart | `test/unit/hooks/HookRunner.test.ts`, `test/unit/hooks/HookDisclosureModal.test.ts` | F8.disc.session-only | ✅ |
| F11.5 | Radio/toggle bounded by Setting API; text inputs reject abs/traversal/Windows-drive | `test/unit/ui/settings/SettingsTab.test.ts`, `test/unit/util/paths.test.ts` | F11.text-rejection | ✅ |

---

## Uncovered ACs

(none — every PRD AC has at least one ✅ source.)

## Notes

- **AC count drift**: PRD line 9 self-reports "98 ACs (2026-04-25)" but
  the canonical grep in this matrix returns 97. One bullet was likely
  collapsed during the F3 numbering edits between PRD v2.0 and v2.1.
  Flagged in the T6.5 deliverable report; not auto-fixed in this commit.
- **Live tests**: zero rows reference `test/live/...` — the
  `executor.live.test.ts` track was retired by ADR-9 v2 (2026-04-25) and
  its scenarios were promoted to `manual-qa-checklist.md` headers
  (happy-path / partial-resume / halt-on-dependency / batch-multi-file /
  schema-invalid-version / peer-missing / silent-mode / cancellation).
- **Manual-only AC (1)**: F8.11 (README + settings show plain-language
  capability enumeration) — copy-quality observation, not unit-testable.
- **Tests-only ACs (14)**: pure data/structural concerns (schema parse
  errors, validation latency budget, `applied:false`-default treatment,
  JSON write-back monotonicity, peer never-required invariant, deny-list
  validation order, never-eval invariant) — no real-Obsidian observation
  surface beyond the unit suite. Specifically: F2.2, F2.3, F2.4, F2.7,
  F4.3, F5.3, F5.4, F5.5, F5.7, F5.8, F8.5, F8.12, F9.1, F9.4.
