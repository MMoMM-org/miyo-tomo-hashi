# Tomo context

How Hashi gives Claude Code — running inside your Tomo container — live ambient editor context (active file, cursor position, current selection) over a loopback WebSocket.

This is **Component B**. It is independent of the [Session View](session-view.md) and the [Instruction Executor](instruction-executor.md) — you can enable it without ever opening the chat tab.

## At a glance

- **Loopback only** — the server binds `127.0.0.1:{port}` (default **`23027`**). It is not reachable from any other host.
- **Disabled by default** (`ideBridgeEnabled: false`). It does nothing until you turn it on.
- **Auth-gated** — every connection must present the `x-claude-code-ide-authorization` token *before* the WebSocket handshake completes. Wrong or missing token → HTTP 401.
- **Ephemeral** — selection text is streamed live and never logged or persisted by Hashi.
- **Hashi writes no lock file** — the discovery lock file lives inside the container and is written by Tomo. Hashi owns only the server and the token.

## Enable it (Hashi side)

**Settings → MiYo Tomo Hashi → Tomo context.**

| Control | What it does |
|---|---|
| **Status** | Live state — `Stopped` / `Running on 127.0.0.1:{port} — N client(s)` / `Error: {reason}`. |
| **Enable** | Master toggle. On → starts the server and generates the auth token on first enable. Off → stops the server and disconnects any client. |
| **Port** | Editable while stopped; **locked while running**. Must be 1024–65535 and **not 23026** (reserved for [Kado](https://github.com/MMoMM-org/miyo-kado)). Default `23027`. |
| **Auth token** | The `hashi_<UUID>` token in cleartext, with **Copy** and **Regenerate**. Regenerating disconnects current clients and requires re-copying the new value into Tomo. |

The token is stored cleartext in `data.json` by design — it ends up cleartext in Tomo's lock file anyway, so masking would protect nothing. See [Configuration](configuration.md) for where settings are persisted.

## Wire up Tomo (container side)

After enabling the bridge, copy **two values into your Tomo setup: the token and the port**. They must match on both sides.

Tomo then does three things inside the container:

1. **Writes the discovery lock file** at `~/.claude/ide/{port}.lock` containing the port and the `authToken` you copied. Claude Code reads this on startup to discover the IDE server.
2. **Runs a socat proxy** so the container's loopback reaches the host where Hashi listens:
   ```bash
   socat TCP-LISTEN:{port},fork,bind=127.0.0.1,reuseaddr TCP:host.docker.internal:{port} &
   ```
3. **Sets the integration env vars** so Claude Code looks for the IDE server:
   ```bash
   -e CLAUDE_CODE_SSE_PORT={port}
   -e ENABLE_IDE_INTEGRATION=true
   ```

Use the **same `{port}` everywhere** — Hashi's `ideBridgePort`, Tomo's socat listen/target port, the lock file, and `CLAUDE_CODE_SSE_PORT`. A mismatch is the most common cause of a failed connection (see [Troubleshooting](#troubleshooting)).

> The Tomo-side wiring (socat, env vars, lock-file generation) lives in the Tomo repo. Hashi's only stake is that the token in the lock file matches Hashi's token and the port matches Hashi's server.

## How the connection works

```
Obsidian (host)                         Tomo container
┌────────────────────────┐              ┌───────────────────────────────┐
│ Hashi context           │              │ Claude Code CLI               │
│ ws 127.0.0.1:23027 ◄────┼──────────────┼─ socat 127.0.0.1:23027        │
│   ▲ token check (401)   │  host.docker │     → host.docker.internal    │
│   │                     │  .internal   │   reads ~/.claude/ide/        │
│ CodeMirror selection ───┘              │        23027.lock (Tomo-written)│
└────────────────────────┘              └───────────────────────────────┘
```

1. Claude Code reads `~/.claude/ide/{port}.lock` → gets the port + token.
2. It opens a WebSocket to `127.0.0.1:{port}` inside the container; socat forwards that to `host.docker.internal:{port}` on the host.
3. Hashi validates the `x-claude-code-ide-authorization` header **on the HTTP upgrade**. Mismatch → `401` and the socket is destroyed before any handshake. Match → `101 Switching Protocols`, client registered.
4. As you move the cursor or change a selection in a Markdown editor, Hashi broadcasts a `selection_changed` notification (debounced 100 ms, vault-relative path, ≤100 KB text). Claude Code surfaces it as `⧉ Selected N lines from <file>` and reads the file via `kado-read` when it needs the content.

## Troubleshooting

### `socat … Connection refused` — nothing is listening on the host

```
socat[1769] E connect(5, AF=2 <host-gateway-ip>:23027, 16): Connection refused
```

This is a **TCP-level** failure: socat reached the host but **nothing accepted the connection on that port**. It is *not* a token problem — a wrong token connects fine and then gets rejected with a 401 (see below). "Connection refused" means one of:

| Cause | Check / fix |
|---|---|
| **Tomo context is disabled** in Hashi | Settings → Tomo context → **Enable** is off, or Status shows `Stopped`. Turn it on. |
| **Port mismatch** between Tomo and Hashi | The port in Tomo's socat command / `CLAUDE_CODE_SSE_PORT` / lock file must equal Hashi's `ideBridgePort`. A custom port on one side and the default `23027` on the other produces exactly this error. Align them. |
| **Obsidian / Hashi not running** | The host server only exists while Obsidian is open with the plugin loaded and the bridge enabled. |
| **Bridge errored on start** | Settings Status shows `Error: port {p} in use` — another process holds the port. Pick a free port (remember to update Tomo too). |

### HTTP `401` — wrong or missing token

If socat connects but Claude Code still can't attach, the token doesn't match. Hashi rejects the upgrade with `401 Unauthorized` and logs the rejected token (`[hashi/ide] auth rejected: …`) with **Debug logging** on. Fix by re-copying Hashi's current **Auth token** into Tomo — and note that **Regenerate** mints a new token, so any container still holding the old one must be updated.

> Quick discriminator: **Connection refused** = nothing listening (port/enable problem). **401 / handshake failure** = listening but token rejected.

### Where Tomo's IDE logs live

Claude Code writes its IDE-integration (MCP) logs **inside the Tomo container**, under the Tomo home:

```
<tomo-home>/.cache/claude-cli-nodejs/-<path-to-instance>/mcp-logs-ide/
```

- `<tomo-home>` — the home of the user running Claude Code in the container (e.g. `/home/tomo`).
- `-<path-to-instance>` — the working directory of that Claude Code instance with `/` replaced by `-` (e.g. a session in `/home/tomo/workspace` becomes `-home-tomo-workspace`).

These logs record the discovery attempt, the socat/WebSocket connection, and the auth result — they are the first place to look when the bridge won't connect. Hashi's own side logs to the **Obsidian developer console** (`Cmd/Ctrl+Shift+I`) with the `[hashi/ide]` prefix when **Debug logging** is enabled.

## See also

- [Configuration](configuration.md) — settings reference, where `data.json` lives
- [Chat](chat.md) — the Docker attach for the chat view (branch A; independent of the bridge)
- [Privacy](../PRIVACY.md) — what the bridge sends and what it never logs
