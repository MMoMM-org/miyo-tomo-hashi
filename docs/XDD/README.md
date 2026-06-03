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
| 001 | [Session View](specs/001-session-view/) | Done | Implemented & released (v0.7.1) |
| 002 | [Instruction Executor](specs/002-instruction-executor/) | Done | Implemented & released (v0.7.1) |
| 003 | [IDE Bridge (Tomo context)](specs/003-ide-bridge/) | Done | Implemented & released (v0.7.1) |

## Status Legend

| Status | Meaning |
|--------|---------|
| — | Not started |
| Draft | Spec written, not reviewed |
| Review | Under review |
| Approved | Ready for implementation |
| In Progress | Implementation started |
| Done | Implemented and verified |

## Deferred Review Items

Open items from the 2026-04-25 multi-batch spec review (classified **Defer**).
Re-triaged 2026-06-03: M20, M25, L1 verified **resolved** (latency budgets dropped
in the 2026-04-28 pass; 50-file batch documented as acceptable for v0.1; 001 scope
no longer counts the 002-owned palette command) and M3 was already closed.

The remaining open items are tracked as GitHub issues — label
[`deferred-review`](https://github.com/MMoMM-org/miyo-tomo-hashi/labels/deferred-review):

| Item | Issue |
|------|-------|
| M23 — partial-failure tests (leaked folder, no cleanup in v0.1) | [#24](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/24) |
| M24 — "Test seam strategy" section in both plan READMEs | [#25](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/25) |
| M26 — Docker Engine API floor + tested runtimes | [#26](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/26) |
| M27 — OS-tier runtime guard / document no per-OS gating | [#27](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/27) |
| H25 — prefers-reduced-motion test plan | [#28](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/28) |
| L3, L11, L12 — docs polish (MoSCoW totals, test-data isolation, UI assertion tags) | [#30](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/30) |
