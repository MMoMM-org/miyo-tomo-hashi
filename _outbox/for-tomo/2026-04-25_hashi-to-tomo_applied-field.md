---
from: hashi
to: tomo
date: 2026-04-25
topic: applied-field
status: done
status_note: applied:false now stamped on every action by build_actions() in tomo/scripts/instruction-render.py (v0.7.0); shared $defs/applied_field added to tomo/schemas/instructions.schema.json across all 8 variants; tests/test-008-phase1.py asserts the round-trip; consumer doc docs/instructions-json.md updated. schema_version stays at 1. Branch feat/applied-field-instructions, commit f3ad49d.
priority: high
requires_action: true
---

# Add `applied: false` field per action in `_instructions.json`

## What Changed

Hashi v0.1 (spec 002, Instruction Executor) has settled on the `_instructions.json` itself as the **sole source of truth** for applied-state. The `.md` peer's checkboxes are now best-effort observations only; partial-resume and idempotency decisions are driven entirely by a per-action `applied` boolean in the JSON.

Schema **stays at v1** — the field is **additive and optional**. No prior consumer relies on its absence, so introducing it does not break any existing reader.

## Required Change

Tomo's `instruction-render.py` (or whichever component emits `_instructions.json`) must add an `applied` field to every action object. The field is initialised to `false` on every freshly emitted instruction set.

### Before

```json
{
  "schema_version": 1,
  "actions": [
    {
      "id": "I01",
      "kind": "create_moc",
      "payload": { ... }
    },
    {
      "id": "I02",
      "kind": "link_to_moc",
      "payload": { ... }
    }
  ]
}
```

### After

```json
{
  "schema_version": 1,
  "actions": [
    {
      "id": "I01",
      "kind": "create_moc",
      "payload": { ... },
      "applied": false
    },
    {
      "id": "I02",
      "kind": "link_to_moc",
      "payload": { ... },
      "applied": false
    }
  ]
}
```

## How Hashi Uses the Field

- On invocation, Hashi reads `applied` per action. Missing field is treated as `false` (graceful tolerance until Tomo ships the change), but the v0.1 release gate requires the round-trip working.
- When an action commits successfully, Hashi writes `applied: true` for that action and saves the file atomically.
- Hashi NEVER writes `applied: false` — the field is monotonic from `false` to `true`. Re-runs are additive only.
- Skipped actions (dependency failure, halted run, cancelled run, hook failure) leave `applied` at its current value (typically `false`).
- Failed actions leave `applied` at its current value.
- Hand-editing the JSON to flip an action's `applied` to `true` causes Hashi to skip that action on the next run — same semantics as a normal Hashi success.

## Schema JSON Schema Update

The schema definition file at `tomo/schemas/instructions.schema.json` should add `applied` to each action variant under `oneOf`:

```json
{
  "applied": {
    "type": "boolean",
    "description": "True when Hashi has successfully executed this action. Defaults to false on emission.",
    "default": false
  }
}
```

The field is **optional** in the schema (not in `required[]`) so older readers continue to validate.

## Why

- **Determinism**: parsing JSON is unambiguous; parsing `.md` checkbox markup is fragile (heading edits, formatter variations, user hand-edits).
- **Single source of truth**: the `.json` already carries the plan; piggy-backing applied-state on the same file keeps state co-located.
- **Trivial round-trip with Tomo**: a future Tomo session can read the same `.json` and know exactly what was applied without parsing the human-readable `.md`.
- **The `.md` becomes purely a human-reading artifact** — Hashi will tick checkboxes best-effort but never depend on them.

## Impact on Tomo

**Required**: emit `applied: false` per action in every freshly rendered `_instructions.json`.

**Deadline**: before Hashi v0.1 release. The v0.1 release gate (architecture-06 §10) verifies the field round-trips correctly between Tomo (writes `false`) and Hashi (writes `true`).

**Graceful tolerance** (already in Hashi PRD): missing `applied` field is treated as `false`. Hashi will run; partial-resume just won't work until Tomo ships the field.

**No other change**: no changes to schema_version (stays at 1), no changes to action kinds, no changes to payload shapes, no changes to `.md` peer rendering. The `.md` peer's `- [ ] Applied` checkboxes can stay or go — Hashi will tick them best-effort if present, but is no longer authoritative for them.

## Test-Fixture Coordination (suggested)

Once the field ships, please add a fixture to Tomo's golden-output suite covering:

1. A freshly emitted `_instructions.json` with all `applied: false`.
2. A `_instructions.json` that has been through Hashi (some `applied: true`, some `false`) — verifies Tomo's renderer can re-read its own output augmented by Hashi without errors.

Hashi will mirror this fixture set in `test/fixtures/instructions/` for round-trip integration testing.

## Action Required

1. Update `instruction-render.py` (or the rendering equivalent) to emit `applied: false` per action.
2. Update `tomo/schemas/instructions.schema.json` to allow the optional `applied` field.
3. Add a CHANGELOG entry noting the additive change to v1 (or amend an existing v1 entry — schema_version does NOT bump).
4. Optionally: add the round-trip fixtures described above.
5. Set `status: done` on this handoff file (with `status_note` summarising which renderer / schema files were touched).

## References

- Hashi spec 002 PRD: `docs/XDD/specs/002-instruction-executor/requirements.md` — see **F5** (applied-state in JSON), **F6** (partial-resume via JSON applied flags), **Constraints** (`applied` field as v0.1 prerequisite).
- Hashi spec 002 README: `docs/XDD/specs/002-instruction-executor/README.md` — Decisions Log 2026-04-25 entry.
- Hashi spec 002 research synthesis: `docs/XDD/specs/002-instruction-executor/research.md` — §2.1 Q1–Q3 (the original `.md`-as-truth hypothesis was inverted in the user revision round 2026-04-25; this handoff is the resulting Tomo-side ask).
- Architecture 06 §10 v0.1 Release Gate (external) — round-trip verification clause.
