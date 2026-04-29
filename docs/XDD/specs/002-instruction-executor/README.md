# Specification: 002-instruction-executor

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-04-24 |
| **Current Phase** | Ready for implementation — readiness HIGH |
| **Last Updated** | 2026-04-24 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| research.md | draft | Agent-team research synthesis — 5 perspectives (Requirements, Technical, Security, Integration, UX) |
| requirements.md | draft | PRD v2.0 — 11 Must features; 95 acceptance criteria; 0 open questions; pivots `.json` to source-of-truth + adds inbox-batch + run-log file |
| solution.md | draft | SDD v1.1 — 10 ADRs (5 revised on 2026-04-25 simplification review: ajv now runtime not standalone; FsPromisesVaultFS dropped; HookContext = `{action, app, logger}` only; no runState; no HookVault facade); ports-and-adapters at vault edge (VaultFS + ObsidianVaultFS + FakeVaultFS); state-machine modal; reuses 001's `Store<T>` and plain-TS-DOM patterns |
| plan/ | draft | 6-phase TDD plan (31 tasks); `plan/README.md` + `plan/phase-1..6.md`; ~891 lines total; full PRD AC → task traceability deferred to phase-6 task T6.5 |

## Scope (from ADR-009 + architecture-06 + Tomo consumer contract)

Parse `_instructions.json` produced by Tomo (`instruction-render.py` v0.6.0+) and execute the deterministic vault operations it describes, via the Obsidian Plugin API, with user-authored Node-script pre/post hooks.

Covers:
- **Input:** `_instructions.json` in vault inbox; `md_peer` field drives companion `.md` lookup; schema version 1
- **8 action kinds** (deterministic, order-constrained):
  1. `create_moc` — move + rename rendered MOC file to Atlas/200 Maps/
  2. `move_note` — move + rename rendered atomic note to Atlas/202 Notes/
  3. `link_to_moc` — append bullet line inside MOC section (section-name resolution + in-set MOC fallback)
  4. `update_tracker` — set tracker field on daily note (`inline_field` / `callout_body` / `checkbox`)
  5. `update_log_entry` — add prose line to daily log (`after_last_line` / `before_first_line` / `at_time`)
  6. `update_log_link` — add wikilink line to daily log (same position semantics; format `- [[stem]]`, `HH:MM - ` prefix when `at_time`)
  7. `delete_source` — move source to Obsidian trash (never hard-delete)
  8. `skip` — informational no-op
- **Execution order:** create_moc → move_note → link_to_moc → daily updates (tracker, log_entry, log_link) → delete_source → skip. Within block, monotonic `I01` … `INN`. `link_to_moc` MUST NOT run before its `create_moc`.
- **Sync contract:** after each successful action, tick matching `- [ ] Applied` checkbox in `.md` peer (`I##` ↔ third-level heading `### I## — …`). On failure, leave unchecked and surface error. Respect pre-ticked boxes (user may have applied manually) — skip those.
- **Hooks:** Node scripts in `.tomo-hashi/hooks/` (user-configurable). Pre/post per operation. Full plugin privilege — same trust model as Templater. Motivating case: `after-move.js` rewriting aliases across linking notes.
- **Tri-state execution mode:** `Confirm before run` (default, user clicks Execute) / `Auto-run with preview` (modal opens, execution starts immediately, user can Cancel) / `Silent` (no modal, Notice on completion). UX affordance, not an approval gate — approval is upstream in Tomo's review step.
- **Idempotency:** per-action rules documented in Tomo consumer contract §Action kinds — re-apply = no-op where states match; inconsistent state (both source and destination present) surfaces error rather than overwriting.
- **Partial-resume:** if N of M actions already ticked, skip them; re-run continues from first unticked.

Explicitly NOT in 002:
- Audit journal (see ADR-009 §6.3 — skipped by design, no consumer without rollback)
- Rollback / undo (file history, git, and user backups are recovery paths)
- LLM-driven section insertion for MOC sub-structure (backlog F-30 in Tomo — v0.1 appends at end of matched callout or falls back to first editable callout)
- Cross-vault operations

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-24 | Reset stale "blocked by 001" status + "Depends on 001" context | 2026-04-24 brainstorm pivot (logged in 001 decisions) made 002 standalone — no shared session identity or error channel with 001. README now reflects the pivot. |
| 2026-04-24 | Begin xdd workflow with PRD phase | Scope is outlined but acceptance criteria, hook API surface, partial-resume UX, and error reporting channel are still open questions from Kokoro's 2026-04-23 onboarding handoff — WHAT-level questions that need settling before design. |
| 2026-04-24 | Run xdd in Agent Team mode | Multiple design axes with potential tension (JSON schema strictness vs error UX; hook trust model vs simplicity; idempotency vs partial-resume progress reporting; Obsidian API surface for file moves and section editing). Persistent researcher perspectives outperform fire-and-forget agents here. |
| 2026-04-24 | Research phase complete — see `research.md` | 5 perspectives returned with strong alignment on core execution model (ports-and-adapters, ajv standalone, `app.fileManager.renameFile` for link preservation, `vault.process` for atomic writes). Conflicts narrowed to UX details (error channel location, popover extension) and integration policy (Periodic Notes fallback, peer-missing behaviour) — all surfaced for PRD. |
| 2026-04-24 | PRD v1.0 drafted with 0 clarification markers; all 8 research-level open questions pre-settled to recommended defaults | Defaults adopted: halt-on-dependency (yes), peer `## Errors` block (in-peer, not separate file), no status-bar popover extension in 002, palette command name "Execute instructions document", Periodic Notes as Should-Have fallback, example hook shipped, first-run disclosure modal + kill-switch for hooks, virtualization deferred to SDD. Any of these can still be redirected during review. |
| 2026-04-25 | **PRD v2.0 — major revision after user comments on v1.0.** Pivots `.json` to sole source of truth for applied-state (Tomo adds optional `applied: false` per action; Hashi flips to `true` on success). Adds inbox-batch invocation (one merged preview when no instruction file is active). Replaces in-peer `## Errors` block with per-run `tomo-hashi-run-log_<ts>.md` files (retention setting: always-keep / only-after-failed). Renames tri-state to *Confirm before run / Auto-run with preview / Silent*. Modal buttons standardised to **Execute / Cancel / Close**. Adds 橋 status-bar indicator as MUST. Drops sha256 hook disclosure (kept *enabled / disabled / ask* + kill-switch). Drops Periodic Notes / daily-notes resolution (Tomo emits absolute paths). Drops example hook on first run. Strengthens "never" markers on cross-vault, remote sources, hook sandboxing. Hooks dir now configurable. Adds debug-logging setting (per-hook detail behind it). | User revisions on requirements.md v1.0 inline; full revision answer round in conversation 2026-04-25. |
| 2026-04-25 | Outbound handoff to Tomo created at PRD exit (HIGH PRIORITY) | `_outbox/for-tomo/2026-04-25_hashi-to-tomo_applied-field.md` — request Tomo emit `applied: false` per action in `_instructions.json`. Schema stays v1 (additive optional field). Hashi v0.1 release gate requires the round-trip working. |
| 2026-04-25 | Tomo handoff returned **done** — `applied:false` shipped in Tomo v0.7.0 | `build_actions()` in `tomo/scripts/instruction-render.py` now stamps `applied:false` on every action; shared `$defs/applied_field` added to `tomo/schemas/instructions.schema.json` across all 8 variants; round-trip test asserts it; branch `feat/applied-field-instructions`, commit `f3ad49d`. Hashi can vendor the updated schema directly during Phase 1 of the plan; CON-9 in the SDD is no longer a blocker. |
| 2026-04-25 | SDD v1.0 — 10 ADRs confirmed in one batched round | 9 ADRs confirmed as proposed (ajv standalone codegen, vendored schema, createRequire+cache-evict hooks, pure handler functions, state-machine modal, vault.process for JSON applied-flag, Markdown per-run log file, vitest split, hook context with runState). ADR-6 revised: 橋 status bar uses idle/green/red color states only — no pulse animation. ADR-9 augmented: manual QA against `../temp/Privat-Test` documented as a release-gate checklist item. |
| 2026-04-25 | Plan v1.0 — 6 phases, 31 tasks, 4 parallel opportunities (T3.1, T5.1, T5.2, T5.3) | Phase 1 Foundation (vendor schema, types, settings UI, path safety, mock) → Phase 2 Vault Boundary & Schema (port + 3 adapters + validator) → Phase 3 Action Handlers (8 pure handlers + 2 helpers; T3.1 parallelizable) → Phase 4 Orchestrator/Hooks/Run Log (planner, applied-writer, peer-sync, run log, hook runner, executor) → Phase 5 UI Surfaces (modal, status bar, hook disclosure; 3 parallel) → Phase 6 Wire-up + live e2e + manual QA + traceability. Inherits `Store<T>` from 001 with on-demand extraction fallback. |
| 2026-04-25 | 4-perspective validation pass (Completeness / Consistency / Alignment / Coverage) — assessment **Critical** at first pass; **Excellent** after fixes | Findings: (HIGH) PRD F10 still described pulse animation in 5 places after ADR-6 was revised; (HIGH) PRD claimed 73 ACs but actual count is 95. (MEDIUM) Spec README scope blurb used old execution-mode names; SDD `minAppVersion` cited 1.5.7 but manifest is 1.5.0; SDD missed type definitions for `Diagnostic`, `ValidationFailure`, `ResolvedSource`, `Clock`, `Readable<T>`; PRD F5 edge-case self-contradicted F5 AC; PRD F11 missed rollback ACs for radio/toggle settings; F7 missed run-log-write-failure AC; 3 plan tasks missed test rows (F6 disabled-Execute, F10 ARIA live region, F11 per-hook ask non-persistence); plan parallelTasks counted 6 vs literal 4. (LOW) hooksDir trailing slash drift; broken `[ref: SDD/...]` strings; F10 tooltip lacked third "error" variant; outbound-handoff prose described handoff as pending though it returned done. **All findings fixed in this pass.** |
| 2026-04-25 | Spec 002 readiness = HIGH. Ready for implementation. | All 11 spec files present (README, research, requirements, solution, plan/README, plan/phase-1..6). 0 open questions. All 10 ADRs confirmed. Tomo `applied:false` handoff returned done in v0.7.0. PRD F1–F11 traceable to SDD components and plan tasks. Validation findings closed. |
| 2026-04-25 | Multi-batch review pass: security re-triage, drift, simplification, testing, compatibility | Five review batches landed: (1) Security — dropped sha-disclosure / lastTrustedAppId / TOCTOU / Tomo identity attestation as Won't Have (no named threat actor); kept H16 Docker-socket pinning, H17 fs.realpath, H19 xterm.js OSC 8/52, M15/M16 logging hygiene. (2) Drift — minAppVersion aligned at 1.5.0; AC counts reconciled; Svelte residue swept; SettingsTab path pinned. (3) Simplification — 6 ADRs revised: ADR-1 v2 runtime ajv (was standalone codegen); ADR-4 v2 drop runState; ADR-9 v2 drop FsPromisesVaultFS (manual QA is integration gate); ADR-10 v2 HookContext = `{action, app, logger}`; ConnectionError 7→4; HandlerOutcome collapsed into ActionOutcome; ValidationFailure → `{ok, message: string}`; runState/HookVault/disableAllHooks/derived/connectionStoreWrite all dropped. (4) Testing — RED-GREEN-REFACTOR canonical task shape; T4.4.0 hook fixture set; F9 fs.realpath EARS; edge-case→tests matrix; manual-QA in T6.4 is now load-bearing per ADR-9 v2. (5) Compatibility — schema forward-compat policy added to PRD Constraints; HookContext stability policy added to ADR-10; two new outbound handoffs in `_outbox/for-tomo/` (`schema-changelog-discipline.md`, `path-emission-contract.md`). |
| 2026-04-29 | F7 run-log fingerprint dropped — log records free-text content fields verbatim. PRD v2.1, SDD v1.1. | The F7 AC originally required an 8-char sha256 fingerprint of `update_tracker.value` / `update_log_entry.line` etc. on the rationale that log files travel with vault sync. The run log lives in the same `<tomo-inbox>/` folder as the source `_instructions.json` files which already contain those exact values in plain text. Hashing one file while its uncrypted source sits beside it adds ceremony without protecting anything. Aligned with the existing "no crypto ceremony without a named threat actor" project stance (cf. dropped sha-disclosure, lastTrustedAppId, etc.). PRD F7 AC and SDD F7 EARS revised in this pass. |
| 2026-04-29 | SDD CON-7 bundle ceiling raised 1000 KB → 1200 KB. | T6.2 wiring of 002 surfaces (executor + planner + 8 handlers + run log + hook runner + 3 UI surfaces + ajv runtime) brought build/main.js to ~1105 KB; the 1000 KB target was set before 002's full surface area was integrated. Follow-up bundle audit task tracked: investigate ajv code-gen per ADR-1 v1, lazy-load xterm (only used by 001's TomoChat). SDD bumped to v1.2. |

## Open Questions (from Kokoro onboarding handoff 2026-04-23)

1. **Hook API surface.** Minimum: current action payload, vault-writing helper, read helper, logger. Keep surface minimal in v0.1; users can reach Obsidian API directly via `app` if they know what they're doing.
2. **Partial-resume UX.** If 10 of 25 actions ticked, show progress summary ("15 of 25 remaining") in preview modal before executing? Kokoro leans yes.
3. **Error reporting channel.** Must align with 001's decision — per-action failures surface where?

## Context

After the 2026-04-24 brainstorm pivot (logged in spec 001 decisions), 002 is **standalone**:
- No dependency on 001 for container identity — the executor runs against `_instructions.json` files in the vault, regardless of whether a Tomo container is currently attached.
- No dependency on 001 for an error channel — 002 surfaces its own per-action errors (channel TBD in PRD/SDD).
- No shared session state with 001.

Both features must land for v0.1; they can proceed in parallel. Implementation (plan/) should land into the same plugin skeleton 001 builds, but 002 has no runtime coupling to 001's connection service.

## References

- ADR-009 §3 Instruction-Set Execution Model, §6.1 Hook Delivery, §6.2 Preview Modal
- Architecture 06 §6 Instruction-Set Execution Model
- Tomo consumer contract: `/Volumes/Moon/Coding/MiYo/Tomo/docs/instructions-json.md`
- Tomo JSON Schema: `/Volumes/Moon/Coding/MiYo/Tomo/tomo/schemas/instructions.schema.json`
- Onboarding handoff: `_inbox/from-kokoro/2026-04-23_kokoro-to-hashi_onboarding-charter-contract-and-v01-scope.md`
