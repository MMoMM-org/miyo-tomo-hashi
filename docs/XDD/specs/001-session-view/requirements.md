---
title: "Tomo Connection & Chat Window — Hashi's live-Tomo surface"
status: draft
version: "2.2"
---

# Product Requirements Document

> **AC count gate**: `grep -c '^  - \[ \]' requirements.md` is the canonical AC total. Plan T5.4 reads it at run time. Last counted: 70 ACs (2026-04-28; up from 64 in the same-day review-fix pass — added F1.11 picker keyboard contract, F1.12 reconnect non-transient short-circuit, F3.10 status-bar keyboard activation, F4.9 xterm a11y mode, F4.10 focus on disconnected open, F5.8 Force Reconnect ≤3 Tab reach).

## Product Overview

Hashi v0.1 has **two independent features**. This PRD covers only feature 1 (Tomo Connection & Chat Window). Feature 2 (Instruction Executor) is specified in `docs/XDD/specs/002-instruction-executor/` and runs standalone against `_instructions.json` files — it does not require a live Tomo connection.

### Vision
Give the MiYo user a single Obsidian-native chat surface to converse with a running Tomo (Claude Code) container, attached via a plugin-managed Docker connection, so that live AI conversation stays inside the vault where PKM work happens.

### Problem Statement
Today there is no plugin-side way to talk to a running Tomo container. A user reviewing AI-proposed vault changes must switch to a terminal and `docker attach` to converse with the same Tomo session — at exactly the moment their attention should be on the proposed edits in Obsidian. Failure modes (Docker not running, container stopped, socket permission denied) are undiagnosable from within Obsidian. Without a plugin-managed chat surface, no v0.1 release is possible — architecture-06 §10 requires Session View + Docker connection working end-to-end against a live Tomo container.

Concrete consequences of the gap:
- Context switching to a terminal breaks flow during AI-proposal review.
- Connection failure modes are indistinguishable without a named-state UI.
- Architecture-06 §10's v0.1 release gate is unmet.

### Value Proposition
One connection managed from Settings, one chat window for conversation, three command-palette verbs, one compact status bar icon. No implicit file-based triggers, no hidden state: the user chooses an instance once, the plugin stays attached until told otherwise, and the chat window is available wherever Obsidian panes go. Scope is deliberately narrow (same-host Docker socket, one connection, desktop only) to make the v0.1 release achievable.

## User Personas

### Primary Persona: The Solo PKM Author
- **Demographics:** Single user of the MiYo system (the project owner in v0.1). Desktop Obsidian on macOS (Linux theoretical; Windows user-contribution per architecture-06). Power user, comfortable with Docker CLI and Obsidian plugin settings. Moderate-to-high technical expertise.
- **Goals:** Keep AI conversation inside Obsidian; know at a glance whether Tomo is connected; reconnect after a hiccup without rebuilding context; reference vault files in chat without typing long paths.
- **Pain Points:** No plugin surface today — conversation lives in a separate terminal. Failure modes are opaque (was the container not running? was the socket unreachable? did it crash?). Manually typing `@vault/relative/path.ext` for file references is error-prone.

### Secondary Personas
None in v0.1. Multi-user, remote Tomo, and mobile users are out of scope for v0.1 (spec README Scope; architecture-06). A future API-based transport may reconsider remote Tomo; not v0.1.

## User Journey Maps

### Primary User Journey: "Connect to Tomo and chat"
1. **Awareness:** The user has a running Tomo container (started externally, e.g. via `docker run` or a `miyo-tomo` start script) labeled `miyo.component=tomo` with its instance name exposed as a label (Tomo-side requirement; see Assumptions).
2. **Consideration:** The user opens Obsidian and wants to chat with that Tomo. Today's alternative: terminal + `docker attach`. They choose Hashi's Settings pane.
3. **Adoption:** User opens Obsidian Settings → Community Plugins → MiYo Tomo Hashi. They click **Connect**. A picker lists all containers labeled `miyo.component=tomo`, showing instance name and uptime per row. User picks one and confirms. Settings shows "Connected to `<instance-name>`". The Obsidian status bar shows the Tomo icon in its connected state; hovering reveals the instance name.
4. **Usage:** User invokes the "Show chat window" command (palette) or clicks the status bar icon → Open Chat Window. The chat window appears (sidebar pane or main pane — same view, user choice). User types, the message goes to the Tomo container's stdin, the response streams back into the message history. Status indicator inside the chat window confirms connected.
5. **Retention:** On next Obsidian launch, the plugin reconnects to the remembered instance automatically if it is still running; otherwise it shows the Disconnected state in the status bar and the chat window's status indicator, with a path to reconnect via Settings.

### Secondary User Journey: "Recover from disconnect"
1. **Awareness:** User is chatting. Docker has a hiccup (daemon restart, stream drop). The chat window's status indicator transitions to "Reconnecting…" and automatic reconnect begins.
2. **Consideration:** If the automatic reconnect succeeds, the indicator returns to "Connected" and the user keeps typing. If it exhausts its bound (5 attempts, exponential backoff from 500ms), the indicator transitions to "Disconnected — reconnect failed" with a **Force Reconnect** button visible in the chat window and also available from the status bar popover and the command palette.
3. **Adoption:** User clicks Force Reconnect (from any of the three surfaces). The plugin re-attaches the Docker stream to the currently chosen instance. If that instance no longer exists (container stopped or removed), state stays **Disconnected** and an error surfaces explaining what happened — the picker does NOT reopen automatically. To choose a different instance, the user opens Settings → Connect.
4. **Usage:** On reconnect success, the chat window's status indicator clears and the input re-enables. Any output the container produced during the disconnected window is not retroactively replayed — the user is informed that a continuity gap occurred.
5. **Retention:** The user learns that transient disconnects self-heal, that Force Reconnect is the single recovery control, and that changing instances always goes through Settings.

### Tertiary User Journey: "Reference a vault file in chat"
1. **Awareness:** User is writing a chat message and wants Tomo to consider a specific note.
2. **Consideration:** Typing `@vault/relative/path/to/note.md` by hand is error-prone.
3. **Adoption:** User right-clicks the file in the file explorer → "Open Tomo chat with `@file` reference". If the chat window is open: the reference is inserted at the chat input cursor position. If closed: the chat window opens, focuses input, and prefills the reference.
4. **Usage:** User adds additional prose after the `@` reference and sends.
5. **Retention:** The pattern generalizes — any file in the explorer can be referenced with one right-click.

## Feature Requirements

### Must Have Features

#### F1: Settings — Connect with Instance Picker
- **User Story:** As the PKM Author, I want a Connect button in plugin settings that lists running Tomo instances and lets me pick one, so that I manage the connection from one clear surface.
- **Acceptance Criteria:**
  - [ ] Given one or more containers labeled `miyo.component=tomo` are running, When I open plugin Settings and click Connect, Then a picker opens listing each matching container with instance name and uptime.
  - [ ] Given no containers match the label filter, When I click Connect, Then the picker shows an empty state with a plain-English message ("No Tomo instance seems to be running — start one and try again") and does not attempt to retry automatically.
  - [ ] Given the Docker daemon is not reachable, When I click Connect, Then the Settings pane shows a named error "Docker daemon not reachable" distinct from "no Tomo instances found".
  - [ ] Given the Docker socket returns permission denied (Linux, user not in `docker` group), When I click Connect, Then the Settings pane shows a named error "Docker socket permission denied" distinct from "Docker daemon not reachable".
  - [ ] Given a container labeled `miyo.component=tomo` is missing an instance-name label, When listed in the picker, Then the row shows the short container ID as a fallback label and uptime, and a small warning icon noting the instance name is not set.
  - [ ] **Settings is the only surface that opens the picker.** Force Reconnect and automatic reconnect never open the picker; they re-attach to the currently chosen instance or stay Disconnected with an error.
  - [ ] **Docker connection target is pinned to the platform-default local socket / named pipe.** The plugin SHALL NOT honor `DOCKER_HOST`, `DOCKER_CONTEXT`, or Docker config context files (`~/.docker/config.json`); if the platform-default socket is unreachable, the named error is "Docker daemon not reachable" — there is no fallback to TCP. Rationale: env-driven redirection of "local" connections is a real bug-defense (a stale `DOCKER_HOST=tcp://…` in a shell profile would otherwise silently route Hashi to a remote daemon).
  - [ ] **Multi-Tomo edge case — duplicate instance-name labels.** Given two or more containers share the same `miyo.tomo.instance-name`, When the picker opens, Then both rows are rendered, disambiguated by appending the short container ID in parentheses to the displayed name (e.g., `my-tomo (a1b2c3d4)` / `my-tomo (e5f6g7h8)`).
  - [ ] **Multi-Tomo edge case — many containers.** Given more than twenty matching containers (rare but possible on dev machines), When the picker opens, Then it remains keyboard-navigable (scroll within the modal, Enter selects the focused row); no hard cap is enforced and no truncation is applied — the user sees the full list in `startedAt` desc order.
  - [ ] **Multi-Tomo edge case — chosen instance gone between list and select.** Given the picker is open and the user selects an instance whose container has been stopped or removed since `listTomoInstances()` ran, When the connect attempt runs, Then it fails with the named error `attach-failed` and the picker stays open showing only still-running candidates after a refresh. (No silent fallback to a different instance — the user must reselect.)
  - [ ] **Picker modal keyboard contract.** Given the picker modal is open, When the user presses Escape, Then the modal closes without connecting and focus returns to the Settings Connect button. While the modal is open, focus is trapped inside it (Tab does not escape to the underlying Settings DOM). Provided by Obsidian's `Modal` default behavior; the spec asserts the application-level invariant only.
  - [ ] **Auto-reconnect short-circuits on non-transient errors.** Given the auto-reconnect loop encounters `socket-permission-denied` or `daemon-unreachable` on any attempt, When the error is detected, Then the loop terminates immediately (transitions to `disconnected{reason}` with the named error, cancels remaining attempts) — does not run the full 5-attempt schedule. Transient `attach-failed` continues through the full schedule per F8/AC2.

#### F2: Settings — Disconnect
- **User Story:** As the PKM Author, I want a Disconnect button in plugin settings, so that I can release the plugin's attachment without stopping the Tomo container.
- **Acceptance Criteria:**
  - [ ] Given the plugin is connected, When I click Disconnect, Then the plugin closes its Docker stream and transitions to disconnected state; the Tomo container remains running (verifiable with `docker ps`).
  - [ ] Given the plugin is disconnected, When I view the Connect/Disconnect area, Then only Connect is visible (no Disconnect for a non-existent session).
  - [ ] Given the plugin is connected, When I click Disconnect, Then the chat window's status indicator and status-bar icon both update **in the same microtask as `connectionStore.set` returns** — verified by a unit assertion that the indicator's state class is the new value immediately after the `set` call returns (no `await`, no `await microtask`). (The previous "≤ 16 ms p95 in jsdom" wording was unfalsifiable — jsdom has no rendering pipeline; the synchronous-class-swap behavior is the actual contract.)

#### F3: Obsidian Status Bar Icon (icon-only with popover)
- **User Story:** As the PKM Author, I want a compact Tomo icon in Obsidian's status bar that shows connection state at a glance, reveals the instance name on hover, and opens a quick-action popover on click, so that I manage the connection without leaving my current pane.
- **Acceptance Criteria:**
  - [ ] Given the plugin is installed, When Obsidian renders the status bar, Then a single Tomo icon is present (Tomo kanji 友 preferred; graceful fallback to a generic plugin glyph if the kanji cannot render consistently in the Obsidian status bar context — SDD decides).
  - [ ] The icon visually distinguishes three states via icon shape and/or a colored indicator dot — never through color alone: Connected, Reconnecting, Disconnected.
  - [ ] Given I hover the icon, When the tooltip appears, Then it shows the instance name for Connected state, "Reconnecting…" for Reconnecting state, or "Tomo: disconnected" for Disconnected state.
  - [ ] Given I click the icon, When the popover opens, Then it contains exactly three actions: **Force Reconnect**, **Open Chat Window**, **Go to Settings**.
  - [ ] Given the popover is open and the plugin is Disconnected with no remembered instance to reconnect to, When I view the Force Reconnect action, Then it is disabled with a tooltip whose canonical copy is **"No Tomo instance chosen — open Settings → Connect."** (verbatim — same string as the F6/AC5 Notice; one source of truth in the codebase at `src/commands/registerCommands.ts`).
  - [ ] Given the popover is open, When I select Open Chat Window, Then the chat window opens or focuses (same behavior as F7 palette command).
  - [ ] Given the popover is open, When I select Go to Settings, Then Obsidian opens Settings and scrolls to the MiYo Tomo Hashi Connect/Disconnect area.
  - [ ] The icon respects `prefers-reduced-motion` — any transitional animation (e.g., Reconnecting) degrades to a static state when reduced motion is requested.
  - [ ] Screen readers announce state changes via an ARIA live region (`polite` for transitional, `assertive` for Disconnected after an unexpected drop). Both `aria-live` and `aria-label` attributes are unit-asserted on the status bar element.
  - [ ] **Keyboard activation.** The status bar icon has `role="button"` and `tabindex="0"`; Space/Enter triggers the same popover handler as click. Reachable via Obsidian's status-bar Tab order.

#### F4: Chat Window View
- **User Story:** As the PKM Author, I want a chat window that I can dock in a sidebar or open as a main-pane tab, so that I can lay out my workspace how I prefer.
- **Acceptance Criteria:**
  - [ ] Given the plugin is installed, When Obsidian registers view types on plugin load, Then a "Tomo Chat" view type is available for placement in left sidebar, right sidebar, or main pane tabs — all behaving identically.
  - [ ] Given the chat window is already open (anywhere), When I invoke "Show chat window" again, Then Obsidian focuses the existing view — a second instance is NOT created (singleton).
  - [ ] Given the plugin is connected, When the chat window opens, Then the chat input is enabled and focused.
  - [ ] Given the plugin is not connected, When the chat window opens, Then the chat input is disabled and the view shows a "Not connected" state with a Connect action that opens Settings.
  - [ ] Given the chat window is Connected, When I type a message and submit, Then the message is delivered to the Tomo container's stdin and echoed in the message history.
  - [ ] Given the chat window is Connected, When the container emits stdout/stderr, Then the output appears in the message history as rendered text only — no auto-execution, no URI activation, no command routing.
  - [ ] Given the chat window is not Connected, When I attempt to send a message, Then the input is disabled and no message is queued or sent.
  - [ ] **Terminal renderer trust boundary.** The xterm.js instance rendering container output SHALL be configured with hyperlink handling disabled (no OSC 8 link activation), OSC 52 clipboard writes ignored, and `allowProposedApi: false`. The renderer presents bytes as text only — bytes from the container can never trigger a clipboard write or open a URI without explicit user copy/paste action. The configuration is unit-asserted by `terminalHost.test.ts` (regex over the source) so a refactor cannot silently re-enable proposed APIs.
  - [ ] **xterm.js accessibility mode.** The xterm.js instance is configured to keep its accessibility-mode rendering active (default in xterm 5.x but version-sensitive — pinned by unit assertion in `terminalHost.test.ts`). Screen-reader users hear terminal buffer content; without this, the chat surface is opaque to AT.
  - [ ] **Focus on open while disconnected.** Given the chat window opens in Not-Connected state (whether via `Show chat window`, the status-bar popover, or the file-menu prefill), When the view's DOM is rendered, Then keyboard focus lands on the Connect link inside the not-connected state — **not** on the disabled chat input. (The connected-state focus rule above remains: focus on input when state is Connected.)

#### F5: Chat Window — Status Indicator and Force Reconnect
- **User Story:** As the PKM Author, I want the chat window to show the current connection status and give me a Force Reconnect button, so that I can recover from a stuck connection without leaving the chat view.
- **Acceptance Criteria:**
  - [ ] Given the chat window is open, When the connection state changes (Connected ↔ Reconnecting ↔ Disconnected), Then an in-view indicator updates to reflect the current state.
  - [ ] Given the chat window is open, When I look at the view, Then a Force Reconnect control is visible and keyboard-reachable whenever the state is Reconnecting or Disconnected (and available — see F3 rule — when an instance has been chosen at least once).
  - [ ] Given I click Force Reconnect while Disconnected or Reconnecting, When the action runs, Then the plugin closes any existing stream and immediately re-attaches to the currently chosen instance.
  - [ ] Given I click Force Reconnect and the currently chosen instance no longer exists (container stopped or removed), When the reconnect attempt fails for that reason, Then state stays Disconnected and an error surfaces naming the cause — **the picker does NOT open**. To choose a different instance, the user opens Settings → Connect.
  - [ ] Given Force Reconnect succeeds, When the chat window updates, Then prior message history remains visible and the user is informed a continuity gap may have occurred.
  - [ ] The indicator conveys severity through icon + text, never color alone, and respects `prefers-reduced-motion`. (Streaming xterm output is exempt from reduced-motion handling — xterm has no reduced-motion mode; the streaming character render is the primary interaction surface, not chrome animation.)
  - [ ] Screen readers announce status-indicator changes (ARIA live region, `polite` for transitional, `assertive` for Disconnected/error). Both `aria-live` and `aria-label` attributes are unit-asserted on the chat-view indicator element.
  - [ ] **Force Reconnect keyboard reach.** When the chat view is Disconnected or Reconnecting, the Force Reconnect button is reachable in **≤ 3 Tab presses** from the chat input (DOM order: input → terminal-host (skip-tab) → header zoom buttons → Force Reconnect).

#### F6: Command Palette — Reconnect to Tomo
- **User Story:** As the PKM Author, I want a reconnect command in the palette that only attempts to reconnect (never opens the picker), so I can retry from the keyboard without changing instances.
- **Acceptance Criteria:**
  - [ ] Given I open the command palette and an instance name is known (Connected, Reconnecting, or remembered from prior session), When I search, Then the command is listed as "Tomo Hashi: Reconnect to `<instance-name>`".
  - [ ] Given I open the command palette and no instance name is known (e.g., first-run, no remembered instance), When I search, Then the command is listed as "Tomo Hashi: Reconnect to Tomo".
  - [ ] Given I invoke the command while Connected or Reconnecting, When it runs, Then it performs a Force Reconnect against the currently chosen instance — identical semantics to the chat-window Force Reconnect button (no picker under any circumstances).
  - [ ] Given I invoke the command while Disconnected and an instance is chosen (remembered or previously selected this session), When it runs, Then it attempts to re-attach to that instance and displays the resulting state (Connected on success, Disconnected with an error on failure). **It does not open the picker.**
  - [ ] Given I invoke the command while Disconnected and no instance is chosen, When it runs, Then it shows an error via `Notice`: "No Tomo instance chosen — open Settings → Connect."

#### F7: Command Palette — Show Chat Window
- **User Story:** As the PKM Author, I want a "Show chat window" command in the palette, so that I can open or focus the chat view with a keyboard-only flow.
- **Acceptance Criteria:**
  - [ ] Given I open the command palette, When I search, Then "Tomo Hashi: Show chat window" is listed.
  - [ ] Given the chat window is not open, When I invoke the command, Then the chat window opens in its last-known location (sidebar or main pane) and chat input is focused.
  - [ ] Given the chat window is already open, When I invoke the command, Then Obsidian focuses the existing view (no new instance; honors the singleton in F4).

#### F8: Automatic Reconnect on Transient Disconnect
- **User Story:** As the PKM Author, I want the plugin to reconnect automatically after a brief Docker hiccup, so that I do not lose flow to transient failures.
- **Acceptance Criteria:**
  - [ ] Given the plugin is Connected and the Docker stream is interrupted, When the interruption is detected, Then the plugin transitions to Reconnecting state automatically; the chat input is disabled; attempts begin.
  - [ ] The reconnect policy is: up to 5 attempts, exponential backoff starting at 500 ms (0.5s / 1s / 2s / 4s / 8s — total ≈ 15.5 s before giving up).
  - [ ] Given a reconnect attempt succeeds, When the stream re-establishes, Then state transitions back to Connected, the input re-enables, and prior message history remains visible.
  - [ ] Given the reconnect bound is exhausted, When the last attempt fails, Then state transitions to Disconnected with an error message naming the cause; automatic retries STOP; only user-initiated Force Reconnect resumes attempts.
  - [ ] Given a successful reconnect after a transient disconnect, When the indicator transitions `reconnecting → connected`, Then the indicator transiently displays **"Reconnected (gap)"** alongside the instance name. The gap notice clears on the next user input (typed character or Enter). Output produced during the disconnected window is not retroactively replayed — the gap notice is the only continuity signal. Verified by `TomoChatView.test.ts` ("indicator shows reconnected-gap after recovery, clears on next user input"); same indicator is exercised by F5/AC5.

#### F9: Error Surfacing
- **User Story:** As the PKM Author, I want connection-related errors to surface in places I will see, so that I never wonder why something is broken.
- **Acceptance Criteria:**
  - [ ] Given the chat window is open and a connection-related error occurs (attach failure, reconnect exhausted, stream error), When the error fires, Then it is surfaced in a sticky in-view indicator that persists until the underlying state resolves or the user dismisses it.
  - [ ] Given an error occurs during a Settings-initiated Connect/Disconnect action, When it fires, Then the Settings pane surfaces it inline (near the Connect/Disconnect buttons) AND the status bar icon reflects the resulting state.
  - [ ] Given an error occurs while the chat window is not open (e.g., a palette-invoked Reconnect), When it fires, Then Obsidian's `Notice` channel surfaces it.
  - [ ] All error messages distinguish among: Docker daemon not reachable / Docker socket permission denied / no Tomo instances found / chosen instance no longer exists / stream error.
  - [ ] Error severity is conveyed via icon + text, never color alone; reduced-motion is respected; screen readers announce new errors via ARIA live regions.
  - [ ] **No chat content is logged.** No log statement in connection or chat-view code SHALL receive a chunk, frame, or buffer originating from the container's stdio stream. The plugin's logger only records state transitions, error categories, and reconnect attempts. Verified by a grep-based assertion in tests (forbidden patterns: `logger.*(chunk`, `logger.*(data`, `logger.*(stdout`, `logger.*(stderr` in `src/connection/**` and `src/ui/chat-view/**`).

### Should Have Features

#### FS1: File Right-Click → Chat with `@file` Reference
- **User Story:** As the PKM Author, I want to right-click any vault file and insert or open a chat prefilled with an `@vault/relative/path` reference, so that I can mention files without typing long paths.
- **Acceptance Criteria:**
  - [ ] Given I right-click a file in the file explorer, When the context menu opens, Then a "Open Tomo chat with `@file` reference" entry is present.
  - [ ] Given the chat window is open and I invoke the context-menu entry, When it runs, Then `@<vault-relative-path> ` is inserted at the chat input caret position (preserving existing text) and focus moves to the input.
  - [ ] Given the chat window is not open and I invoke the entry, When it runs, Then the chat window opens, focuses the input, and prefills `@<vault-relative-path> ` (followed by a space so the user can type immediately).
  - [ ] Given the plugin is not connected, When I invoke the entry, Then the chat window opens in Not-Connected state with the prefill still present, and a reminder that Connect is required before sending.
  - [ ] The feature works for any file type (not restricted to `_instructions.md`).

#### FS2: Remember Last Connected Instance Across Sessions
- **User Story:** As the PKM Author, I want the plugin to remember the last Tomo instance I connected to and reconnect automatically on Obsidian launch, so that my normal workflow does not start with a picker every time.
- **Acceptance Criteria:**
  - [ ] Given I successfully Connect to an instance, When I close and relaunch Obsidian, Then the plugin attempts to reconnect to the same instance (matched by container ID).
  - [ ] Given the remembered instance no longer exists on relaunch, When auto-reconnect attempts the attach, Then the plugin transitions to Disconnected with an explanatory message; it does NOT auto-open the picker.
  - [ ] Given the remembered instance exists but auto-reconnect fails for another reason (permissions, daemon not yet ready), When failures accumulate, Then the plugin stops retrying and shows Disconnected with a Force Reconnect path.

### Could Have Features

None in v0.1 for the chat surface. Sidebar-of-pending-instruction-sets and error-log sidebar ideas belong to spec 002 (Instruction Executor), not 001.

### Won't Have (This Phase)

- Stopping the Tomo container from the plugin — user manages container lifecycle externally (out of scope; out of proportion to v0.1).
- Multiple simultaneous Tomo connections — one connection at a time (one chat window, one stream).
- Remote Tomo — v0.1 uses the local Docker daemon socket, which cannot reach remote daemons; a future transport (e.g., HTTP API) may reconsider remote Tomo support but is not in v0.1.
- Mobile Obsidian support — desktop-only; manifest must declare `isDesktopOnly: true`.
- HTTP/WebSocket transport, or any settings toggle hinting at a future transport in the v0.1 UI.
- Split-pane chat (separate input and output panes) — unified view only; `AskUserQuestion` prompts from Tomo render cleanly only in a unified chat.
- External inbound surface — no ports, no webhooks, no MCP server. Kado remains the sole external inbound surface for MiYo. Any change requires a new ADR.
- **Tomo container identity pinning** (image digest / Cmd[0] / container ID fingerprint persisted across sessions, refusal-to-attach on drift) — never. Hashi is local-only and outbound-only; the realistic "wrong container" scenario is user-error (e.g., another Tomo install side-by-side), not adversarial impersonation. Pinning would force re-pair on every Tomo version bump for zero defended attack. Trust derives from the user choosing the container in the Settings picker.
- **Vault↔Tomo pairing fingerprint** persisted to `data.json` (e.g., `pairedTomoFingerprint`, `lastTrustedAppId`) — never. Each Obsidian vault is its own trust domain by design (architecture: vaults live in independent directories with independent plugin sets); cross-vault hook/instruction reuse is not part of the workflow. Adding a pairing prompt creates one click-through with no defended adversary.
- **TOCTOU defense** between preview render and execute (hash-pinning the source `_instructions.json`) — never. Charter declares the preview modal a UX affordance, not an approval gate; defending the gap between two non-gates is theater.
- Message replay across reconnect boundaries — the continuity gap is disclosed, not repaired.
- Background/passive Docker polling at plugin load beyond the single auto-reconnect to the remembered instance — no ambient scanning.
- Conversation history beyond what the chat view has locally observed — Tomo's own process owns its history; Hashi does not persist chat history to disk in v0.1.
- Picker anywhere outside Settings — Force Reconnect, automatic reconnect, status bar popover, and palette commands never open the picker.

## Detailed Feature Specifications

### Feature: Connection Lifecycle (the core complex feature)

**Description:** The plugin owns a single connection state that flows across Settings, the status bar, and the chat window. Every state transition is observable in all three surfaces simultaneously.

**User Flow (observable states):**
1. On plugin load: if a remembered instance exists (FS2), attempt auto-reconnect → transitions through Reconnecting to Connected or Disconnected. If no remembered instance: start in Disconnected.
2. User clicks Settings → Connect. Picker opens. User selects instance. Transitions: Disconnected → Attaching → Connected (or → Disconnected with error). **Settings is the only surface that opens the picker.**
3. While Connected, the user chats in the chat window. Messages flow bidirectionally over the Docker stream.
4. On transient stream interruption: Connected → Reconnecting (automatic). On success within bound: → Connected. On bound exhaustion: → Disconnected (with reason "reconnect failed").
5. User clicks Force Reconnect (chat window / palette / status bar popover): any state → Attaching → Connected (or stays Disconnected with error if the chosen instance is gone — no picker).
6. User clicks Disconnect in Settings: Connected/Reconnecting → Disconnected (graceful close of stream; container unaffected).

**Business Rules:**
- Exactly one connection exists at a time; exactly one chat window view instance is created per chat view type (singleton).
- Discovery (the Connect picker population) only runs from Settings → Connect on explicit user action — never as ambient background work, never from Force Reconnect, never from auto-reconnect, never from palette commands, never from the status bar popover.
- Chat input is enabled exactly when state == Connected.
- The status bar icon, chat window indicator, and Settings state MUST agree at all times.
- Docker endpoint in v0.1 is the local Docker daemon socket only; no remote endpoint resolution is performed.
- All data received from the Tomo container is rendered as text only; no auto-execution, no URI activation.
- The plugin persists only the chosen instance identifier (container ID) for FS2; it does not persist chat history, credentials, or container configuration.

**Edge Cases:**
- Docker daemon not running at Connect → Disconnected, named error "Docker daemon not reachable".
- Docker socket permission denied → Disconnected, named error "Docker socket permission denied" (actionable message mentions group membership on Linux).
- No Tomo containers found → picker opens with empty state; plain-English message ("No Tomo instance seems to be running — start one and try again"); no auto-retry.
- Chosen instance vanishes (stopped externally) during a session → Reconnecting → exhausted → Disconnected; subsequent Force Reconnect from any surface stays Disconnected with error; user must open Settings → Connect to pick a different instance.
- User detaches (Disconnect) while a message is in flight → stream closes; the in-flight message is considered lost; the chat history retains what was typed but marks it as "not delivered".
- User closes the chat window while Connected → the view is removed but the connection persists (the stream is attached at the plugin level, not the view level); the status bar icon still shows Connected.
- User opens the chat window while Connected → the view reattaches to the live stream; message history shown is what the view has locally observed since the window was last open (not everything since Connect).
- User invokes `@file` context menu while not connected → chat window opens in Not-Connected state with prefill present; no send attempt.
- Instance-name label absent on a listed container → picker row shows short container ID + uptime + a warning icon; user can still pick it. Command-palette Reconnect command label falls back to "Tomo Hashi: Reconnect to Tomo".
- Obsidian is launched offline → auto-reconnect fails cleanly to Disconnected with an explanatory message; no crash, no hang.
- Tomo container output contains shell metacharacters, ANSI escapes, or Obsidian URIs → rendered as plain text; no rendering of Obsidian internal links or URI schemes.

## Success Metrics

### Key Performance Indicators

MiYo v0.1 is a private single-user system; cohort adoption metrics do not apply. Success is acceptance-coverage based:

- **Adoption:** v0.1 release gate — architecture-06 §10 requires live Tomo Docker connection + end-to-end chat working. Success = gate passed.
- **Engagement:** The owner can complete the primary user journey (Connect → chat → Disconnect) without touching a terminal. Success = journey is achievable end-to-end against a live Tomo container.
- **Quality:** 100% of the acceptance criteria in this PRD pass in integration tests using a real Docker daemon (team standard: integration tests hit real external systems, per feedback memory on prior mock/prod divergence).
- **Platform:** `manifest.json` ships with `isDesktopOnly: true` — no mobile installations attempted.

### Tracking Requirements

No telemetry in v0.1. Acceptance criteria above already enumerate every observable transition that integration tests verify; no event-table duplication is necessary. (A 9-event analytics-shaped table existed in PRD v2.1 and was removed in the 2026-04-28 review pass — it duplicated the AC list under another name without adding falsifiable behavior.)

---

## Constraints and Assumptions

### Constraints
- **Platform:** Desktop Obsidian only (macOS primary; Linux theoretical; Windows user-contribution per architecture-06). Current `manifest.json` has `"isDesktopOnly": false` — this is a known drift that MUST be corrected to `true` before any release. This is a manifest declaration, not a runtime check; Obsidian enforces it at install time.
- **Transport:** Local Docker daemon socket only in v0.1 — no HTTP/WS transport, no settings toggle hinting at a future transport, no placeholder UI. A future version may add a remote-capable transport; that is post-v0.1.
- **Concurrency:** One active Tomo connection at a time.
- **Security boundary:** No external inbound surface — no ports, no webhooks, no MCP server. All external vault access is Kado's domain (architecture summary). Inviolable for v0.1; any change requires a new ADR.
- **Trust model:** All data received from the Tomo container's stdout/stderr is treated as untrusted text for display only. No auto-execution, no URI activation, no command routing from container output.
- **Dependencies:** No Docker client library is currently in `package.json` dependencies. The SDD must select one (e.g., dockerode, direct socket fetch, or child-process approach). The PRD flags the absent binding as a v0.1 constraint to resolve.
- **Persistence:** The plugin persists only the chosen container ID (for FS2 auto-reconnect). No chat history on disk. No credentials. No container configuration data.
- **Picker surface:** Settings → Connect is the only surface that opens the instance picker. All other reconnect flows (Force Reconnect, auto-reconnect, palette command, status bar popover) re-attach to the currently chosen instance or stay Disconnected with an error.

### Assumptions
- The user has Docker installed and reachable via the local daemon socket (macOS: Docker Desktop socket; Linux: `/var/run/docker.sock` with appropriate group membership).
- Tomo containers are started externally (outside Hashi) and are responsible for:
  - Labeling themselves `miyo.component=tomo` so Hashi's picker can discover them.
  - Exposing a human-readable instance name as a Docker label (e.g., `miyo.tomo.instance-name=<name>`), so the picker and the command-palette reconnect command can display it. **Tomo-side change required — captured as a handoff in README Decisions Log; outbound handoff to be created in `_outbox/for-tomo/` during plan phase.**
- The Tomo container's stdout/stderr stream is the authoritative chat channel; Tomo's own process owns conversation history.
- The user is the project owner and is trusted unconditionally; no access-control layer mediates user input within the plugin.
- Spec 002 (Instruction Executor) runs standalone and does NOT depend on an active Tomo connection. This PRD assumes 002 has its own error surface and state model. (002's README was decoupled from 001 directly on 2026-04-24 — see that README's Decisions Log row "Reset stale 'blocked by 001' status + 'Depends on 001' context".)

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Docker daemon not running at plugin load | High — user sees immediate failure | High — normal on fresh desktop boot | Named Disconnected state distinguishes "daemon not reachable" from other causes; auto-reconnect does not retry a missing daemon indefinitely |
| Docker socket permission denied on Linux | Medium — opaque failure without guidance | Medium — Linux users not in `docker` group | Named Disconnected state; error message explains group-membership requirement explicitly |
| Tomo changes land late or don't expose instance name label | Medium — picker shows short container IDs, command label degrades to "Reconnect to Tomo" | Medium — outbound Tomo handoff introduces cross-repo dependency | PRD allows graceful fallback (short container ID in picker; static command label); plan phase must create the `_outbox/for-tomo/` handoff early |
| Manifest `isDesktopOnly: false` ships to users | High — plugin appears on mobile where Docker is unreachable | Low if tracked | MUST-fix constraint flagged in this PRD; SDD/plan owns the change |

## Open Questions

None — all prior open questions resolved in the brainstorm pivot on 2026-04-24 and the follow-up refinement round. Further clarifications, if any, will surface during SDD and will be recorded in the spec README's Decisions Log.

---

## Supporting Research

### Competitive Analysis
Not applicable in the conventional sense. MiYo is a private PKM system. Reference points from the Obsidian plugin ecosystem: command palette with `addCommand`, status bar via `addStatusBarItem`, custom views via `ItemView` placeable in any pane, file-explorer context menus via the `file-menu` event, `Notice` for transient messages. All features specified here use idiomatic Obsidian patterns.

### User Research
Single-user system; formal research not applicable. Three parallel research briefs (Requirements/Product, UX/Interaction, Integration/Security) were dispatched in the PRD research phase. The brainstorm pivot on 2026-04-24 inverted several of their assumptions (chat was not coupled to `_instructions.md`; instruction execution is independent of the Tomo connection). Surviving conclusions from the briefs:
- Settings + status bar + dedicated view is idiomatic for connection-bearing plugins.
- In-view sticky indicator is the right primary error surface for connection-state UI (Notices don't express settled/reconnecting states).
- `@file` prefill via `file-menu` is low-cost and high-value for power users.

### Market Data
Not applicable. Private plugin, single user.

### References
- Spec README: `docs/XDD/specs/001-session-view/README.md`
- Spec 002 README: `docs/XDD/specs/002-instruction-executor/README.md` (decoupled from 001 in the brainstorm pivot; 002 README still needs follow-up update)
- ADR-009 §2 Connection Strategy (external; summarized in spec README)
- Architecture 06 §4 Layers, §5 Connection Strategy, §10 v0.1 Release Gate (external; summarized in spec README)
- Brainstorm pivot 2026-04-24 — inline notes on `requirements.md` v1, captured in spec README Decisions Log
- Refinement round 2026-04-24 — inline notes on `requirements.md` v2 (status bar icon+popover, picker-only-in-Settings, command label convention), captured in spec README Decisions Log
