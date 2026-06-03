# Chat

How Hashi finds, attaches to, and reconnects to a Tomo Docker container.

## Picking a Tomo instance

> Screenshot — instance picker modal listing running Tomo containers with `<name> — started <uptime>` rows.
<p align="center">
  <img src="../assets/instance-picker.png" alt="Instance picker modal — list of running Tomo Docker containers, one row each" width="600" />
</p>

The picker (`InstancePickerModal`) opens on demand:

- From **Settings → Tomo chat → Connect** (when disconnected)
- From the [status-bar 友 popover](#status-bar-) → "Open chat" if no instance has ever been chosen

Hashi calls Docker's `GET /containers/json?filters={"label":["miyo.tomo.role=session"]}` to enumerate. Each row shows:

- **Label** — the value of the `miyo.tomo.instance-name` label, or the container's short ID as a fallback.
- **Uptime** — derived from `Container.State.StartedAt`.

Clicking a row triggers `connection.connect(instance)` — the modal closes immediately and the [status bar](#status-bar-) and [chat-view header](session-view.md#header) reflect the attach progression.

### Empty state

If no Tomo container is running, the modal shows:

> *No Tomo instance seems to be running — start one and try again.*

Same copy is rendered when Docker returns an explicit no-instances error so the message is identical regardless of cause.

### Failure surface

If `GET /containers/json` errors (Docker daemon not running, permission denied, etc.), the picker renders the failure detail inline rather than bouncing to a Notice. The user stays in the modal and can retry by closing and reopening it.

## Attach mechanics

`TomoConnection` opens a streaming HTTP upgrade to `POST /containers/{id}/attach?stream=1&stdin=1&stdout=1&stderr=1`. Once the upgrade completes, the underlying socket carries:

- **Inbound:** raw stdout + stderr from the container (multiplexed via Docker's frame header — Hashi parses and forwards bytes to xterm)
- **Outbound:** raw stdin — Hashi's `connection.write(data)` writes directly to the upgraded socket

Geometry sync runs over a *separate* HTTP call: `POST /containers/{id}/resize?h=<rows>&w=<cols>` whenever xterm resizes. This is independent of the attach stream and uses a fresh request each time.

## Auto-reconnect on load

When Obsidian loads the plugin and `chosenInstanceName` is set, Hashi:

1. Shows a Notice — `Auto-connecting to '<name>' from saved session`.
   Reason: Obsidian Sync replicates `data.json` across devices. The auto-attach lands on whichever local container matches the synced label — potentially unrelated to the container the user originally saved on. The Notice gives a visible signal of *which* instance was just connected.
2. Calls `conn.autoReconnectIfRemembered()` fire-and-forget. The reconnect loop drives the state machine; the chat view (if open) renders the transitions.

If no container with the saved name is found, the connection settles in `disconnected` with `reason.detail` describing why. The user can pick a different one from the picker.

### <a name="sync-warning"></a>Obsidian Sync warning

`chosenInstanceName` lives in `<vault>/.obsidian/plugins/miyo-tomo-hashi/data.json`. If Obsidian Sync is enabled, the file replicates across devices.

- **Same-machine reload:** auto-reconnect lands on the right container — the labels match.
- **Different machine:** auto-reconnect tries to attach to a container with the same label name on the *new* machine. If a container with that label happens to exist there, you get connected to it — possibly to a totally different Claude Code session than the original. The Notice on load surfaces the label that's about to be re-attached so you can detect a wrong-container connect.

Workaround: pick instances per device (the picker's no-instance message will say so), and ignore the saved name when switching machines by clicking Disconnect first.

## Reconnect schedule

When the attach stream drops mid-session (container restart, Docker daemon hiccup, OS sleep), `ReconnectLoop` runs a fixed backoff:

| Attempt | Delay before attempt | Cumulative |
|---|---:|---:|
| 1 | 500 ms | 500 ms |
| 2 | 1000 ms | 1500 ms |
| 3 | 2000 ms | 3500 ms |
| 4 | 4000 ms | 7500 ms |
| 5 | 8000 ms | 15500 ms |

Total budget: **15.5 s**. After the 5th failed attempt, state transitions to `disconnected` with `reason.detail = "exhausted"`. No further retries until the user clicks **Force reconnect** or selects an instance from the picker.

Cancellation of the loop (via `Disconnect` or `Force reconnect`) resolves the pending `wait()` promise immediately so the loop's cancellation check fires at the head of the next iteration — without that, a Disconnect during a 8 s wait would leave the loop dangling for up to 8 seconds.

## Force reconnect

Available from:

- **Chat view header → Force reconnect button** (disabled if no instance has been chosen yet)
- **Status bar 友 → popover → Force reconnect**
- **Command palette → "MiYo Tomo Hashi: Reconnect"** — disabled label when no name set

Behaviour: cancel any in-flight reconnect loop, drop the current attach, start a fresh attach against `chosenInstanceName`. Useful when the container has been stopped+started and the existing attach went stale.

## Status bar 友

> Screenshot — status-bar 友 icon in three states (connected / reconnecting / disconnected). Composite or individual screenshots both fine.
<p align="center">
  <img src="../assets/status-bar-tomo.png" alt="Status bar 友 icon in three states — green dot (connected), yellow pulse (reconnecting), gray (disconnected)" width="480" />
</p>

The 友 (Tomo) glyph in the Obsidian status bar communicates connection state via three CSS classes:

| Class | When | aria-live |
|---|---|---|
| `is-connected` | state = `connected` | `polite` |
| `is-reconnecting` | state = `reconnecting` or `attaching` | `polite` |
| `is-disconnected` | state = `disconnected` | `assertive` — unexpected drops are the only state SR users must hear immediately |

Tooltip / `aria-label`:

- Connected → `Tomo: <name>` (or `Tomo: connected` if no name)
- Reconnecting → `Reconnecting…`
- Attaching → `Connecting…`
- Disconnected → `Tomo: disconnected`

Clicking opens a three-action popover; Enter and Space mirror the click for keyboard activation.

> Screenshot — the popover triggered by clicking 友, showing three rows: Force reconnect / Open chat / Open settings.
<p align="center">
  <img src="../assets/status-bar-tomo-popover.png" alt="Status bar 友 popover — Force reconnect (disabled when no instance), Open chat, Open settings" width="320" />
</p>

The **Force reconnect** entry is disabled when no `chosenInstanceName` has been saved yet — same parity as the chat-view header button (PRD F3 / AC5).

## State machine

```
   ┌─────────────┐
   │ disconnected│ ◄────────────────────────┐
   └──────┬──────┘                          │
          │ user picks instance / auto      │ exhausted / user disconnect
          ▼                                  │
   ┌──────────────┐  attach fails    ┌──────┴───────┐
   │  attaching   │ ───────────────► │ reconnecting │
   └──────┬───────┘                  └──────┬───────┘
          │ attach ok                       │ next attempt
          ▼                                  │
   ┌──────────────┐                         │
   │  connected   │ ─── stream drops ───────┘
   └──────────────┘
```

`connectionStore` is the single source of truth for this state. Both the chat view and the status-bar 友 subscribe to it; nothing else writes to it (per ADR-4). UI components compute derived values inline.

## See also

- [Session View](session-view.md) — chat tab, terminal, input row
- [Configuration / Tomo chat](configuration.md#a--tomo-chat) — settings reference
- [Tomo context](context.md) — give Tomo your active file + selection (opt-in, off by default)
- [Privacy](../PRIVACY.md) — what leaves the local machine and what doesn't (spoiler: nothing)
