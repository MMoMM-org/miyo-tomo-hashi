# Configuration

All settings live under **Settings → MiYo Tomo Hashi**. The tab is split by component — the connection settings drive the [Session View](session-view.md), the executor settings drive the [Instruction Executor](instruction-executor.md).

> Screenshot — full settings tab with both sections collapsed for overview.
<p align="center">
  <img src="../assets/settings-tab-overview.png" alt="MiYo Tomo Hashi settings tab — Tomo connection + Instruction executor sections" width="720" />
</p>

---

## A — Tomo connection

> Screenshot — connection section, Disconnected state showing the **Connect** button.
<p align="center">
  <img src="../assets/settings-connection.png" alt="Tomo connection section in Settings — Connect button + last-used label" width="720" />
</p>

| Setting | What it does | Default |
|---|---|---|
| **Status row** | Live state from `connectionStore` — Disconnected / Attaching / Reconnecting (attempt N) / Connected to *label* | n/a |
| **Connect / Disconnect button** | Opens the [instance picker](connection.md#picking-a-tomo-instance) when disconnected; gracefully tears down when connected | n/a |
| (persisted) **`chosenInstanceName`** | Last instance label the user selected. Used for [auto-reconnect](connection.md#auto-reconnect-on-load) on plugin load. Survives Obsidian Sync — see warning in [Connection](connection.md#sync-warning). | `null` |
| (persisted) **`zoomLevel`** | Terminal zoom (0.5× / 1× / 1.5×). Set in the chat-view header, not in this tab. | `1` |

Connection state itself is **not** persisted — only the chosen-instance name. A plugin reload always re-attaches via the [auto-reconnect](connection.md#auto-reconnect-on-load) path.

---

## B — Instruction executor

> Screenshot — executor section showing all 6 controls.
<p align="center">
  <img src="../assets/settings-executor.png" alt="Instruction executor section in Settings — 6 controls: inbox folder, execution mode, run log retention, hooks dir, hooks policy, debug logging" width="720" />
</p>

| Setting | What it does | Default |
|---|---|---|
| **Tomo inbox folder** | Vault-relative path to the folder Hashi watches for `*_instructions.json` files. Path is validated against traversal (`..`), absolute paths, and Windows drive letters. Invalid input is rejected with a Notice and the previous safe value is kept. | *empty* — set this before first run |
| **Execution mode** | How the executor presents a run before applying it. See [modes](instruction-executor.md#execution-modes). | **Confirm before run** |
| **Run log retention** | `Always keep` writes a log every run; `Only after failed runs` deletes the log when zero actions failed. | **Always keep** |
| **Hooks directory** | Vault-relative path scanned for `before-*.cjs` / `after-*.cjs` hook scripts. Same path safety as inbox. | `.tomo-hashi/hooks` |
| **Hooks policy** | Master switch for hook execution. See [hooks](hooks.md#policy). | **Disabled** *(safe default — kill switch)* |
| **Debug logging** | Verbose executor + hook output to the developer console (`Cmd/Ctrl+Shift+I`). Off in production. | **Off** |

### Path safety guard

Both **Tomo inbox folder** and **Hooks directory** reject:

- Absolute paths (`/foo`, `\foo`)
- Windows drive letters (`C:`)
- `..` segments anywhere in the path
- Empty segments (`a//b`)

Rejected input shows a Notice (`Invalid path (<reason>): "<value>"`) and the field reverts to the prior safe value.

### Where it's stored

All settings live in `<vault>/.obsidian/plugins/miyo-tomo-hashi/data.json`. Obsidian Sync replicates this file across devices — the executor settings are device-agnostic, but the persisted `chosenInstanceName` may not match a container that exists on every device. See [Connection / Sync warning](connection.md#sync-warning) for the implication.

## Feature compatibility

| Feature | Requires Docker | Requires Tomo container running |
|---|:-:|:-:|
| Open chat view | ✓ | ✓ |
| Force reconnect | ✓ | ✓ |
| Status bar 友 | ✓ | — (icon shows disconnected) |
| Run instruction set (palette / file menu) | — | — |
| Status bar 橋 | — | — |
| Hooks | — | — |

The executor side has zero Docker dependency — you can use Hashi for instruction sets that another tool produced, without ever connecting to a Tomo container.

## Next

- [Session View](session-view.md) and [Connection](connection.md) — branch A
- [Instruction Executor](instruction-executor.md), [Actions](action-reference.md), [Hooks](hooks.md), [Run Log](run-log.md) — branch B
