---
title: "Phase 5: Wire-up, Integration & Release Gate"
status: completed
version: "1.0"
phase: 5
---

# Phase 5: Wire-up, Integration & Release Gate

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- PRD: All features (F1–F9 + FS1 + FS2); "Success Metrics" → v0.1 release gate; "Constraints and Assumptions"
- SDD: "Architecture Decisions" (10 ADRs), "Runtime View", "Deployment View", "Quality Requirements"
- README: full Decisions Log — especially Tomo handoff requirement (note: the 2026-04-24 entry about spec 002 coupling drift is historical; spec 002 README has since been decoupled)

**Key Decisions** (affecting this phase):
- ADR-8: dynamic command label via `removeCommand` + `addCommand`
- ADR-6: singleton chat view via `getLeavesOfType` + `setViewState`
- PRD command palette = exactly 3 commands (Reconnect, Show chat, Execute instructions — the last belongs to spec 002 and is OUT OF SCOPE for this plan)
- Release gate: Tomo handoff file created in `_outbox/for-tomo/` and returned `status: done` (Tomo v0.7.0)

**Dependencies**: Phases 1–4 complete.

---

## Tasks

This phase binds everything together in `main.ts`, registers the two Hashi commands, runs PRD-level integration tests against a real Docker daemon, and ships the two outbound handoffs the plan carries.

- [x] **T5.1 Command registry — Reconnect (dynamic label) + Show chat window** `[activity: integration]`

  1. Prime: Read PRD F6, F7; SDD ADR-8 and "Implementation Examples / Dynamic Command Label" `[ref: PRD/F6; PRD/F7; SDD/ADR-8; SDD/Implementation Examples]`.
  2. Test: Write `test/unit/commands/registerCommands.test.ts`:
     - On plugin init, exactly one "Reconnect" command and one "Show chat window" command are registered
     - Reconnect command label is "Reconnect to `<instance-name>`" when `displayInstanceName` is non-null
     - Reconnect command label is "Reconnect to Tomo" when `displayInstanceName` is null
     - On state change that flips the display name, `removeCommand` is called with the old ID and `addCommand` is called with the new label; no duplicate commands remain
     - Invoking Reconnect while Connected/Reconnecting: calls `connection.forceReconnect()`
     - Invoking Reconnect while Disconnected with `chosenInstanceId`: calls `connection.forceReconnect()` (which internally attempts re-attach, stays Disconnected on failure; NEVER opens picker)
     - Invoking Reconnect while Disconnected with no `chosenInstanceId`: surfaces a `Notice` with the PRD F6/AC5 message; does NOT open the picker
     - Invoking "Show chat window" calls the singleton leaf opener (see T5.2)
     - On plugin unload, both commands unregister
  3. Implement:
     - Create `src/commands/registerCommands.ts` exporting `registerCommands(plugin, { connection, showChatWindow })`.
     - Inside, call `registerReconnectCommand(plugin, onInvoke)` using the pattern from SDD Implementation Examples; pass `onInvoke = async () => { if connected/reconnecting → connection.forceReconnect(); else if chosenInstanceId → connection.forceReconnect(); else new Notice("No Tomo instance chosen — open Settings → Connect.") }`.
     - Register Show Chat Window: `plugin.addCommand({ id: "show-chat-window", name: "Show chat window", callback: showChatWindow })`.
  4. Validate: Unit tests pass.
  5. Success:
     - [ ] Dynamic label re-register works on state change `[ref: PRD/F6/AC1-2; ADR-8]`
     - [ ] Reconnect command never opens picker `[ref: PRD/F6/AC4-5; Decisions Log 2026-04-24]`

- [x] **T5.2 Singleton chat view opener** `[activity: integration]`

  1. Prime: Read ADR-6 + PRD F7 ACs + Obsidian workspace docs on `getLeavesOfType`, `getRightLeaf`, `setViewState`, `revealLeaf` `[ref: SDD/ADR-6; PRD/F7]`.
  2. Test: Write `test/unit/ui/chat-view/showChatWindow.test.ts`:
     - When no leaf of `VIEW_TYPE_TOMO_CHAT` exists: creates one via `getRightLeaf(false).setViewState({ type: VIEW_TYPE_TOMO_CHAT, active: true })` and reveals it
     - When a leaf exists: reveals the existing leaf (does NOT create a second instance)
     - When multiple leaves exist (edge case — user manually cloned): reveals the first; leaves the others in place (per SDD ADR-6 trade-off)
  3. Implement: Create `src/ui/chat-view/showChatWindow.ts` exporting `showChatWindow(app: App): Promise<void>`.
  4. Validate: Unit tests pass.
  5. Success:
     - [ ] Singleton invariant holds across invocations `[ref: PRD/F4/AC2; ADR-6]`

- [x] **T5.3 `main.ts` wire-up** `[activity: integration]`

  1. Prime: Read current `src/main.ts` + SDD "Building Block View / Components" diagram + ADR-10 (plugin unload best-effort) `[ref: src/main.ts; SDD/Building Block View]`.
  2. Test: Write `test/unit/main.integration.test.ts`:
     - `onload` registers: settings tab, chat view type, status bar item, file menu listener, two commands
     - `onload` creates a `TomoConnection` instance which imports `dockerode` directly via `src/connection/docker.ts`. Unit tests use `vi.mock('dockerode')` to script the small surface (listContainers, getContainer, container.inspect, container.attach).
     - `onload` calls `autoReconnectIfRemembered()` (FS2)
     - `onunload` calls `connection.dispose()` and detaches any `VIEW_TYPE_TOMO_CHAT` leaves
     - Double-onload (defensive): second call is a no-op (or throws a clear error)
  3. Implement: Rewrite `src/main.ts`:
     - Class `HashiPlugin extends Plugin` with `settings: PluginSettings` + `connection: TomoConnection`
     - `onload()`: load settings; create `DockerodeAdapter`; instantiate `TomoConnection(adapter, settings)`; register view + settings + status bar + file menu + commands; kick off `autoReconnectIfRemembered()`; log plugin loaded
     - `onunload()`: best-effort stream close via `connection.dispose()`; detach chat leaves; log plugin unloaded
  4. Validate: Integration test passes; production build succeeds; manual smoke in test vault.
  5. Success:
     - [ ] All surfaces from Phase 4 are wired and reachable `[ref: SDD/Building Block View]`
     - [ ] FS2 auto-reconnect fires on load `[ref: PRD/FS2/AC1]`
     - [ ] Clean unload `[ref: SDD/Quality Requirements; Reliability]`

- [x] **T5.4 PRD acceptance-criteria traceability matrix** `[activity: testing]` (revised 2026-04-25 — adopted 002's matrix model)

  1. Prime: Read PRD §Feature Requirements (F1–F9 + FS1, FS2) — count ACs by `grep -c '^  - \[ \]' requirements.md` and use that as the gate (do NOT hard-code a per-feature breakdown — it drifts when ACs are added/removed). The PRD's Output Schema row holds the canonical total; this matrix MUST cover that exact count.
  2. Test: Build a traceability matrix file `docs/XDD/specs/001-session-view/plan/traceability.md`:
     - Rows: every PRD AC (count taken from PRD Output Schema at run time)
     - Columns: AC ID (Fx.y) | description | covering test file(s) | covering live-test scenario(s) | covering manual-QA row(s) (T5.5b) | status (✅ / ❌)
     - Every AC must have at least one ✅ across the test/live/manual columns. **No `test.todo` placeholders** — `test.todo` is silent in CI and a previous draft of this task allowed orphan ACs to slip through; the matrix file is the authoritative gate.
  3. Implement:
     - Walk the PRD; for each AC, fill in the row
     - Run `npm test && npm run test:live && npm run lint` — confirm full green
     - If any AC has no coverage (test or manual-QA row), add a TDD-style task to the relevant phase OR add a row to the T5.5b checklist, and re-fill the matrix
     - The Phase 5 Validation step (T5.9) reads this file and fails if any row's status is ❌
  4. Validate: Full traceability matrix at 100% coverage; all status rows ✅; spec README reflects ready-for-implementation state.
  5. Success:
     - [ ] 100% of PRD ACs traced to at least one test/live/manual artifact (count gate from PRD Output Schema) `[ref: PRD/Feature Requirements all]`

- [x] **T5.5 End-to-end live test** `[activity: testing]`

  1. Prime: Read SDD "Runtime View" — primary flow + failure flows `[ref: SDD/Runtime View]`.
  2. Test: Write `test/live/e2e.live.test.ts`:
     - Start an `alpine:latest` container with label `miyo.component=tomo` and `miyo.tomo.instance-name=e2e-test`, running `cat`; full flow: instantiate `TomoConnection` with real `DockerodeAdapter` → `openPicker()` returns 1 instance → `connect(instance)` reaches Connected → write "hello\n" → read "hello\n" back from `onData` within 2s → `disconnect()` → container still running (assert via direct docker inspect) → cleanup
     - Transient disconnect: kill the container's stream externally (`docker restart`); observe reconnect loop; on failure, verify Disconnected with `reconnect-exhausted`; restart the container; forceReconnect; verify Connected
     - Chosen-instance-gone: connect; stop + remove container; forceReconnect; verify state stays Disconnected with `chosen-instance-gone`; picker NOT invoked (no spy call)
  3. Implement: No production code; this is a test-only task. Ensure Docker helpers are in `test/live/_helpers/` and isolated per-test.
  4. Validate: `npm run test:live` passes end-to-end. CI integration confirmed (mark in commit message).
  5. Success:
     - [ ] End-to-end happy path works with real Docker `[ref: PRD/Success Metrics; v0.1 release gate]`
     - [ ] Reconnect + chosen-instance-gone flows verified `[ref: PRD/F5/AC4; F8/AC4]`

- [x] **T5.5b Manual QA checklist + test-vault deployment** `[activity: validate]` (added 2026-04-25 to mirror 002's T6.4 — closes the Obsidian-API test-seam gap that the obsidian mock cannot cover) — checklist authored; user runs the 37 rows post-merge; release gate is conditional on `status: passed`

  1. Prime: Read SDD ADR-3 (plain TS rendering) + ADR-6 (singleton view) + ADR-9 (Menu popover). Confirm `../temp/Privat-Test` exists and has the plugin folder structure (`.obsidian/plugins/miyo-tomo-hashi/`). Note: this task closes the gap that `vi.mock('dockerode')` + `test/__mocks__/obsidian.ts` cannot cover — visual rendering (友 kanji glyph + state colors), focus trap behavior in real Obsidian Modal, scroll behavior in the picker with many candidates, prefers-reduced-motion respect, and screen-reader announcements.
  2. Test: Author `docs/XDD/specs/001-session-view/plan/manual-qa-checklist.md` listing every PRD AC that requires real-Obsidian observation. Each row: AC ref | expected | observed | passed (Y/N) | notes. Required rows (minimum):
     - F3/AC1: status-bar 友 kanji renders (not the fallback glyph) on macOS Obsidian Insider + stable
     - F3/AC2: state class swap is visually distinguishable for connected / reconnecting / disconnected (color + shape, not color alone)
     - F3/AC3: hover tooltip shows the right text per state
     - F3/AC4-7: popover renders all three actions; each item invokes correctly
     - F3/AC8: animation degrades under `prefers-reduced-motion: reduce` (toggle the OS setting and verify)
     - F3/AC9: screen reader (VoiceOver on macOS) announces state transitions via the live region
     - F4: chat view docks correctly in left sidebar / right sidebar / main pane; xterm.js renders the Claude Code TUI cleanly (colors, cursor, line edits)
     - F4: xterm.js does NOT activate OSC 8 hyperlinks or write to clipboard via OSC 52 (verify with crafted output)
     - F5: in-view banner persists during reconnect; Force Reconnect is keyboard-reachable
     - FS1: right-click on a `.md`, `.pdf`, and a `.png` — the menu entry is present and inserts the correct `@<vault-relative-path> ` prefill at caret
     - F1 (multi-Tomo): start 2 containers with the same `instance-name` label; picker disambiguates with short ID
     - F1 (>20 containers): start 25 disposable containers with the label; picker remains keyboard-navigable, list scrolls, no truncation
  3. Implement:
     - In `esbuild.config.mjs`, uncomment / add the `VAULT_PLUGIN_DIR = "../temp/Privat-Test/.obsidian/plugins/miyo-tomo-hashi"` block (or a flag-gated equivalent) so `npm run build` copies output into the test vault.
     - Run `npm run build`. Open `../temp/Privat-Test` in Obsidian. Walk the checklist with a live Tomo container running.
  4. Validate: All checklist rows marked passed; observations recorded for any failures; deviations logged in spec README.
  5. Success:
     - [ ] Manual checklist 100% passed in real Obsidian `[ref: SDD/ADR-3, ADR-6, ADR-9]`
     - [ ] Build deployment to test vault wired and documented `[ref: SDD/Implementation Context]`
     - [ ] Every "real-Obsidian-only" AC from the T5.4 traceability matrix has a row here `[ref: T5.4]`

- [x] **T5.6 Bundle size + manifest verification** `[activity: platform]`

  1. Prime: Read SDD "Quality Requirements / Performance" and "Constraints / CON-3, CON-7" `[ref: SDD/Quality Requirements; SDD/CON-3; SDD/CON-7]`.
  2. Test: Extend `test/unit/build-output.test.ts`:
     - `build/main.js` exists after `npm run build`
     - `build/main.js` size ≤ 500 KB minified
     - `build/manifest.json` has `isDesktopOnly: true`
  3. Implement: Test only; no production-code change unless bundle exceeds budget (in which case, investigate per SDD "Implementation Gotchas").
  4. Validate: `npm run build && npm test` passes.
  5. Success:
     - [ ] Bundle ≤ 500 KB `[ref: SDD/Quality Requirements]`
     - [ ] Manifest desktop-only confirmed `[ref: PRD/Constraints; SDD/CON-3]`

- [x] **T5.7 Tomo outbound handoff — instance-name label** `[activity: handoff]` — **completed 2026-04-24 ahead of implementation; Tomo returned `status: done` on 2026-04-24** so the label is now Tomo's primary path; the SDD's graceful fallback (short container ID + warning icon) is now backup-only, not the v0.1 path.

  - File: `_outbox/for-tomo/2026-04-24_hashi-to-tomo_instance-name-label.md` (status: done).
  - Request shipped: `--label miyo.tomo.instance-name=<value>` is added wherever Tomo starts containers.
  - Graceful fallback retained in Hashi (short container ID + warning icon in picker; static "Reconnect to Tomo" palette label) — defensive only.
  - Success (met):
    - [x] Handoff committed and Tomo returned `status: done` `[ref: README/Decisions Log; Tomo handoff entry]`

- [x] **T5.8 ~~Spec 002 README decoupling note~~** — **OBSOLETE** (closed 2026-04-25). The decoupling work this task described was performed directly on `docs/XDD/specs/002-instruction-executor/README.md` on 2026-04-24 — see that README's Decisions Log row "Reset stale 'blocked by 001' status + 'Depends on 001' context", which removed the legacy "Depends on 001" language from both the Context paragraph and the dependencies list. The originally-planned `_outbox/for-claude/…` handoff was never valid (the MiYo handoff protocol has no `for-claude/` recipient — recipients are kado / kokoro / kouzou / satori / seigyo / shuu / tomo / temp). No further action; T5.9's success criterion has been retargeted to track only the Tomo handoff round-trip.

- [x] **T5.9 Phase 5 Validation & Release Readiness** `[activity: validate]`

  - Run `npm run build && npm run lint && npm test && npm run test:live`. All green. Bundle under budget. Manifest desktop-only. Tomo handoff file present. Spec 002 follow-up note present.
  - Update `plan/README.md` phases list — tick every phase and set overall status to COMPLETE.
  - Update spec `README.md` Current Phase to "Ready for implementation → Release Gate verified".
  - Record the release-gate pass in the spec README's Decisions Log.
  - Success (v0.1 release gate per PRD Success Metrics):
    - [ ] Live Tomo Docker connection + end-to-end chat working `[ref: PRD/Success Metrics; architecture-06 §10]`
    - [ ] Every PRD AC verified in unit + live suites `[ref: T5.4; T5.5]`
    - [ ] Tomo handoff returned `status: done` in `_outbox/for-tomo/` `[ref: T5.7]` (T5.8 obsoleted — see task body)

---

## PRD Acceptance Criterion → Task Traceability

| PRD reference | Verified in |
|---|---|
| F1/AC1 (picker with name + uptime) | T2.2, T4.1 |
| F1/AC2 (empty-state message) | T4.1 |
| F1/AC3 (daemon unreachable named error) | T2.2, T3.3, T4.1 |
| F1/AC4 (socket permission denied) | T2.2, T3.3, T4.1 |
| F1/AC5 (missing instance-name label fallback) | T2.2, T4.1 |
| F1/AC6 (Settings is only picker surface) | T3.3, T5.1 |
| F2 all | T3.3, T4.1 |
| F3/AC1–AC7 (status bar icon + popover) | T4.2 |
| F4 all (chat view, singleton) | T4.3, T5.2 |
| F5 all (in-view indicator + Force Reconnect) | T3.3, T4.3 |
| F6 all (Reconnect command, dynamic label, no picker) | T3.3, T5.1 |
| F7 all (Show chat window) | T5.1, T5.2 |
| F8 all (auto-reconnect schedule) | T3.2, T3.3, T5.5 |
| F9 all (error surfacing routing) | T3.3, T4.1, T4.2, T4.3 |
| FS1 all (@file prefill) | T4.4 |
| FS2 all (remember last instance) | T3.4, T5.3 |
| Constraint: manifest desktop-only | T1.1, T5.6 |
| Constraint: bundle ≤ 500 KB | T5.6 |
| Handoffs | T5.7, T5.8 |
