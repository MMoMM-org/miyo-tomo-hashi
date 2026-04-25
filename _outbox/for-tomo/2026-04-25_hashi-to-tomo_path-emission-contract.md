---
from: hashi
to: tomo
date: 2026-04-25
topic: path-emission-contract
status: pending
status_note:
priority: normal
requires_action: true
---

# Path-emission contract — confirm absolute vault-relative paths for all 8 action kinds

## What Changed

Hashi spec 002 (Instruction Executor) PRD F4 acceptance criterion states:

> All target paths in every action payload are absolute vault-relative paths emitted by Tomo. Hashi does NOT resolve daily-note locations, plugin aliases, relative paths, or any other path-shape transformation.

This is a hard contract with Tomo's renderer. Hashi's path-safety pipeline (PRD F9) runs:
**schema → normalize → vault-root containment → deny-list → `fs.realpath` symlink-escape check → execute**

Every stage assumes paths are already in canonical "vault-relative absolute" form. A relative path (`./foo`), a leading-slash absolute path (`/Atlas/200 Maps/foo.md`), or a plugin alias (`{{daily}}/inbox.md`, `<%tp.file.title%>`) would either fail validation with a confusing error message ("Path escapes vault root") or, worse, would be misinterpreted.

The `applied: false` handoff and the `instance-name-label` handoff confirmed Tomo's renderer behaviour for those specific surfaces. This handoff confirms the path-shape contract for **all 8 action kinds** explicitly, before Hashi's executor implementation lands.

## Required Confirmation (per action kind)

For each path field in each of the 8 action kinds, Tomo MUST confirm — and document in `tomo/docs/instructions-json.md` if not already — that the emitted value is:

1. **Vault-relative** (no `/` prefix, no drive letter, no `~`)
2. **Absolute within the vault** (no `..` segments, no `./` prefix, no relative-to-something resolution required by the consumer)
3. **No plugin aliases** (no `{{daily}}`, no Templater syntax, no `[[wikilink]]` shorthand — those are MOC-link payload fields, not path fields)
4. **Forward-slash separated** (no backslashes even on Windows-rendered output — Tomo runs in a Linux container so this should be automatic, but the contract should be stated)
5. **Free of control characters** (`\n`, `\r`, `\x00`, non-printable controls)

## Path Field Inventory by Action Kind

The following table lists every path-typed field across the 8 action kinds. Tomo should confirm each row, or flag any deviation.

| Action kind | Path field | Example | Notes |
|---|---|---|---|
| `create_moc` | `payload.target_path` | `Atlas/200 Maps/MyMOC.md` | Destination of the rendered MOC file. |
| `create_moc` | `payload.source_path` (if present in schema) | `_inbox/2026-04-25-render/MyMOC.md` | Where Tomo wrote the rendered file before move. |
| `move_note` | `payload.source_path` | `_inbox/2026-04-25-render/Atomic Note.md` | Source location in the inbox. |
| `move_note` | `payload.target_path` | `Atlas/202 Notes/Atomic Note.md` | Destination location. |
| `link_to_moc` | `payload.moc_path` | `Atlas/200 Maps/ParentMOC.md` | The MOC file to append a link line into. |
| `link_to_moc` | `payload.note_path` | `Atlas/202 Notes/Linked Note.md` | The note being linked from the MOC. |
| `update_tracker` | `payload.daily_note_path` | `Daily Notes/2026-04-25.md` | The daily note carrying the tracker. **Tomo resolves the date-to-path mapping; Hashi receives the resolved path.** |
| `update_log_entry` | `payload.daily_note_path` | `Daily Notes/2026-04-25.md` | Same as above. |
| `update_log_link` | `payload.daily_note_path` | `Daily Notes/2026-04-25.md` | Same as above. |
| `delete_source` | `payload.path` | `_inbox/2026-04-25-render/Old Draft.md` | The file to move to vault trash. |
| `skip` | (none) | — | Informational no-op; no path field. |

If the schema's actual field names differ from this inventory, Tomo should correct the table in this handoff (or in `tomo/docs/instructions-json.md`) so the contract is unambiguous.

## Why

- **PRD F9 says explicitly that "Hashi is path-agnostic about what those targets represent"** — Hashi does not have, and will not have in v0.1, a Daily Notes plugin resolver, a Periodic Notes resolver, a Templater syntax interpreter, or a `..`-resolver. Anything other than canonical vault-relative absolute paths fails closed.
- **The `realpath` check** (added in PRD F9 and SDD EARS-F9 on 2026-04-25 per the security re-triage) refuses to write to a target whose realpath resolves outside the vault root. A misformed relative path could pass containment after normalization but realpath to somewhere unexpected — defended by the realpath check, but the user-visible error would be cryptic ("path-symlink-escape") for what is really "Tomo emitted an unresolved path".
- **Tomo's existing renderer behaviour likely already conforms** — `instruction-render.py` writes vault-relative paths in its inbox staging area, and the `applied:false` handoff confirmed Tomo handles vault-relative semantics correctly for the `applied` field on already-emitted instruction sets. This handoff is about *making the contract explicit and testable* rather than introducing a new requirement.

## Hashi-Side Counterparts

Hashi's plan-002 includes:
- T1.4 `paths.ts` utility — normalize + contain + deny-list + (post-2026-04-25) `fs.realpath` check
- T2.4 SchemaValidator — wraps ajv 8.x at runtime; flattens any path-related schema error into a single human message

Hashi already exposes the named errors `Path escapes vault root`, `Path is on deny-list`, and `path-symlink-escape`. If Tomo emits a non-conforming path, the user sees one of those messages — actionable for the implementer reading Tomo's renderer, but opaque to a vault user. Confirming the contract before Hashi's executor ships means we never see this in production.

## Impact on Tomo

**Required**:
1. Confirm each row in the Path Field Inventory above. Correct any field-name drift.
2. Document the contract in `tomo/docs/instructions-json.md` under a new "Path Shape Contract" section (or augment an existing path discussion). The five rules above (vault-relative, absolute-within-vault, no plugin aliases, forward-slash, no control characters) should be explicit.
3. Confirm Tomo's renderer rejects user-supplied path strings containing `..`, `\n`, `\r`, `\x00`, or backslashes BEFORE writing them into `_instructions.json`. If the renderer does not currently do this, add the check (this is a Tomo-side defense; Hashi defends in depth on its side too).

**Optional but useful**:
- Add a Tomo-side fixture test asserting an emitted instruction set contains only vault-relative paths matching the contract — rejects `/abs/path`, `..` segments, `{{templates}}`, control chars, etc.

**Deadline**: before Hashi v0.1 release. Hashi can ship without explicit Tomo-side confirmation (the realpath defense catches the worst cases) but the user-facing error quality is significantly better when the contract is documented and tested upstream.

## Action Required

1. Confirm or correct the Path Field Inventory.
2. Add the "Path Shape Contract" section to `tomo/docs/instructions-json.md`.
3. (Optional) Add the Tomo-side path-validation regression test.
4. Set `status: done` on this handoff with `status_note` linking to the documented contract section in `instructions-json.md` and any code-side check added.

## References

- Hashi spec 002 PRD: `docs/XDD/specs/002-instruction-executor/requirements.md` — F4 (paths are emitted by Tomo, Hashi does not resolve), F9 (path safety pipeline including realpath).
- Hashi spec 002 SDD: `docs/XDD/specs/002-instruction-executor/solution.md` — EARS F9, `paths.ts` utility, ADR-7 (atomic write).
- Hashi spec 002 plan: `docs/XDD/specs/002-instruction-executor/plan/phase-1.md` (T1.4) — path-safety unit test surface.
- Tomo consumer contract: `/Volumes/Moon/Coding/MiYo/Tomo/docs/instructions-json.md` — current per-action field documentation.
- Precedent handoffs: `_outbox/for-tomo/2026-04-25_hashi-to-tomo_applied-field.md`, `_outbox/for-tomo/2026-04-24_hashi-to-tomo_instance-name-label.md`.
