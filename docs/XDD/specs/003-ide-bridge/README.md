# Specification: 003-ide-bridge

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-05-27 |
| **Current Phase** | Implemented |
| **Last Updated** | 2026-05-30 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | 15 active features (F2 removed → Tomo owns the lock file; F1, F3–F16), all user comments + Kokoro §5 resolved |
| solution.md | completed | 8 ADRs (ADR-8 superseded — lock file moved to Tomo); layered Component C design, full directory map + interface specs. Under user review. |
| plan/ | completed | All 5 phases implemented (Phases 1–3 prior; Phases 4–5 this session). 1106 tests green, build + lint clean. Per-task TDD-guardian → implement → spec-compliance → code-quality pipeline. |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

## Scope

Hashi IDE Bridge — ambient editor context for Tomo via the Claude Code IDE protocol. Implements a WebSocket server (127.0.0.1:23027) as a Session View subsystem that broadcasts real-time editor state (active file, cursor position, text selection) to Claude Code running inside a Tomo Docker container.

Approved in Kokoro ADR-019. Constraints: localhost-only, auth-gated, single purpose (IDE protocol only), no vault I/O (Kado handles that), fixed port 23027.

### In scope

- WebSocket server on 127.0.0.1:23027 (RFC 6455, JSON-RPC 2.0)
- Auth token generation + validation (x-claude-code-ide-authorization header); token displayed for the user to copy into Tomo
- `selection_changed` broadcast (active file path + cursor/selection, debounced)
- `getCurrentSelection` / `getLatestSelection` tools (CLI-internal, not model-visible)
- `getOpenEditors` tool (F11 — lists open markdown tabs, CLI-internal)
- `openFile` tool (Claude asks Obsidian to open a note)
- `getWorkspaceFolders` — real handler that always returns an empty array (Kokoro ADR-019 §5), not a stub
- Protocol stubs (no-op acknowledgments): `getDiagnostics`, `checkDocumentDirty`, `saveDocument`, `close_tab`, `closeAllDiffTabs`
- Ping/pong keepalive (30s)
- Settings UI: port config, auth token display/copy, enable/disable toggle
- Vault-relative paths throughout (matches Kado path scheme)

### Not in scope

- Vault file I/O (Kado's domain: kado-read, kado-write, kado-search, kado-delete)
- Open notes listing (Kado: kado-open-notes)
- Diff view / openDiff — not registered (executor handles batch ops; Kado handles writes)
- Actual document-saving — Obsidian auto-saves; `saveDocument` is registered only as a no-op stub acknowledgment (see In scope), it performs no save
- executeCode — not registered (not applicable; no REPL)
- Lock file generation — Tomo writes the discovery lock file inside the container (from the user-copied token + port); Hashi writes none (ADR-8 superseded; F2 removed)
- Tomo Docker-side wiring (setup script, socat proxy, container lock file — separate Tomo handoff)

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-27 | Spec scaffolded, starting PRD | ADR-019 approved by Kokoro. Implementation scope clear from brainstorm + ADR decisions. |
| 2026-05-27 | Agent Team mode for research | 6-perspective parallel research (Requirements, Technical, Security, Performance, Integration, UX). Complex domain: WebSocket protocol + Obsidian API + Docker networking + security. |
| 2026-05-27 | Add getOpenEditors to tool scope | Full protocol has 12 tools; getOpenEditors is useful and simple. Stubs for rest. |
| 2026-05-28 | Auth token in data.json, cleartext, `hashi_<UUID>` (reverses 05-27 call) | Per user + Kado ADR-5/ADR-6 precedent. Token must be cleartext in the lock file for the protocol to work, so separate-file storage/masking protects nothing (no named threat actor). Synced token is inert on other devices. No masking; copy + regenerate (confirm dialog). |
| 2026-05-28 | Broadcast carries both absolute + vault-relative path | **[SUPERSEDED 2026-05-28 by the Kokoro ADR-019 §5 row below — final decision: PLAIN vault-relative only, no absolute path.]** Absolute satisfies protocol compliance; vault-relative lets Claude call kado-read directly. Answers "how does Claude reach the full file" — via Kado, routed by Tomo instructions. |
| 2026-05-28 | Status via existing color-coded status-bar kanji | Reuse existing kanji approach (+ port in tooltip), not a bespoke widget. Connection-presence only; cannot identify a specific Tomo instance in v0.1. |
| 2026-05-28 | Port editable only when bridge stopped (Kado flow) | Matches Kado enable/disable UX. Failed-auth log includes the rejected token (not a secret); remote address omitted (always 127.0.0.1 via socat). |
| 2026-05-28 | PRD approved, starting SDD | All 8 user comments resolved, document consistent. Token decision reversed to Kado precedent. Proceeding to technical design. |
| 2026-05-28 | ADR-1: hand-rolled RFC 6455 WebSocket | Zero new deps (Constitution L1/L2). Proven by obsidian-claude-ide + claudecode.nvim. Protocol uses only TEXT + ping/pong. User confirmed. |
| 2026-05-28 | ADR-6: extend 友 indicator for IDE status | **[SUPERSEDED 2026-05-28 by the "combined session health" row below — final decision: NO indicator dot; 友 kanji color = combined worst-state.]** Color the 友 indicator dot + popover line ("IDE Bridge: connected(N) :port") + "Copy auth token" action. No new status-bar widget. User confirmed. |
| 2026-05-28 | SDD complete (ADR-2/3/5/8 follow repo conventions) | src/ide-bridge/ Component C; Store<T> reuse; CM6 updateListener + 100ms debounce; ~~manage only our own port's lock file~~ **[SUPERSEDED — Hashi writes NO lock file; Tomo owns it (ADR-8 superseded, see row below)]**. Kado settings UX mirrored. |
| 2026-05-28 | Kokoro ADR-019 §5 applied (vault path resolution) | Binding contract from `_inbox/from-kokoro/2026-05-28...vault-path-resolution`. Reversed ADR-7 dual-path: emit PLAIN vault-relative paths, EMPTY workspaceFolders (lock file + getWorkspaceFolders), no custom path-field extensions (§2.3). Resolution is Tomo-side (CLAUDE.md → kado-read). Dropped the additive vaultRelativePath field. PRD F2/F5/F8 + SDD ADR-7/SelectionChangedParams/LockFile/tool registry updated. |
| 2026-05-28 | SDD review (user): lock file → Tomo; ADR-8 superseded | Per user (Tomo already coding it). Hashi writes NO lock file; Tomo generates the container lock file from copied token + port. Removed lockFile.ts + LockFile entity; F2 removed (numbering kept). Consequences: no host-side `claude --ide`, manual token re-copy on regenerate. **Supersedes ratified ADR-019 §6** → amendment handoff raised: `_outbox/for-kokoro/2026-05-28_hashi-to-kokoro_ide-bridge-lock-file-ownership.md`. |
| 2026-05-28 | SDD review (user): 友 kanji = combined session health | No indicator dot. 友 kanji color = worst-state across Docker + IDE Bridge (error > reconnecting/disconnected > connected). StatusBarIcon subscribes both stores. Details + Copy-token in the popover. ADR-6 updated. |
| 2026-05-28 | Kokoro ratified lock-file ownership as ADR-019 §6 | Amendment accepted: Tomo writes the container lock file, Hashi none. Refinement: **no 0600 hardening** (single-user FS + cleartext token by design — no named threat). Removed two stale 0600 claims. Kokoro raised the Tomo handoff (not duplicated). ADR-019 §6 now matches the spec — no longer divergent. |
| 2026-05-28 | PLAN drafted (5 phases, 25 tasks) | Dependency-ordered bottom-up: (1) protocol/transport primitives, (2) editor adapter+tools+selection tracker, (3) wsServer+IdeBridge orchestrator, (4) settings/UI/commands/main.ts wiring, (5) e2e protocol tests + PRIVACY/README + full validation. Grounded in verified existing patterns (Store<T>, ConnectionState, Kado ApiKeyTab/GeneralTab, obsidian alias mock). All F1/F3–F16 traced; F2 absent (no lock file). |
| 2026-05-30 | Phase 4 implemented (T4.1–T4.6) | Settings schema + v1→v2 migration, ConfirmModal, IDE-bridge settings section (enable/port-lock/token copy+regenerate), 友 combined worst-state status + popover, Toggle IDE bridge command, IdeBridge lifecycle wired into main.ts (CM6 selection tracking, start-if-enabled, LIFO teardown). Per-task TDD pipeline. Incident: a code-quality amend dropped an unstaged file (StatusBarIcon copyAuthToken) → committed tree broke; caught + remediated (`90e708c`); lesson recorded to memory. |
| 2026-05-30 | T5.1a protocol correction: tools/call dispatcher | **During T5.1 e2e the server was found to route tools as DIRECT JSON-RPC methods with no `tools/call` handler — contradicting the SDD (lines 172/341/501/652-666) and the claudecode.nvim reference (verified: real client sends `tools/call {name,arguments}` and expects `{content:[{type:text,text}]}`).** A real Claude Code client would have received -32601 for every tool. Implementation brought into compliance with the already-correct SDD: single `tools/call` dispatcher, MCP content envelope, unknown tool → -32602, openFile traversal → -32602 preserved, direct tool-name methods removed (→ -32601). No SDD change. User chose "fix now". |
| 2026-05-30 | Performance NFRs verified by-construction (deliberate gap) | `<200ms` editor-change→frame, `<1MB` overhead, no measurable typing latency are NOT asserted by a latency/memory measurement test in v0.1. They are satisfied by-construction (100ms trailing debounce + JSON dedup + 100KB text cap + async socket I/O off the CM6 update path + the proven obsidian-claude-ide reference). Recorded explicitly so the absence of a perf-measurement test is acknowledged, not silent (per SDD Quality Requirements). |
| 2026-05-30 | Phase 5 complete + release gate green (T5.1/T5.1a/T5.2/T5.3) | 18-scenario e2e protocol suite (auth/handshake/tools-via-tools-call/broadcast/keepalive/lifecycle); PRIVACY.md corrected (stale "zero inbound surfaces" claim fixed) + README IDE Bridge section; full validation: 1106 tests + build + lint green, all F1/F3–F16 traced, security gates (loopback-only hard guard, 401-pre-handshake, no selection in logs, no fs write), zero new runtime deps. `/validate` drift sweep: 6 PASS / 0 WARN / 0 FAIL — implementation matches PRD↔SDD↔Plan. |
| 2026-05-30 | Implementation complete | Phases 4-5 implemented on feat/xdd-003-ide-bridge (commits 665666a..c70e03a). Delivered: IDE settings fields + v1→v2 migration, ConfirmModal, IDE-bridge settings section (enable/port-lock/token copy+regenerate), 友 combined worst-state status + popover, Toggle IDE bridge command, IdeBridge lifecycle wired into main.ts (CM6 selection tracking + LIFO teardown), 18-scenario e2e protocol integration suite, T5.1a MCP tools/call protocol fix (server previously had no tools/call dispatcher — would have -32601'd every real tool call), PRIVACY.md + README IDE Bridge documentation. Release gate: 1106 tests + build + lint green; /validate drift sweep 6 PASS / 0 WARN / 0 FAIL; all PRD F1/F3-F16 traced; perf NFRs verified by-construction (recorded). Not yet merged to main (PR pending). |

## Sources

- Claude Code IDE integration docs: https://code.claude.com/docs/en/ide-integrations
- Neovim reference implementation (full protocol): https://github.com/coder/claudecode.nvim
- Obsidian community implementation: https://github.com/petersolopov/obsidian-claude-ide
- Kokoro ADR-019: IDE Bridge approved as Session View subsystem
- Hashi→Kokoro handoff: `_outbox/for-kokoro/2026-05-27_hashi-to-kokoro_ide-bridge-adr-proposal.md`
- Hashi→Tomo handoff: `_outbox/for-tomo/2026-05-27_hashi-to-tomo_ide-bridge-docker-wiring.md`

## Context

The IDE Bridge fills the gap between Kado (vault access) and the Tomo Docker container (Claude Code). Today, the user must explicitly reference files via @-mentions or the file-menu action. With the IDE Bridge, Claude Code receives ambient editor context on every prompt — which file is open, what text is selected — without any user action. File access continues through Kado's permission chain.

The protocol is reverse-engineered from the VS Code extension and documented in the Neovim reference implementation. Key insight: most IDE tools are CLI-internal RPC, not model-visible. Only `getDiagnostics` and `executeCode` reach the model. The primary value is the automatic `selection_changed` notification that the CLI injects into prompt context.

---
*This file is managed by the xdd-meta skill.*
