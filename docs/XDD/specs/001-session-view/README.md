# Specification: 001-session-view

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-04-24 |
| **Current Phase** | Implementation complete — Release Gate verified (code-side) · operational gates pending (see "Release Gate Status" below) |
| **Last Updated** | 2026-04-28 |

## Release Gate Status

The release gate has two independent halves; today only the **code-side** half has passed.

| Gate half | Status | What it covers |
|-----------|--------|----------------|
| **Code-side** | ✅ PASS (2026-04-28) | Build green, 203/203 unit tests, lint clean, bundle ≤ 1000 KB (CON-7 revised 2026-04-28), manifest desktop-only verified, traceability matrix at 61/64 ✅ (3 known orphans tracked below) |
| **Operational** | ⏳ PENDING | (a) `npm run test:live` must run green in CI against a real Docker daemon — no `test:live` run has been recorded against this branch; (b) the 37-row T5.5b manual-QA checklist must be walked end-to-end against a live Tomo container — frontmatter `status: pending` is the gate, T5.9 reads it; (c) the F5.5/F8.5 continuity-gap finding (or downgraded AC) must be reconciled with implementation truth |

The 2026-04-28 code-side gate pass does **not** authorize a public release. T5.9's release-gate task remains `[ ]` until both operational halves clear; references in earlier Decisions Log entries to "Release Gate code-side passed" should be read as "passed for the code half only."

Three orphan ACs tracked in `plan/traceability.md`:
- **F1.10** (picker→connect→inspect-null→refresh) — covered by T5.5 e2e (live) + T5.5b manual-QA row.
- **F4.5** (closed-loop chat-view ↔ xterm) — covered by T5.5 e2e (live) + manual visual.
- **F8.5 / F5.5** (user informed of continuity gap after auto-reconnect) — see the 2026-04-28 review-fix Decisions Log entry below.

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | draft | PRD v2.2 — brainstorm pivot + refinement round + 2026-04-28 review-fix pass; 0 open questions; 70 ACs (T5.4 grep-verified; bumped from 64 in the 2026-04-28 review-fix when 6 a11y/lifecycle ACs were added) |
| solution.md | draft | SDD v1.2 — all 10 ADRs confirmed; 4 drifts patched during implementation; 2026-04-28 review-fix pass added attach-lifecycle state machine table, PTY resize ordering, single-flight invariant, dispose timeout bound, store re-entrancy invariant |
| plan/ | complete | 5-phase TDD plan (30 tasks across 5 phases — all completed; T5.5b added 2026-04-25); phase-1..phase-5.md + README.md + traceability.md (T5.4) + manual-qa-checklist.md (T5.5b) |

## Scope (post-brainstorm pivot, 2026-04-24)

Hashi v0.1 delivers **two independent features**; this spec covers feature 1 only.

**Feature 1 (this spec): Tomo Connection & Chat Window.** The plugin-managed connection to a local Tomo container and the chat surface that exposes it. Connection is a plugin-level state (not per-file, not per-view). Chat is a singleton Obsidian view placeable in sidebar or main pane.

**Feature 2 (spec 002): Instruction Executor.** Standalone execution of `_instructions.json` files — does NOT require an active Tomo connection and does NOT share state with feature 1. The tri-state preview modal (Preview on / off / No confirmation) referenced in `~/Kouzou/projects/miyo/miyo-architecture.md` is owned by spec 002; its focus, Escape, and shortcut behavior are specified there. Spec 001 has no responsibility for that modal beyond the pane context that hosts the chat view.

Feature 1 covers:
- **Docker discovery by label `miyo.component=tomo`** — picker-based, explicit user action only (no ambient scanning)
- **Connection transport:** Docker API only in v0.1 — no HTTP/WS stub, no settings toggle hinting at transport mode
- **Settings pane:** Connect button (with picker) + Disconnect button
- **Picker content:** Tomo instance name + uptime per candidate (requires Tomo-side label; graceful fallback to short container ID)
- **Status bar icon** (Tomo kanji 友 preferred): state via icon/indicator, hover tooltip shows instance name, click opens popover with three actions (Force Reconnect, Open Chat Window, Go to Settings)
- **Chat window view:** singleton, placeable in any Obsidian pane; status indicator + Force Reconnect inside the view
- **Command palette (three commands total for 001):**
  1. "Show Tomo chat window" (focus or open)
  2. "Tomo Hashi: Reconnect to `<instance-name>`" (or "… Reconnect to Tomo" when name unknown) — reconnect-only; never opens picker
  3. "Execute instructions document" — *belongs to spec 002; listed here only so the complete palette surface is visible*
- **File explorer right-click:** "Open Tomo chat with `@file` reference" — any file; inserts `@vault/relative/path.ext ` at cursor or opens+prefills
- **Automatic reconnect on transient disconnect:** 5 attempts, exponential backoff from 500 ms (~15.5 s total)
- **FS2 Remember last instance across Obsidian sessions:** auto-reconnect on launch by container ID
- **Error surfacing:** in-view sticky indicator in chat window; inline Settings error; `Notice` for palette-invoked failures when chat is closed

Explicitly NOT in 001:
- Stopping the Tomo container from the plugin (container lifecycle is external)
- Multiple simultaneous Tomo connections (one at a time)
- Remote Tomo — v0.1 uses the local Docker socket (cannot reach remote anyway); a future API-capable transport may reconsider
- Mobile (desktop-only; manifest drift flagged)
- HTTP/WS transport or any placeholder UI
- Split-pane chat (unified view only)
- External inbound surface of any kind (no ports, no webhooks, no MCP)
- Message replay across reconnect boundaries (continuity gap disclosed, not repaired)
- Conversation history persisted to disk (Tomo owns its own history)
- Picker outside Settings — Force Reconnect, auto-reconnect, palette reconnect command, and status bar popover never open the picker

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-24 | Begin xdd workflow with PRD phase | Three open questions (trigger UX, discovery policy, error channel) were WHAT-level decisions; needed settling before design |
| 2026-04-24 | Run xdd in Agent Team mode | Three document phases planned; Obsidian + Docker + UX trade-offs benefit from persistent research perspectives |
| 2026-04-24 | **PIVOT after PRD v1 review:** Hashi v0.1 has two independent features — Tomo Connection & Chat (001) and Instruction Executor (002). They do NOT share state, session identity, or error channels. | Original PRD v1 coupled 002 to 001's session identity and error channel; user's brainstorm notes clarified 002 is standalone and runs against `_instructions.json` without needing a live Tomo connection. PRD rewritten to v2. |
| 2026-04-24 | Connection lives in plugin Settings (Connect button + picker, Disconnect button) | Explicit user-controlled connection surface beats implicit file-based trigger. Connection is plugin-level, not per-file. |
| 2026-04-24 | Connection state visible in three places: Settings, Obsidian status bar, chat window indicator | Persistent visibility wherever the user is working; user should never have to hunt for connection state |
| 2026-04-24 | Chat window is a singleton Obsidian view (sidebar or main pane, user choice) | One connection → one view. Re-invoking "Show chat window" focuses existing; prevents divergent stream consumers. |
| 2026-04-24 | Command palette exposes exactly three Hashi commands | "Show Tomo chat window", "Reconnect to Tomo", and — via spec 002 — "Execute instructions document". Minimal surface; every verb maps to a single explicit user intent. |
| 2026-04-24 | File right-click → `@file` prefill works on any vault file (not restricted to `_instructions.md`) | Leverages Tomo's existing `@vault-path` mention support; high-value across the whole vault, not just the inbox |
| 2026-04-24 | Force Reconnect = re-attach Docker stream to the currently chosen instance; re-open picker only if that instance is gone | Fast path for transient stream breakage; picker reopens only when the user really needs to re-choose |
| 2026-04-24 | Discovery filter = `miyo.component=tomo` label; no secondary `plugin-enabled=false` opt-out in v0.1 | Single label is enough when the picker is explicit user action. Simpler contract for Tomo to implement. |
| 2026-04-24 | Picker rows show instance name + uptime; graceful fallback to short container ID when the instance-name label is missing | User said this was the minimum to identify the right Tomo. Graceful fallback prevents the picker from becoming unusable before Tomo ships the label change. |
| 2026-04-24 | Reconnect policy = 5 attempts, exponential backoff starting at 500 ms (~15.5 s) | Absorbs typical Docker Desktop hiccups without hanging the UI for long |
| 2026-04-24 | Error channel inside chat window = sticky in-view indicator (not one-shot Notices) | Indicator can evolve across states (Reconnecting → Connected); notices retained for pre-view errors (palette-invoked failures when chat is closed) |
| 2026-04-24 | `manifest.json` `isDesktopOnly: false` drift flagged as PRD-level constraint; SDD/plan owns the fix | Current manifest contradicts v0.1 desktop-only scope; Obsidian enforces at install time |
| 2026-04-24 | Outbound handoff required to Tomo: expose instance name as a Docker label (suggested: `miyo.tomo.instance-name=<name>`) | Picker UX and command-palette reconnect label both depend on it; Hashi falls back to short container ID / static "Tomo" when missing. Handoff to be created in `_outbox/for-tomo/` during plan phase. |
| 2026-04-24 | Spec 002 README has legacy language about depending on 001 for lifecycle contracts / error channel — flagged as drift; NOT edited in this PRD pass | 002 is now standalone; 002 README update is a follow-up task, not part of 001's PRD. **(Resolved 2026-04-24 directly in 002's README — see 002 Decisions Log entry for that date. T5.8 in this spec's plan is therefore obsolete.)** |
| 2026-04-24 | **Refinement round after PRD v2 review:** status bar = icon-only; hover tooltip shows instance name; click opens popover with three actions (Force Reconnect, Open Chat Window, Go to Settings). Preferred glyph: Tomo kanji 友 with state-indicating color/indicator. | User's feedback: text label "Tomo: `<name>`" was too loud for the status bar; icon + on-demand detail is the Obsidian-idiomatic pattern. Popover consolidates three actions previously scattered across other surfaces. |
| 2026-04-24 | **Picker opens ONLY from Settings → Connect.** Force Reconnect, automatic reconnect, palette "Reconnect to Tomo", and the status bar popover all re-attach to the currently chosen instance or stay Disconnected with an error — never open the picker. | Prevents hidden state changes where the "reconnect" verb silently lets the user land on a different container than they chose. Changing instances is an intentional act that belongs in Settings. |
| 2026-04-24 | Drop "refuse non-local Docker endpoint" acceptance criterion | Moot under the local-socket approach used in v0.1 (we connect to the daemon socket directly, remote endpoints aren't reachable). A future API-capable transport may legitimately support remote Tomo; categorical refusal would block that. v0.1 "Won't Have" softened from "refuse" to "not in v0.1". |
| 2026-04-24 | Command palette Reconnect label = "Tomo Hashi: Reconnect to `<instance-name>`" when known; else "Tomo Hashi: Reconnect to Tomo". Reconnect command is reconnect-only — never opens picker. | Dynamic label gives the user the critical identity at a glance. Reconnect-only semantics align with the picker-in-Settings-only rule. |
| 2026-04-24 | F1 empty-state message reworded to plain English ("No Tomo instance seems to be running — start one and try again") — no label names surfaced to the user | Label names are implementation detail; user-facing text stays in user language. |
| 2026-04-24 | **SDD brainstorm:** Docker client = `dockerode`; Attach mechanism = `docker attach` to PID 1 with xterm.js rendering | dockerode is battle-tested for stream hijack/demux; xterm.js gives full-fidelity TUI rendering required by Claude Code's interactive mode. Both confirmed in SDD brainstorm. |
| 2026-04-24 | **SDD ADR-3 revised:** UI approach = plain TypeScript + DOM via Obsidian primitives (was: Svelte) | After pros/cons review, the framework runtime is not justified for 4 reactive UI surfaces + xterm-dominated chat view. Plain TS keeps bundle small, debugging transparent, and tests simple (no `@testing-library/svelte` integration needed). CSS isolation via `hashi-` class prefix convention. |
| 2026-04-24 | **SDD ADR-4 revised:** State store = custom typed `Store<T>` helper (was: Svelte writable store) | Consistent with ADR-3. ~30 LOC helper with `subscribe` returning unsubscribe matches Obsidian's `plugin.register` teardown pattern. Read/write split via `connectionStore: Readable<T>` + `connectionStoreWrite` naming convention. |
| 2026-04-24 | SDD ADR-5 through ADR-10 proposed (ports-and-adapters for Docker edge; singleton view via `getLeavesOfType`; cancellable reconnect loop; `removeCommand`+`addCommand` for dynamic labels; Obsidian `Menu` for status bar popover; vitest unit + vitest live split) | All pending user confirmation; detailed rationale and trade-offs captured in `solution.md`. |
| 2026-04-24 | SDD ADR-3..ADR-10 **all confirmed** in two batched rounds (plain TS UI; `Store<T>` helper; ports & adapters; `getLeavesOfType` singleton; cancellable reconnect loop; `removeCommand`+`addCommand` dynamic label; Obsidian `Menu` popover; unit + live test split) | User selected each recommended option in two AskUserQuestion rounds. SDD phase complete pending final validation pass. |
| 2026-04-24 | Plan phase complete — 5 phases, 29 tasks, full PRD AC → task traceability; 4 parallel tasks in Phase 4 (UI surfaces); live-Docker e2e test in Phase 5 | Phase structure: Foundation → Docker Boundary → Connection Service → UI Surfaces → Wire-up/Integration/Release Gate. TDD Prime/Test/Implement/Validate per task. Outbound handoffs (Tomo instance-name label, spec 002 README decoupling) captured as Phase 5 tasks T5.7/T5.8. |
| 2026-04-24 | Spec 001 readiness = HIGH. Ready for implementation. | All nine spec files present (README, requirements, solution, plan/README, plan/phase-1..5). Zero open questions. All ADRs confirmed. Full PRD→SDD→PLAN traceability. |
| 2026-04-24 | Tomo handoff (T5.7) created ahead of implementation: `_outbox/for-tomo/2026-04-24_hashi-to-tomo_instance-name-label.md` | Tomo needs lead time to ship the `miyo.tomo.instance-name` label; creating the handoff at plan-time (rather than waiting until Phase 5 of implementation) maximizes parallel work. Phase 5 T5.7 marked completed in `plan/phase-5.md`. |
| 2026-04-25 | Multi-batch review pass: security re-triage, drift, simplification, testing | Four review batches landed: (1) Security — dropped Tomo identity pinning / vault-pairing fingerprint / preview-execute TOCTOU as Won't Have (Hashi is local + outbound-only; no named threat actor); kept Docker-socket pinning (no DOCKER_HOST follow), xterm.js OSC 8/52 disabled, no chat content in logs. (2) Drift — manifest/peerDep/PRD all aligned at minAppVersion 1.5.0; AC count = 61; Svelte residue swept after ADR-3/4 v2 plain-TS pivot; `src/settings/` path pinned. (3) Simplification — ADR-4 v3 `Store<T>` only (no `derived<T,U>`, no `connectionStoreWrite` read/write split); ADR-5 v2 use dockerode directly via `src/connection/docker.ts` (no `DockerClient` port, no `FakeDockerClient` — `vi.mock('dockerode')` at unit-test boundary); `ConnectionError` collapsed 7→4 codes. (4) Testing — RED-GREEN-REFACTOR canonical task shape in plan/README; T5.5b manual-QA mirroring 002's T6.4 (closes Obsidian-API test-seam gap); T5.4 traceability matrix file replaces silent `test.todo`; PRD F1 multi-Tomo edge-case ACs (duplicate names, >20 containers, vanish-mid-pick); F2/AC3 quantified to "≤16 ms p95 in jsdom" (was "visible interval"); edge-case→tests matrix in plan/README. SDD bumped to v1.1; PRD acceptanceCriteria=61. |
| 2026-04-28 | **Multi-perspective review pass on the spec set + fix branch.** Seven specialist reviews (Security, Simplification, Performance, Quality, Concurrency, Accessibility, Testing) ran against the full 001 spec set (2,601 lines, 11 files). 3 Critical, 18 High, 17 Medium, 8 Low findings. Fixes landed in branch `review/spec-001-fixes` across 5 bundles: (1) doc-drift — bundle budget reconciled to 1000 KB across SDD §Quality / §Deployment / phase-5 / build-output test, AC count gate aligned 61→64, "DockerodeAdapter"/"DockerClient port" zombies replaced with `src/connection/docker.ts` helpers in 5 places, directory map collapsed `src/docker/` under `src/connection/`, "FileMenuHandler" → `fileMenu`/`registerFileMenu`, 9-event "Tracking Requirements" table deleted (duplicated ACs under analytics-shaped names while v0.1 explicitly ships no telemetry), Phase 5 task count 9→10 (T5.5b inclusion) and total 29→30, "exactly 3 commands" reframed to "exactly 2 in spec 001", "ConnectionFailure" matrix references clarified as the carrier exception class for the `ConnectionError` discriminated union, Phase 5 task count + Release Gate Status section added separating code-side from operational gates, traceability.md prose exegesis stripped (~120 lines: "Notes per feature" + "Next-up rows" + "Open follow-ups" — the live matrix + orphan list + 4-row follow-ups table replace them); (2) spec gap fills — attach-lifecycle state-machine table, PTY resize ordering subsection, single-flight invariant, dispose timeout bound (~2000 ms), store re-entrancy invariant, 6 new ACs (status-bar keyboard activation, picker modal focus trap/Escape, xterm a11y mode, focus on disconnected open, Force Reconnect tab order, reduced-motion streaming rationale), `ConnectionState.error` variant deleted (unused; `disconnected{reason}` covers all failure paths); (3) test coverage — `terminalHost.test.ts` source-regex asserts xterm config flags, `no-chat-content-logged.test.ts` grep test, `aria-live` attribute asserts, `docker.test.ts` `DOCKER_HOST` negative case, file-menu control-char strip + test, `addCommand` dedup multi-state test, ResizeObserver debounce test; (4) code — RAF coalescing in `terminalHost.ts`, `scrollback: 5000` cap, ResizeObserver debounce (150 ms), `Store<T>` listener-set snapshot for re-entrant safety, file-menu strips `\n`/`\r`/`\0` from `file.path` before insertion, transient continuity-gap state in `TomoChatView` (closes F5.5/F8.5 ❌), unmeasured perf NFRs deleted (load/discovery/attach p95 with no measurement harness); (5) plan/process — Release Gate Status block, traceability follow-ups table. F2/AC3 "≤16 ms p95 in jsdom" wording replaced with the actual testable behavior ("indicator class updated synchronously in the same microtask as `connectionStore.set` returns"). PRD bumped to v2.2; SDD bumped to v1.2. |
| 2026-04-28 | **Implementation complete — all 5 phases shipped + Release Gate code-side passed.** Phase 1 Foundation (PR #1, commit b974885), Phase 2 Docker Boundary (PR #3, commit 70a65fa), Phase 3 Connection Service (PR #4, commit c6fc8f0), Phase 4 UI Surfaces (PR #5, commit caa67b7), Phase 5 Wire-up + Release Gate (PR #6, this branch). Build clean, 203/203 unit tests, lint clean, bundle ~304 KB (well under 1000 KB SDD CON-7 ceiling, revised same day), manifest desktop-only verified. T5.4 traceability matrix: 61/64 ACs covered automatically (3 orphans — F1.10 + F4.5 closed by T5.5 e2e; F8.5 deferred as a known-likely-fail row in T5.5b). T5.5 e2e live test authored (CI-only — no Docker in dev environment). T5.5b manual-QA checklist (37 rows) authored — pending user run in real Obsidian against a live Tomo container. SDD drifts patched during implementation: ADR-4 v3 `Readable<T>` removal (T1.3), ADR-4 v3 dynamic-command-label subscribe target (T5.1), FS2 `chosenInstanceId` not cleared on Disconnect (T3.4). T5.7 Tomo instance-name label handoff returned status:done 2026-04-24. T5.8 obsoleted (decoupling done in 002 README directly). | Release-readiness gate per PRD Success Metrics has two remaining checks: CI must run `npm run test:live` against real Docker; user must walk the T5.5b manual-QA checklist. Code is ready to ship pending those two operational gates. |

## Context

Spec 001 ships Tomo Connection & Chat Window. Spec 002 ships the Instruction Executor. After the brainstorm pivot on 2026-04-24, the two features are **independent** — 002 does not require an active Tomo connection, and 001 does not carry session-identity or error-channel contracts for 002. Both must land for v0.1 but can be developed in parallel.

v0.1 release target: live Tomo Docker connection + chat working end-to-end + at least one base instruction-execution operation working against a live Tomo-produced `_instructions.json` (per architecture-06 §10).

## Open Questions

None remaining at PRD level. Questions from Kokoro's 2026-04-23 onboarding handoff have all been addressed (trigger mechanism was dissolved by the pivot; discovery policy became "picker on explicit user action"; error channel became the in-view indicator).

## References

- ADR-009 §2 Connection Strategy (external)
- Architecture 06 §4 Layers, §5 Connection Strategy, §9 Repository Structure, §10 v0.1 Release Gate (external)
- Onboarding handoff: `_inbox/from-kokoro/2026-04-23_kokoro-to-hashi_onboarding-charter-contract-and-v01-scope.md` (external; not in sandbox — summaries above are authoritative for this spec)
- Brainstorm pivot 2026-04-24 — inline notes on requirements.md v1
