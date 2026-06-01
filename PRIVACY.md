# Privacy & Network Surfaces — MiYo Tomo Hashi

> Constitution L1 Privacy & Security: every MiYo component documents its
> network surfaces in `PRIVACY.md`. This file is the trust contract Hashi
> offers users (and Obsidian community reviewers).

## TL;DR

- **Local-first.** Hashi never makes outbound HTTPS calls. No telemetry,
  no analytics, no crash reporting, no model context shipping.
- **One outbound surface.** Hashi reaches `/var/run/docker.sock` (or
  `\\.\pipe\docker_engine` on Windows; named-pipe path is the same idea)
  to discover and attach to local Tomo containers running on **your
  machine**. That's it.
- **One opt-in inbound surface.** Tomo context (`ideBridgeEnabled`,
  **disabled by default**) opens a WebSocket server bound to
  `127.0.0.1:23027` (loopback-only, never `0.0.0.0`). It is
  auth-gated (bearer token, HTTP 401 on mismatch) and serves a single
  local consumer: Claude Code inside your Tomo Docker container, over
  loopback/socat. See [Tomo context inbound surface](#tomo-context-inbound-surface)
  below. If the bridge is disabled (the default), there is still no inbound
  surface of any kind.
- **Vault data stays in the vault.** Container stdout, hook output, and
  Tomo session content are surfaced to the active editor and the run
  log only — not persisted in plugin settings or any external store.

## Outbound surfaces

### Docker engine socket — *only outbound surface*

| Property | Value |
|---|---|
| Direction | Hashi → Docker engine |
| Transport | Unix domain socket (macOS/Linux) or named pipe (Windows) |
| Path | `/var/run/docker.sock` (Mac/Linux); `\\.\pipe\docker_engine` (Win) — hardcoded compile-time constant per ADR-1 |
| Purpose | List Tomo containers (`docker ps` w/ label filter) + attach a duplex stream to one (`docker exec --interactive --tty`) |
| Honors `DOCKER_HOST` / `DOCKER_CONTEXT`? | **No** — explicitly ignored to lock the trust boundary at the local socket. Verified by `test/unit/connection/docker.test.ts` |
| Auth | None on the wire — Docker socket access is the auth boundary (must be a member of the `docker` group on Linux, or own the `docker.sock` file on Mac) |
| Data sent over the wire | (1) label-filter `listContainers` queries, (2) keystrokes typed into the chat view, (3) terminal resize hints |
| Data received over the wire | Container stdout/stderr (the Tomo session output) |

### `dockerode` library calls only

All Docker engine RPC goes through `dockerode ^4.0.2`. The one
exception is `src/connection/dialAttach.ts`, which performs a raw HTTP
UPGRADE request (still over the same Unix socket) to bypass two
documented bugs in `docker-modem 4.0.12`. The socket path is identical;
no other transport is opened.

## Inbound surfaces

### Tomo context inbound surface

Tomo context is **disabled by default** (`ideBridgeEnabled: false`).
The user explicitly enables it in plugin settings. When disabled, no
socket is opened and this section is inert.

| Property | Value |
|---|---|
| Direction | External client → Hashi |
| Transport | WebSocket (RFC 6455), JSON-RPC 2.0 / MCP IDE protocol |
| Bind address | `127.0.0.1` **only** (loopback). `0.0.0.0` is never used. Not reachable from any other host. |
| Port | Default `23027` (user-configurable). Kado uses `23026` — different surface, different plugin. |
| Opt-in | Off by default (`ideBridgeEnabled: false`). User must explicitly enable. |
| Auth | Bearer token in the `x-claude-code-ide-authorization` HTTP upgrade header. A missing or wrong token receives HTTP 401 before the WebSocket handshake completes. |
| Token format | `hashi_<UUID>`, stored cleartext in `data.json`. Cleartext is intentional: the protocol requires the raw token value, and loopback-only + single-user filesystem means there is no named threat actor against which encryption adds defence (see spec-003 no-crypto-ceremony decision). |
| Token logging | A **rejected** token is `warn`-logged (the token string only — no remote address, because the address is always `127.0.0.1`). This is the one place a token-shaped string appears in logs, and only for a token that was already refused. Accepted connections do not log the token. |
| Intended consumer | Claude Code running inside the user's local Tomo Docker container (reached via loopback/socat). One connection at a time. No other consumer is supported. |
| No lock file from Hashi | Hashi writes **no discovery lock file**. Tomo generates the container-side discovery file from the copied token and port that the user pastes into Tomo settings. |

#### Data transmitted (server → client)

All data broadcast by the bridge is **ephemeral** — sent live to the
connected client and immediately forgotten. Nothing the bridge sends
is written to `data.json`, written to disk, or included in any log.

| Field | Description | Constraint |
|---|---|---|
| Active file path | Vault-relative path of the currently active note, e.g. `notes/plan.md` | Plain vault-relative (Kokoro ADR-019 §5). **No host-absolute path** is included. |
| Cursor position | Line + column of the editor cursor | Integer pair only, no content |
| Text selection | The text currently selected in the editor | Capped at **100 KB**. No selection → empty string. |
| Workspace folders | Always returns `[]` (empty) | Hashi does not expose the vault root path via this surface |

**No vault file content beyond the selection is sent.** Reading and
writing vault files is Kado's responsibility; the bridge carries only
the editor state the user's cursor is already showing.

Reaffirmation: Tomo context is inbound-only and loopback-only. It
does not add any outbound surface, telemetry, or analytics. The
"no telemetry / no outbound HTTPS / no third-party services" guarantees
in the TL;DR remain unconditionally true.

## Persisted data

| Item | Where | Notes |
|---|---|---|
| Plugin settings (`PluginSettings`) | `data.json` in the plugin directory via `plugin.saveData()` | Includes `chosenInstanceName`, `tomoInboxFolder`, `hooksDir`, `executionMode`, `hooksPolicy`, `runLogRetention`, `debugLogging`, `zoomLevel`, `settings_version`, `ideBridgeEnabled`, `ideBridgePort`, `ideBridgeAuthToken`. The Tomo context token (`hashi_<UUID>`) is stored cleartext by design — see auth row in the Tomo context table above. **No other credentials, no vault content.** |
| Run logs | Vault file in your Tomo inbox folder (`tomo-hashi-run-log_*.md`) | Per-run audit trail. **Metadata only** — paths, action IDs, outcome kinds, durations. Pre-fix used to leak `line_to_add` / tracker `value` content into the `summary` column; closed in spec-002 review H1. Verified by `test/unit/executor/planner.test.ts`. |
| Hook session decisions | In-memory only (HookRunner) | "Enable for session" / "Disable" choices live in the runtime map and are cleared on plugin reload. Never persisted. |

### Privacy regression guard

`test/unit/no-chat-content-logged.test.ts` runs in every
CI build. It greps the `src/connection/**` and `src/ui/chat-view/**`
trees for any `logger.<method>(..., chunk|data|stdout|stderr|...)`
call — a single such call breaks the build. This is the technical
enforcement of the "no chat content logged" guarantee.

## Hooks (user-authored Node scripts)

Hooks run in the plugin process with full plugin privileges (the
[Templater](https://obsidian.md/plugins?id=templater-obsidian) trust
model). The disclosure modal (`HookDisclosureModal`) presents the hook
file path, size, and a capability warning before first execution. The
default policy is `"ask"`; `"disabled"` is the kill switch.

`HookContext` exposes only `{ action, app, logger }` to user hook
scripts. **Hooks have no path to the Docker socket or container
stdin** — `TomoConnection` is not in the context shape (verified in
spec-002 review M1 + the security review notes).

## Plugin behavior flags (Obsidian automated review)

The Obsidian community-plugin scanner reports three capabilities in
Hashi's bundled `main.js`. All three are intrinsic to what Hashi does;
each is listed here with its exact source and the constraint that bounds
it, so reviewers and users can confirm none of them is an open-ended risk.

| Scanner flag | Where it comes from | What bounds it |
|---|---|---|
| **Direct Filesystem Access** (`node:fs`) — *Warning* | `src/hooks/FsHookLoader.ts` (discover `.cjs` hook files in the configured hooks dir) and `src/util/paths.ts` (realpath-based vault-escape guard) | **Read-only.** Only `realpathSync` / `readdirSync` / `statSync` / `realpath` are used — there is no `writeFile`, `mkdir`, `unlink`, or any other write API anywhere in `src/`. Every vault *mutation* goes through the Obsidian Vault API (`fileManager.renameFile`), never `fs`. Raw `fs` is required because hook scripts are real files the user drops into the vault, and OS-level `realpath` is the only way to detect symlink escapes the Vault API cannot see. Reads are confined to the configured hooks directory plus the path-safety checks; access is further constrained by the deny-list in *What Hashi does not do* below. |
| **Clipboard Access** — *Recommendation* | `src/ui/status-bar/StatusBarIcon.ts` and `src/settings/SettingsTab.ts` | **Write-only, user-initiated.** Both call sites are `navigator.clipboard.writeText(token)` behind an explicit "Copy" button and copy the Tomo-context auth token (`hashi_<UUID>`) so the user can paste it into Tomo. Hashi **never reads** the clipboard (`readText` appears nowhere), so the scanner's "may expose content copied from outside Obsidian" concern does not apply — nothing flows *out of* the clipboard into Hashi. |
| **Dynamic Code Execution** (`new Function`) — *Recommendation* | **Ajv** (`ajv@^8.17.1`), used in `src/schema/validator.ts` to compile the bundled, vendored Tomo instruction-set JSON schema (`src/schema/instructions.schema.json`) | The single `new Function` in the bundle is Ajv's schema-to-validator compiler operating on a **schema shipped inside the plugin** — no user-controlled string is ever compiled. Hashi's own source contains **zero** `eval` / `new Function`. This code path is the *opposite* of an arbitrary-code surface: its job is to **reject** malformed Tomo instruction JSON before any action runs. |

The capability that genuinely runs *your* code is the **hooks** feature —
user-authored `.cjs` scripts loaded via Node `require` and executed with
full plugin privileges. The static scanner does not flag it (it is
`require`, not `eval`), but it is the surface that actually warrants trust,
and it is gated by the disclosure modal and the `hooksPolicy` kill switch.
See [Hooks](#hooks-user-authored-node-scripts) above and `docs/hooks.md`.

## Release integrity (artifact attestation)

Every released `main.js`, `manifest.json`, and `styles.css` carries a
[GitHub artifact attestation](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds)
generated by the `release.yml` workflow (`actions/attest-build-provenance`).
This is GitHub-native, sigstore-backed provenance — **anyone** can verify a
downloaded asset was built from this repository's source, with no trust in a
hand-published hash:

```bash
gh attestation verify main.js --repo MMoMM-org/miyo-tomo-hashi
```

## What Hashi does *not* do

- Send any data to Anthropic, Obsidian, GitHub, or any third party
- Auto-update, phone home, or check for new versions
- Read or write outside the configured vault (deny-list enforces
  `.obsidian/`, `.git/`, `.trash/`, the configured hooks dir, and any
  path that escapes the vault root — see `src/util/paths.ts`)
- Open inbound network sockets when Tomo context is disabled (the default)
- Persist any container output, chat content, or hook output beyond
  the explicit run-log file (which is metadata-only)
- Collect telemetry of any kind

## If you need stricter isolation

- Run Tomo's Docker container in a separate user namespace, or behind
  a non-root Docker daemon (`rootless docker`)
- Set `hooksPolicy: "disabled"` to neutralize hook execution entirely
- Use the per-vault `.obsidian/plugins/miyo-tomo-hashi/data.json`
  config to isolate per-vault settings if you sync vaults selectively

## Reporting privacy issues

If you find a path that contradicts this document, please open an
issue at <https://github.com/MMoMM-org/miyo-tomo-hashi/issues> with
the file:line reference.

---

*Last reviewed: 2026-06-01 (fix/css-border-and-uuid-doc — Obsidian behavior-flag review: documented Direct Filesystem Access / Clipboard / Dynamic Code Execution flags; added release artifact attestation + verify instructions).*
