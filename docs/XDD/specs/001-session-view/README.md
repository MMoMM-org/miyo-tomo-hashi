# Specification: 001-session-view

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-04-24 |
| **Current Phase** | Planning — no PRD or SDD written yet |
| **Last Updated** | 2026-04-24 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | not started | PRD — trigger UX, lifecycle contract, error channel |
| solution.md | not started | SDD — Docker client shape, Session Manager state machine, unified chat view |
| plan/ | not started | Implementation phases |

## Scope (from ADR-009 + architecture-06)

Unified chat-style Obsidian view driving a running Tomo Docker container.

Covers:
- **Docker discovery** via labels (`miyo.component=tomo`, `miyo.plugin-enabled=true`); `plugin-enabled=false` is an opt-out
- **Connection transport:** Docker API only in v0.1 — no HTTP/WS stub, no settings toggle hinting at transport mode
- **Lifecycle controls:** attach, detach, stop, resume, reconnect-on-transient-disconnect
- **Unified chat view** (no split panes — `AskUserQuestion` doesn't render cleanly against split input/output)
- **Container-absent UX:** clear surfacing when no Tomo container is reachable (do not silently fail)
- **Error channel:** one surface for connection errors, session errors, lifecycle errors

Explicitly NOT in 001:
- Multi-container orchestration (one session at a time)
- Remote Tomo (same-host only)
- Mobile (desktop-only)
- HTTP/WS transport or any placeholder UI for it

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| — | — | — |

## Open Questions (from Kokoro onboarding handoff 2026-04-23)

1. **Trigger mechanism.** Three candidates (Kokoro leans #1):
   1. Command palette while `_instructions.md` is active → derive `.json` via `md_peer` field (simplest; Kokoro-recommended for v0.1)
   2. Sidebar/ribbon listing vault files tagged `#MiYo-Tomo/instructions` not yet `/applied` (nicer for many pending sets; v0.2)
   3. Right-click context menu on `_instructions.md` (complementary, cheap to add)
2. **Discovery policy.** If user triggers Hashi with no `_instructions.md` active, scan inbox folder and offer picker, or refuse with "open an instructions file first"?
3. **Error reporting channel.** Toast / notice / sticky banner / sidebar log — pick one simple channel for v0.1.

## Context

Spec-001 ships Session View; spec-002 ships Instruction Executor. The executor depends on lifecycle contracts (attach state, container identity, error propagation) defined here, so 001 lands first.

v0.1 release target: Session View + Docker connection + instruction-set execution of at least one base operation type working end-to-end against a live Tomo container (per architecture-06 §10).

## References

- ADR-009 §2 Connection Strategy
- Architecture 06 §4 Layers, §5 Connection Strategy, §9 Repository Structure
- Onboarding handoff: `_inbox/from-kokoro/2026-04-23_kokoro-to-hashi_onboarding-charter-contract-and-v01-scope.md`
