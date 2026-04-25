# Hashi Documentation Index

> Single entry point for all MiYo Tomo Hashi specifications.
> Convention mirrors Tomo's `docs/XDD/` layout (3-digit IDs, hyphen-slug dirs, per-spec `README.md` + `requirements.md` (PRD) + `solution.md` (SDD) + `plan/`).

## Authoritative External References

| Doc | Lives in | Purpose |
|---|---|---|
| ADR-009 Tomo Hashi Charter | Kokoro `global/decisions/ADR-009-tomo-hashi-charter.md` | Scope, connection strategy, execution model — pinned |
| Architecture narrative | Kokoro `global/architecture/06-miyo-tomo-hashi.md` | Flow diagrams, layer breakdown, out-of-scope list |
| Instructions JSON consumer contract | Tomo `docs/instructions-json.md` | Per-action field catalog, execution semantics, idempotency rules |
| Instructions JSON Schema | Tomo `tomo/schemas/instructions.schema.json` | Draft 2020-12 — authoritative on required fields, enums, types |
| Release pipeline standards | Kokoro `global/decisions/ADR-005-obsidian-plugin-release-pipeline.md` | Semantic-release, tag format, versions.json, obsidianmd lint |
| Kado scope (for comparison) | Kokoro `global/architecture/03-miyo-kado.md` | Why Hashi is NOT an MCP gateway |

## Implementation Specs

| ID | Name | Phase | Status |
|----|------|-------|--------|
| 001 | [Session View](specs/001-session-view/) | Planning | Approved — ready for implementation |
| 002 | [Instruction Executor](specs/002-instruction-executor/) | Planning | Approved — ready for implementation |

## Status Legend

| Status | Meaning |
|--------|---------|
| — | Not started |
| Draft | Spec written, not reviewed |
| Review | Under review |
| Approved | Ready for implementation |
| In Progress | Implementation started |
| Done | Implemented and verified |
