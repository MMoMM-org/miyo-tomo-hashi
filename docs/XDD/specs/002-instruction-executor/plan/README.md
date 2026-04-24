# Plan: 002-instruction-executor

> Filled in once requirements.md + solution.md land. Per-phase files (`phase-N.md`) live alongside this README.

## Phase Sketch (placeholder)

| Phase | Goal | Status |
|-------|------|--------|
| 1 | JSON parser + schema validation; reject unknown schema versions; `md_peer` lookup | not started |
| 2 | Action handlers — file moves first (`create_moc`, `move_note`, `delete_source`) | not started |
| 3 | Action handlers — in-file edits (`link_to_moc`, `update_tracker`, `update_log_entry`, `update_log_link`) | not started |
| 4 | Checkbox sync (`.md` peer) + partial-resume + idempotency guarantees | not started |
| 5 | Hook loader + pre/post dispatch + documented hook API surface | not started |
| 6 | Tri-state preview modal + settings UI | not started |

Phase breakdown will be confirmed during SDD drafting; this table is provisional.
