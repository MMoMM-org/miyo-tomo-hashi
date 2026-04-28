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
