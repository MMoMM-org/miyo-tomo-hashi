# Decisions Memory

<!-- 2026-04-28 -->
- **When a plan task and an SDD code sketch conflict, the plan wins (assuming the plan task explicitly references a newer ADR revision).**
  XDD leaves SDDs and plans as parallel artifacts that can drift after an ADR revision. Plans are usually rewritten in full at the end of `xdd-plan`; SDD code sketches only update when someone explicitly edits them. Spec 001 plan-task T1.3 said "drop `Readable<T>` and `derived<T,U>` per ADR-4 v3" while SDD `solution.md` lines 432-454 still showed `interface Readable<T>` + `class Store<T> implements Readable<T>`. Implementer flagged it; we followed the plan and patched the SDD in commit `4d039f2`.
  - **Why:** plan tasks for a phase are written *after* the latest ADR revisions are folded in (xdd-plan reads SDD + decisions log). SDD code sketches are illustrative; they decay when ADRs revise without an explicit sketch edit. The plan is the operational contract for the implementer.
  - **How to apply:**
    1. When an implementer agent flags a Plan ↔ SDD conflict, follow the plan and log the SDD as drift.
    2. Before each phase starts, scan for similar drift between the phase's task texts and the SDD sections they reference (grep for "ADR-N v[2-9]" or "simplification" in plan + diff against SDD code blocks).
    3. After implementation, patch the SDD in a follow-up commit so future readers don't repeat the resolution.
  - **Out of scope:** if an SDD revision is *newer* than the plan task (rare — usually plan is regenerated after SDD edits), the SDD wins and the plan needs an update. The default direction is plan → wins because plan is the more recently regenerated of the two in normal XDD flow.

<!-- 2026-04-28 -->
- **Use an `epoch` counter to protect async state machines from races where external transitions can fire during in-flight async operations.**
  When a service exposes async methods like `connect()`, `disconnect()`, `forceReconnect()`, the user (or the runtime) can fire one while another is mid-flight. Without a guard, a slow `attach()` from a stale `connect()` can resolve AFTER a `disconnect()` and overwrite the current state — leaking a session and putting the store in the wrong state. `TomoConnection` (commit `ba065e2`) handles this by:
  1. Maintaining `private epoch = 0` on the service.
  2. Bumping it on every externally-initiated transition (`connect`, `disconnect`, `forceReconnect`, `autoReconnectIfRemembered`, `dispose`).
  3. Each in-flight async operation captures the current epoch at start. When it resolves, it compares the captured epoch against the live one. If different → the operation is stale; silently `close()` the freshly-acquired session and discard the result.
  - **Why:** simpler than AbortController everywhere; doesn't require the underlying API (dockerode `attach`) to support cancellation; keeps the state-store consistent without having to reason about every interleaving.
  - **How to apply:** any service with `connect/disconnect/reconnect`-style methods AND an underlying async API that returns a stateful resource (stream, socket, file handle) — bump epoch on transition; capture-and-compare on async resolve; clean up the resource if epoch moved. Document the discipline in the class header so future maintainers don't accidentally break it by skipping a bump.
