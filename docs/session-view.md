# Session View

The Session View is a unified Obsidian tab that hosts an interactive terminal connected to a [Tomo](https://github.com/MMoMM-org/miyo-tomo) Docker container. Anything you'd type in `docker attach <container>`, you type here — and Tomo's TUI (Claude Code's interface) renders inline in the leaf.

> Screenshot — chat view connected to a running Tomo container, terminal showing live Claude Code output and an active prompt.
<p align="center">
  <img src="../assets/session-view-connected.png" alt="MiYo Tomo Hashi chat view connected to a Tomo container, xterm rendering Claude Code's TUI in real time" width="800" />
</p>

## Opening the chat view

Three entry points; all converge on a single `VIEW_TYPE_TOMO_CHAT` leaf (singleton — re-opening focuses the existing one rather than spawning a duplicate):

1. **Status bar 友 → popover → Open chat**
2. **Command palette → "MiYo Tomo Hashi: Show chat window"**
3. **Right-click a vault file → "Open Tomo chat with @file reference"** — opens the view and writes `@<path> ` directly into the Docker session so it appears in Tomo's TUI as typed text. See [file-menu injection](#file-menu-file-injection).

If no Tomo instance has been chosen yet, the picker modal opens first; once you select one, the chat view opens with the attach already in flight.

## Anatomy

### Header

> Screenshot — header bar with state indicator on the left and zoom + Force reconnect on the right.
<p align="center">
  <img src="../assets/session-view-zoom.png" alt="Chat view header — state indicator (Connected — friendly name), zoom buttons 0.5× / 1× / 1.5×, Force reconnect button" width="720" />
</p>

- **Indicator** — text + state class (`is-connected` / `is-reconnecting` / `is-attaching` / `is-disconnected`). The text reads `Connected — <name>`, `Connecting to <name>…`, `Reconnecting (attempt N)…`, or `Disconnected — <reason>`.
- **Zoom group** — three buttons (0.5× / 1× / 1.5×) that scale xterm's font size relative to a 14 px base. Persisted across reloads. Active zoom is communicated via `aria-pressed=true` for screen readers.
- **Force reconnect** — disabled when no instance has ever been chosen (no name to reconnect *to*). Otherwise drops the current attach and starts a fresh attach to the same `chosenInstanceName`. See [Force reconnect](chat.md#force-reconnect).

### Terminal

xterm.js, configured with:

- `convertEol: true` so LF-only output from Tomo renders correctly
- `cursorBlink: true`
- `screenReaderMode: true` — assistive-tech support stays on by default
- `allowProposedApi: false` — OSC 52 (clipboard) and OSC 8 (hyperlinks) are explicitly disabled. A regression test pins these flags so a refactor cannot silently re-enable them.
- `scrollback: 5000` — bounded buffer (`cargo build` floods don't grow unbounded)

Bytes flow both ways:

```
Tomo container stdout → Docker socket → xterm.write
xterm onData (your keystrokes) → docker.write → container stdin
```

All input goes through the terminal — there is no separate line-input field. Type directly into the xterm surface the same way you would type into any terminal emulator.

**Shift+Enter inserts a newline** instead of submitting the prompt. A plain terminal can't tell Shift+Enter from Enter — both emit CR (`0x0D`) — so Hashi intercepts Shift+Enter and sends LF (`0x0A`) to the container instead. That is the same byte Ctrl+J produces, which Claude Code binds to its "newline" action in every terminal. Plain Enter still submits.

## File-menu @file injection

Right-click any file in the file explorer → **Open Tomo chat with @file reference**. Hashi:

1. Opens the chat view if it isn't open already.
2. Writes `@<vault-relative-path> ` directly into the Docker session's stdin, so it appears in Tomo's TUI as if you typed it.
3. Strips control characters (`\n`, `\r`, `\0`) from the path so they cannot disrupt Tomo's terminal — escape sequences would render visibly inside the running TUI.
4. If not connected, the chat view is still revealed so you can see the disconnected state and connect manually.

Pattern: ask Tomo to look at a file by referencing it explicitly rather than pasting its contents.

## State transitions

The chat view subscribes to `connectionStore`. Indicator + Force-reconnect button update on every transition:

| State | Indicator class | Force-reconnect |
|---|---|:-:|
| `attaching` | `is-attaching` | enabled if name set |
| `connected` | `is-connected` | enabled if name set |
| `reconnecting (N)` | `is-reconnecting` | enabled if name set |
| `disconnected` | `is-disconnected` | enabled if name set |

On reconnecting → connected, a sticky `— Reconnected (gap)` suffix is appended to the indicator label until you type something in the terminal. The signal is intentional: while Hashi was reconnecting, container output between the disconnect and the reconnect was lost — you may have missed bytes, and acknowledging by typing clears the suffix.

## Resize behaviour

ResizeObserver on the terminal host triggers a debounced (`150 ms` trailing) `fit()` call. Fit re-measures the host element, recomputes the cell grid, and pushes the new geometry through to the container PTY via `POST /containers/{id}/resize`. This keeps Tomo's TUI from drawing into stale cells when you resize the Obsidian pane.

A separate `disconnected → connected` edge in the indicator's render loop fires an unconditional fit + resize push — the container starts at the docker-run default 80×24 and xterm's `onResize` doesn't fire on attach unless dimensions change, so we do it explicitly.

## Lifecycle and cleanup

- One View instance per leaf. `onOpen` builds the DOM; `onClose` drains the connection-store subscription, the xterm `onData` / `onResize` disposables, the ResizeObserver, the resize-debounce timer, and the terminal session itself (which flushes any queued bytes synchronously before disposing).
- Plugin `onunload` detaches every chat-view leaf so a reload doesn't leave dangling leaves talking to a disposed connection.

## See also

- [Chat](chat.md) — picker, reconnect schedule, force-reconnect semantics
- [Status bar 友](chat.md#status-bar-) — three-state icon + popover
- [Tomo context](context.md) — feed your editor context to Tomo (opt-in, off by default)
