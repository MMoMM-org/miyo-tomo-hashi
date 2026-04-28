---
title: "Phase 4: UI Surfaces"
status: completed
version: "1.0"
phase: 4
---

# Phase 4: UI Surfaces

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- PRD: F1 Settings pane, F3 Status bar icon + popover, F4 Chat view (singleton), F5 in-view indicator + Force Reconnect, F9 error surfacing
- SDD: "Building Block View / Components + Directory Map", ADR-3 (plain TS), ADR-6 (singleton view), ADR-9 (Menu popover), "Quality Requirements / Usability"

**Key Decisions** (affecting this phase):
- ADR-3 plain TS: every UI surface subclasses an Obsidian primitive and builds DOM directly
- ADR-6: chat view is a singleton via `getLeavesOfType` + `setViewState`
- ADR-9: status bar popover uses Obsidian `Menu` API
- CSS class convention: prefix all plugin classes with `hashi-`

**Dependencies**: Phase 3 complete (`connectionStore` + `TomoConnection` + `src/connection/docker.ts` helpers, per ADR-5 v2 — no port). `TomoConnection` is available via plugin instance (wired in Phase 5).

---

## Tasks

Four parallel UI surfaces — each consumes `connectionStore` (read) and calls `TomoConnection` methods (write). Can be developed concurrently by different agents or in any order; none depend on another's DOM.

- [x] **T4.1 Settings pane — Connect/Disconnect + open picker** `[activity: frontend-ui] [parallel: true]`

  1. Prime: Read PRD F1, F2 acceptance criteria and SDD "Directory Map" entry for `src/settings/` `[ref: PRD/F1; PRD/F2; SDD/Directory Map]`.
  2. Test: Write `test/unit/ui/settings/SettingsTab.test.ts`:
     - `display()` renders a Connect button when state is Disconnected
     - `display()` renders a Disconnect button when state is Connected, showing the instance name
     - Clicking Connect opens the InstancePickerModal
     - Clicking Disconnect calls `TomoConnection.disconnect()`
     - On state change while tab is open, the DOM updates (subscribe is live)
     - On `hide()` / `display()` re-entry, subscriptions don't leak (count active listeners before and after)
  3. Implement:
     - Modify `src/settings/SettingsTab.ts` — constructor takes `(app, plugin, connection: TomoConnection)`; `display()` builds DOM via Obsidian's `Setting` API; subscribes to `connectionStore` for live updates; stores unsubscribe handle; calls it in `hide()`.
     - Create `src/settings/InstancePickerModal.ts` — extends Obsidian `Modal`; `onOpen()` triggers `connection.openPicker()`, renders each `TomoInstance` as a row showing instance name (or short ID fallback) + formatted uptime via `formatUptime`; on selection calls `connection.connect(instance)` and closes modal; Cancel closes without effect.
     - Error rendering: if `openPicker()` rejects with a `ConnectionError`, render the error inline in the modal with the specific cause message.
  4. Validate: Unit tests pass; `npm run lint` clean.
  5. Success:
     - [x] Connect + Disconnect + picker round-trip works `[ref: PRD/F1/AC1; PRD/F2]`
     - [x] Error surfaces in Settings inline `[ref: PRD/F9/AC2]`
     - [x] Picker shows name + uptime per row `[ref: PRD/F1/AC1; Decisions Log 2026-04-24]`

- [x] **T4.2 Status bar icon + popover** `[activity: frontend-ui] [parallel: true]`

  1. Prime: Read PRD F3 all ACs; SDD ADR-9 and "UI Visualization / Status bar icon" `[ref: PRD/F3; SDD/ADR-9; SDD/UI Visualization]`.
  2. Test: Write `test/unit/ui/status-bar/StatusBarIcon.test.ts` and `openPopover.test.ts`:
     - Icon element created with `hashi-status-bar` class
     - Icon state-class updates on connection state change (`is-connected`, `is-reconnecting`, `is-disconnected`)
     - Hover tooltip text matches current state (connected: instance name; reconnecting: "Reconnecting…"; disconnected: "Tomo: disconnected")
     - Click opens a Menu with exactly 3 items: "Force Reconnect", "Open Chat Window", "Go to Settings"
     - Force Reconnect item is disabled (with tooltip) when `chosenInstanceId` is null
     - Invoking "Open Chat Window" calls the workspace-leaf opener callback (mocked via dep injection)
     - Invoking "Go to Settings" calls the settings-opener callback (mocked via dep injection)
  3. Implement:
     - Create `src/ui/status-bar/StatusBarIcon.ts` — registers status bar item via `plugin.addStatusBarItem()`; builds a `<div class="hashi-status-bar">` with inner `<span>` for the Tomo kanji (friendly fallback: icon text `友`, with a small state dot via CSS pseudo-element); subscribes to `connectionStore` to update state-class and tooltip.
     - Create `src/ui/status-bar/openPopover.ts` — pure function taking `(evt, actions: { forceReconnectEnabled, onForceReconnect, onOpenChat, onOpenSettings })`; builds `new Menu()` with three items per spec; shows at mouse event.
     - Keyboard/a11y: ensure the status bar element has `role="button"` and `tabindex="0"`; Space/Enter triggers the same popover handler.
  4. Validate: Unit tests pass; manual smoke in Obsidian optional (hot-reload enabled in `test/Hashi/.obsidian/plugins/hot-reload`).
  5. Success:
     - [ ] Icon-only, state via shape + indicator, never color alone `[ref: PRD/F3/AC2]`
     - [ ] Three-action popover `[ref: PRD/F3/AC4]`
     - [ ] Force Reconnect disabled when no instance chosen `[ref: PRD/F3/AC5]`

- [x] **T4.3 Chat view — `TomoChatView` + xterm terminal host** `[activity: frontend-ui] [parallel: true]`

  1. Prime: Read PRD F4, F5; SDD ADR-2, ADR-6, "Directory Map / src/ui/chat-view/", and xterm.js docs for `Terminal`, `FitAddon`, `onData`, `write` `[ref: PRD/F4; PRD/F5; SDD/ADR-2; SDD/ADR-6]`.
  2. Test: Write `test/unit/ui/chat-view/TomoChatView.test.ts`:
     - `onOpen()` creates the DOM skeleton (header area, indicator, Force Reconnect button, terminal host, chat input)
     - Chat input is disabled when state is not Connected
     - Chat input is enabled + focused when state transitions to Connected
     - Submitting a message calls `connection.write("text\n")`
     - Stream bytes from `connection.onData` are forwarded to the terminal's write method
     - Force Reconnect button calls `connection.forceReconnect()`
     - Force Reconnect button disabled when `chosenInstanceId` is null (parity with F3/AC5)
     - State changes update the in-view indicator element
     - `onClose()` unsubscribes and disposes the xterm instance
  3. Implement:
     - Create `src/ui/chat-view/index.ts` exporting `VIEW_TYPE_TOMO_CHAT = "miyo-tomo-hashi-chat"`.
     - Create `src/ui/chat-view/TomoChatView.ts` extending `ItemView`; builds skeleton DOM with `hashi-chat-view` class; wires subscribe; renders message input below terminal host.
     - Create `src/ui/chat-view/terminalHost.ts` with functions `createTerminal(container: HTMLElement, theme?)`, `writeChunk(term, bytes)`, `fit(term)`, `dispose(term)`. Imports `@xterm/xterm` and `@xterm/addon-fit`; loads xterm CSS (via T1.2's loader approach).
     - Wire a `ResizeObserver` on the terminal host container to call `fit()` on resize.
  4. Validate: Unit tests pass; headless terminal write smoke test (no full xterm DOM assertion — verify `writeChunk` is invoked with forwarded bytes).
  5. Success:
     - [ ] Bidirectional stream surfaces through xterm `[ref: PRD/F4/AC5-6; SDD/ADR-2]`
     - [ ] Input disabled iff state ≠ Connected `[ref: PRD/F4/AC7]`
     - [ ] Force Reconnect never opens picker `[ref: PRD/F5/AC4]`
     - [ ] xterm lifecycle clean on view close `[ref: SDD/Quality Requirements; Reliability]`

- [x] **T4.4 File menu handler (`@file` prefill)** `[activity: frontend-ui] [parallel: true]`

  1. Prime: Read PRD FS1 all ACs; SDD "Directory Map / src/commands/fileMenu.ts" `[ref: PRD/FS1; SDD/Directory Map]`.
  2. Test: Write `test/unit/commands/fileMenu.test.ts`:
     - Right-click on any file appends "Open Tomo chat with `@file` reference" entry to the Menu
     - Entry label format exact match
     - When chat view is open: invoking the entry inserts `@<vault-relative-path> ` at caret position
     - When chat view is closed: invoking opens the view and prefills the input
     - When disconnected: the chat view opens in Not-Connected state, prefill still present
     - Works for any file type (test with `.md`, `.pdf`, `.png` mock files)
  3. Implement:
     - Create `src/commands/fileMenu.ts` exporting `registerFileMenu(plugin, { getOrOpenChatView, resolveVaultPath })`.
     - Uses `plugin.registerEvent(plugin.app.workspace.on("file-menu", (menu, file, source) => { menu.addItem(item => ...) }))`.
     - The entry's click callback resolves the relative path (use `file.path` directly — it's already vault-relative in Obsidian), then either inserts into current input or opens the view then inserts.
  4. Validate: Unit tests pass.
  5. Success:
     - [ ] Entry appears for any file `[ref: PRD/FS1/AC5]`
     - [ ] Insert-at-caret + open-and-prefill both work `[ref: PRD/FS1/AC2; FS1/AC3]`

- [x] **T4.5 Phase 4 Validation** `[activity: validate]`

  - Run `npm test && npm run lint && npm run build`. All UI unit tests green. Bundle builds cleanly. Optionally do a manual smoke-test by copying `main.js` + `manifest.json` + `styles.css` into `test/Hashi/.obsidian/plugins/miyo-tomo-hashi/` and launching Obsidian on `test/Hashi` vault; hot-reload will pick up changes.
  - Success:
    - [ ] Every UI surface tested against a driven `connectionStore` (per ADR-4 v3) — Docker is mocked at the dockerode boundary via `vi.mock('dockerode')` in the connection-layer tests, not at this UI layer `[ref: SDD/ADR-3; ADR-5 v2; ADR-10]`
    - [ ] `hashi-` CSS prefix applied consistently `[ref: SDD/Technical Debt]`
    - [ ] No subscription leaks across open/close cycles (verified in T4.1–T4.3 tests) `[ref: SDD/Quality Requirements; Reliability]`
