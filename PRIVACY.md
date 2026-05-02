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
- **Zero inbound surfaces.** Hashi opens no ports, runs no servers,
  registers no MCP endpoints, and accepts no external connections.
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

**None.** Hashi does not open any port, run any server, register any
HTTP/MCP endpoint, expose any IPC, or accept any external connection
of any kind.

## Persisted data

| Item | Where | Notes |
|---|---|---|
| Plugin settings (`PluginSettings`) | `data.json` in the plugin directory via `plugin.saveData()` | Includes `chosenInstanceName`, `tomoInboxFolder`, `hooksDir`, `executionMode`, `hooksPolicy`, `runLogRetention`, `debugLogging`, `zoomLevel`, `settings_version`. **No secrets, no credentials, no vault content.** |
| Run logs | Vault file in your Tomo inbox folder (`tomo-hashi-run-log_*.md`) | Per-run audit trail. **Metadata only** — paths, action IDs, outcome kinds, durations. Pre-fix used to leak `line_to_add` / tracker `value` content into the `summary` column; closed in spec-002 review H1. Verified by `test/unit/executor/planner.test.ts`. |
| Hook session decisions | In-memory only (HookRunner) | "Enable for session" / "Disable" choices live in the runtime map and are cleared on plugin reload. Never persisted. |

### Privacy regression guard

`test/unit/connection/no-chat-content-logged.test.ts` runs in every
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

## What Hashi does *not* do

- Send any data to Anthropic, Obsidian, GitHub, or any third party
- Auto-update, phone home, or check for new versions
- Read or write outside the configured vault (deny-list enforces
  `.obsidian/`, `.git/`, `.trash/`, the configured hooks dir, and any
  path that escapes the vault root — see `src/util/paths.ts`)
- Open inbound network sockets of any kind
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

*Last reviewed: 2026-05-02 (review/spec-001-fixes — Constitution L1
Privacy & Security gap closed).*
