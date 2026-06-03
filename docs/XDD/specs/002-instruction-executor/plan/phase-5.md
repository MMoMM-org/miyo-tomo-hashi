---
title: "Phase 5: UI Surfaces"
status: completed
version: "1.0"
phase: 5
---

# Phase 5: UI Surfaces

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- PRD: F3 (tri-state mode + modal), F7 (run-end Notice), F8 (hook disclosure modal), F10 (status-bar 橋) — `[ref: PRD/F3, F7, F8, F10]`
- SDD: ExecutionModal; modalContent subviews; statusBar; HookDisclosureModal; ADR-5 (state-machine modal); ADR-6 (color-state status bar) — `[ref: SDD/Directory Map; ui]` `[ref: SDD/Architecture Decisions; ADR-5, ADR-6]`

**Key Decisions** (affecting this phase):
- ADR-5: single `ExecutionModal` class with three internal subviews; subscribed to `executionStore`
- ADR-6: 橋 status bar uses idle/green/red color classes; **no animation**, no `prefers-reduced-motion` handling needed
- All UI subscribes; the executor publishes state. UI surfaces never call the executor directly except via explicit user actions (Cancel button, etc.).

**Dependencies**: Phase 4 (orchestrator + executionStore + HookRunner with the disclosure callback signature).

---

## Tasks

This phase implements the four UI surfaces — the execution modal (state-machine), the 橋 status bar (color states), the hook disclosure modal, and the run-end Notice helper. The first three are independent files and can be developed in parallel.

> **Assertion venue tags:** each `2. Test:` row below is tagged `[jsdom]` (fully verified by the automated vitest/jsdom unit suite), `[manual]` (requires real-Obsidian observation — recorded in `manual-qa-checklist.md`), or `[jsdom][manual]` (structural assertion automated in jsdom, with a perceptual or assistive-technology confirmation in manual QA).

- [x] **T5.1 ExecutionModal — state-machine UI** `[parallel: true]` `[activity: frontend-ui]`

  1. Prime: Read PRD F3 (tri-state behavior + button labels) `[ref: PRD/F3]`. Read PRD F6 (banner) and F7 (sticky error banner during run) `[ref: PRD/F6, F7]`. Read SDD ADR-5 + Component States diagram `[ref: SDD/Architecture Decisions; ADR-5]` `[ref: SDD/Cross-Cutting Concepts; Component States]`.
  2. Test: `test/unit/ui/ExecutionModal.test.ts`:
     - **Preview subview** (mode=confirm, state=previewing): `[jsdom]`
       - Header shows source-file count and partial-resume banner if remaining < total
       - Body shows action rows grouped by source file with `## <filename>` headers; each row has glyph + I## + kind + summary
       - Already-applied rows render greyed-out with ✓ glyph
       - Footer disclosure: "Approval lives in Tomo's review step. This preview is informational."
       - Buttons: **Execute** (primary) + **Cancel** (secondary). No "Dismiss".
     - **Preview subview** (mode=auto-run, state=running): banner present; rows present; **Cancel** button visible; **Execute** absent (run already started). `[jsdom]`
     - **Progress subview** (state=running): row glyphs animate ⏺ → ⟳ → ✓/✗/⊘ as outcomes arrive; sticky error banner accumulates failures; Cancel halts after current action. `[jsdom]`
     - **Summary subview** (state=summary): stats line *"✓ A · ⊘ S · ✗ F (Xs)"*; **View errors** button when F > 0; **Close** button. `[jsdom]`
     - **0-of-M-remaining state** (all actions already applied): banner *"0 of M remaining — all actions already applied"*; **Execute** button is disabled (asserted via `disabled` attribute) in *Confirm* mode; the test verifies the AC at PRD F6 line 193 `[ref: PRD/F6]` `[jsdom]`.
     - **Validation-failed** state: per-file errors displayed in a tabular layout; only **Close** button. `[jsdom]`
     - State transitions: each transition rebuilds the modal body in place (no Modal.close + Modal.open between phases). `[jsdom]`
     - Cancel during preview → `executor.cancel()` not invoked (no run started); Cancel during running → `executor.cancel()` invoked exactly once. `[jsdom]`
     - Esc key follows the button mapping (preview: cancel; running: cancel; summary/validation-failed: close). `[jsdom]`
  3. Implement:
     - `src/ui/ExecutionModal.ts` — Modal subclass; subscribes to `executionStore`; on each state change, calls into `previewView` / `progressView` / `summaryView` to render `contentEl`.
     - `src/ui/modalContent/previewView.ts`, `progressView.ts`, `summaryView.ts` — pure DOM render functions taking `(contentEl: HTMLElement, state: RunState, callbacks: ModalCallbacks)`. The callbacks bundle the `onExecute`, `onCancel`, `onClose` action handlers.
     - `src/ui/ExecutionModal.css` rules added to `styles.css` under `.hashi-execution-modal`.
  4. Validate: All ExecutionModal tests pass; jsdom assertions on DOM structure; lint clean.
  5. Success:
     - [x] All 5 PRD F3 ACs covered (button labels, mode-driven start, Cancel semantics) `[ref: PRD/F3]`
     - [x] Per-action progress + sticky error banner work `[ref: PRD/F7]`
     - [x] Modal stays the same instance across phases (no flash) `[ref: SDD/ADR-5]`

- [x] **T5.2 Status bar 橋 — color states** `[parallel: true]` `[activity: frontend-ui]`

  1. Prime: Read PRD F10 ACs `[ref: PRD/F10]`. Read SDD ADR-6 (revised; color states only) `[ref: SDD/Architecture Decisions; ADR-6]`. Read 001's status-bar implementation if shipped (`src/ui/status-bar/StatusBarIcon.ts`) for class-naming conventions.
  2. Test: `test/unit/ui/statusBar.test.ts`:
     - On plugin load, status bar item renders 橋 kanji with class `is-idle` `[jsdom][manual]`
     - When `executionStore` transitions to `running`, the item swaps to class `is-running` (asserted by classList) `[jsdom][manual]`
     - When the run ends with ≥ 1 failure, the item swaps to `is-error` and remains for ~10s, then returns to `is-idle` `[jsdom][manual]`
     - When the run ends with 0 failures, the item returns directly to `is-idle` `[jsdom]`
     - Tooltip text per state: idle / `running — N of M actions` / `last run had F failures — see <log filename>` `[jsdom][manual]`
     - Click on running state focuses the active modal (asserted via spy on `app.workspace.setActiveLeaf` or modal-focus method) `[jsdom]`
     - Click on idle state is a no-op `[jsdom]`
     - **No animation**: assert that the element has no inline style `animation` and no `@keyframes` rule applies (CSS class names checked) `[jsdom]`
     - Reduced-motion: no special handling needed (test verifies that no media-query CSS rules toggle animation) `[jsdom]`
     - **ARIA live region**: the status-bar item has `role="status"` and `aria-live="polite"`; state changes append a brief text node (e.g., "Hashi running", "Hashi error", "Hashi idle") that screen readers announce. Asserted by jsdom — verifies the AC at PRD F10 line 256 `[ref: PRD/F10]`. `[jsdom][manual]`
  3. Implement:
     - `src/ui/statusBar.ts` — registers an `addStatusBarItem`; subscribes to `executionStore`; class swap on state change; tooltip set via `setAttr('aria-label', text)` and `title`
     - `styles.css` rules: `.hashi-status-bar-bridge.is-idle { color: var(--text-muted); }`, `.is-running { color: var(--color-green); }`, `.is-error { color: var(--color-red); }`. No animation rules.
  4. Validate: Status bar tests pass; `npm run build` clean; jsdom assertions reliable.
  5. Success:
     - [x] Three color states verified `[ref: PRD/F10; SDD/ADR-6]`
     - [x] Tooltip text correct per state `[ref: PRD/F10]`
     - [x] No animation present `[ref: SDD/ADR-6]`

- [x] **T5.3 HookDisclosureModal — ask-mode disclosure** `[parallel: true]` `[activity: frontend-ui]`

  1. Prime: Read PRD F8 ACs about disclosure modal `[ref: PRD/F8]`. Read SDD `HookDisclosureModal` directory entry `[ref: SDD/Directory Map; hooks]`.
  2. Test: `test/unit/hooks/HookDisclosureModal.test.ts`:
     - Modal opens with: hook path (relative to vault root), file size in bytes, three buttons **Enable**, **Enable once**, **Disable** `[jsdom]`
     - Each button resolves a Promise with the chosen decision (`"enable"`, `"enable-once"`, `"disable"`) `[jsdom]`
     - Esc resolves with `"disable"` (defensive default) `[jsdom]`
     - Modal does NOT carry state across opens — fresh resolution every time `[jsdom]`
  3. Implement: `src/hooks/HookDisclosureModal.ts` — Obsidian `Modal` subclass. Constructor takes `(app, hookInfo): Promise<Decision>`-style callback. Wired into Phase 4's `HookRunner` callback signature.
  4. Validate: Tests pass; modal interaction round-trips.
  5. Success:
     - [x] All three decisions returned correctly `[ref: PRD/F8]`
     - [x] Esc-as-disable defensive default `[ref: PRD/F8]`

- [x] **T5.4 Phase 5 Validation** `[activity: validate]`

  - Run `npm test && npm run lint && npm run build`. Confirm:
    - [x] All three UI surfaces pass their own test suites (671 tests; +62 over Phase 4 baseline)
    - [x] `executionStore` subscriptions are unsubscribed on modal close / status-bar teardown (asserted via `listenerCount(store)` helper in `test/unit/ui/ExecutionModal.test.ts:76`; dedicated teardown test in `test/unit/ui/statusBar.test.ts:478`)
    - [x] jsdom DOM assertions stable (671/671 green; no flakes)
    - [x] No lint warnings
