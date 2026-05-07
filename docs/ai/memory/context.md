# Context Memory

## Pending release cut

- **0.2.0 release cut** (loose end from F-43 collision-guard handoff, 2026-05-07). The implementation shipped to main via PR #3 (commit `40b7383`), but the version bump + tag are still pending. Required when releasing: bump `package.json` and `manifest.json` from `0.1.0` to `0.2.0`, add an entry to `versions.json` mapping `0.2.0` to its minimum Obsidian version, tag `0.2.0`, and flip the ACK in `_outbox/for-tomo/2026-05-07_hashi-to-tomo_create-moc-collision-guard-ACK.md` once the tag exists. Tomo's F-43 PLAN T6.4 launch gate already has the receipt; the version cut just makes the ACK's `target_version: 0.2.0` literally true.

## Deferred Review Items (2026-04-25 multi-batch review)

The following items from the 2026-04-25 multi-batch spec review on branch `feat/xdd-scaffold` were classified Defer — out of scope for the XDD-scaffold branch but should be picked up later. Each row names where the work belongs.

### Implementation-time (resolve during the relevant phase)

- **M20 — NFR measurement methods.** SDDs declare latency budgets ("plugin load → chat view ≤ 500 ms p95", "discovery p95 ≤ 300 ms", "schema validation ≤ 200 ms / 100 actions") with no measurement method. Resolve during Phase 5 (001) / Phase 6 (002) by either dropping the budgets as informational, or pinning a measurement (`performance.now()` in live tests, median of 20 runs, threshold = 2× target for jsdom flake tolerance). Currently unenforceable.
  - Location: `docs/XDD/specs/001-session-view/solution.md` Quality Requirements / Performance; `docs/XDD/specs/002-instruction-executor/solution.md` Quality Requirements.
  - Branch context: deferred from `feat/xdd-scaffold`.

- **M23 — F4 partial-failure tests.** When a vault write fails after a partial side effect (e.g., destination folder created, then `fileManager.renameFile` throws), the leaked folder is currently undocumented. Add unit tests in T3.2 / T3.3 that pin the actual behaviour ("leaked folder, no cleanup in v0.1") and document in PRD F4 Edge Cases.
  - Location: 002 plan/phase-3.md handler tasks.

- **M24 — Test seam strategy section.** Each plan README should list the seams (dockerode via `vi.mock`, Vault via FakeVaultFS, time via `vi.useFakeTimers`, hook loader via fixtures, schema validator scripted) and mandate explicit timer/event-loop control for any test asserting async ordering. Currently implicit.
  - Location: both `plan/README.md` files — add a "Test seam strategy" section.

- **M25 — 50-file batch perf bound.** PRD-002 edge case mentions 50-file batch with no upper bound or perf test. Decide: (a) hard upper bound + Notice-on-exceed, (b) perf test in live tests with 30 s end-to-end budget, or (c) lazy/streaming validation. Currently allows silent runaway.
  - Location: 002 PRD F1/F2 Constraints; 002 plan/phase-2 or phase-6 perf test.

- **M26 — Docker engine API floor.** Spec 001 SDD references "Docker Engine API v1.45" without stating it as a minimum or tested floor. OrbStack / colima / Podman compatibility unstated. Add a CON or "Deployment View" subsection naming the minimum API version (e.g., 1.41+ which dockerode broadly targets), tested host runtimes (Docker Desktop, OrbStack), and explicit non-support of Podman in v0.1.
  - Location: 001 SDD Constraints / Deployment View.

- **M27 — OS-tier runtime guard.** Charter says macOS primary, Linux theoretical, Windows user-contribution. Manifest only has the binary `isDesktopOnly` flag — no per-OS gating exists. Add a load-time OS detection that surfaces a one-time Notice ("Linux: experimental, Windows: user-contributed") on first install per OS, OR document explicitly in spec README that no per-OS runtime gating exists in v0.1.
  - Location: 001 SDD or `src/main.ts` load-time check; spec README documentation.

- **H25 — prefers-reduced-motion test mocks.** PRD-001 F3/F5 ARIA + reduced-motion ACs have no test plan; jsdom doesn't honor `prefers-reduced-motion` natively. Either (a) mock `window.matchMedia('(prefers-reduced-motion: reduce)')` in T4.2 / T4.3 unit tests, OR (b) move the AC to manual-QA in T5.5b with explicit checklist row. T5.5b already lists this — pick one position when implementing Phase 4.
  - Location: 001 plan/phase-4.md T4.2 / T4.3 (decide unit vs manual at implementation time).

### Cosmetic / nice-to-have

- **L1 — 001 PRD palette command annotation.** 001 README scope blurb lists "Execute instructions document" as a 002-owned palette command alongside 001's two — inflates the "three commands for 001" headline. Resolve by moving palette inventory into a shared note (`docs/XDD/README.md` table) when the implementation lands.
  - Location: `docs/XDD/specs/001-session-view/README.md` Scope section.

- **L3 — F6 MoSCoW totals visibility.** 002 PRD claims "11 Must, 0 Should, 0 Could" without surfacing the asymmetry vs spec 001 (9 Must + 2 Should). Add MoSCoW totals to `docs/XDD/README.md` spec table so the difference is visible without opening either PRD.
  - Location: `docs/XDD/README.md`.

- **L11 — Test data isolation.** 002 plan T6.3 has 8 live-test scenarios but doesn't say whether they share or isolate tmpdirs. With FsPromisesVaultFS dropped in the 2026-04-25 simplification, this concern partially evaporates — but the manual-QA scenarios in T6.4 should still get an explicit "fresh test vault per scenario" note when implemented.
  - Location: 002 plan/phase-6.md T6.4.

- **L12 — Manual vs automated UI assertion split.** Phase-4 (001) and Phase-5 (002) UI tests assert in jsdom against the obsidian mock without splitting "jsdom-testable" from "manual-QA-only" per assertion. With T5.5b / T6.4 manual-QA tasks in place, future implementers should tag each UI test row "[jsdom]" vs "[manual]" so coverage is unambiguous.
  - Location: 001 plan/phase-4.md tasks; 002 plan/phase-5.md tasks.

### Architectural / process

- **M12 — Hierarchical CLAUDE.md cull.** Three of four hierarchical CLAUDE.md files (`docs/`, `docs/ai/`, `test/`) restate global rules from `~/Kouzou/standards/`. `docs/CLAUDE.md` was rewritten in the 2026-04-25 drift batch; the others remain. Decide later whether to delete them once implementation starts and we know what scoped guidance the implementer actually needs.
  - Location: `docs/ai/CLAUDE.md`, `test/CLAUDE.md`, `src/CLAUDE.md`.

### Push back closed

- **M3 — Explicit AC IDs in PRD** (push-back applied, not deferred). Promoting `[ref: PRD/F1/AC5]` references to anchored `**AC F1.1**` IDs in both PRDs (~150 ACs to relabel) was rejected as cost-disproportionate. The H5 recount-and-lock-the-count approach (Output Schema row holds canonical total; CI gate fails on mismatch) addresses the same failure mode at a fraction of the cost. No further action.
