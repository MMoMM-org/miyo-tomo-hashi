# How It Works

Hashi is two independent components living inside one Obsidian plugin. They share nothing at runtime — different code paths, different state, different status-bar icons.

```
┌────────────────────────────────────────────────────────────┐
│                  Obsidian (desktop only)                    │
│                                                             │
│  ┌──────────────────────┐     ┌─────────────────────────┐  │
│  │ A. Tomo Session GUI  │     │ B. Instruction Executor │  │
│  │  (status bar 友)      │     │  (status bar 橋)         │  │
│  │                       │     │                         │  │
│  │ Chat view ←→ xterm   │     │ Reads _instructions.json│  │
│  │ Docker container     │     │ Validates → preview     │  │
│  │ attach / reconnect   │     │ Executes via Vault API  │  │
│  └──────────┬───────────┘     └────────────┬────────────┘  │
│             │                              │                │
│             ▼                              ▼                │
│   Docker socket (Unix)              Obsidian Vault API     │
│   /var/run/docker.sock               vault.create / move / │
│   → running Tomo container           process / trash …    │
└────────────────────────────────────────────────────────────┘
```

## A — Tomo Session GUI

The Session View (chat tab + status-bar 友 icon) is a thin wrapper over a running [Tomo](https://github.com/MMoMM-org/miyo-tomo) Docker container. Hashi attaches to the container's stdio over the Docker socket; xterm.js renders the bidirectional stream.

- **Transport:** Docker `/containers/{id}/attach` HTTP upgrade. v0.1 has no TLS, no MCP, no custom protocol — just raw container stdin/stdout/stderr.
- **Discovery:** `Plugin → addStatusBarItem (友)` lists running containers labelled `miyo.tomo.*` via `GET /containers/json`. The user picks one in the picker modal.
- **Reconnect:** fixed-schedule backoff (5 attempts: 500/1000/2000/4000/8000 ms). The persisted `chosenInstanceName` survives container stop+start, so a Hashi reload finds the same container by name.
- **No vault writes from this side.** The session view is read-only with respect to your vault — it only renders bytes from a container.

Details: [Session View](session-view.md), [Connection](connection.md).

## B — Instruction Executor

The executor (modal + status-bar 橋 icon) reads `_instructions.json` files emitted by Tomo, validates them against a vendored JSON Schema, and runs each action against your vault through Obsidian's Vault API.

- **Trigger:** explicit user action only — command palette, file-menu, or right-click on the `.md` peer of an `_instructions.json`. Never automatic.
- **Validation:** ajv-compiled at module load. A failed schema check stops the whole file before any write.
- **Execution:** sequential, halts on `create_moc` failure for dependent `link_to_moc` actions.
- **Idempotency:** every action records `applied: true` in the source JSON when it succeeds. Re-running a file skips already-applied actions ("partial-resume").
- **Run log:** every run produces a markdown file in the inbox folder with per-action outcomes.

Details: [Instruction Executor](instruction-executor.md), [Actions](action-reference.md), [Hooks](hooks.md), [Run Log](run-log.md).

## What Hashi does NOT do

- **No external surface.** Unlike its sibling [Kado](https://github.com/MMoMM-org/miyo-kado), Hashi opens no ports, exposes no MCP server, accepts no inbound network traffic. The Docker socket is *outbound* — Hashi initiates the connection.
- **No approval gate.** The preview modal shows what will happen but is informational, not a permission boundary. Approval lives upstream in Tomo's review step.
- **No vault rollback in v0.1.** The run log records what happened; reversing it is your responsibility.
- **No telemetry.** No crash reports, no analytics, no background network calls. See [PRIVACY.md](../PRIVACY.md).

## Path safety

Actions targeting `.obsidian/`, `.git/`, `.trash/`, the configured hooks directory, or paths that escape the vault root are rejected before any write. The deny-list is hard-coded — no setting disables it.

## Component boundaries (architecture)

| Layer | Module | Notes |
|---|---|---|
| Plugin entry | `src/main.ts` | Registers everything; double-onload-guarded |
| Connection | `src/connection/` | Docker dial, attach stream, reconnect loop |
| Chat UI | `src/ui/chat-view/`, `src/ui/status-bar/` | xterm host, status-bar 友 |
| Schema | `src/schema/` | Vendored Tomo schema + ajv validator |
| Executor | `src/executor/` | RunState store, planner, per-action handler |
| Actions | `src/actions/` | One handler per action kind (`create_moc`, `move_note`, …) |
| Hooks | `src/hooks/` | Loader, runner, disclosure modal |
| Vault adapter | `src/vault/` | `ObsidianVaultFS` (production), `FakeVaultFS` (tests) |
| Executor UI | `src/ui/ExecutionModal.ts`, `src/ui/modalContent/`, `src/ui/statusBar.ts` | Preview / progress / summary; status-bar 橋 |

Each layer has unit tests with fakes (`FakeVaultFS`, fake Docker, fake clock); the only "real Obsidian" tests are the manual-QA checklist in `docs/XDD/specs/002-instruction-executor/plan/manual-qa-checklist.md`.
