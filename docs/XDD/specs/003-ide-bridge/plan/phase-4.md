---
title: "Phase 4: Plugin Integration — Settings, UI, Commands & Lifecycle"
status: in_progress
version: "1.0"
phase: 4
---

# Phase 4: Plugin Integration — Settings, UI, Commands & Lifecycle

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Interface Specifications/Application Data Models; lines: 300-308]` — `PluginSettings` additive fields + version bump
- `[ref: SDD/Settings UI; lines: 361-377]` — IDE bridge section controls + placement
- `[ref: SDD/User Interface & UX; lines: 547-579]` — popover layout, combined-color rule, accessibility
- `[ref: SDD/Building Block View/Directory Map; lines: 266-278]` — MODIFY list (StatusBarIcon, openPopover, ConfirmModal, SettingsTab, types, settingsPersistence, registerCommands, main.ts)
- `[ref: SDD/Implementation Boundaries; lines: 129-134]` — Must Preserve / Can Modify / Must Not Touch
- `[ref: SDD/Implementation Gotchas; lines: 683-685]` — workspace-ready timing, settings re-render, token getter
- `[ref: PRD/F3]`, `[ref: PRD/F10]`, `[ref: PRD/F12]`, `[ref: PRD/F13]`

**Key Decisions**:
- ADR-4: 3 new settings fields, cleartext token, `settings_version` 1→2 migration must not drop existing fields.
- ADR-6: 友 kanji color = **combined worst-state** across `connectionStore` + `ideBridgeStore` (`error > reconnecting/disconnected > connected`); no separate dot; popover line + Copy-token; color is not the sole signal (popover + tooltip carry it). **Note:** `ConnectionState` (src/connection/state.ts) has **no `error` kind** — its failures land in `disconnected{reason}`. So the `error` precedence tier is fed **only** by `ideBridgeStore` (`IdeBridgeState.error`); Docker contributes `reconnecting`/`disconnected`/`connected` only. Map both axes' kinds into the shared precedence explicitly rather than assuming a symmetric `error` state.
- Kado UX mirrored: enable→start/stop, port locked-while-running via **control-swap** (not `setDisabled`), Copy/Regenerate→ConfirmModal.

**Dependencies**:
- Phase 3 (`IdeBridge` orchestrator) complete — settings/commands/main wire to its `start`/`stop`/`isRunning`/`regenerateToken`/`getToken`.

---

## Tasks

This phase makes the bridge user-facing and lifecycle-managed: persisted settings with a safe migration, the IDE bridge settings section, combined status on the 友 kanji + popover, a toggle command, and Component C construction/teardown in `main.ts`.

- [x] **T4.1 Settings schema & v1→v2 migration** `[activity: data-architecture]`

  1. Prime: Read the settings model `[ref: SDD; lines: 300-308]`, `src/types/index.ts` (current `PluginSettings`/`DEFAULT_SETTINGS`), and `src/connection/settingsPersistence.ts` (migration anchor that reads `settings_version` before the DEFAULT merge).
  2. Test: `loadSettings` on a v1 blob (no IDE fields) returns the 3 new fields at defaults (`ideBridgeEnabled:false`, `ideBridgePort:23027`, `ideBridgeAuthToken:""`) **and preserves** every existing 001/002 field, with `settings_version` now `2`; a v2 blob round-trips unchanged; an existing token is never overwritten by migration.
  3. Implement: `src/types/index.ts` — add `ideBridgeEnabled: boolean`, `ideBridgePort: number`, `ideBridgeAuthToken: string` to `PluginSettings` + `DEFAULT_SETTINGS`; bump `settings_version` default to `2`. `src/connection/settingsPersistence.ts` — extend the migration block to default the 3 fields for v1 stores.
  4. Validate: Unit tests pass; lint clean; types check.
  5. Success: v1 settings migrate to v2 with all prior fields intact and the 3 IDE fields defaulted `[ref: SDD/Implementation Boundaries; line: 131; ref: SDD; lines: 300-308]`.

- [x] **T4.2 ConfirmModal** `[activity: frontend-ui]` `[parallel: true]`

  1. Prime: Read the regenerate UX `[ref: SDD/Settings UI; line: 375]` + accessibility note (Cancel focused by default) `[ref: SDD/User Interface & UX; line: 579]`; mirror `../Kado/src/settings/tabs/ApiKeyTab.ts` `ConfirmModal(app, title, message, onConfirm)`. Note Hashi has no ConfirmModal yet (existing modals: `ExecutionModal`, `HookDisclosureModal`).
  2. Test: renders title + message + Cancel/Confirm; Confirm invokes the async `onConfirm`; Cancel/Esc closes without calling it; Cancel is the default focus.
  3. Implement: `src/ui/ConfirmModal.ts` — `class ConfirmModal extends Modal` with `constructor(app, title, message, onConfirm: () => Promise<void>)`; renders heading + paragraph + two buttons (Confirm is `mod-warning`).
  4. Validate: Unit tests pass (jsdom + obsidian mock; `import "obsidian"` first); lint clean; types check.
  5. Success: Confirm runs the callback; Cancel/Esc is a safe no-op with default focus on Cancel `[ref: SDD; lines: 375, 579]`.

- [x] **T4.3 IDE bridge settings section** `[activity: frontend-ui]`

  1. Prime: Read the settings spec `[ref: SDD/Settings UI; lines: 361-377]`, F10/F3 criteria `[ref: PRD/F10; ref: PRD/F3]`, `src/settings/SettingsTab.ts` (`display()`, `buildSettingsHandlers`, full re-render on change), and the Kado port-lock/control-swap + Copy/Regenerate patterns `[ref: ../Kado/src/settings/tabs/GeneralTab.ts; ref: ../Kado/src/settings/tabs/ApiKeyTab.ts]`.
  2. Test (handlers are pure/testable like `buildSettingsHandlers`): port validation accepts integers 1024–65535, rejects out-of-range/non-numeric/`23026` (Kado collision) and restores the previous valid value; the enable handler flips `ideBridgeEnabled`, persists, and calls `start()`/`stop()`; regenerate handler calls `ideBridge.regenerateToken()` then re-renders.
  3. Implement: `src/settings/SettingsTab.ts` — add an "IDE bridge" `setHeading` section placed **after** "Tomo connection", **before** "Instruction executor": Status (desc-only), Enable toggle (→ start/stop + re-render), Port (control-swap: locked desc while `isRunning()`, validated text input while stopped), Auth token cleartext span + `Copy` (clipboard → "Copied!" 1.5s) + `Regenerate` (→ `ConfirmModal` → `regenerateToken` + Notice). Single page (tabs deferred). **Note:** the existing `addPathSetting`/`buildSettingsHandlers`/`HandlerMap` helpers are typed to the fixed key union (`"tomoInboxFolder" | "hooksDir"`), so the IDE-bridge controls are **bespoke `new Setting(...)` blocks** (mirroring Kado's `GeneralTab`/`ApiKeyTab`), not reuses of those helpers — or widen `HandlerMap` if you prefer to route them through it.
  4. Validate: Unit tests for the validation/handler logic pass; manual render check in the test vault (`HASHI_DEPLOY_VAULT=1 npm run build`); lint clean; types check.
  5. Success: Port read-only while running / validated 1024–65535 (≠23026) while stopped; token shown cleartext with working Copy + confirmed Regenerate `[ref: PRD/F10; ref: PRD/F3; ref: SDD/Settings UI]`.

- [ ] **T4.4 Status-bar integration (友 combined health + popover)** `[activity: frontend-ui]`

  1. Prime: Read ADR-6 `[ref: SDD; lines: 614-618]`, the combined-color rule + popover layout + accessibility `[ref: SDD/User Interface & UX; lines: 547-579]`, F12 criteria `[ref: PRD/F12]`, and `src/ui/status-bar/StatusBarIcon.ts` (single `connectionStore` subscription + `STATE_CLASSES`) and `src/ui/status-bar/openPopover.ts` (Menu builder).
  2. Test: a pure `combinedColor(connState, ideState)` (or class) applies worst-state precedence — `error` when the IDE axis is `error` (Docker has no `error` kind), the degraded color when **either** axis is `reconnecting`/`disconnected`, and `connected` only when both are healthy; Docker alone drives the color when the bridge is disabled (`stopped` contributes nothing) — F12; the popover renders an "IDE Bridge: <state> :<port>" line with client count and shows "Copy auth token" **only while running**.
  3. Implement:
     - `src/ui/status-bar/StatusBarIcon.ts` — also subscribe `ideBridgeStore`; compute the kanji color/state-class from the combined worst-state; fold IDE state into the `aria-label`/announcer (color not the sole signal); **no new dot**. Unsubscribe both stores on `unmount()`.
     - `src/ui/status-bar/openPopover.ts` — add the IDE Bridge status line + a "Copy auth token" action (guarded by running state), reading token via `ideBridge.getToken()`.
  4. Validate: Unit tests for `combinedColor` pass; manual check in the test vault (toggle bridge → kanji + popover update); lint clean; types check; existing Docker-only coloring still correct when bridge disabled (regression).
  5. Success: 友 color = combined worst-state, popover shows the IDE line + port + client count + Copy-token, no separate dot `[ref: PRD/F12; ref: SDD/ADR-6]`.

- [ ] **T4.5 Toggle command & main.ts wiring** `[activity: backend-api]`

  1. Prime: Read F13 `[ref: PRD/F13]`, the integration approach `[ref: SDD/Solution Strategy; lines: 210-212]`, the workspace-ready/teardown gotchas `[ref: SDD/Implementation Gotchas; lines: 683-685]`, `src/commands/registerCommands.ts`, and `src/main.ts` (component construction in `onload`, `this.cleanups` LIFO drain, `getSettings` getter).
  2. Test: a "Toggle IDE bridge" command is registered; executing it when stopped calls `start()` + Notice "IDE Bridge started on :{port}"; when running calls `stop()` + Notice "IDE Bridge stopped"; `main.ts` constructs `IdeBridge` once, calls `start()` only when `ideBridgeEnabled`, and pushes a teardown (stop + unsubscribe + tracker dispose) to `cleanups` (verified via the existing `main.test.ts` lifecycle harness).
  3. Implement:
     - `src/commands/registerCommands.ts` — add `registerIdeBridgeCommand(plugin, { ideBridge })` (or extend an existing registrar) for "Toggle IDE bridge" → `isRunning() ? stop() : start()` with the notices.
     - `src/main.ts` — construct `IdeBridge` in `onload` with `{ app, getSettings, persist, log }`; register the CM6 `updateListener` + `active-leaf-change` (deferred to layout-ready) feeding `selectionTracker`; `start()` if enabled; push teardown to `this.cleanups`; wire `StatusBarIcon` to also receive `ideBridgeStore` and the popover Copy-token via `ideBridge.getToken`.
  4. Validate: `main.test.ts`-style lifecycle tests pass; manual check in the test vault (enable in settings → server starts; command toggles; disable/Obsidian-close tears down cleanly); lint clean; types check.
  5. Success: Command toggles the bridge with the correct notices; the bridge starts-if-enabled on load and tears down on unload without leaking timers/sockets `[ref: PRD/F13; ref: SDD/Solution Strategy; ref: SDD/Implementation Boundaries; lines: 129-131]`.

- [ ] **T4.6 Phase Validation** `[activity: validate]`

  - Run all tests, `npm run lint`, `npm run build`. Verify Component A (connection/chat/status) and Component B (executor) behavior is preserved `[ref: SDD/Implementation Boundaries; lines: 129-131]` — especially the 友 kanji's Docker-only coloring when the bridge is disabled. Confirm Kado, the executor, and vault read/write paths are untouched. Manual end-to-end smoke in the test vault: enable → token visible → port locks → toggle command works → disable stops cleanly.
