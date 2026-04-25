---
from: hashi
to: tomo
date: 2026-04-25
topic: schema-changelog-discipline
status: pending
status_note:
priority: normal
requires_action: true
---

# Schema-change CHANGELOG discipline + version-bump rules

## What Changed

Hashi vendors `tomo/schemas/instructions.schema.json` directly into `src/schema/instructions.schema.json` (per Hashi spec 002 SDD ADR-2). Hashi's runtime ajv validator (ADR-1 v2, revised 2026-04-25) compiles that vendored copy at plugin load. There is no automated drift-detection between Tomo's authoritative schema and Hashi's vendored copy — drift is currently signaled by manual coordination only.

That is fragile. If Tomo adds a required field under `schema_version: 1`, Hashi will start failing-closed on every newly-emitted instruction set without warning. If Tomo bumps to `schema_version: 2` without a coordinated Hashi release, every vault on the older Hashi version stops working with no actionable error. The safety net we have today (Hashi's `version-mismatch` named error) is the right behaviour — but it leaves the user stuck.

This handoff asks Tomo to commit to a written **schema-change discipline** so the drift signal is explicit.

## Required Discipline

When the schema in `tomo/schemas/instructions.schema.json` is touched, Tomo MUST:

### A. Classify the change

| Change | Classification | Version bump |
|---|---|---|
| Add an optional field (not in `required[]`) | **Additive** | none — `schema_version` stays at current value |
| Add a new action `kind` | **Additive** | none — older readers reject the new kind via existing fail-closed |
| Add a value to an existing enum | **Additive** | none |
| Add a new required field | **Breaking** | bump `schema_version` |
| Remove a field | **Breaking** | bump `schema_version` |
| Rename a field | **Breaking** | bump `schema_version` |
| Change a field's type or shape | **Breaking** | bump `schema_version` |
| Change the canonical execution order of action kinds | **Breaking** | bump `schema_version` |

The `applied` field added in v0.7.0 (handoff `2026-04-25_hashi-to-tomo_applied-field.md`) is a textbook **additive** change — schema stayed at v1 — and is the precedent here.

### B. CHANGELOG entry on every schema touch

For every commit that modifies `tomo/schemas/instructions.schema.json`, Tomo MUST add a row to a CHANGELOG (either a new `tomo/CHANGELOG.md` or a clearly-flagged section in an existing changelog) with:

- **Date** (ISO 8601)
- **Tomo version / commit** (semantic version + short SHA)
- **Classification** (Additive / Breaking)
- **Schema version after the change** (e.g., `v1 (unchanged)` or `v1 → v2`)
- **One-line summary** of what changed, naming the affected action kind(s) and field(s)
- **Migration note** for breaking changes (what consumers must do)

Example row format:

```markdown
| 2026-04-25 | v0.7.0 / f3ad49d | Additive | v1 (unchanged) | Added optional `applied: boolean` field per action. | Consumers can ignore until they want partial-resume; missing field still validates. |
```

### C. Coordinated bump for breaking changes

When a breaking change ships (`schema_version` is incremented), Tomo SHOULD:

1. Open a Hashi-side outbound handoff in `_outbox/for-hashi/` flagging the bump and target Tomo version.
2. Wait for Hashi to confirm vendored-schema upgrade before merging the breaking change to Tomo `main`. (Hashi's vendored-schema regression test in plan/phase-1 T1.1 asserts `schema_version === 1` — a v2 emission against a v1-pinned Hashi will fail-closed but the user-visible error is non-actionable without a coordinated release.)

This is the same handoff lane already in use for the `applied: false` field and the `instance-name` label. The mechanics are familiar.

## Why

- **Hashi cannot detect schema drift on its own.** The vendored copy is a snapshot; without a signal from Tomo, Hashi's validator either silently accepts the older schema (good) or fail-closes on additive changes (bad UX) or fail-closes on a breaking change (correct but blocking).
- **The `applied: false` rollout proved the model works.** That handoff classified itself as additive, kept `schema_version` at 1, shipped a CHANGELOG-equivalent entry in the handoff `status_note`, and Hashi vendored without ceremony. Codifying the rule means future schema changes follow the same path automatically.
- **The risk row in Hashi spec 002 PRD §Risks names this gap** — "outbound handoff requesting CHANGELOG entries on every schema change" was the listed mitigation. This file *is* that handoff.

## Impact on Tomo

**Required**:
1. Decide where the schema CHANGELOG lives (`tomo/CHANGELOG.md` or a section in an existing changelog) and seed it with the historical entries (at minimum: the v0.7.0 `applied` field addition).
2. Adopt the rule that any commit modifying `tomo/schemas/instructions.schema.json` MUST update the CHANGELOG in the same commit.
3. For any future *breaking* change, open an outbound handoff in `_outbox/for-hashi/` BEFORE merging.

**Optional but useful**:
- Add a CI check (or pre-commit hook) on the Tomo side that fails if `tomo/schemas/instructions.schema.json` is modified without a corresponding CHANGELOG diff.

**No code-shape change**: this is a process commitment, not a renderer or schema change. Adopting the discipline costs ~5 lines per schema-touching commit.

## Hashi-Side Counterparts

Hashi's plan already includes:
- `test/unit/schema/vendored-schema.test.ts` (plan-002 T1.1) — asserts `schema_version === 1` and `$defs/applied_field` presence. This test catches schema drift at *Hashi* CI time but only flags it, doesn't explain it.
- The vendored copy is committed to git, so a Hashi-side `git log` shows when Hashi last vendored — pairing this with Tomo's CHANGELOG gives a complete drift picture.

If the discipline is adopted, Hashi will (in a follow-up): add a CI check that fails when the vendored schema differs from Tomo's latest schema *without* a corresponding Hashi CHANGELOG entry referencing the Tomo CHANGELOG row. (Out of v0.1 scope; tracked for v0.2.)

## Action Required

1. Choose the CHANGELOG location and seed it (or confirm an existing location).
2. Document the additive-vs-breaking classification rules above in Tomo's contributor docs (or link to this handoff).
3. Commit to opening an outbound `_outbox/for-hashi/` handoff before any future breaking schema change.
4. Set `status: done` on this handoff with `status_note` naming the CHANGELOG file path and the contributor-doc location.

## References

- Hashi spec 002 PRD: `docs/XDD/specs/002-instruction-executor/requirements.md` — see **Constraints** (schema-version pinning) and **Risks** row "Schema drift between Tomo and vendored copy".
- Hashi spec 002 SDD: `docs/XDD/specs/002-instruction-executor/solution.md` — ADR-1 (revised 2026-04-25, runtime ajv) and ADR-2 (vendored schema with Tomo CHANGELOG as drift signal).
- Hashi spec 002 README: `docs/XDD/specs/002-instruction-executor/README.md` — Decisions Log 2026-04-25 entries on schema vendoring.
- Precedent handoff: `_outbox/for-tomo/2026-04-25_hashi-to-tomo_applied-field.md` — additive change classified correctly; this handoff codifies the rule used there.
