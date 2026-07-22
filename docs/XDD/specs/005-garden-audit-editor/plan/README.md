---
title: "Garden-Audit review surface — implementation plan"
status: draft
version: "1.0"
---

# Implementation Plan

## Validation Checklist

### CRITICAL GATES (Must Pass)

- [x] All `[NEEDS CLARIFICATION: ...]` markers have been addressed
- [x] All specification file paths are correct and exist
- [x] Each phase follows TDD: Prime → Test → Implement → Validate
- [x] Every task has verifiable success criteria
- [x] A developer could follow this plan independently

### QUALITY CHECKS (Should Pass)

- [x] Context priming section is complete
- [x] All implementation phases are defined with linked phase files
- [x] Dependencies between phases are clear (no circular dependencies)
- [x] Parallel work is properly tagged with `[parallel: true]`
- [x] Activity hints provided for specialist selection `[activity: type]`
- [x] Every phase references relevant SDD sections
- [x] Every test references PRD acceptance criteria
- [x] Integration & E2E tests defined in final phase
- [x] Project commands match actual project setup

---

## Context Priming

*GATE: Read all files in this section before starting any implementation.*

**Specification**:
- `docs/XDD/specs/005-garden-audit-editor/requirements.md` — PRD (9 features, Gherkin ACs)
- `docs/XDD/specs/005-garden-audit-editor/solution.md` — SDD (ADR-1..7, interfaces, EARS ACs)
- `docs/XDD/specs/005-garden-audit-editor/README.md` — verified contract + OQ1..5 + follow-ups
- `_inbox/from-tomo/2026-07-22_tomo-to-hashi_garden-audit-wire-schema-and-answers.md` — §2 verified example
- `/Volumes/Moon/Coding/MiYo/Tomo/tomo/schemas/garden-audit-wire.schema.json` — authoritative schema (vendor source)

**Reuse references (read before mirroring)**:
- `src/suggestions/ObsidianSuggestionsDoc.ts`, `src/vault/SuggestionsDoc.ts`, `src/schema/suggestions-validator.ts`
- `src/ui/suggestions-view/{SuggestionsEditorView,tabContract,openSuggestionsEditor}.ts`, `tabs/SuggestionsTab.ts`, `pickers/*`
- `src/commands/registerCommands.ts` (open command + `resolveSuggestionsDocPath`), `src/main.ts` (registerView), `src/util/store.ts`

**Key Design Decisions**:
- **ADR-1**: Parallel `GardenAuditEditorView` + `VIEW_TYPE_GARDEN_AUDIT_EDITOR` — reuse machinery, don't generic-ize the suggestions view.
- **ADR-2**: Mirror `ObsidianSuggestionsDoc` — load→validate→`{doc,dirty}`, dirty-gated verbatim JSON write, `emit_digest` passthrough.
- **ADR-3**: Composite target control — input + picker + explicit-empty (per-check empty label).
- **ADR-4**: Dead-link context derived locally, async + cached (no wire change).
- **ADR-5**: Editor sets `decision.action` for broken_up (non-empty→`add_relationship`, empty→`edit_note_text`).
- **ADR-6**: One command dispatches by suffix; Hashi does NOT write the `.md` in v1.
- **ADR-7**: Vendor schema + Ajv2020 validator; re-sync from Tomo.

**Load-bearing invariants** (bake into every relevant task):
- `emit_digest` carried **verbatim, never recomputed**; whole-doc round-trips byte-faithful.
- `dirty` is NOT gated on the digest — `suggest_requested`-only edits still enable Save.
- Advisory findings have **no** `decision` block → strictly read-only.
- Fixtures OQ3: the two vault fixtures are stale-shape → the validator rejects them; use a
  regenerated current-shape fixture / handoff §2 as the round-trip baseline.

**Implementation Context**:
```bash
npm test                              # vitest unit tests
npm run lint                          # eslint (obsidianmd) + stylelint
npm run build                         # tsc -noEmit + esbuild (the real typecheck gate over test/)
HASHI_DEPLOY_VAULT=1 npm run build    # deploy into test/Hashi for manual QA
```
Branch: `feat/garden-audit-editor`. Prereqs `feat/rename-tomo-editor` (view naming) and
`feat/edit-note-text-action` (executor) are related but the editor build proceeds in parallel
and integrates. `main` is PR-only.

**Cross-cutting gotchas** (apply in every UI/adapter/test task):
- Tests: side-effect `import "obsidian"`; `cls` array form (`cls:["a","b"]`); `Plugin` abstract → `Pick<>`.
- Tabs/pickers are NOT `Component`s → bare `addEventListener` (no `registerDomEvent`); subtree rebuilt each render.
- `metadataCache` async-rebuild race → resolve body/structure from `cachedRead` content, not `vault.metadata()`.
- Sentence-case UI text; reuse `hashi-se-*` classes; scoped vitest skips typecheck → run full `npm run build` at integration.

---

## Implementation Phases

Each phase is defined in a separate file. Tasks follow red-green-refactor: **Prime** → **Test** (red) → **Implement** (green) → **Validate**.

- [x] [Phase 1: Contract foundation — schema, types, validator, fixture](phase-1.md)
- [x] [Phase 2: Adapter & transforms](phase-2.md)
- [ ] [Phase 3: Discovery & command dispatch](phase-3.md)
- [ ] [Phase 4: View & tab shell](phase-4.md)
- [ ] [Phase 5: Per-check cards & interaction](phase-5.md)
- [ ] [Phase 6: Dead-link context & note navigation](phase-6.md)
- [ ] [Phase 7: Integration, styles & polish](phase-7.md)

---

## Traceability (PRD feature → phase/task)

| PRD | Feature | Phase/Task |
|-----|---------|-----------|
| F1 | Discover & open a garden-audit surface | P3 (T3.1–T3.3), P4 (T4.1) |
| F2 | Findings grouped by tier + counts | P4 (T4.2) |
| F3 | Apply/Skip + target control (pick/type/empty) + dead-link context | P2 (T2.2), P5 (T5.1–T5.3), P6 (T6.1) |
| F4 | Display-only candidates (click-to-pick) | P5 (T5.4) |
| F5 | Suggest-targets toggle + two-run legibility | P2 (T2.2), P5 (T5.5) |
| F6 | Advisory read-only | P5 (T5.6) |
| F7 | Save=approve / Revert / dirty | P2 (T2.1), P4 (T4.3) |
| F8 | Empty & error states | P4 (T4.4) |
| F9 | Open-beside + hover-preview | P6 (T6.2) |
| — | Contract fidelity (schema/validator/digest) | P1 (T1.1–T1.4) |

---

## Plan Verification

| Criterion | Status |
|-----------|--------|
| A developer can follow this plan without additional clarification | ✅ |
| Every task produces a verifiable deliverable | ✅ |
| All PRD acceptance criteria map to specific tasks | ✅ |
| All SDD components have implementation tasks | ✅ |
| Dependencies are explicit with no circular references | ✅ |
| Parallel opportunities are marked with `[parallel: true]` | ✅ |
| Each task has specification references `[ref: ...]` | ✅ |
| Project commands in Context Priming are accurate | ✅ |
| All phase files exist and are linked from this manifest as `[Phase N: Title](phase-N.md)` | ✅ |
