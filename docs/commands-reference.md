# Commands Reference

Every command Hashi contributes to the Obsidian command palette. Open the palette
with `Ctrl/Cmd+P` and type **MiYo Tomo Hashi** to filter to just these entries —
they all appear under that prefix.

## Commands

| Command | Description | Preconditions | Default hotkey |
|---|---|---|:-:|
| **Show chat window** | Opens the [Session View](session-view.md) attached to a Tomo container. The view is a singleton — if it's already open, this focuses it instead of spawning a duplicate. | None. If no Tomo instance has been chosen yet, the picker modal opens first. | None |
| **Reconnect to *&lt;name&gt;*** | Drops the current attach and starts a fresh one to the chosen Tomo instance. | A Tomo instance must have been chosen. If none is, it shows the Notice *"No Tomo instance chosen — open Settings → Connect."* and does nothing. | None |
| **Execute instructions document** | Runs the [instruction executor](instruction-executor.md). With an `_instructions.json` (or its `.md` peer) active, runs that single set; otherwise (a suggestions doc, a plain note, or nothing active) opens a picker over your inbox's `*_instructions.json` — a "run the whole inbox (batch)" entry plus one entry per doc. Empty inbox shows a Notice. | None — behaviour depends on the active file. | None |
| **Open Tomo editor** | Opens either the [Suggestions Editor](suggestions-editor.md) or the [Garden-Audit Editor](garden-audit-editor.md), dispatched by the active file's suffix. A `_garden-audit.json` (or its `.md` peer) active opens the Garden-Audit Editor; a `_suggestions.json` (or its `.md` peer, incl. the `-fan` Force-Atomic Resolve variant) active opens the Suggestions Editor. Anything else opens a combined picker over every run of either kind in the vault. If none exist, shows *"No Tomo runs found — open a `_suggestions.json` or `_garden-audit.json` (or its .md) first"*. | None — behaviour depends on the active file. | None |
| **Toggle IDE bridge** | Starts or stops the [Tomo context](context.md) server (the command and its Notices use the internal name *"IDE Bridge"*). On start, shows *"IDE Bridge started on :&lt;port&gt;"*; on stop, *"IDE Bridge stopped"*. | None. The port defaults to **23027** and is configurable in Settings (locked while the bridge is running). | None |

## Notes

- **The Reconnect command renames itself.** Its label tracks the connection state —
  *"Reconnect to &lt;instance name&gt;"* once an instance is chosen, or *"Reconnect to
  Tomo"* before then. Searching `Reconnect` in the palette finds it regardless of which
  instance is active.
- **No default hotkeys.** None of these commands ship a bound hotkey. Assign your own
  under **Settings → Hotkeys** (search for *MiYo Tomo Hashi*).
- **Not everything is a palette command.** Some actions are reached elsewhere: the
  status bar 友 popover ([Open chat](chat.md#status-bar-)), and the right-click file
  menu entries *"Open Tomo chat with @file reference"* ([Session View](session-view.md#file-menu-file-injection))
  and *"Execute instructions…"* ([instruction executor](instruction-executor.md#triggering-a-run)).
  Those are context-menu items, not command-palette commands, so they don't appear in
  this list.
