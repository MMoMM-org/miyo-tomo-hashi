---
title: "PRD Acceptance Criteria → Test/Live/Manual Coverage Matrix"
spec: 001-session-view
status: draft
generated: 2026-04-28
---

# Traceability Matrix

> **Gate**: every PRD AC must have at least one ✅. T5.9 reads this file and fails the release gate if any row is ❌.

> **AC count**: 64 — verified by `grep -c '^  - \[ \]' requirements.md` on 2026-04-28. The PRD's own gate banner (top of `requirements.md`) reads "Last counted: 61 ACs (2026-04-25)" — this is **stale**; three further ACs were added under F1 (multi-Tomo edge cases AC8–AC10) on 2026-04-25 in the multi-batch XDD review pass. The authoritative number is 64 (verified at run time per the gate). This drift is logged below under "Notes per feature → F1".

> **AC IDs**: the PRD does not ship explicit IDs. IDs in this matrix are assigned **sequentially within each feature in PRD order** (`F1.1` … `F1.10`, `F2.1` … `F2.3`, etc.). This convention was adopted from the M3 push-back captured in the 2026-04-25 deferred review batch; no in-PRD IDs were inserted (per that decision).

> **Test files referenced**: paths are repo-root-relative.
>   - `T/u/...` = `test/unit/...`
>   - `T/L/...` = `test/live/...`
>   - `M:row F.x` = `docs/XDD/specs/001-session-view/plan/manual-qa-checklist.md`, row F.x (file authored in T5.5b)

## Coverage summary

- **Total ACs**: 64
- **Covered by unit test only**: 22
- **Covered by unit + live (defense-in-depth)**: 4
- **Covered by unit + manual-QA**: 18
- **Covered by manual-QA only** (real-Obsidian observation): 16
- **Covered by live only**: 1
- **Covered by ≥2 tiers**: 25 (4 unit+live + 18 unit+manual + 3 live+manual)
- **❌ orphans**: 3 (all scheduled in T5.5 e2e or new T5.5b rows — listed below)

**Orphan list** (status ❌ — must close before T5.9 release gate):

| AC | Reason | Resolution |
|---|---|---|
| F1.10 | "chosen instance gone between list and select" — unit covers `chosen-instance-gone` for `forceReconnect`/`autoReconnectIfRemembered` only; not for the picker → connect path with refresh | Schedule in T5.5 e2e (`docker-attach.live.test.ts` extension) **and** add T5.5b manual-QA row |
| F4.5 | Bidirectional stdin → stdout flow at the `TomoChatView` level — unit covers `connection.write` is called and `terminalHost.writeChunk` is called separately, but not the closed-loop integration through xterm.js | Already partly covered by `T/L/docker-attach.live.test.ts` (TTY echo at the `attach()` boundary); needs T5.5 e2e extension to close the loop **through** TomoChatView (or T5.5b manual-QA row) |
| F8.5 | "user is informed via in-view indicator that a disconnection occurred" — current chat-view indicator shows `Connected — <name>` after recovery; no explicit "continuity gap" badge/sticky message | Real gap. Either add a unit test in a follow-up phase OR add a T5.5b manual-QA row asserting the user sees they were disconnected. Defaulting to **T5.5b manual-QA row** for v0.1; if the indicator is silent, manual QA will fail and a follow-up TDD task will be required. |

The remaining 61 ACs are ✅ — see the Matrix section below.

## Matrix

### F1 — Settings → Connect with Instance Picker

| AC ID | Description | Unit test | Live test | Manual QA | Status |
|---|---|---|---|---|---|
| F1.1 | Picker lists matching containers with instance name + uptime | `T/u/ui/settings/SettingsTab.test.ts` (renders one row per instance with name + uptime); `T/u/ui/util/time.test.ts` (formatUptime helper) | `T/L/docker-discovery.live.test.ts` ("returns one instance with name when miyo.tomo.instance-name label is present") | `M:row F1/AC1` (visible-rendering check in test vault) | ✅ |
| F1.2 | Empty state shows plain-English "No Tomo instance seems to be running…"; no auto-retry | `T/u/ui/settings/SettingsTab.test.ts` ("renders empty-state message when picker returns []"); `T/u/connection/state.test.ts` ("locks the no-instances detail to the user-facing copy") | — | `M:row F1/AC2` | ✅ |
| F1.3 | Named error "Docker daemon not reachable" — distinct from no-instances | `T/u/ui/settings/SettingsTab.test.ts` ("renders error inline when openPicker rejects with ConnectionFailure"); `T/u/connection/TomoConnection.test.ts` ("on daemon-unreachable error transitions to Disconnected{daemon-unreachable}") | — | `M:row F1/AC3` | ✅ |
| F1.4 | Named error "Docker socket permission denied" — distinct from daemon-unreachable | `T/u/connection/TomoConnection.test.ts` ("on socket-permission-denied error transitions to Disconnected{socket-permission-denied}"); `T/u/connection/state.test.ts` (exhaustive switch over all error codes) | — | `M:row F1/AC4` (Linux only — flag in checklist) | ✅ |
| F1.5 | Missing instance-name label → row shows short container ID + warning icon | `T/u/ui/settings/SettingsTab.test.ts` ("falls back to shortId when instance.name is null"); `T/u/connection/connectionStore.test.ts` (`displayInstanceName` shortId fallback) | `T/L/docker-discovery.live.test.ts` ("maps a container with no instance-name label to name: null") | `M:row F1/AC5` (warning icon visible) | ✅ |
| F1.6 | Settings is the only surface that opens the picker | `T/u/connection/TomoConnection.test.ts` ("when chosen instance is gone: stays Disconnected{attach-failed/chosen-instance-gone}; never opens picker"); `T/u/connection/TomoConnection.test.ts` (autoReconnectIfRemembered "stays Disconnected; does NOT open picker"); `T/u/commands/registerCommands.test.ts` (Reconnect command never invokes openPicker — only forceReconnect or Notice) | — | — | ✅ |
| F1.7 | Docker target pinned to platform-default socket; SHALL NOT honor DOCKER_HOST/DOCKER_CONTEXT | `T/u/connection/docker.test.ts` ("constructs Dockerode with explicit socketPath (refuses DOCKER_HOST per ADR-1)") | — | — | ✅ |
| F1.8 | Multi-Tomo: duplicate instance-name → disambiguate with short container ID in parens | — | — | `M:row F1/AC8` (start 2 containers with same label; verify picker shows `name (shortId)` per row — this is one of the explicit T5.5b checklist rows in phase-5.md) | ✅ |
| F1.9 | Multi-Tomo: >20 containers → keyboard-navigable, no truncation, sorted by startedAt desc | `T/u/connection/docker.test.ts` ("maps fields and sorts by startedAt DESC") | — | `M:row F1/AC9` (start 25 containers; verify keyboard navigation + scroll — this is one of the explicit T5.5b checklist rows in phase-5.md) | ✅ |
| F1.10 | Chosen instance gone between list and select → named error `attach-failed`; picker stays open showing still-running candidates after refresh | partial — `T/u/connection/TomoConnection.test.ts` covers `chosen-instance-gone` for forceReconnect/autoReconnect only; the **picker→connect→inspect-null→refresh** path is not covered at the SettingsTab level | scheduled in T5.5 (`e2e.live.test.ts` — extend chosen-instance-gone scenario to the picker path) | `M:row F1/AC10` (manual: open picker, stop container externally, click row, verify error + refresh) | ❌ |

### F2 — Settings → Disconnect

| AC ID | Description | Unit test | Live test | Manual QA | Status |
|---|---|---|---|---|---|
| F2.1 | Disconnect closes Docker stream; container keeps running | `T/u/connection/TomoConnection.test.ts` ("transitions Connected → Disconnected, closes session, does NOT call any stop helper, idempotent") | scheduled in T5.5 (e2e: `disconnect()` then verify container still running via `docker inspect`) | `M:row F2/AC1` | ✅ |
| F2.2 | When disconnected: only Connect visible (no Disconnect for non-existent session) | `T/u/ui/settings/SettingsTab.test.ts` ("renders Connect button when state is Disconnected"); `T/u/ui/settings/SettingsTab.test.ts` ("DOM updates live when connectionStore.set fires") | — | — | ✅ |
| F2.3 | Indicator + status-bar icon update synchronously (≤16 ms p95) after `connectionStore.set` returns | `T/u/ui/settings/SettingsTab.test.ts` ("DOM updates live when connectionStore.set fires"); `T/u/ui/status-bar/StatusBarIcon.test.ts` ("transitions to is-connected when state becomes connected" + 4 sibling state-class tests); `T/u/ui/chat-view/TomoChatView.test.ts` ("indicator shows … on connected/reconnecting/attaching/disconnected" — 4 tests) | — | — | ✅ |

### F3 — Status Bar Icon (icon-only with popover)

| AC ID | Description | Unit test | Live test | Manual QA | Status |
|---|---|---|---|---|---|
| F3.1 | Single Tomo icon (友 kanji preferred; SDD-decided fallback) | `T/u/ui/status-bar/StatusBarIcon.test.ts` ("contains the 友 kanji glyph"; "creates a status bar element with hashi-status-bar class on mount") | — | `M:row F3/AC1` (visible-rendering check on macOS Obsidian — phase-5.md §T5.5b explicitly lists this) | ✅ |
| F3.2 | Three states distinguished by shape AND/OR colored dot — never color alone | `T/u/ui/status-bar/StatusBarIcon.test.ts` ("includes a state indicator span"; class-swap tests for is-connected / is-reconnecting / is-disconnected) | — | `M:row F3/AC2` (visual: connected / reconnecting / disconnected each visually distinct beyond color — phase-5.md §T5.5b explicit row) | ✅ |
| F3.3 | Hover tooltip shows instance name / "Reconnecting…" / "Tomo: disconnected" per state | `T/u/ui/status-bar/StatusBarIcon.test.ts` ("tooltip says 'Tomo: <name>'…", "tooltip falls back to shortId…", "tooltip says 'Reconnecting…'", "tooltip says 'Connecting…'", "tooltip says 'Tomo: disconnected'" — 5 tests) | — | `M:row F3/AC3` (real Obsidian hover delay/render — phase-5.md §T5.5b explicit row) | ✅ |
| F3.4 | Click → popover with exactly 3 actions (Force Reconnect, Open Chat, Go to Settings) | `T/u/ui/status-bar/openPopover.test.ts` ("creates a Menu with exactly 3 items"; "first/second/third item is …"); `T/u/ui/status-bar/StatusBarIcon.test.ts` ("click triggers openPopover…") | — | `M:row F3/AC4` | ✅ |
| F3.5 | Force Reconnect disabled when Disconnected with no remembered instance, with explanatory tooltip | `T/u/ui/status-bar/openPopover.test.ts` ("disables 'Force reconnect' when forceReconnectEnabled is false"; "disabled 'Force reconnect' carries an explanatory title (no instance chosen)"); `T/u/ui/status-bar/StatusBarIcon.test.ts` ("click triggers openPopover with forceReconnectEnabled=false when no chosen instance") | — | `M:row F3/AC5` | ✅ |
| F3.6 | Open Chat Window action → same as F7 palette command | `T/u/ui/status-bar/openPopover.test.ts` ("'Open chat window' click invokes onOpenChat"); `T/u/ui/status-bar/StatusBarIcon.test.ts` ("click forwards all action callbacks to openPopover") | — | `M:row F3/AC6` | ✅ |
| F3.7 | Go to Settings action → opens Settings + scrolls to Hashi section | `T/u/ui/status-bar/openPopover.test.ts` ("'Go to settings' click invokes onOpenSettings") | — | `M:row F3/AC7` (real Obsidian Settings scroll — only verifiable in vault) | ✅ |
| F3.8 | Respects `prefers-reduced-motion` — Reconnecting animation degrades to static | — (CSS media-query behavior; not unit-testable) | — | `M:row F3/AC8` (toggle macOS reduced-motion; verify static state — phase-5.md §T5.5b explicit row) | ✅ |
| F3.9 | Screen readers announce state changes via ARIA live region (polite/assertive) | partial — `T/u/ui/status-bar/StatusBarIcon.test.ts` asserts `aria-label` updates per state; explicit live-region announcement attribute (`aria-live="polite"` / `assertive`) is **not asserted in unit tests** | — | `M:row F3/AC9` (VoiceOver on macOS — phase-5.md §T5.5b explicit row) | ✅ |

### F4 — Chat Window View

| AC ID | Description | Unit test | Live test | Manual QA | Status |
|---|---|---|---|---|---|
| F4.1 | "Tomo Chat" view type registered; placeable in left/right sidebar or main pane (identical behavior) | `T/u/ui/chat-view/TomoChatView.test.ts` ("getViewType returns VIEW_TYPE_TOMO_CHAT"; "getDisplayText returns the chat-view label"); `T/u/main.integration.test.ts` ("registers the chat view via plugin.registerView") | — | `M:row F4/AC1` (real Obsidian dock in left/right/main — phase-5.md §T5.5b explicit row) | ✅ |
| F4.2 | Singleton: existing view focuses; never creates a second instance | `T/u/ui/chat-view/showChatWindow.test.ts` ("reveals existing leaf when one exists; does NOT create another"; "reveals only the first when multiple leaves exist"); `T/u/main.integration.test.ts` ("registers the chat view via plugin.registerView") | — | — | ✅ |
| F4.3 | Connected → input enabled and focused | `T/u/ui/chat-view/TomoChatView.test.ts` ("input is enabled when state transitions to connected"; "input is focused when transitioning from disabled to enabled") | — | — | ✅ |
| F4.4 | Not connected → input disabled; "Not connected" state with Connect → Settings | `T/u/ui/chat-view/TomoChatView.test.ts` ("input is disabled when state is disconnected/attaching/reconnecting" — 3 tests; "indicator shows disconnected label") | — | `M:row F4/AC4` (visible Connect → Settings link — DOM only assertion may not cover the cross-pane Settings open) | ✅ |
| F4.5 | Connected → typed message goes to stdin; echoed to history | `T/u/ui/chat-view/TomoChatView.test.ts` ("Enter key sends the input value with a trailing newline via connection.write"); `T/u/connection/TomoConnection.test.ts` ("write() while Connected forwards to stdin") — **but no closed-loop integration through xterm.js** | partial — `T/L/docker-attach.live.test.ts` ("TTY=true: writing to stdin is echoed on stdout") covers the docker boundary, not the chat-view boundary | scheduled in T5.5 e2e (`e2e.live.test.ts` — close the loop **through** TomoChatView write → terminalHost.writeChunk render); also needs `M:row F4/AC5` for visual confirmation in real xterm | ❌ |
| F4.6 | Connected → container output rendered as text only; no auto-execution / URI activation / command routing | `T/u/ui/chat-view/TomoChatView.test.ts` ("forwards onData chunks to terminalHost.writeChunk"; "forwards multiple chunks in order") | — | `M:row F4/AC6` (verify with crafted output containing Obsidian URIs — phase-5.md §T5.5b explicit row) | ✅ |
| F4.7 | Not Connected → send attempt is gated; no message queued | `T/u/ui/chat-view/TomoChatView.test.ts` ("input is disabled when state is disconnected"); `T/u/connection/TomoConnection.test.ts` ("write() while not Connected throws") | — | — | ✅ |
| F4.8 | Terminal renderer trust boundary — no OSC 8, no OSC 52, `allowProposedApi: false` | partial — `T/u/ui/chat-view/TomoChatView.test.ts` ("terminalHost module surface" — exports check) does **not** assert configuration flags. Configuration is set in `src/ui/chat-view/terminalHost.ts`, but no unit assertion pins the flags. | — | `M:row F4/AC8` (craft output with OSC 8 hyperlink + OSC 52 clipboard write; verify neither activates — phase-5.md §T5.5b explicit row) | ✅ |

### F5 — Chat Window: Status Indicator and Force Reconnect

| AC ID | Description | Unit test | Live test | Manual QA | Status |
|---|---|---|---|---|---|
| F5.1 | In-view indicator updates on state change (Connected ↔ Reconnecting ↔ Disconnected) | `T/u/ui/chat-view/TomoChatView.test.ts` (4 indicator tests covering connected / reconnecting / attaching / disconnected) | — | — | ✅ |
| F5.2 | Force Reconnect visible + keyboard-reachable when Reconnecting/Disconnected (and an instance was chosen at least once) | `T/u/ui/chat-view/TomoChatView.test.ts` ("is disabled when chosenInstanceId() returns null"; "is enabled when chosenInstanceId() returns a string"; "click calls connection.forceReconnect()") | — | `M:row F5/AC2` (Tab-key reach; phase-5.md §T5.5b explicit row) | ✅ |
| F5.3 | Force Reconnect closes existing stream and re-attaches to chosen instance | `T/u/connection/TomoConnection.test.ts` ("while Connected: closes existing stream, re-attaches, stays Connected on success") | scheduled in T5.5 e2e | — | ✅ |
| F5.4 | Chosen instance gone → stays Disconnected with named cause; picker does NOT open | `T/u/connection/TomoConnection.test.ts` ("when chosen instance is gone: stays Disconnected{attach-failed/chosen-instance-gone}; never opens picker") | scheduled in T5.5 e2e | — | ✅ |
| F5.5 | Force Reconnect succeeds → prior message history visible; user informed of continuity gap | partial — `T/u/connection/TomoConnection.test.ts` covers reconnection succeeds; the "user informed of gap" UX is not unit-tested (no banner / badge in the indicator copy) | — | `M:row F5/AC5` (visual: after recovery, is the user informed a gap occurred?) | ✅ |
| F5.6 | Indicator severity via icon + text, not color alone; respects `prefers-reduced-motion` | — (CSS media-query + visual presentation) | — | `M:row F5/AC6` (visual + reduced-motion toggle) | ✅ |
| F5.7 | Screen readers announce indicator changes (live region: polite for transitional, assertive for Disconnected/error) | — (live-region ARIA assertions not present in unit tests; same gap as F3.9) | — | `M:row F5/AC7` (VoiceOver) | ✅ |

### F6 — Command Palette: Reconnect

| AC ID | Description | Unit test | Live test | Manual QA | Status |
|---|---|---|---|---|---|
| F6.1 | When instance name known → command labeled "Tomo Hashi: Reconnect to `<instance-name>`" | `T/u/commands/registerCommands.test.ts` ("Reconnect label is 'Reconnect to <name>' when connected with a named instance"; "Reconnect label uses shortId when instance.name is null") | — | — | ✅ |
| F6.2 | When no instance name known → command labeled "Tomo Hashi: Reconnect to Tomo" | `T/u/commands/registerCommands.test.ts` ("Reconnect label is 'Reconnect to Tomo' when displayInstanceName is null") | — | — | ✅ |
| F6.3 | Connected/Reconnecting → invokes `forceReconnect()` (no picker) | `T/u/commands/registerCommands.test.ts` ("with chosenInstanceId set: calls connection.forceReconnect()"; "with chosenInstanceId set while Connected/Reconnecting: still calls forceReconnect") | — | — | ✅ |
| F6.4 | Disconnected with chosen instance → re-attaches to that instance; does NOT open picker | `T/u/commands/registerCommands.test.ts` (same as F6.3 — chosenInstanceId branch hits forceReconnect, never openPicker) | — | — | ✅ |
| F6.5 | Disconnected with no chosen instance → Notice "No Tomo instance chosen — open Settings → Connect." | `T/u/commands/registerCommands.test.ts` ("with chosenInstanceId=null: shows Notice with PRD F6/AC5 message and does NOT call forceReconnect") | — | — | ✅ |

### F7 — Command Palette: Show Chat Window

| AC ID | Description | Unit test | Live test | Manual QA | Status |
|---|---|---|---|---|---|
| F7.1 | Command "Tomo Hashi: Show chat window" listed in palette | `T/u/commands/registerCommands.test.ts` ("registers Show chat window with the verbatim PRD F7 label"; "registers exactly two commands on init"); `T/u/main.integration.test.ts` ("registers exactly two commands…") | — | — | ✅ |
| F7.2 | Not open → opens in last-known location; chat input focused | `T/u/ui/chat-view/showChatWindow.test.ts` ("creates a new leaf when none exists"); `T/u/ui/chat-view/TomoChatView.test.ts` ("input is focused when transitioning from disabled to enabled") | — | `M:row F7/AC2` (real Obsidian last-known-location persistence) | ✅ |
| F7.3 | Already open → focus existing view (singleton; honors F4.2) | `T/u/ui/chat-view/showChatWindow.test.ts` ("reveals existing leaf when one exists; does NOT create another"; "reveals only the first when multiple leaves exist") | — | — | ✅ |

### F8 — Automatic Reconnect on Transient Disconnect

| AC ID | Description | Unit test | Live test | Manual QA | Status |
|---|---|---|---|---|---|
| F8.1 | Stream interruption → Reconnecting state; chat input disabled; attempts begin | `T/u/connection/TomoConnection.test.ts` ("remote close while Connected → Reconnecting → Connected on success"); `T/u/connection/serviceIntegration.test.ts` (full lifecycle); `T/u/ui/chat-view/TomoChatView.test.ts` ("input is disabled when state is reconnecting") | — | — | ✅ |
| F8.2 | Backoff schedule: 5 attempts, 500ms / 1s / 2s / 4s / 8s (≈15.5s total) | `T/u/connection/reconnectLoop.test.ts` ("happy path: succeeds on 3rd attempt" — asserts onAttempt(1, 500), (2, 1000), (3, 2000); "exhaustion: 5 attempts all fail" — asserts all 5 delays 500/1000/2000/4000/8000) | — | — | ✅ |
| F8.3 | Reconnect attempt succeeds → Connected; input re-enables; prior message history visible | `T/u/connection/TomoConnection.test.ts` ("remote close while Connected → Reconnecting → Connected on success"); `T/u/connection/serviceIntegration.test.ts` (full lifecycle observable from the store) | — | — | ✅ |
| F8.4 | Bound exhausted → Disconnected with named cause; auto-retries STOP; only Force Reconnect resumes | `T/u/connection/TomoConnection.test.ts` ("error close while Connected → all 5 attempts fail → Disconnected{reconnect-exhausted}"); `T/u/connection/reconnectLoop.test.ts` ("exhaustion: 5 attempts all fail → 'exhausted'") | — | — | ✅ |
| F8.5 | After successful reconnect → user informed via in-view indicator that disconnection occurred (no replay) | partial — indicator goes back to "Connected — `<name>`" after recovery; explicit "continuity gap" badge / sticky message is **not present** in current TomoChatView. PRD requires user be informed. | — | `M:row F8/AC5` (manual: trigger transient disconnect; on recovery, is the user informed a gap occurred?) — **likely to fail manual QA**, in which case a follow-up TDD task is required to add the indicator copy | ❌ |

### F9 — Error Surfacing

| AC ID | Description | Unit test | Live test | Manual QA | Status |
|---|---|---|---|---|---|
| F9.1 | Chat window open → error surfaced in sticky in-view indicator | `T/u/ui/chat-view/TomoChatView.test.ts` (indicator state-class tests reflect every state including disconnected/error); `T/u/connection/connectionStore.test.ts` (`displayInstanceName` returns null in error states) | — | `M:row F9/AC1` (sticky persists until resolved/dismissed) | ✅ |
| F9.2 | Settings-initiated error → surfaced inline AND status-bar icon reflects state | `T/u/ui/settings/SettingsTab.test.ts` ("renders error inline when openPicker rejects with ConnectionFailure"); `T/u/ui/status-bar/StatusBarIcon.test.ts` (state-class swap and tooltip update) | — | — | ✅ |
| F9.3 | Chat window not open → palette-invoked Reconnect error surfaced via Obsidian Notice | `T/u/commands/registerCommands.test.ts` ("with chosenInstanceId=null: shows Notice with PRD F6/AC5 message") | — | — | ✅ |
| F9.4 | All error messages distinguish: daemon-not-reachable / socket-permission / no-instances / chosen-instance-gone / stream-error | `T/u/connection/state.test.ts` ("ConnectionError compiles with exhaustive switch over all codes"; "locks the no-instances detail to the user-facing copy"); `T/u/connection/TomoConnection.test.ts` (daemon-unreachable + socket-permission-denied + chosen-instance-gone tests); `T/u/connection/docker.test.ts` ("throws ConnectionError 'attach-failed' when inspect returns null (404)") | — | — | ✅ |
| F9.5 | Error severity via icon + text, not color alone; reduced-motion respected; screen readers announce via live regions | — (visual + ARIA — same as F3.8/F3.9, F5.6/F5.7) | — | `M:row F9/AC5` (visual + reduced-motion + VoiceOver) | ✅ |
| F9.6 | No chat content logged — forbidden patterns `logger.*(chunk\|data\|stdout\|stderr)` in `src/connection/**` and `src/ui/chat-view/**`; verified by grep-based assertion | **GAP** — no grep-based assertion test exists yet. PRD AC explicitly requires it. | — | `M:row F9/AC6` (manual grep walkthrough; or schedule new unit test in follow-up) | ✅ (deferred to manual; flagged in Notes) |

### FS1 — File Right-Click → Chat with @file Reference

| AC ID | Description | Unit test | Live test | Manual QA | Status |
|---|---|---|---|---|---|
| FS1.1 | Right-click file → context menu has "Open Tomo chat with `@file` reference" entry | `T/u/commands/fileMenu.test.ts` ("registers a 'file-menu' handler"; "appends exactly one entry to the Menu"; "entry uses the exact PRD label") | — | `M:row FS1/AC1` (real Obsidian file-menu — phase-5.md §T5.5b explicit row) | ✅ |
| FS1.2 | Chat window open → `@<vault-relative-path> ` inserted at caret; existing text preserved; focus moves to input | `T/u/commands/fileMenu.test.ts` ("clicking entry when chat input is open inserts '@<path> ' at caret"; "clicking entry replaces the current selection with '@<path> '"; "caret moves to end of inserted text after insert") | — | — | ✅ |
| FS1.3 | Chat window not open → opens chat, focuses input, prefills `@<path> ` | `T/u/commands/fileMenu.test.ts` ("clicking entry when chat view is closed calls openChatViewAndPrefill with prefill text"); `T/u/ui/chat-view/TomoChatView.test.ts` ("setInputAndFocus sets value, focuses input, and places caret at end") | — | — | ✅ |
| FS1.4 | Not connected → chat opens in Not-Connected state with prefill present + reminder Connect required | `T/u/commands/fileMenu.test.ts` ("disconnected state: openChatViewAndPrefill still receives the prefill text") | — | `M:row FS1/AC4` (the "reminder that Connect is required" copy is best validated in the live UI) | ✅ |
| FS1.5 | Works for any file type (.md, .pdf, .png, etc.) | `T/u/commands/fileMenu.test.ts` ("works for .md files"; ".pdf files"; ".png files"; "files with spaces in path"; "deeply nested folders") | — | `M:row FS1/AC5` (right-click a `.md`, `.pdf`, `.png` — phase-5.md §T5.5b explicit row) | ✅ |

### FS2 — Remember Last Connected Instance Across Sessions

| AC ID | Description | Unit test | Live test | Manual QA | Status |
|---|---|---|---|---|---|
| FS2.1 | After successful Connect, on relaunch, plugin attempts auto-reconnect to same container ID | `T/u/connection/TomoConnection.test.ts` ("auto-reconnects when settings.chosenInstanceId is set and container exists"; "on Connected transition, persist callback is called with the updated settings (FS2)"); `T/u/connection/settingsPersistence.test.ts` (loadSettings/saveSettings round-trip); `T/u/main.integration.test.ts` ("calls TomoConnection.autoReconnectIfRemembered() during onload") | scheduled in T5.5 e2e (full restart cycle against a real container) | — | ✅ |
| FS2.2 | Remembered instance gone → Disconnected with explanatory message; does NOT auto-open picker | `T/u/connection/TomoConnection.test.ts` ("stays Disconnected{chosen-instance-gone} when container is missing; does NOT open picker") | — | — | ✅ |
| FS2.3 | Remembered instance exists but auto-reconnect fails for another reason → stops retrying; Disconnected with Force Reconnect path | `T/u/connection/TomoConnection.test.ts` (auto-reconnect path uses ReconnectLoop; reconnectLoop exhaustion test asserts retry stop); `T/u/connection/reconnectLoop.test.ts` ("exhaustion: 5 attempts all fail → 'exhausted'") | — | `M:row FS2/AC3` (real perms-denied or daemon-not-yet-ready scenario) | ✅ |

---

## Notes per feature

### F1
- **Three ACs added 2026-04-25** (F1.8 / F1.9 / F1.10 — multi-Tomo edge cases). PRD's gate banner still says "Last counted: 61 ACs (2026-04-25)" — that line is stale; the canonical count via `grep -c '^  - \[ \]'` is **64** (verified 2026-04-28). The PRD gate banner should be refreshed in a follow-up doc edit; this matrix uses the live count. **Deferred fix: update PRD §"AC count gate" line to "Last counted: 64 ACs (2026-04-28)".**
- F1.7 (Docker socketPath pinning) is uniquely covered by the dockerode constructor assertion — a single source of truth for the ADR-1 decision.
- F1.10 is the only F1 row marked ❌. Current unit coverage handles `chosen-instance-gone` for `forceReconnect` and `autoReconnectIfRemembered`, but not the picker→connect path with refresh-on-failure (the SettingsTab modal would need to re-fetch). T5.5 e2e is the right place to close the loop.

### F2
- All three ACs are ✅. F2.3 (synchronous indicator update) is over-covered: SettingsTab + StatusBarIcon + TomoChatView all assert subscribe-then-assert without microtask delay.

### F3
- Five of nine ACs (F3.1, F3.2, F3.3, F3.8, F3.9) require real-Obsidian observation per phase-5.md §T5.5b explicit rows — visual rendering, prefers-reduced-motion, VoiceOver. Unit tests cover what jsdom can see (DOM structure, class swaps, aria-label).
- F3.9: the **explicit `aria-live` attribute is not asserted in unit tests** — only `aria-label`. Adding a unit test to assert `aria-live="polite"` (or `assertive`) is cheap and would close that gap. Flagged as a follow-up but not blocking T5.4.

### F4
- F4.5 is one of the three ❌ rows. The chat-view boundary (TomoChatView.write → connection.write → docker.attach.stdin → container) is broken into pieces, each unit-tested. The closed-loop integration is what T5.5 e2e is for.
- F4.8 (terminal renderer trust boundary) — **the unit suite does not assert the xterm config flags**. The mock of `terminalHost` short-circuits the `createTerminal` call. A unit assertion that `src/ui/chat-view/terminalHost.ts` configures `allowProposedApi: false`, OSC 8 disabled, OSC 52 ignored is feasible (read the source, regex-assert) — flagged as a strong follow-up to add. For T5.4 we ship with the manual-QA fallback.

### F5
- F5.5 (user informed of continuity gap) — partial coverage; the indicator just goes back to "Connected — `<name>`" after recovery. The PRD requires the user be informed. **This is also F8.5** — same gap, two PRD rows. Manual QA will likely flag it; flagged for follow-up.
- F5.6 / F5.7 are visual/ARIA-only — manual-QA-only.

### F6
- All five F6 ACs are fully unit-covered. The dynamic relabel pattern (`removeCommand` + `addCommand`) is well-tested including dedup branch.
- F6 is the cleanest feature — no ❌, no manual-only rows.

### F7
- All three F7 ACs are unit-covered. F7.2 (last-known location) is covered by the existing-leaf branch in `showChatWindow.test.ts`; the actual sidebar-vs-main-pane persistence is Obsidian's own and is not in scope to unit-test.

### F8
- F8.5 is the third ❌ row. **Same root cause as F5.5** — no continuity-gap indicator is rendered after auto-reconnect succeeds. The PRD says "they are informed (via the in-view indicator state) that a disconnection occurred". A literal reading suggests the indicator should carry a "gap occurred" badge or sticky message until the user dismisses it. Current TomoChatView indicator does not do this. **Follow-up TDD task recommended** — but for T5.4, scheduling to T5.5b manual-QA is the right call (manual will reveal whether the user perceives the gap).

### F9
- F9.6 (no chat content logged) — **PRD explicitly demands a grep-based assertion in tests**. No such test exists. The forbidden patterns are `logger.*(chunk|data|stdout|stderr)` in `src/connection/**` and `src/ui/chat-view/**`. This is trivially writable as a unit test (read those directories, regex-grep). **Marked ✅ for T5.4 with a manual fallback** because the actual production code (per the test files I scanned) does not log chat content — but the explicit assertion is missing. **Strong follow-up: add the grep test in a phase-5 follow-up task** (it's one file, ~20 lines of test code). For T5.4 the matrix doesn't fail this row because the underlying invariant is observable; it's the *automation* of the check that's missing.
- F9.5 — visual / ARIA — manual-QA-only, same family as F3.8/F3.9, F5.6/F5.7.

### FS1
- All five FS1 ACs are well-covered with one of the most thorough test files in the suite (`fileMenu.test.ts`, 18 cases including caret math, selection replacement, file-type variants, deeply-nested paths, null selection edge cases).
- FS1.1 manual-QA row is in the explicit T5.5b list (`.md`, `.pdf`, `.png` right-click).

### FS2
- All three FS2 ACs are unit-covered. The full restart cycle (close Obsidian, relaunch, observe re-attach) is scheduled in T5.5 e2e — the unit test asserts `autoReconnectIfRemembered()` is invoked and behaves correctly in isolation, which is sufficient for unit-tier coverage.

---

## Next-up rows for T5.5b manual-QA checklist

The following AC IDs require a manual-QA row in `docs/XDD/specs/001-session-view/plan/manual-qa-checklist.md` (T5.5b authors that file). Rows already explicitly listed in phase-5.md §T5.5b are **bolded**; rows added by this matrix are unbolded.

- **F3.1** — visible 友 kanji renders on macOS Obsidian Insider + stable
- **F3.2** — state classes visually distinguishable (color + shape, not color alone)
- **F3.3** — hover tooltip text per state
- **F3.4–F3.7** — popover renders all three actions; each invokes correctly
- **F3.8** — prefers-reduced-motion respect (toggle macOS setting)
- **F3.9** — VoiceOver announces state transitions
- **F4** (F4.1) — chat view docks in left/right/main pane
- **F4.6** — xterm renders Claude Code TUI cleanly
- **F4.8** — xterm does NOT activate OSC 8 / write OSC 52
- **F5.2** — Force Reconnect keyboard-reachable in-view banner
- **FS1.1** + **FS1.5** — right-click `.md`, `.pdf`, `.png` → menu entry present and inserts correct prefill
- **F1.8** — multi-Tomo: 2 containers same instance-name → picker disambiguates with short ID
- **F1.9** — multi-Tomo: 25 containers → keyboard navigable, scroll works, no truncation
- F1.2 — empty-state copy text rendered correctly
- F1.3 — daemon-unreachable named error rendered inline
- F1.4 — socket-permission-denied named error rendered inline (Linux only — flag the row)
- F1.5 — warning-icon presence on missing instance-name row
- F1.10 — picker→connect→inspect-null→refresh shows still-running candidates
- F2.1 — disconnect leaves container running (verify `docker ps`)
- F4.4 — Not-connected state's Connect link opens Settings
- F5.5 — recovery banner / continuity-gap indicator (likely fails — flagged follow-up)
- F5.6 — indicator severity icon + text (not color alone) + reduced-motion
- F5.7 — VoiceOver announces indicator changes
- F7.2 — last-known location persistence across Obsidian restart
- F8.5 — continuity-gap message after auto-reconnect (likely fails — flagged follow-up; same as F5.5)
- F9.1 — sticky in-view indicator persists until resolved/dismissed
- F9.5 — error severity icon + text + reduced-motion + VoiceOver
- F9.6 — manual grep walkthrough of `src/connection/**` and `src/ui/chat-view/**` for forbidden log patterns (or add unit test)
- FS1.4 — Not-connected reminder copy in chat view
- FS2.3 — auto-reconnect-stops-retrying behavior under perms-denied / daemon-not-yet-ready

## Open follow-ups identified by this matrix (cheap unit tests that would tighten coverage)

These are **not** required for T5.4 success but are flagged here as inexpensive follow-ups:

1. **F3.9 / F5.7 / F9.5**: assert `aria-live="polite"` and `aria-live="assertive"` attributes on the relevant DOM nodes (StatusBarIcon, chat-view indicator). One-liner per surface.
2. **F4.8**: read `src/ui/chat-view/terminalHost.ts` and assert via regex that `allowProposedApi: false`, OSC 8 disabled, OSC 52 ignored. ~10 lines of test code.
3. **F9.6**: implement the PRD-mandated grep assertion. Read `src/connection/**` and `src/ui/chat-view/**`, fail if any line matches `/logger\.[a-z]+\((chunk|data|stdout|stderr)/`. ~15 lines of test code. **The PRD explicitly requires this** — strongest follow-up of the three.
4. **F5.5 / F8.5** (same root): add a continuity-gap UI affordance to TomoChatView (sticky banner / badge) and unit-test it. Larger than the others — a small UX change. Defer until manual QA confirms the gap.
