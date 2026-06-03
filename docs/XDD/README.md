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

## Deferred Review Items

Open items from the 2026-04-25 multi-batch spec review, all classified **Defer**
at the time. Re-triaged 2026-06-03: M20, M25, L1 verified **resolved** (latency
budgets dropped in the 2026-04-28 pass; 50-file batch documented as acceptable for
v0.1; 001 scope no longer counts the 002-owned palette command) and M3 was already
closed. The items below remain open. (Relocated here from the now-deleted
`docs/pre-release-findings.md` snapshot so they stay tracked.)

### Implementation-time

| ID | Item | Location | Action / decision needed |
|----|------|----------|--------------------------|
| M23 | F4 partial-failure tests — leaked folder when a vault write fails after a partial side effect (destination folder created, then `renameFile` throws) is undocumented | `specs/002-instruction-executor/plan/phase-3.md` (T3.2/T3.3) | Add unit tests pinning actual behaviour ("leaked folder, no cleanup in v0.1"); document in PRD F4 Edge Cases |
| M24 | No "Test seam strategy" section listing seams (dockerode via `vi.mock`, Vault via `FakeVaultFS`, time via `vi.useFakeTimers`, hook loader fixtures, schema validator scripted) | both `specs/*/plan/README.md` | Add a "Test seam strategy" section mandating explicit timer/event-loop control for async-ordering tests |
| M26 | Docker Engine API floor unstated — SDD references "v1.45" without a minimum/tested floor; OrbStack/colima/Podman compat unstated | `specs/001-session-view/solution.md` Constraints / Deployment View | State a minimum API version (e.g. 1.41+), tested host runtimes (Docker Desktop, OrbStack), explicit Podman non-support in v0.1 |
| M27 | OS-tier runtime guard — `isDesktopOnly` set, but no per-OS gating for the macOS-primary / Linux-theoretical / Windows-contribution charter | `specs/001-session-view/solution.md` or `src/main.ts` | Add a load-time OS-detection Notice, or document that no per-OS gating exists in v0.1 |
| H25 | prefers-reduced-motion test mocks — PRD-001 F3/F5 ARIA + reduced-motion ACs have no test plan; jsdom doesn't honor `prefers-reduced-motion` | `specs/001-session-view/plan/phase-4.md` (T4.2/T4.3) | Mock `window.matchMedia('(prefers-reduced-motion: reduce)')` in unit tests, or move the AC to manual-QA |

### Cosmetic / nice-to-have

| ID | Item | Location | Action |
|----|------|----------|--------|
| L3 | F6 MoSCoW totals not visible — 002 PRD claims "11 Must, 0 Should, 0 Could" without surfacing the asymmetry vs 001 (9 Must + 2 Should) | this index's spec table | Add MoSCoW totals so the difference is visible without opening either PRD |
| L11 | Test data isolation unstated — 002 plan T6.3 has 8 live-test scenarios with no share/isolate note | `specs/002-instruction-executor/plan/phase-6.md` (T6.4) | Add an explicit "fresh test vault per scenario" note |
| L12 | Manual vs automated UI assertion split — phase-4 (001) and phase-5 (002) UI tests don't split `[jsdom]` from `[manual]` per assertion | `specs/001-session-view/plan/phase-4.md`; `specs/002-instruction-executor/plan/phase-5.md` | Tag each UI test row so coverage is unambiguous |

### Architectural / process

| ID | Item | Decision needed |
|----|------|-----------------|
| M12 | Hierarchical CLAUDE.md cull — `docs/ai/CLAUDE.md`, `test/CLAUDE.md`, `src/CLAUDE.md` still restate global rules from `~/Kouzou/standards/` | Delete them once implementation reveals what scoped guidance the implementer actually needs, or keep as navigational anchors |
