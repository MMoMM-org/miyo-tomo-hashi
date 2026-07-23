# Context Memory

## Garden-Audit executor actions + QA polish landed (2026-07-23)

After Phase 7's core (T7.1/T7.2 done), a QA + Tomo-round-trip burst on `feat/garden-audit-editor`:
- **Editor UX (spec-005):** skip+target-edit auto-selects Apply (`080f173`); empty-state
  aria-label tooltips + "no scan candidate" detail-line hint (`c66c21e`→`bd51b05`);
  broken_up remove tooltip flipped to link-only wording (`5e8d0cb`).
- **Executor actions (spec-002, needed for garden-audit apply end-to-end):**
  cherry-picked the finished-but-unmerged **`edit_note_text`** action (`feat/edit-note-text-action`
  8492b19 → clean, no conflicts: executor namespace `src/actions`+`src/schema/types.ts` is
  disjoint from the garden-audit-editor namespace `src/garden-audit`+`src/ui/garden-audit-view`),
  then added **`remove_up_link`** (13th kind, `4ee6d40`+`8ecdc27`): removes one `[[link]]` from
  the `up::` line, KEEPS the field (empty `up:: ` when last link, never delete — up:: is
  structural, resurfaces as unparented next scan), whole-stem `indexOf` match (not substring),
  callout/bullet prefix preserved, skip-and-report on no-match. Reuses `addRelationship`'s locator.
- **ADR-7 full re-vendor** of `instructions.schema.json` from Tomo's `hashi-instructions.schema.json`
  (`cc24db3`): vendored copy had drifted (terser descriptions + `minLength:1` on
  insert_under_marker.target_path); now byte-identical to Tomo.
- **Withdrawn by Tomo mid-flight:** advisory `ack` wire field (Correction 2 → pushback is
  Tomo-internal, T5.5 read-only stays correct); `decision.selected` now defaults false at scan
  (no Hashi change — editor renders from wire; skip+target-edit→apply complements it).
- Adding an executor action kind touches ~20 sites; the Explore scout's checklist + memory
  `troubleshooting_adding_action_kind_test_enumeration_sites` caught them all. KIND_ORDER is the
  silent-drop trap (only the planner.test.ts slot assertion guards it).
- 3 Tomo handoffs closed `done`; branch pushed. 1923 tests green at `5e8d0cb`.

## Garden-Audit Editor Phases 5+6 — COMPLETE (2026-07-23), Phase 7 next

Phase 6 (dead-link context + note navigation) shipped same day: async cached extractor
(`deadLinkContext.ts`, per-doc-load cache after review fix), card wiring with
stale-render guard (`DeadLinkContextView.ts`), side-split + hover-preview navigation
(`noteNavigation.ts` — additive sibling, spec-004 `openNote.ts` untouched),
`registerHoverLinkSource` wired in onload (boundary-validation catch — the mock can't
see Page Preview registration). 1850 tests / build / lint green at `052af85`.
**Phase 7 (final): integration, styles & polish.** Carried-in polish list: extract
`renderCandidateChips`/`renderChipRow` from `GardenAuditTab.ts` (~535 LOC); code-fence
heading edge in deadLinkContext; `deadTarget === undefined` branch test; optional
hover-preview for the suggestions editor (display name "Tomo editor" already umbrella);
lock the registerHoverLinkSource display string in the main.integration test.

## Garden-Audit Editor Phase 5 — COMPLETE (2026-07-23)

**Phase 5 shipped same-day after the Tomo round-trip resolved.** Tomo adopted Hashi's
`decision.suggested` ran-marker proposal as-is (+ fixed the S.4 wire re-upload AND a
third self-found Gap C: the `enriched N` count stopping zero-candidate runs). Schema
re-vendored (ADR-7), T5.4 shipped (`SuggestControl.ts`: toggle + pending /
"no suggestions found" hint precedence per the reply handoff), Phase 5 fully validated
(1818 tests, build, lint; drift-checked). Handoff pair closed `done` both ways. Next:
Phase 6 (dead-link context T6.1, open-beside/hover T6.2), then Phase 7 (integration,
styles, polish — carry-over item: extract `renderCandidateChips`/`renderChipRow` from
`GardenAuditTab.ts` (~525 LOC, over the 500 soft band)).

Wire-gap history (short): T5.4 was blocked half a day because "suggest pending" vs
"ran-and-empty" were wire-identical and `decision` is `additionalProperties:false` — the
handoff pair `2026-07-23_*garden-audit-suggest*` (outbox/inbox, both `done`) carries the
full analysis. Also fixed en route: the ADR-5 apply-only/approve-only gap
(`normalizeBrokenUpActions` on the save path, `f7a43c2`).

## Suggestions Editor (ADR-026) — ABSORBED, BLOCKED on Tomo (2026-07-03)

Kokoro ADR-026 (Draft) amends Hashi's charter (ADR-009): Hashi gains a **Suggestions Editor** — a structured, editable view of Tomo's Pass-1 `suggestions.json` with four deterministic ops (re-point to MOC / pick spot in MOC / merge-rename proposed MOCs / change lifecycle state). Decision + open points recorded in `decisions.md` (2026-07-03). **Not started — gated on Tomo:** the `suggestions.json` schema + change-signal are Tomo-owned and not yet defined (paired Kokoro→Tomo handoff issued same day). Next steps once Tomo's contract lands: scaffold `docs/XDD/specs/NNN-suggestions-editor/` via `tcs-workflow:xdd`, do the ADR-026 §0 capability-mapping (four ops → existing executor contracts ADR-016/023/024) in the SDD, push back on any op that duplicates Tomo. Inbound handoff (absorbed, ack'd): `_inbox/from-kokoro/2026-07-03_kokoro-to-hashi_suggestions-editor-charter.md`.

## Logging / run-log foundation — DONE (2026-06-09, 0.8.1)

The empty-run-log investigation (from issue #51) is **closed**. The root cause was **not** an uncaught throw aborting before `finalize()` (the #51/#55 hypothesis) — a real `confirm`-run logged `run complete` yet the file was the 190-byte placeholder. Actual cause: the two-write placeholder lifecycle (`start()` writes a placeholder, `finalize()` overwrites it) combined with an external frontmatter-automator clobber race in the Privat-Test vault (Obsidian Linter `Updated:` stamp + MetaEdit rewriting Hashi's output files). Resolved by making the run log **write-once** (#58 → 0.8.1): `start()` reserves the path only, `finalize()` creates the file exactly once via `vault.create()`. Same PR also fixed the `skipped-already` footgun — already-correct `add_relationship` notes now graduate (`applied:true` written) instead of reappearing every run. Details in `decisions.md` + `troubleshooting.md`. The MetaEdit null-frontmatter throw is a third-party bug, intentionally out of scope.

## Next up — documentation refresh pass (queued 2026-05-31, after PR #15 / 0.6.0)

The IDE Bridge feature shipped and the user-facing naming was changed to **Tomo chat** / **Tomo context** (was Connection / IDE Bridge). The docs *text* is aligned, but the visual + structural layer lags. Do a dedicated pass covering:

- **Screenshots** — recapture to reflect the renamed three-section settings tab and new labels:
  - `assets/settings-tab-overview.png` — now **three** sections (Tomo chat / Tomo context / Instruction executor); current shot/alt predates Tomo context.
  - `assets/settings-connection.png` — content says "Tomo connection"; recapture as "Tomo chat" (and rename the asset file → update refs in `docs/configuration.md`, `docs/chat.md`).
  - **No screenshots exist yet for Tomo context** — add the IDE-bridge settings section + the 友 popover showing the IDE state line. `docs/context.md` currently has none.
  - Verify `instance-picker.png`, `settings-executor.png`, `status-bar-tomo*.png` still current.
- **Logos / diagrams** — `assets/two-components-overview.svg` is now wrong: there are **three** components (A chat, B executor, C context). File name, content, and the README alt text all say "two". Redraw + rename. Re-check `tomo-hashi-hanko.png`.
- **Structure** — `docs/configuration.md` still has no **Tomo context** settings section (only A — Tomo chat + B — Instruction executor); add it. Reconcile the "branch A/B/C" labels across README + docs. Sanity-check that `chat.md` (connection mechanics) vs `session-view.md` (chat UI) naming is still unambiguous now both read as "chat".
- **Naming scheme** — asset filenames still encode the old terms (`settings-connection.png`, `two-components-overview.svg`); decide rename-files-vs-leave and update all refs. XDD specs + AI memory were intentionally left under the old names as historical records (scope decision 2026-05-31) — confirm that's still the desired boundary.
- **etc** — bump `PRIVACY.md` "Last reviewed" date when touched; grep the README MiYo-family blurb for any remaining "two components" phrasing.

## Release pipeline — operational from 0.2.0 forward

Releases are automated by **semantic-release** on every push to `main`. The workflow (`.github/workflows/release.yml`) runs `npx semantic-release`, which analyses conventional-commit subjects since the last tag, computes the next semver, runs `version-bump.mjs` (propagates version to `manifest.json` and `versions.json`), tags the commit, and drafts a GitHub release with `build/main.js`, `manifest.json`, and `styles.css` as assets.

**0.1.0 anchor:** tag `0.1.0` was placed at commit `9d9d00b` (the original `feat: PRD-aligned errors + v0.1.0 + log_format_version` commit) so semantic-release has a starting point. Without the anchor, the first run would default to `1.0.0`.

**Pipeline-fix history:** prior to 2026-05-07 the workflow trigger and `.releaserc.json` both pointed at `master` while the actual default branch is `main`, so the pipeline never fired and `0.1.0` was set manually in `package.json`/`manifest.json` only. Both refs were corrected in the same PR that opened semantic-release for `0.2.0`.

**For maintainers:** do not bump `package.json`/`manifest.json`/`versions.json` by hand; let conventional commits and the pipeline do it. The version files are listed as `@semantic-release/git` assets and committed automatically as `chore(release): X.Y.Z [skip ci]`.

## Deferred Review Items (2026-04-25 multi-batch review)

The following items from the 2026-04-25 multi-batch spec review on branch `feat/xdd-scaffold` were classified Defer — out of scope for the XDD-scaffold branch but should be picked up later. Each row names where the work belongs.

### Implementation-time (resolve during the relevant phase)

- **M20 — NFR measurement methods.** SDDs declare latency budgets ("plugin load → chat view ≤ 500 ms p95", "discovery p95 ≤ 300 ms", "schema validation ≤ 200 ms / 100 actions") with no measurement method. Resolve during Phase 5 (001) / Phase 6 (002) by either dropping the budgets as informational, or pinning a measurement (`performance.now()` in live tests, median of 20 runs, threshold = 2× target for jsdom flake tolerance). Currently unenforceable.
  - Location: `docs/XDD/specs/001-session-view/solution.md` Quality Requirements / Performance; `docs/XDD/specs/002-instruction-executor/solution.md` Quality Requirements.
  - Branch context: deferred from `feat/xdd-scaffold`.

- **M23 — F4 partial-failure tests.** When a vault write fails after a partial side effect (e.g., destination folder created, then `fileManager.renameFile` throws), the leaked folder is currently undocumented. Add unit tests in T3.2 / T3.3 that pin the actual behaviour ("leaked folder, no cleanup in v0.1") and document in PRD F4 Edge Cases.
  - Location: 002 plan/phase-3.md handler tasks.

- **M24 — Test seam strategy section.** ✅ RESOLVED 2026-06-03 (issue #25). Added a "Test seam strategy" section to **all three** plan READMEs (scoped to all three, not just the two named at review time, since 003 has its own async seams). Each lists its boundaries → named seam (001: dockerode `vi.mock` / real-Docker live / reconnect-backoff fake timers / obsidian mock / xterm injection; 002: `FakeVaultFS` / `.cjs` hook fixtures + createRequire / scripted ajv `validate()` / injected clock + fake timers; 003: real-loopback `WsServer` port:0 / pure frame+JSON-RPC / CM6 editor mock / 100ms debounce fake timers) and carries an **async-ordering mandate**: ordering tests MUST use `vi.useFakeTimers()` + `advanceTimersByTimeAsync` (or deterministic byte-buffer `waitFor` for the real-loopback transport) — never a bare real-time `setTimeout`/`sleep`.
  - Location: all three `plan/README.md` files — "Test seam strategy" section.

- **M25 — 50-file batch perf bound.** PRD-002 edge case mentions 50-file batch with no upper bound or perf test. Decide: (a) hard upper bound + Notice-on-exceed, (b) perf test in live tests with 30 s end-to-end budget, or (c) lazy/streaming validation. Currently allows silent runaway.
  - Location: 002 PRD F1/F2 Constraints; 002 plan/phase-2 or phase-6 perf test.

- **M26 — Docker engine API floor.** ✅ RESOLVED 2026-06-03 (issue #26). Spec 001 SDD now carries **CON-10** (no API version pinned; conservative floor Engine API v1.41 / Docker 20.10+; the `v1.45` doc-links are reference-doc version, not a requirement) and a **Deployment View → Host Runtime Compatibility** table: OrbStack (macOS) verified; Docker Desktop + Docker Engine (Linux) expected-to-work-but-unverified; Podman explicitly not supported in v0.1; Colima/others untested.
  - Location: 001 SDD Constraints / Deployment View.

- **M27 — OS-tier runtime guard.** ✅ RESOLVED 2026-06-03 (issue #27). Decision: **document, no gating** (the load-time per-OS Notice was considered and rejected as ceremony — macOS, the primary platform, would see nothing; Linux/Windows users would get a scary banner on a plugin that may work fine; named Docker errors already communicate real failures). Spec 001 SDD now carries **CON-11** ("No per-OS runtime gating" + rationale) + an OS-support-tiers note in the Host Runtime Compatibility section; README "Known edge cases" gained an Operating-systems bullet (macOS verified / Linux experimental / Windows user-contributed; same code, no gating).
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

- **M12 — Hierarchical CLAUDE.md cull. RESOLVED 2026-06-03 (issue #29, keep-and-fix).** Decision: keep all hierarchical CLAUDE.md files as navigational anchors, but rewrite to point at where rules live instead of restating global standards. `src/CLAUDE.md` and `test/CLAUDE.md` rewritten Hashi-specific (test/ had Python-naming residue `test_<module>.py` in a vitest repo); `docs/ai/CLAUDE.md` and `docs/CLAUDE.md` already curated, left as-is.
  - Location: `docs/ai/CLAUDE.md`, `test/CLAUDE.md`, `src/CLAUDE.md`.

### Push back closed

- **M3 — Explicit AC IDs in PRD** (push-back applied, not deferred). Promoting `[ref: PRD/F1/AC5]` references to anchored `**AC F1.1**` IDs in both PRDs (~150 ACs to relabel) was rejected as cost-disproportionate. The H5 recount-and-lock-the-count approach (Output Schema row holds canonical total; CI gate fails on mismatch) addresses the same failure mode at a fraction of the cost. No further action.
