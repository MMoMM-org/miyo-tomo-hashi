# Specification: 002-instruction-executor

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-04-24 |
| **Current Phase** | Planning — blocked by 001 lifecycle contracts |
| **Last Updated** | 2026-04-24 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | not started | PRD — preview modal, hook API, partial-resume UX, error reporting |
| solution.md | not started | SDD — JSON schema validation, 8 action handlers, hook loader, checkbox sync |
| plan/ | not started | Implementation phases |

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
- **Tri-state preview modal:** `Preview on` (default, user confirms) / `Preview off` (informational) / `No confirmation` (run immediately). UX affordance, not an approval gate — approval is upstream in Tomo's review step.
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
| — | — | — |

## Open Questions (from Kokoro onboarding handoff 2026-04-23)

1. **Hook API surface.** Minimum: current action payload, vault-writing helper, read helper, logger. Keep surface minimal in v0.1; users can reach Obsidian API directly via `app` if they know what they're doing.
2. **Partial-resume UX.** If 10 of 25 actions ticked, show progress summary ("15 of 25 remaining") in preview modal before executing? Kokoro leans yes.
3. **Error reporting channel.** Must align with 001's decision — per-action failures surface where?

## Context

Depends on 001 for:
- Container identity (Hashi needs to know which Tomo session produced the instructions, if ever used for traceability)
- Error channel (shared surface for executor failures and session-lifecycle failures)

Independent of 001 for:
- JSON parsing, schema validation, action handlers, checkbox sync, hook loader, preview modal

Could start SDD drafting in parallel with 001's SDD, but implementation (plan/) should land after 001 so the executor writes into a live plugin skeleton.

## References

- ADR-009 §3 Instruction-Set Execution Model, §6.1 Hook Delivery, §6.2 Preview Modal
- Architecture 06 §6 Instruction-Set Execution Model
- Tomo consumer contract: `/Volumes/Moon/Coding/MiYo/Tomo/docs/instructions-json.md`
- Tomo JSON Schema: `/Volumes/Moon/Coding/MiYo/Tomo/tomo/schemas/instructions.schema.json`
- Onboarding handoff: `_inbox/from-kokoro/2026-04-23_kokoro-to-hashi_onboarding-charter-contract-and-v01-scope.md`
