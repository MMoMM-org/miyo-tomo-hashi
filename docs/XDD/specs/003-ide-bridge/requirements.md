---
title: "Hashi IDE Bridge — Ambient Editor Context for Tomo"
status: draft
version: "1.0"
---

# Product Requirements Document

## Validation Checklist

### CRITICAL GATES (Must Pass)

- [x] All required sections are complete
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Problem statement is specific and measurable
- [x] Every feature has testable acceptance criteria (Gherkin format)
- [x] No contradictions between sections

### QUALITY CHECKS (Should Pass)

- [x] Problem is validated by evidence (not assumptions)
- [x] Context → Problem → Solution flow makes sense
- [x] Every persona has at least one user journey
- [x] All MoSCoW categories addressed (Must/Should/Could/Won't)
- [x] Every metric has corresponding tracking events
- [x] No feature redundancy (check for duplicates)
- [x] No technical implementation details included
- [x] A new team member could understand this PRD

---

## Product Overview

### Vision

Give Tomo (Claude Code in Docker) real-time awareness of what the user is reading, editing, and selecting in Obsidian — without any user action — by implementing the Claude Code IDE integration protocol as a Hashi subsystem.

### Problem Statement

Today, the user must explicitly tell Tomo which file or text to work with. Every interaction requires one of three manual steps: (1) right-click a file and choose "Open Tomo chat with @file reference," (2) type an `@path` reference manually in the terminal, or (3) copy-paste content from the editor. There is no way for Tomo to know what the user is currently reading, editing, or selecting in Obsidian — the editor state is invisible to the Docker container.

This creates friction on every prompt. The user must context-switch from "thinking about the note" to "telling Tomo about the note." In IDE integrations (VS Code, JetBrains, Neovim), Claude Code receives this context automatically via the IDE protocol. Obsidian users lack this capability entirely, making the Tomo experience noticeably less fluid than the native IDE experience.

### Value Proposition

Zero-friction ambient editor context. Once enabled and configured (a one-time setup), the IDE Bridge broadcasts the user's active file and text selection to Tomo on every prompt — no action required. Claude Code sees "Selected N lines from notes/plan.md" in the transcript automatically, just like it does in VS Code. The user edits naturally in Obsidian while Tomo maintains continuous awareness of their focus.

This bridges the last major gap between Obsidian-based and IDE-based Claude Code workflows, making Tomo a first-class Claude Code integration partner rather than a terminal-only fallback.

## User Personas

### Primary Persona: The Solo PKM Author

- **Demographics:** Technical professional (developer, researcher, writer), 25–55, comfortable with Docker and Obsidian plugin configuration, uses Obsidian as a primary knowledge management tool, runs Tomo for AI-assisted workflows.
- **Goals:** Interact with Tomo as naturally as they would with Claude Code in VS Code. Ask questions about the note they are reading without manually referencing it. Get AI suggestions that are contextually aware of their current editing focus.
- **Pain Points:** Must break flow to tell Tomo which file to look at. Copy-pasting content into the terminal is tedious and error-prone. The @file reference requires knowing the exact vault-relative path. Loses the "ambient awareness" experience that VS Code and Neovim users enjoy natively.

### Secondary Personas

**Claude Code (Tomo in Docker)** — the AI consumer. Not a human persona, but a system actor with requirements: discovers the IDE server via a lock file, connects via WebSocket, receives `selection_changed` notifications on every prompt, and uses CLI-internal RPC tools to query editor state on demand. Its success depends on reliable, low-latency delivery of editor context.

## User Journey Maps

### Primary User Journey: First-Time Setup

1. **Awareness:** User learns that Hashi can provide ambient editor context to Tomo (documentation, changelog, or community mention).
2. **Consideration:** User evaluates whether the one-time setup (enable toggle + Docker configuration) is worth the ongoing benefit of zero-friction context.
3. **Adoption:** User enables the IDE Bridge in Hashi settings, copies the auto-generated auth token, and updates their Tomo Docker configuration with the token and port (Tomo's setup writes the container lock file and runs the socat proxy).
4. **Usage:** User verifies the integration works: selects text in Obsidian, sends a prompt in Tomo, and sees "Selected N lines from file.md" in the Claude Code transcript.
5. **Retention:** From this point forward, every Tomo interaction benefits from ambient context with no further user action. The user edits normally; Tomo sees what they see.

### Secondary User Journey: Daily Ambient Use

1. User opens Obsidian. Hashi loads and starts the IDE Bridge server automatically (if enabled).
2. User starts a Tomo session. Claude Code discovers the IDE server via the lock file and connects.
3. User opens a note, reads, edits, selects text as part of their normal workflow.
4. User switches to Tomo and asks a question. Claude Code already knows the active file and selection — the user does not need to reference anything.
5. Tomo responds with context-aware answers. If Tomo needs to read the full file, it uses Kado (the vault access gateway), not the IDE Bridge.

### Tertiary User Journey: Troubleshooting a Broken Connection

1. User notices Tomo is not showing editor context ("Selected N lines..." absent from transcript).
2. User checks the IDE Bridge status — the color-coded status-bar kanji shows "listening" (running, no client connected) with the port in its tooltip. (Note: the indicator reflects connection-presence only; Hashi cannot tell _which_ Tomo container is or isn't connected — see F12.)
3. User restarts their Tomo container. Claude Code reconnects to the IDE Bridge automatically.
4. If that does not work, user checks the Hashi settings for the auth token and compares it to their Docker configuration.
5. If the token is mismatched, user copies the correct token and updates the Docker config.

## Feature Requirements

### Must Have Features

#### Feature F1: WebSocket IDE Server

- **User Story:** As the PKM Author, I want Hashi to run a WebSocket server that speaks the Claude Code IDE protocol so that Tomo can connect and receive editor context automatically.
- **Acceptance Criteria:**
  - [ ] Given the IDE Bridge is enabled in settings, When the plugin loads, Then a WebSocket server starts listening on `127.0.0.1` on the configured port (default 23027)
  - [ ] Given the IDE Bridge is running, When the user views the port setting, Then the port field is read-only; the port is only editable while the bridge is stopped (same flow as Kado)
  - [ ] Given the server is running, When a client sends a valid WebSocket upgrade request with the correct auth header, Then the connection is accepted and the MCP handshake (`initialize` → `notifications/initialized` → `tools/list`) completes successfully
  - [ ] Given the server is running, When the plugin is unloaded (disable or Obsidian close), Then all WebSocket connections are closed gracefully and the server stops listening
  - [ ] Given the server is running, When the configured port is already in use, Then the server fails with a user-visible error message naming the port ("Port 23027 is already in use")

#### ~~Feature F2: Lock File Management~~ — REMOVED (moved to Tomo, 2026-05-28)

**Hashi writes no lock file.** Lock-file generation moved to Tomo: Tomo's setup scripts write the discovery lock file **inside the container** (at the container's `~/.claude/ide/{port}.lock`) using the port and the auth token the user copied from Hashi settings. Hashi's only obligations are to run the WebSocket server and to own/display the auth token (F3) so the user can copy it into Tomo.

This **supersedes** the accepted ADR-019 §6 (which had Hashi write the host lock file + Tomo mount it read-only) — a Kokoro ADR-019 amendment handoff has been raised (`_outbox/for-kokoro/2026-05-28...lock-file-ownership`). Consequences accepted with this change: no host-side `claude --ide` discovery, and the user must re-copy the token into Tomo after a regenerate (no auto-propagation via a mount). See Won't Have.

The F2 number is retained (not reused) so existing F-references stay stable.

#### Feature F3: Auth Token Lifecycle

- **User Story:** As the PKM Author, I want an auth token to be generated automatically and stored securely so that only authorized clients can connect to the IDE Bridge.
- **Acceptance Criteria:**
  - [ ] Given the IDE Bridge is enabled for the first time (no existing token), When the server starts, Then a token of the form `hashi_<UUID>` is generated (matching Kado's `kado_<UUID>` convention, ADR-6) and persisted in `data.json` via Obsidian's native settings API (matching Kado ADR-5)
  - [ ] Given a token exists, When the user opens the settings tab, Then the token is displayed in cleartext (no masking) with a "Copy" button and a "Regenerate" button
  - [ ] Given the user clicks "Copy," When the clipboard write succeeds, Then a confirmation notice is shown ("Token copied to clipboard")
  - [ ] Given the user clicks "Regenerate" and confirms via a confirmation dialog, When the new token is written, Then any connected clients are disconnected, the settings field updates, and a notice reminds the user to copy the new token into their Tomo configuration (no Hashi lock file to rewrite)

#### Feature F4: Connection Authentication

- **User Story:** As the PKM Author, I want unauthorized connection attempts to be rejected immediately so that no unintended process can receive my editor context.
- **Acceptance Criteria:**
  - [ ] Given a WebSocket upgrade request arrives without the `x-claude-code-ide-authorization` header, When the server processes the upgrade, Then it responds with HTTP 401 before the WebSocket handshake completes (no upgrade)
  - [ ] Given a WebSocket upgrade request arrives with an incorrect token, When the server processes the upgrade, Then it responds with HTTP 401 before the WebSocket handshake completes
  - [ ] Given a valid token is presented, When the upgrade completes, Then the connection is established and the client receives subsequent broadcasts
  - [ ] Given the server binds to a network interface, When configuration is applied, Then only `127.0.0.1` is accepted as a bind address (any other interface is rejected)

#### Feature F5: Selection Changed Broadcast

- **User Story:** As the PKM Author, I want my active file and text selection to be broadcast to Tomo automatically so that Claude Code knows what I am looking at without any action on my part.
- **Acceptance Criteria:**
  - [ ] Given a markdown file is open and the user moves the cursor or changes selection, When the change stabilizes (100ms debounce), Then a `selection_changed` notification is sent to all connected clients containing the **plain vault-relative** file path, selection range (start/end line and character), and selected text
  - [ ] Given the user drags to select text (rapid intermediate changes), When the selection stabilizes after debounce, Then exactly one `selection_changed` notification is sent (not one per pixel of drag)
  - [ ] Given the user switches to a different open file, When the active leaf changes, Then a `selection_changed` notification is sent with the new file's path and cursor position
  - [ ] Given no markdown editor is active (canvas view, graph view, settings panel, PDF), When the user is in a non-editor context, Then no `selection_changed` notifications are sent
  - [ ] Given the selected text exceeds 100KB, When the notification is constructed, Then the text is truncated to 100KB to prevent pathological memory or bandwidth use
  - [ ] Given the cursor position has not changed since the last broadcast, When the debounce fires, Then no notification is sent (deduplication)

#### Feature F6: getCurrentSelection and getLatestSelection Tools

- **User Story:** As the PKM Author, I want Tomo to be able to query the current editor state on demand so that Claude Code can retrieve my selection even if it missed the broadcast.
- **Acceptance Criteria:**
  - [ ] Given a client calls `getCurrentSelection`, When a markdown editor is active, Then the response contains the active file path, cursor/selection range, and selected text (if any)
  - [ ] Given a client calls `getCurrentSelection`, When no markdown editor is active, Then the response indicates no active selection (empty result)
  - [ ] Given a client calls `getLatestSelection`, When a selection was previously broadcast, Then the response contains the most recent cached selection data
  - [ ] Given no selection has ever been broadcast in this session, When `getLatestSelection` is called, Then the response returns an empty result

#### Feature F7: openFile Tool

- **User Story:** As the PKM Author, I want Tomo to be able to navigate Obsidian to a specific note so that when Claude references a file in conversation, I can view it directly.
- **Acceptance Criteria:**
  - [ ] Given a client calls `openFile` with a valid vault-relative path, When the file exists in the vault, Then Obsidian opens that file in the active editor leaf
  - [ ] Given a client calls `openFile` with a path that does not exist, When the tool processes the request, Then an error response is returned (not a crash or unhandled exception)
  - [ ] Given a client calls `openFile` with an absolute path or a path containing traversal segments (`..`), When the tool validates the input, Then the request is rejected with a descriptive error

#### Feature F8: Protocol Stubs

- **User Story:** As the PKM Author, I want the IDE Bridge to respond to all expected Claude Code protocol methods so that the integration does not break or produce errors from unhandled messages.
- **Acceptance Criteria:**
  - [ ] Given a client calls `getWorkspaceFolders`, When the server responds, Then it returns an **empty** `workspaceFolders` array — a host vault path is meaningless inside the unmounted Tomo container, so leaving it empty forces Kado routing (Kokoro ADR-019 §5)
  - [ ] Given a client calls `getDiagnostics`, When the server responds, Then it returns an empty diagnostics array (no LSP in Obsidian)
  - [ ] Given a client calls `checkDocumentDirty`, When the server responds, Then it returns `false` (Obsidian auto-saves)
  - [ ] Given a client calls `saveDocument`, `close_tab`, or `closeAllDiffTabs`, When the server responds, Then it returns a success acknowledgment (no-op)
  - [ ] Given a client calls an unrecognized method, When the server processes the request, Then it returns a JSON-RPC error response with code `-32601` (method not found)

#### Feature F9: Ping/Pong Keepalive

- **User Story:** As the PKM Author, I want the IDE Bridge to detect and clean up dead connections so that stale clients do not accumulate.
- **Acceptance Criteria:**
  - [ ] Given a client is connected, When the server sends a ping frame, Then it expects a pong response within 30 seconds
  - [ ] Given a connected client does not respond to a ping within the timeout, When the next keepalive cycle runs, Then the server closes that client's connection
  - [ ] Given all clients disconnect, When the server detects zero connections, Then it continues listening for new connections (does not shut down)

#### Feature F10: Settings UI

- **User Story:** As the PKM Author, I want a dedicated settings section for the IDE Bridge so that I can enable, configure, and manage the integration from the Hashi settings tab.
- **Acceptance Criteria:**
  - [ ] Given the user opens the Hashi settings, When the IDE Bridge configuration renders, Then it contains (following Kado's settings patterns): an enable/disable toggle, a port number input, an auth token display in cleartext, a "Copy" button, and a "Regenerate" button. Everything fits on a single page if space allows; otherwise it is split into tabs as Kado does
  - [ ] Given the bridge is stopped, When the settings render, Then the port field is editable; Given the bridge is running, Then the port field is read-only (Kado enable/disable flow)
  - [ ] Given the user enables the toggle, When the server starts successfully, Then a confirmation notice is shown ("IDE Bridge started on :23027")
  - [ ] Given the user clicks "Regenerate," When the confirmation dialog is accepted, Then a new `hashi_<UUID>` token is generated, connected clients are disconnected, and the new token is shown in cleartext
  - [ ] Given the user enters a port that is out of range (< 1024 or > 65535) or non-numeric, When validation runs, Then the input is rejected with an inline error and the previous valid value is restored

### Should Have Features

#### Feature F11: getOpenEditors Tool

- **User Story:** As the PKM Author, I want Tomo to be able to see which files are currently open in Obsidian tabs so that Claude Code can reference them without me listing them.
- **Acceptance Criteria:**
  - [ ] Given a client calls `getOpenEditors`, When markdown editor tabs are open, Then the response lists each open file with its path and dirty status
  - [ ] Given no markdown editor tabs are open, When the tool is called, Then it returns an empty list

#### Feature F12: IDE Bridge Status (combined into the 友 kanji)

- **User Story:** As the PKM Author, I want the IDE Bridge state folded into the existing 友 (Tomo) status-bar kanji so that one indicator tells me the overall session health, with the details in its popover.
- **Acceptance Criteria:**
  - [ ] The 友 kanji color reflects **combined session health** across both the Docker connection and the IDE Bridge, using a worst-state-wins priority: **error > reconnecting/disconnected > connected/healthy**. A degraded IDE Bridge can tint the kanji even when Docker is connected
  - [ ] Given the IDE Bridge is disabled, When the status bar renders, Then the IDE Bridge contributes nothing to the kanji color (only the Docker connection drives it)
  - [ ] Given the IDE Bridge is enabled, When its state changes (listening / connected / error), Then the kanji color recomputes from the combined priority
  - [ ] The 友 popover shows a dedicated "IDE Bridge: <state>" line including the port and client count, plus a "Copy auth token" action while the bridge is running
  - [ ] **No separate indicator dot** — IDE Bridge state is surfaced only via the 友 kanji color + the popover line + tooltip (color is not the sole signal: popover text and tooltip carry it for accessibility)
  - [ ] The status reflects whether _any_ authorized client is connected. Hashi cannot reliably correlate a WebSocket client to a specific Tomo container in v0.1 (the IDE protocol carries no Tomo instance identity), so the status is connection-presence, not per-instance

#### Feature F13: Toggle IDE Bridge Command

- **User Story:** As the PKM Author, I want a command palette entry to toggle the IDE Bridge so that I can quickly enable or disable it without opening settings.
- **Acceptance Criteria:**
  - [ ] Given the command palette is open, When the user searches for "IDE bridge," Then a "Toggle IDE bridge" command is available
  - [ ] Given the bridge is off and the command is executed, When the server starts, Then a notice confirms "IDE Bridge started on :23027"
  - [ ] Given the bridge is running and the command is executed, When the server stops, Then a notice confirms "IDE Bridge stopped"

#### Feature F14: PRIVACY.md Documentation

- **User Story:** As the PKM Author, I want the IDE Bridge's network surface documented so that I can verify what Hashi exposes and to whom.
- **Acceptance Criteria:**
  - [ ] Given the PRIVACY.md is updated, When it describes the IDE Bridge, Then it states: the WebSocket surface, the bind address (127.0.0.1 only), the data transmitted (file paths, cursor positions, selected text — ephemeral only), and the authentication mechanism

### Could Have Features

#### Feature F15: Auto-Restart on Server Crash

- **User Story:** As the PKM Author, I want the IDE Bridge to recover automatically from a crash so that I do not have to manually re-enable it.
- **Acceptance Criteria:**
  - [ ] Given the WebSocket server crashes unexpectedly, When the crash is detected, Then the server restarts automatically after a 2-second delay
  - [ ] Given the auto-restart also fails, When the second failure is detected, Then the bridge transitions to an error state with a user-visible notice and no further auto-retry

#### Feature F16: Failed Auth Attempt Logging

- **User Story:** As the PKM Author, I want to know if unauthorized connection attempts are being made so that I can investigate if needed.
- **Acceptance Criteria:**
  - [ ] Given an unauthorized connection attempt is rejected, When the server logs the event, Then it writes to the developer console at `warn` level including the rejected (wrong) token value to aid debugging (the token is not a secret in this threat model). The remote address is omitted as uninformative — connections arrive via the socat proxy and always appear to originate from `127.0.0.1`

### Won't Have (This Phase)

- **Vault file I/O** — Reading, writing, searching, and deleting vault files is Kado's exclusive domain per ADR-019 and the MiYo Constitution L1 architecture rule.
- **File content serving** — The bridge sends paths and selected text, not file bodies. Kado handles `kado-read`.
- **Open notes _listing_** — Enumerating which notes are currently open is Kado's `kado-open-notes` tool (a read-only query, scope active/other/all, gated through Kado's permission chain). This is distinct from the IDE Bridge's `openFile` (F7), which _navigates_ Obsidian to open a specific note (a command, not a listing), and from `getOpenEditors` (F11), the CLI-internal IDE tool that lists open editor tabs for Claude Code's own UI. The IDE Bridge does not replicate Kado's model-visible open-notes listing.
- **Mobile support** — The plugin is desktop-only (`isDesktopOnly: true`). The WebSocket server requires Node.js APIs available only in Electron.
- **Multi-vault scenarios** — Single vault, single server instance.
- **openDiff** — The Instruction Executor handles batch operations.
- **executeCode** — Not applicable to Obsidian (no REPL).
- **Custom protocol extensions** — ADR-019 mandates single-purpose (Claude Code IDE protocol only). No additional RPC methods.
- **Docker-side wiring** — socat proxy, **container lock file generation**, container env vars. These are Tomo's responsibility, coordinated via the existing handoff (`_outbox/for-tomo/2026-05-27`) and the lock-file-ownership amendment.
- **Lock file generation** — Tomo writes the discovery lock file inside the container (from the user-copied token + port). Hashi writes no lock file (supersedes ADR-019 §6 — Kokoro amendment raised 2026-05-28).

## Detailed Feature Specifications

### Feature: Selection Changed Broadcast (F5)

**Description:** The core value of the IDE Bridge. Listens to Obsidian's editor events and broadcasts the user's current editing context to all connected Claude Code clients. Claude Code injects this context into every prompt automatically, showing "Selected N lines from file.md" in the transcript.

**User Flow:**
1. User opens a markdown note in Obsidian and reads/edits normally.
2. As the user moves the cursor or selects text, Obsidian fires editor state change events.
3. The IDE Bridge debounces these events (100ms trailing-edge) to collapse rapid changes into a single broadcast.
4. After the debounce window, the bridge checks whether the state has changed since the last broadcast (deduplication).
5. If changed, a `selection_changed` notification is sent to all connected WebSocket clients.
6. Claude Code receives the notification and includes the file path and selection in the next prompt's context. If Claude needs the _full_ file rather than just the selection, it calls Kado's `kado-read` — not the IDE Bridge. **Resolution is entirely Tomo-side** (Kokoro ADR-019 §5, mechanism (a)): a routing rule in Tomo's container `CLAUDE.md` sends vault content to `kado-read` first, reserving the local `Read` tool for container files. Because the broadcast emits **plain vault-relative paths** (Rule 7) in the same namespace Kado addresses, and `workspaceFolders` is empty (no local root to anchor on), Kado routing is the only sensible path. The IDE Bridge never serves file bodies and contains **no** Hashi-side resolution logic.

**Business Rules:**
- Rule 1: Only markdown editors produce selection events. Canvas, graph view, PDF viewer, and settings panels are non-editor contexts — no broadcasts.
- Rule 2: Debounce is trailing-edge at 100ms. Each new event resets the timer. Only the final resting state is broadcast.
- Rule 3: Deduplication compares the full state (file path + selection range + text). If identical to the previous broadcast, no message is sent.
- Rule 4: Selected text is capped at 100KB. Selections exceeding this limit are truncated. This prevents pathological memory use when a user selects an entire large file.
- Rule 5: Active leaf changes (switching tabs) trigger an immediate broadcast of the new file's cursor position, subject to the same debounce.
- Rule 6: The selected text content is ephemeral — it is never persisted to disk, never written to logs, and never included in audit records (per MiYo Constitution L2).
- Rule 7: The broadcast emits **plain vault-relative paths** in the standard `selection_changed` path fields — the same namespace Kado addresses, with **no `kado:` prefix and no custom path-field extensions** (Kokoro ADR-019 §2.3, §5). No absolute host path is sent; no separate `vaultRelativePath` field is added. `getWorkspaceFolders` (Hashi's WebSocket response) and the container lock file's `workspaceFolders` (Tomo-generated) are kept **empty** so Claude has no local root to anchor on — Kado routing (via Tomo's CLAUDE.md rule) is the only path. Mechanism (b) — emitting `kado:`-prefixed references — was considered and rejected by Kokoro; do not build it.

**Edge Cases:**
- User holds arrow key down (rapid cursor movement) → debounce collapses to one broadcast when key is released.
- User switches from markdown to canvas and back → broadcast on the return-to-markdown transition, no broadcasts while in canvas.
- User selects entire 10K-line file → text truncated to 100KB, selection range preserved in full.
- All clients disconnect during a broadcast → broadcast silently dropped (no queue, no retry).
- Plugin unloads mid-debounce → pending timer cancelled, no broadcast sent.

### Feature: Auth Token Lifecycle (F3)

**Description:** The auth token is the sole authentication mechanism for the IDE Bridge. It prevents accidental or unintended connections to the WebSocket server. The token is generated once, stored in cleartext in `data.json`, and **displayed for the user to copy into their Tomo configuration** — Tomo writes it into the container lock file Claude Code discovers. It can be regenerated at any time.

**Why no masking or "secure" storage:** This was settled for Kado (ADR-5: single `data.json`; ADR-6: `kado_<UUID>` keys). The same reasoning applies here: the IDE Bridge is a single-host, localhost-only service. The whole point of showing the token is for the user to **copy it as plaintext** into their Tomo config, and it ends up cleartext in three places regardless — `data.json`, the user's Tomo config, and Tomo's container lock file. Masking the one value the user must read and copy is pure friction that protects against nothing: any process that can read `data.json` can already read it. There is no named threat actor that masking or separate-file storage would defend against.

**User Flow:**
1. User enables the IDE Bridge for the first time.
2. The bridge generates a `hashi_<UUID>` token and stores it in `data.json`.
3. The settings UI shows the token in cleartext; the user copies it into their Tomo configuration. Tomo's setup writes it into the container lock file (Hashi writes no lock file).
4. From this point, the token persists across Obsidian restarts. The user does not interact with it again unless they regenerate it (after which they re-copy it into Tomo).

**Business Rules:**
- Rule 1: Token format is `hashi_<UUID>` (`hashi_` prefix + `crypto.randomUUID()`), matching Kado's `kado_` convention (ADR-6).
- Rule 2: Token is stored in cleartext in `data.json` via Obsidian's native settings API (matching Kado ADR-5). No separate file, no masking.
- Rule 3: Token regeneration is user-triggered (Regenerate button + confirmation dialog) and disconnects all current clients. The user must re-copy the new token into their Tomo config (no Hashi lock file to rewrite).
- Rule 4: The token is not a secret to defend in this threat model. It IS logged on failed-auth (the rejected value) to aid debugging (F16). It is never treated as sensitive content.

**Edge Cases:**
- Token regenerated while Tomo is connected → Tomo is disconnected; user copies the new token into the Docker config and reconnects.
- Obsidian Sync propagates `data.json` to another device → the synced token is inert there. That device runs its own bridge; the token only matters on the host where the WebSocket server actually runs. (This is the Kado-established rationale for why `data.json` storage is acceptable despite Constitution L2's general guidance.)
- User has multiple vaults on the same machine → each Hashi instance manages its own token and runs on its own port.

## Success Metrics

### Key Performance Indicators

- **Adoption:** The IDE Bridge is enabled in the user's Hashi settings and a Claude Code client is connected during Tomo sessions. Success: the bridge is the default way the user provides editor context (replaces manual @file references for most prompts).
- **Engagement:** `selection_changed` notifications are delivered on every prompt where the user has text selected or a file open. Success: Claude Code transcript shows "Selected N lines from file.md" consistently during active editing sessions.
- **Quality:** Zero observable typing latency from the IDE Bridge. Zero data loss (no missed broadcasts during normal editing). WebSocket connection remains stable across multi-hour Tomo sessions. Success: the user never thinks about the bridge — it just works.
- **Business Impact:** Reduced friction per Tomo interaction. The user no longer needs to manually reference files for context. Success: the Tomo + Obsidian experience matches the VS Code + Claude Code experience for ambient editor context.

### Tracking Requirements

| Event | Properties | Purpose |
|-------|------------|---------|
| Bridge server start | port, success/failure, error reason if failed | Measure adoption, detect port conflicts |
| Client connected | client count | Measure successful integrations |
| Client disconnected | client count, reason (clean/timeout/auth) | Detect connection reliability issues |
| selection_changed sent | file path (no content), debounce count (events collapsed) | Measure engagement, debounce effectiveness |
| Auth rejected | rejected token value (no remote address — always 127.0.0.1 via socat) | Detect misconfiguration (token mismatch) |
| Token regenerated | — | Track manual token management events |

Note: All tracking is local developer-console logging only. No telemetry, no external network calls, no vault content in logs (per MiYo Constitution L1).

---

## Constraints and Assumptions

### Constraints

- **Desktop only:** The IDE Bridge requires Node.js `net`, `http`, and `fs` APIs available only in Electron. Mobile Obsidian cannot run a WebSocket server. `isDesktopOnly: true` in manifest.
- **Localhost only:** The server binds to `127.0.0.1` exclusively. No remote access, no configurable bind address. This is a hard security constraint from ADR-019.
- **No vault I/O:** The IDE Bridge provides editor metadata (paths, positions, selected text). All vault file access goes through Kado. This separation is mandated by the MiYo Constitution L1 architecture rule and ADR-019.
- **Single protocol:** The Claude Code IDE integration protocol (JSON-RPC 2.0 over WebSocket) is the only protocol supported. No custom extensions, no additional RPC methods (ADR-019 constraint).
- **Token in data.json (cleartext):** Following Kado's ADR-5 (single `data.json`) and ADR-6 (`<prefix>_<UUID>` keys), the auth token is stored in `data.json` in cleartext, not a separate file. Constitution L2's general "credentials outside data.json" guidance is consciously waived here for the same reason it was in Kado: the token must be copied as plaintext into Tomo's config (and ends up cleartext in Tomo's container lock file) for the protocol to function, so separate-file storage or UI masking protects nothing. A synced token is inert on other devices.
- **Port 23027 default:** Kado uses 23026. Hashi IDE Bridge uses 23027 as the default. User-changeable but must avoid collision with Kado.

### Assumptions

- **Claude Code IDE protocol stability:** The protocol as documented in the VS Code extension and Neovim reference implementation is stable enough to target. Protocol changes could require Hashi updates.
- **Lock file convention stability:** The `~/.claude/ide/{port}.lock` convention is the established discovery mechanism, now written by **Tomo** inside the container. If Claude Code changes discovery, the Tomo setup (not Hashi) must adapt. Hashi only needs the token + port to match.
- **Single Tomo container:** The primary use case is one Tomo container per Obsidian vault. Multiple containers can connect (the broadcast model supports it), but UX is optimized for the single-container case.
- **Docker networking:** The socat proxy pattern (`host.docker.internal` → localhost) works on macOS Docker Desktop. Linux Docker may require `--network host` or explicit IP configuration. This is Tomo's responsibility, not Hashi's.
- **Obsidian APIs:** `registerEditorExtension()`, `workspace.on("active-leaf-change")`, `MarkdownView.editor.getCursor()`, and `workspace.openLinkText()` remain stable across Obsidian versions >= 1.5.0.

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Protocol changes in Claude Code | High — integration breaks | Low — protocol has been stable across VS Code and Neovim implementations | Pin to a known protocol version. Monitor Claude Code releases for breaking changes. |
| Port conflict with other local services | Medium — server fails to start | Low — 23027 is not a well-known port | User-configurable port. Clear error message naming the conflicting port. |
| Auth token read by another same-user process | Medium — editor context exposed to local attacker | Low — requires same-user compromise (same threat model as SSH agent, VS Code IDE bridge) | The token is cleartext in `data.json` (and Tomo's container lock file — no file-mode hardening, single-user container FS, per ADR-019 §6). An accepted, inherent limitation of localhost services. Documented in PRIVACY.md. |
| Obsidian Sync propagates token via data.json | Low — token is inert on devices that don't run this bridge instance | Medium — Sync replicates data.json | Accepted per Kado ADR-5 precedent. The token only authenticates against the WebSocket server on the host where it runs; a copy on another device authenticates nothing. |
| Typing lag from selection event handling | High — violates Constitution L1 | Very low — the reference implementation proves no measurable impact | 100ms debounce, JSON deduplication, async I/O. |
| Token drift after regenerate | Medium — Tomo can't connect until re-copied | Medium — easy to forget the re-copy step | Regenerate shows a notice reminding the user to update the Tomo config. (No host lock file to keep in sync since lock-file generation is Tomo-side.) |
| Lock-file ownership change vs ratified ADR-019 | Medium — spec/ADR divergence until accepted | High — ADR-019 §6 currently says Hashi writes it | Kokoro ADR-019 amendment handoff raised 2026-05-28; Tomo already implementing container-side generation. Hashi spec updated to the new contract. |

## Open Questions

All questions have been resolved through research and user decisions:

- [x] ~~Status bar indicator approach~~ → Resolved: reuse the existing color-coded status-bar kanji (+ port in tooltip), not a bespoke widget (2026-05-28)
- [x] ~~Auth token storage location~~ → Resolved: in `data.json` cleartext, `hashi_<UUID>` format, no masking — per Kado ADR-5/ADR-6 precedent (2026-05-28)
- [x] ~~Path format convention~~ → Resolved by Kokoro ADR-019 §5: emit plain vault-relative paths, empty `workspaceFolders`, no path-field extensions (2026-05-28)
- [x] ~~Tool scope beyond ADR-019~~ → Resolved: Add getOpenEditors, stub remaining protocol tools (2026-05-27)
- [x] ~~How does Claude reach the full file, not just the selection?~~ → Resolved by Kokoro ADR-019 §5 mechanism (a): a Tomo-side `CLAUDE.md` routing rule sends vault content to `kado-read`. No Hashi-side logic; Hashi only emits plain vault-relative paths (2026-05-28)
- [x] ~~Can Hashi show which specific Tomo instance is connected?~~ → Resolved: No — v0.1 shows connection-presence only (the IDE protocol carries no Tomo identity) (2026-05-28)
- [x] ~~Who writes the discovery lock file?~~ → Resolved: **Tomo** writes the container lock file (from copied token + port). Hashi writes none. Supersedes ADR-019 §6 — Kokoro amendment handoff raised; Tomo already implementing (2026-05-28)
- [x] ~~How does the 友 kanji show both Docker and IDE state?~~ → Resolved: combined session health, worst-state-wins priority; no indicator dot; popover disambiguates (2026-05-28)

---

## Supporting Research

### Competitive Analysis

Three existing implementations of the Claude Code IDE protocol inform this PRD:

1. **VS Code Extension** (Anthropic, official) — the reference implementation. Full protocol with all 12 tools. Establishes the `selection_changed` notification as the primary ambient context mechanism. Only `getDiagnostics` and `executeCode` are model-visible; all other tools are CLI-internal RPC.

2. **claudecode.nvim** (Neovim, community) — full protocol implementation in Lua. Hand-rolled RFC 6455 WebSocket over libuv. Documents the complete protocol surface including lock file format, auth header convention, and ping/pong keepalive. Demonstrates that a zero-dependency WebSocket server is viable and sufficient.

3. **obsidian-claude-ide** (Obsidian, community) — a working Obsidian plugin implementing the core protocol subset. Uses Node.js `http.createServer()` with hand-rolled RFC 6455 framing (~70 lines). Implements `getCurrentSelection`, `getLatestSelection`, `getOpenEditors`, `getWorkspaceFolders`, and stubs for remaining tools. Does NOT implement `openFile`. Uses 100ms debounce with JSON-based deduplication. Proves the zero-dependency approach works in Electron.

Hashi's IDE Bridge builds on these references while adding: `openFile` support (missing from the community implementation), auth token management UX matching Kado's conventions (`hashi_<UUID>`, data.json storage, copy/regenerate controls), a color-coded status-bar indicator, plain vault-relative paths in the broadcast for direct Kado access (Kokoro ADR-019 §5), and integration with the existing Hashi settings and Session View.

### User Research

The IDE Bridge addresses a gap identified through the MiYo development workflow: every Tomo session requires manual file referencing, which breaks the editing flow. The VS Code and Neovim Claude Code integrations demonstrate that ambient editor context significantly reduces friction — users report it as the most valuable aspect of IDE integration. The Obsidian community implementation (obsidian-claude-ide) validates demand: users are building this capability independently.

### Market Data

Claude Code's IDE integration protocol is supported across VS Code, JetBrains (via plugin), Neovim, and Emacs (community). Obsidian is the notable gap in the editor ecosystem. The MiYo project (Kado + Tomo + Hashi) positions Obsidian as a first-class Claude Code integration target. The IDE Bridge is the final piece that brings feature parity with traditional IDE integrations for ambient context.
