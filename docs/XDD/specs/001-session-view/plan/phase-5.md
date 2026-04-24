---
title: "Phase 5: Wire-up, Integration & Release Gate"
status: pending
version: "1.0"
phase: 5
---

# Phase 5: Wire-up, Integration & Release Gate

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- PRD: All features (F1–F9 + FS1 + FS2); "Success Metrics" → v0.1 release gate; "Constraints and Assumptions"
- SDD: "Architecture Decisions" (10 ADRs), "Runtime View", "Deployment View", "Quality Requirements"
- README: full Decisions Log — especially Tomo handoff requirement and spec 002 coupling drift note

**Key Decisions** (affecting this phase):
- ADR-8: dynamic command label via `removeCommand` + `addCommand`
- ADR-6: singleton chat view via `getLeavesOfType` + `setViewState`
- PRD command palette = exactly 3 commands (Reconnect, Show chat, Execute instructions — the last belongs to spec 002 and is OUT OF SCOPE for this plan)
- Release gate: Tomo handoff file created in `_outbox/for-tomo/`; spec 002 README drift flagged in `_outbox/for-claude/`

**Dependencies**: Phases 1–4 complete.

---

## Tasks

This phase binds everything together in `main.ts`, registers the two Hashi commands, runs PRD-level integration tests against a real Docker daemon, and ships the two outbound handoffs the plan carries.

- [ ] **T5.1 Command registry — Reconnect (dynamic label) + Show chat window** `[activity: integration]`

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

- [ ] **T5.2 Singleton chat view opener** `[activity: integration]`

  1. Prime: Read ADR-6 + PRD F7 ACs + Obsidian workspace docs on `getLeavesOfType`, `getRightLeaf`, `setViewState`, `revealLeaf` `[ref: SDD/ADR-6; PRD/F7]`.
  2. Test: Write `test/unit/ui/chat-view/showChatWindow.test.ts`:
     - When no leaf of `VIEW_TYPE_TOMO_CHAT` exists: creates one via `getRightLeaf(false).setViewState({ type: VIEW_TYPE_TOMO_CHAT, active: true })` and reveals it
     - When a leaf exists: reveals the existing leaf (does NOT create a second instance)
     - When multiple leaves exist (edge case — user manually cloned): reveals the first; leaves the others in place (per SDD ADR-6 trade-off)
  3. Implement: Create `src/ui/chat-view/showChatWindow.ts` exporting `showChatWindow(app: App): Promise<void>`.
  4. Validate: Unit tests pass.
  5. Success:
     - [ ] Singleton invariant holds across invocations `[ref: PRD/F4/AC2; ADR-6]`

- [ ] **T5.3 `main.ts` wire-up** `[activity: integration]`

  1. Prime: Read current `src/main.ts` + SDD "Building Block View / Components" diagram + ADR-10 (plugin unload best-effort) `[ref: src/main.ts; SDD/Building Block View]`.
  2. Test: Write `test/unit/main.integration.test.ts`:
     - `onload` registers: settings tab, chat view type, status bar item, file menu listener, two commands
     - `onload` creates a `TomoConnection` instance using the real `DockerodeAdapter` (in the mock, injected via a factory so the test can pass a `FakeDockerClient`)
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

- [ ] **T5.4 PRD acceptance-criteria traceability pass** `[activity: testing]`

  1. Prime: Read PRD "Feature Requirements" in full; SDD "Acceptance Criteria" section in full `[ref: PRD/Feature Requirements; SDD/Acceptance Criteria]`.
  2. Test: Create a single `test/unit/acceptance/prd-traceability.test.ts` whose names are the PRD AC IDs. Each test references an earlier unit test by importing its fixtures or re-runs a minimum assertion. The point is a mapping file, not duplication — each test either (a) invokes the relevant helper and asserts the headline outcome, or (b) imports and re-exports a specific assertion from the phase 1–4 test suites.
  3. Implement: Write the traceability file; cross-reference against the PRD acceptance-criteria list; flag any unmapped criterion with a `test.todo(...)` and open a task in the Deviations log.
  4. Validate: Traceability file passes; `console.log` output lists every PRD/F*/AC* ID covered.
  5. Success:
     - [ ] 100% PRD AC coverage `[ref: PRD/Feature Requirements all]`

- [ ] **T5.5 End-to-end live test** `[activity: testing]`

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

- [ ] **T5.6 Bundle size + manifest verification** `[activity: platform]`

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

- [ ] **T5.7 Tomo outbound handoff — instance-name label** `[activity: handoff]`

  1. Prime: Read PRD "Constraints and Assumptions / Tomo containers are started externally" and README Decisions Log 2026-04-24 entry on the Tomo handoff `[ref: PRD/Assumptions; README/Decisions Log]`.
  2. Test: N/A (documentation task).
  3. Implement: Create `_outbox/for-tomo/2026-04-24_hashi-to-tomo_instance-name-label.md` with:
     - Title: "Add `miyo.tomo.instance-name` Docker label to Tomo container startup"
     - Context: Hashi v0.1 Session View (spec 001) discovers Tomo containers by `miyo.component=tomo` and displays them in a picker by instance name + uptime. Uptime comes from Docker `inspect.State.StartedAt`; instance name must be exposed as a Docker label because the Docker API doesn't otherwise expose a human-friendly name.
     - Required label key: `miyo.tomo.instance-name=<name>`; value should be user-meaningful (e.g., derived from a `--name` flag, the vault name, or a user-set env var).
     - Degradation path: Hashi falls back to the short container ID + a warning icon; picker remains usable. Command palette Reconnect command falls back to the static label "Tomo Hashi: Reconnect to Tomo" in the absence of the label.
     - Deadline: before Hashi v0.1 release (Tomo can ship this independently; Hashi's code is already compatible).
     - Reference: `docs/XDD/specs/001-session-view/requirements.md` Assumptions + `solution.md` ADR-1 context.
  4. Validate: File exists at expected path; follows MiYo handoff-protocol format `[ref: ~/Kouzou/projects/miyo/miyo-handoff-protocol.md]`.
  5. Success:
     - [ ] Handoff committed and visible in `_outbox/for-tomo/` `[ref: README/Decisions Log; Tomo handoff entry]`

- [ ] **T5.8 Spec 002 README decoupling note (outbound to claude/meta)** `[activity: handoff]`

  1. Prime: Read README Decisions Log entry flagging the spec 002 drift and PRD Assumptions paragraph about the drift being a follow-up not handled in this PRD `[ref: README/Decisions Log; PRD/Assumptions]`.
  2. Test: N/A.
  3. Implement: Create `_outbox/for-claude/2026-04-24_hashi-001-followup_spec-002-decoupling.md`:
     - Title: "Update spec 002 README to remove 001-coupling language"
     - Context: Spec 002 (`docs/XDD/specs/002-instruction-executor/README.md`) currently says "Depends on 001 for ... lifecycle contracts ... container identity ... error channel". After the 2026-04-24 brainstorm pivot on 001, spec 002 is standalone and does NOT depend on 001's connection. The README text should be updated to reflect this before 002 enters its own PRD phase.
     - Specific edits requested:
       - Remove "lifecycle contracts (attach state, container identity, error propagation) defined here" from the Context paragraph.
       - Remove "Container identity (Hashi needs to know which Tomo session produced the instructions, if ever used for traceability)" and "Error channel (shared surface for executor failures and session-lifecycle failures)" from the "Depends on 001 for" list.
       - Leave the statement that 002 plan lands after 001 plan (implementation sequencing is still true — 001 ships the plugin skeleton 002 writes into).
  4. Validate: File exists.
  5. Success:
     - [ ] Follow-up captured for the next Hashi session touching spec 002 `[ref: README/Decisions Log]`

- [ ] **T5.9 Phase 5 Validation & Release Readiness** `[activity: validate]`

  - Run `npm run build && npm run lint && npm test && npm run test:live`. All green. Bundle under budget. Manifest desktop-only. Tomo handoff file present. Spec 002 follow-up note present.
  - Update `plan/README.md` phases list — tick every phase and set overall status to COMPLETE.
  - Update spec `README.md` Current Phase to "Ready for implementation → Release Gate verified".
  - Record the release-gate pass in the spec README's Decisions Log.
  - Success (v0.1 release gate per PRD Success Metrics):
    - [ ] Live Tomo Docker connection + end-to-end chat working `[ref: PRD/Success Metrics; architecture-06 §10]`
    - [ ] Every PRD AC verified in unit + live suites `[ref: T5.4; T5.5]`
    - [ ] Both outbound handoffs delivered `[ref: T5.7; T5.8]`

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
