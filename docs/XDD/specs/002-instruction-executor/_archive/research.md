# Research Synthesis — Spec 002 Instruction Executor

Date: 2026-04-24
Mode: Agent Team (5 perspectives: Requirements, Technical, Security, Integration, UX)

This document captures the research phase of the xdd workflow. It feeds the PRD, SDD, and PLAN phases and is cited where design decisions are made.

## 1. Alignment across perspectives

The five researchers converged on these points without conflict:

### 1.1 Core execution model

- Canonical execution order: `create_moc → move_note → link_to_moc → update_tracker → update_log_entry → update_log_link → delete_source → skip`. Within each block, monotonic `I01…INN`. `link_to_moc` never runs before its `create_moc`.
- Sync contract: on success, tick the `- [ ] Applied` checkbox inside the `.md` peer's `### I## — …` third-level heading block; on failure, leave unticked and surface the error.
- Pre-ticked boxes are respected — treated as "already applied", skipped without re-execution.
- Partial-resume: skip already-ticked `I##`s, resume from first unticked. Pre-tick (manual) and executor-tick are indistinguishable and handled identically.
- Idempotency per action kind: re-apply where states match = no-op; inconsistent state (both source and destination present) = error, never overwrite.
- Schema version 1 only; strict equality. Mismatch and malformed JSON fail closed before any action runs.

### 1.2 Architecture

All perspectives recommend mirroring spec 001's ports-and-adapters layout:

- Ports: `InstructionSource`, `VaultFS`, `HookRunner`, `Clock`, `SchemaValidator`.
- Core: `InstructionPlanner` (orders actions), 8 pure action handlers, `CheckboxSyncer`, `Executor` (orchestrates and emits state events to a `Store<ExecutionState>` — reused from 001's `Store<T>` helper).
- Adapters: `ObsidianVaultFS`, `NodeRequireHookRunner`, `AjvSchemaValidator` (or standalone).
- UI: plain TS + DOM (ADR-3 from 001) — no framework.

### 1.3 JSON schema validation

**Recommendation: ajv 8.x, standalone codegen at build time.** Tomo owns `instructions.schema.json`; Hashi consumes it as the single source of truth. Standalone mode emits a pure validator function, keeping the runtime bundle lean. `json-schema-to-ts` provides static types including the 8-kind discriminated union.

Alternatives rejected: zod / valibot (would hand-port Tomo's schema, violating SSOT); hand-rolled (error-message quality and `oneOf` branching cost more than ajv's bundle footprint).

### 1.4 Obsidian API mapping

| Action | API |
|---|---|
| `create_moc`, `move_note` | `app.fileManager.renameFile(file, newPath)` — **required** for link-preservation. `vault.rename` leaves orphan links. |
| `link_to_moc`, `update_tracker`, `update_log_entry`, `update_log_link`, peer checkbox sync | `app.vault.process(file, fn)` — atomic read-modify-write (Obsidian ≥ 1.4). |
| `delete_source` | `app.vault.trash(file, /* system */ true)` — OS trash, never `vault.delete`. |
| `skip` | no-op. |
| Section/heading detection | `app.metadataCache.getFileCache(file).sections` + `.headings`. Callout detection requires re-parsing the line. |

Folder existence: auto-create destination folders via `vault.createFolder` (catch "already exists"). Missing source files fail that action and continue.

### 1.5 Hook model

- Location: `.tomo-hashi/hooks/{before,after}-<action-kind>.js`. Convention over config.
- Loading: `require()` via `createRequire(import.meta.url)` — synchronous, simple.
- Trust: full plugin privilege, Templater-equivalent. v0.1 ships no technical sandbox.
- Signature: `Hook = (ctx: HookContext) => Promise<void> | void` where `ctx = { action, vault: { read, write, exists }, app, logger }`.
- `app` is exposed as a documented escape hatch — keeps the minimum surface small while letting power users reach everything.

### 1.6 Observability

- No audit journal (per ADR-009 §6.3 — explicitly declined for v0.1).
- No rollback (Obsidian undo, git, user backups are recovery paths).
- The peer `.md` is the durable record of run state (ticked checkboxes = applied).

### 1.7 Testing

- Unit (vitest + jsdom): every action handler tested against an in-memory `FakeVaultFS`; `InstructionPlanner` ordering; `CheckboxSyncer` string transforms (table-driven); schema validator fixtures; hook runner with stubbed `require`.
- Integration (live): temp vault under `os.tmpdir()`, fixture JSON + markdown, backed by `fs/promises` — not real Obsidian. Follows 001's unit/live split.
- Fixtures: `test/fixtures/instructions/` — one per action kind plus edge cases (empty `actions[]`, all-8 mixed, `md_peer` missing, malformed JSON, unknown `kind`, unknown `schema_version`, duplicate `I##`, `link_to_moc` before its `create_moc`).

## 2. Proposed decisions (to settle in PRD)

### 2.1 Three open questions from Kokoro's onboarding handoff

**Q1 — Hook API surface (minimum).** Expose:
- `action` (current payload, read-only)
- `vault.read(path)`, `vault.write(path, content)`, `vault.exists(path)`, `vault.getAbstractFileByPath(path)`
- `logger.info/warn/error` (routes to executor's own error channel)
- `app` — documented escape hatch

**Q2 — Partial-resume UX.** Banner at the top of the preview modal: *"N of M remaining (X already applied)"*. Already-applied rows stay visible at reduced opacity, in-list — lets the user audit re-run safety.

**Q3 — Error reporting channel.** Primary: **sticky error banner in the modal**, accumulating during the run. Durable fallback: **append `## Errors — <timestamp>` block into the `.md` peer** so unattended ("No confirmation") runs have a persistent record. A one-line `Notice` fires on run end. No status-bar surface (that belongs to 001).

### 2.2 Execution policy

- Halt-on-dependency-broken: **yes** — if a `create_moc` fails, its dependent `link_to_moc` actions are marked "skipped — dependency failed" and not attempted.
- Halt-on-independent-failure: **no** — unrelated failures do not stop the batch. Users re-run to retry.
- Hook failure semantics: pre-hook throw = action skipped + error surfaced; post-hook throw = checkbox still ticked (vault state is correct) + hook error surfaced distinctly.
- Concurrency: single-run lock; second invocation on the same document shows a Notice (*"Execution already in progress for this document."*).
- Hooks fire per-action (not per-block), to match the motivating `after-move.js` alias-rewrite case.

### 2.3 Integration policy

- Schema version strictness: `schema_version === 1`; mismatch fails closed with explicit error.
- Destination folder policy: auto-create missing folders (`Atlas/200 Maps/`, `Atlas/202 Notes/`).
- Daily-note location: read from the core Daily Notes plugin settings (`internalPlugins.getPluginById('daily-notes').instance.options`); fallback to Periodic Notes if installed; error if neither.
- Missing `.md` peer: soft-warn, execution proceeds (checkbox sync becomes no-op with a footer warning).
- Missing source file (for `move_note` / `link_to_moc target` / `delete_source`): fail that action, continue others.

### 2.4 Security / trust posture

**MUST (PRD-level):**
- Deny-list: refuse operations on `.obsidian/**`, `.git/**`, `.tomo-hashi/**`, `.trash/**`. Fixed for v0.1, not user-configurable.
- Path safety: all target paths resolve inside vault root. Reject absolute paths, `..` segments after normalisation, empty segments, drive letters. Use `normalizePath` + `Vault.getAbstractFileByPath`.
- Validation order: JSON schema → path normalisation → vault-root containment → deny-list → per-action guard → execute.
- Hook disclosure: first-detected hook file (by path + sha256) triggers a modal — path, size, hash, "Enable / Disable / Enable-once". Re-prompt on hash change.
- Plugin setting: `Hooks: enabled | disabled | ask` (default `ask`) + a master `Disable all hooks` kill-switch.
- README + settings helper text: "Hooks are Node scripts with full access to your vault, files, network, and shell. Only enable hooks from sources you trust."
- No instruction field ever passed to `eval` / `exec` / shell.
- Preview-modal helper text clarifies: UX affordance, not an authorization gate; path-safety checks run in all three preview modes.

**SHOULD:**
- Log hook loads + invocations (path, action kind, I##, duration, outcome) to Obsidian's dev console.
- 30s timeout around hook execution — runaway hook surfaces as action failure.
- TOCTOU: re-read source file hash at execute time; abort that action if changed since preview.

**ACCEPTED (for v0.1):**
- No audit journal.
- No rollback.
- Full-privilege hooks (no sandbox).
- No hook signing (sha256-change re-prompt is detective, not preventive).
- Fixed deny-list (not user-configurable).

### 2.5 UX details

- Entry points: (1) command palette *"Execute instructions document"* operating on the active file (resolves `.json` ↔ `.md` peer by stem); (2) file-explorer right-click *"Execute instructions…"* on any `.json` or `.md` peer. No auto-trigger on file creation.
- Tri-state setting: single radio in plugin settings (*Preview on* default / *Preview off* / *No confirmation*). No per-invocation override.
- Preview-off semantics: modal opens, plan shown, single **Dismiss** button triggers execution. Esc cancels.
- No-confirmation mode: settings label warns "*Runs without any visible preview. Use only when you trust Tomo's review step.*"; every run ends with a `Notice` (only on-screen cue in that mode). Optional: "Execution: No confirmation" line in 001's status-bar popover (**open: may 002 extend 001's popover?**).
- Row state glyphs during run: `⏺ pending` · `⟳ running` · `✓ applied` · `⊘ skipped` · `✗ failed`.
- Accessibility: Obsidian `Modal` base class (focus-trap, role=dialog, Esc-closes); list rows `role="listitem"` with `aria-label`; `aria-live="polite"` on progress; `aria-live="assertive"` on first error.
- Large lists: default to virtualize above 50 rows. No spinner for parsing (sub-100ms typical).

## 3. Outbound handoffs required

- **[→ Tomo]** Request Tomo publish a `CHANGELOG.md` entry per `instructions.schema.json` change with explicit "schema version bump: yes/no". Draft in `_outbox/for-tomo/` during PRD/SDD.
- **[→ Tomo]** Request shared golden fixtures — bit-identical `_instructions.json` test inputs produced by the renderer's golden-output suite. Alternative for v0.1: Hashi snapshots at a pinned Tomo version, documents which renderer version generated them.
- **[→ Kokoro]** Propose ADR-009 §3 amendment naming the Hashi-side contract mirror doc and schema-version policy.

## 4. Artifacts 002 must produce

- `docs/XDD/specs/002-instruction-executor/contract.md` — Hashi-side mirror of the Tomo consumer contract (load-bearing vs advisory fields, fallbacks, test-fixture catalogue).
- `test/fixtures/instructions/` — one golden JSON per action kind + edge cases.
- `.tomo-hashi/hooks/example-hook.js` — commented-out sample shipped on first run so users discover the directory.

## 5. Remaining open questions (entering PRD)

1. **Halt-on-dependency-broken** — confirm yes; alternative halt-on-any-failure with explicit resume is simpler but pushes more re-run work onto the user.
2. **`## Errors` written into peer `.md` vs separate `.errors.md`** — recommendation is in-peer (fewer files, scoped to the run) but users may prefer separate files for noise isolation.
3. **May 002 extend 001's status-bar popover** with an "Execution: No confirmation" reminder line? (UX agent flagged; needs sign-off from whoever owns 001's popover contract — likely same owner.)
4. **Palette command name** — "Execute instructions document" (matches Tomo's terminology) vs "Execute instructions file" (Obsidian-idiomatic). Recommend the former.
5. **Virtualize large lists vs 50-row cap with "… N more" footer** — can be deferred to SDD; PRD only needs to state "responsive up to at least 100 actions".
6. **Periodic Notes plugin support** — core Daily Notes first + Periodic Notes fallback, or Daily Notes only in v0.1?
7. **Example hook shipped on first run** — confirm; low-cost, high-discoverability.
8. **Hook enable/disable UI location** — in-modal on first detection (intrusive) vs settings-pane list (discoverable but easy to miss).
