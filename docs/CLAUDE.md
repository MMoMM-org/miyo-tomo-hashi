# docs/ — Documentation Rules

## When to update what
- New session learnings → save to auto-memory under `~/.claude/projects/<repo>/memory/` (via the standing memory protocol)
- Architectural decisions of cross-repo significance → land in Kokoro under `global/decisions/ADR-NNN-…` (Kokoro is the source of truth for MiYo architecture)
- Hashi-internal design decisions → log in the relevant spec README's Decisions Log (`docs/XDD/specs/<spec>/README.md`)
- New major feature → update root `README.md` and the relevant spec under `docs/XDD/specs/`

## XDD discipline
- New spec → use `tcs-workflow:xdd` to scaffold under `docs/XDD/specs/NNN-<slug>/`
- PRD edits → keep validation checklist current; recount acceptance criteria when sections are added/removed
- Multi-doc revisions → run `/validate` afterward to catch PRD ↔ SDD ↔ Plan drift
