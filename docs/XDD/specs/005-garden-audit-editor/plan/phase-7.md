---
title: "Phase 7: Integration, styles & polish"
status: in_progress
version: "1.0"
phase: 7
---

# Phase 7: Integration, styles & polish

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/User Interface & UX]` — the entry-point wireframe + new elements
- `[ref: SDD/Deployment View]` — single-bundle, no deploy change
- `[ref: SDD/Quality Requirements]`, `[ref: SDD/Acceptance Criteria (EARS)]`
- Reuse: `styles.css` (`hashi-se-*` vocabulary + theme vars)

**Key Decisions**: reuse `hashi-se-*` — only genuinely new elements get CSS; full build/test/lint gate; verify against real + regenerated fixtures.

**Dependencies**: Phases 1–6.

---

## Tasks

Integrates the surface end-to-end, adds the minimal new styles, and gates on the full suite + real fixtures.

- [x] **T7.1 Styles for new elements** `[activity: frontend-ui]`

  1. Prime: Read the `hashi-se-*` classes + theme vars + the obsidianmd CSS rule (no `text-decoration` style value → use `border-bottom`) `[ref: SDD/User Interface & UX]`.
  2. Test: stylelint passes; the new elements (typed-target input, pending-suggest hint, tier count pill, dead-link context snippet) resolve against existing light/dark vars.
  3. Implement: add the minimal `styles.css` rules, reusing `hashi-se-*` vars; no new color tokens.
  4. Validate: `npm run lint` (stylelint) clean; visual check in the test vault (`HASHI_DEPLOY_VAULT=1 npm run build`).
  5. Success: the surface matches the editor idiom in light + dark `[ref: SDD/User Interface & UX]`.

  **Audit note (T7.1, post-P4-6 pass):** re-checked every `hashi-ga-*` rule against the SDD
  mockup + `hashi-se-*` idiom — typed-target input (`.hashi-ga-target-inp` + reused
  `.hashi-se-inp`/`.hashi-se-mini-pick`), pending/empty suggest hints
  (`.hashi-ga-suggest-hint--pending`/`--empty`), tier count (`.hashi-ga-tier-count` — already
  `border-radius:999px` + `--se-bg-alt` fill, i.e. already pill-shaped; shape precedent is
  `.hashi-se-warn-pill` — review correction: `.hashi-se-src-badge` is a 3px-radius squared
  badge, not a pill, and was wrongly cited as idiom precedent in the first audit pass), dead-link context
  (`.hashi-ga-context`/`-line`/`-missing`), candidate chips, `.hashi-ga-card--advisory` dim, and
  `.hashi-ga-note-missing` tag all resolve purely through `--se-*` custom props / Obsidian theme
  vars — zero raw hex/rgb literals in the `hashi-ga-*` block, zero `text-decoration` style-value
  usage anywhere in the file. Audit clean, no CSS changes needed; no class renamed.

- [ ] **T7.2 End-to-end integration + fixtures** `[activity: integration]`

  1. Prime: Re-read `main.ts` wiring + the regenerated current-shape fixture (T1.3) + the two real vault fixtures `[ref: SDD/Runtime View]`.
  2. Test (integration, real stack against fixtures): open the current-shape fixture → render all tiers → edit a target on each fixable check type → Save → assert the written JSON has the decisions + `approved:true` + `emit_digest` byte-identical to the input; the stale fixtures open into the error surface (validator reject); a Suggest-only edit saves and changes no apply-field.
  3. Implement: any remaining wiring in `main.ts`; ensure the whole flow runs against real Tomo emission (not synthetic).
  4. Validate: `npm run build` (full tsc over `test/`) + `npm test` + `npm run lint` all green; manual QA in the test vault.
  5. Success: a full run is reviewable + approvable through the editor with the digest preserved `[ref: PRD/F7; SDD/Quality Requirements]`; Tomo↔Hashi round-trip proven against real emission `[ref: README/OQ3]`.

- [ ] **T7.3 Phase validation (integration & E2E)** `[activity: validate]`

  - Run the FULL suite: `npm run build` + `npm test` + `npm run lint`. Walk the traceability table (every PRD feature → a passing test). Deploy to the test vault and confirm the manual review flow end-to-end. Note the ADR-5 Tomo-confirm follow-up and the schema re-sync (README follow-ups) before opening a PR.
