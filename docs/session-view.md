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
3. **Right-click a vault file → "Insert into chat"** — opens the view AND prefills the input with `@<path> ` so you can ask Tomo about that file. See [file-menu prefill](#file-menu-file-prefill).

If no Tomo instance has been chosen yet, the picker modal opens first; once you select one, the chat view opens with the attach already in flight.

## Anatomy

### Header

> Screenshot — header bar with state indicator on the left and zoom + Force reconnect on the right.
<p align="center">
  <img src="../assets/session-view-zoom.png" alt="Chat view header — state indicator (Connected — friendly name), zoom buttons 0.5× / 1× / 1.5×, Force reconnect button" width="720" />
</p>

- **Indicator** — text + state class (`is-connected` / `is-reconnecting` / `is-attaching` / `is-disconnected`). The text reads `Connected — <name>`, `Connecting to <name>…`, `Reconnecting (attempt N)…`, or `Disconnected — <reason>`.
- **Zoom group** — three buttons (0.5× / 1× / 1.5×) that scale xterm's font size relative to a 14 px base. Persisted across reloads. Active zoom is communicated via `aria-pressed=true` for screen readers.
- **Force reconnect** — disabled when no instance has ever been chosen (no name to reconnect *to*). Otherwise drops the current attach and starts a fresh attach to the same `chosenInstanceName`. See [Force reconnect](connection.md#force-reconnect).

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

A separate `<input>` row at the bottom is wired for *line-submit* style messaging — Enter sends `<text>\n` to the container's stdin and clears the field. Use whichever feels more natural; the terminal accepts both.

### Input row

> Screenshot — input field at bottom of the chat view, user mid-message.
<p align="center">
  <img src="../assets/session-view-input.png" alt="Chat view input row at bottom — text field with placeholder, user typing a message" width="800" />
</p>

- `aria-label="Message"` — placeholder is not a substitute for an accessible name in some browser/AT combinations.
- Disabled when not Connected; on the disabled→enabled transition the input auto-focuses so you can start typing immediately on reconnect.
- **Enter** submits, **Shift+Enter** is reserved for future multi-line composition (currently inserts a newline without sending).

## File-menu file prefill

Right-click any file in the file explorer → **Insert into chat**. Hashi:

1. Opens the chat view if it isn't open already.
2. Inserts `@<vault-relative-path> ` at the input's caret position (or appends if the input is empty).
3. Strips control characters (`\n`, `\r`, `\0`) from the path so they cannot disrupt Tomo's terminal — escape sequences would render visibly inside the running TUI.

Pattern: ask Tomo to look at a file by referencing it explicitly rather than pasting its contents.

## State transitions

The chat view subscribes to `connectionStore`. Indicator + input + Force-reconnect button update on every transition:

| State | Indicator class | Input | Force-reconnect |
|---|---|:-:|:-:|
| `attaching` | `is-attaching` | disabled | enabled if name set |
| `connected` | `is-connected` | enabled, focused on edge | enabled if name set |
| `reconnecting (N)` | `is-reconnecting` | disabled | enabled if name set |
| `disconnected` | `is-disconnected` | disabled | enabled if name set |

On reconnecting → connected, a sticky `— Reconnected (gap)` suffix is appended to the indicator label until you type something. The signal is intentional: while Hashi was reconnecting, container output between the disconnect and the reconnect was lost — you may have missed bytes, and acknowledging by typing clears the suffix.

## Resize behaviour

ResizeObserver on the terminal host triggers a debounced (`150 ms` trailing) `fit()` call. Fit re-measures the host element, recomputes the cell grid, and pushes the new geometry through to the container PTY via `POST /containers/{id}/resize`. This keeps Tomo's TUI from drawing into stale cells when you resize the Obsidian pane.

A separate `disconnected → connected` edge in the indicator's render loop fires an unconditional fit + resize push — the container starts at the docker-run default 80×24 and xterm's `onResize` doesn't fire on attach unless dimensions change, so we do it explicitly.

## Lifecycle and cleanup

- One View instance per leaf. `onOpen` builds the DOM; `onClose` drains the connection-store subscription, the xterm `onData` / `onResize` disposables, the ResizeObserver, the resize-debounce timer, and the terminal session itself (which flushes any queued bytes synchronously before disposing).
- Plugin `onunload` detaches every chat-view leaf so a reload doesn't leave dangling leaves talking to a disposed connection.

## See also

- [Connection](connection.md) — picker, reconnect schedule, force-reconnect semantics
- [Status bar 友](connection.md#status-bar-) — three-state icon + popover
