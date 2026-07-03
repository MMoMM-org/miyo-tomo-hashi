# Specification: 004-suggestions-editor

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-07-03 |
| **Current Phase** | Design sketch — **BLOCKED on Tomo** (`suggestions.json` schema + change-signal not yet pinned) |
| **Last Updated** | 2026-07-03 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| solution.md | sketch | SDD skeleton — surface + edit-model + store shape + view lifecycle + the three picker contracts, bound to Hashi's real insert primitive (`anchorResolver` + `blockInsert` + `markdownStructure`). The `suggestions.json` read/write layer is deliberately a thin deferred adapter — see "Blocked boundary". |
| requirements.md | — | **Deferred.** PRD needs the four-op painpoint analysis + the Tomo-owned schema; writing ACs against an un-pinned wire shape would encode a guess. Author after Tomo's schema lands. |
| plan/ | — | **Deferred** until PRD. |

## Scope (from Kokoro ADR-026, amends ADR-009 §3)

ADR-026 (Draft) amends Hashi's charter: Hashi may render an **editable, structured view** of Tomo's Pass-1 **Suggestions Document** (`suggestions.json`) and write the user's edits back. Hashi now fronts **both** Tomo gates it already bridges — Pass-1 review (this spec) and Pass-2 execution (spec 002).

**v1 is deterministic-only** — no Tomo reasoning round-trip. Four operations:

1. **Re-point a suggestion to a different MOC** — id/path picker over existing MOCs. Graph edit on `suggestions.json` (re-points the suggestion's target edge).
2. **Choose the spot inside a MOC** — Hashi parses the **note's own structure** (headings, callouts) and the user picks an anchor + placement. **Bound to the executor's real insert primitive** (`anchorResolver`/`blockInsert`): anchor ∈ {callout, heading, line, block}; placement ∈ {before, after} + `inside` (callouts only). **Do NOT reimplement Tomo's protected-zone/placement heuristics** — surface the real structure, the user chooses (ADR-026 §0).
3. **Merge / rename *proposed* MOCs** — id-based graph op over `suggestions.json`: rename a node, or merge A→B (re-point child edges by id, drop the empty node). Scope: **proposed** MOCs only.
4. **Change a note's scan / lifecycle state** — offer only the **valid** transitions (Tomo `state-tag-lifecycle.md` §6: exactly one lifecycle tag; Invariant #5: monotonic). Safer than raw frontmatter editing.

Anything the editor can't express **escalates through the existing Session View chat** (spec 001) — not a new feature.

**On save:** write `suggestions.json`; **re-render `_suggestions.md`** as a courtesy read view (Pass 2 does not rely on the render); emit whatever **change signal** Tomo chose (payload digest → no-op; explicit dirty flag → set it).

**Approval is unchanged** — the user's `#MiYo-Tomo/proposed → confirmed` tag flip. The editor is a better tool for the *existing* review, **not** a new approval gate and not an automated approver. ADR-009's "no proposal-first approval gate inside Hashi" still holds.

Explicitly NOT in 004 (v1):
- Tomo-reasoning round-trips (any op that would need Tomo to re-derive placement/structure → escalate to Session View instead)
- Editing / creating **existing** (non-proposed) MOCs' structure
- A new approval gate or automated approver
- Ownership of the `suggestions.json` schema (Tomo-owned; Hashi conforms)

## Architecture direction (settled 2026-07-03)

**Leaf `ItemView` (not a Modal).** The instruction-executor's `ExecutionModal` is the wrong precedent: it is a transient single-shot `preview → running → summary` automaton with a terminal `Execute`. The suggestions editor is an **iterative editing surface** with `Save` semantics that benefits from sitting beside the source note (op 2 references note structure). It is the "second face of the bridge" ADR-026 describes — mirroring the existing `TomoChatView` (`src/ui/chat-view/`) surface pattern, **not** the modal.

**Hybrid:** the leaf view hosts the editable suggestion list; the discrete choices (MOC pick, spot pick, state pick) are small **`SuggestModal`/`FuzzySuggestModal`** pickers, reusing `InstancePickerModal` / `FolderSuggest` idioms. Domain logic (edit-model, graph ops, structure parsing) stays behind `VaultFS` and pure functions → testable against `FakeVaultFS` without Obsidian (Constitution L1).

## Blocked boundary — what "waiting on Tomo" means precisely

We design the **surface + edit-model + picker contracts** now. We do **not** lock the **read/write layer**:

- The `suggestions.json` **schema is Tomo-owned** (producer + consumer). Hashi conforms once pinned.
- The **change-signal mechanism** is Tomo's choice (paired handoff: `Tomo/_inbox/from-kokoro/2026-07-03_kokoro-to-tomo_suggestions-json-optional-wire.md`).
- Same drift risk as spec 002: build the read/write layer against **real Tomo emission**, never a Hashi-side guess. The SDD isolates all wire-shape knowledge behind a single `SuggestionsDoc` adapter port so the guess-surface is one small, replaceable file.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-03 | ADR-026 charter amendment absorbed; inbound handoff acknowledged `done`. | `_inbox/from-kokoro/2026-07-03_kokoro-to-hashi_suggestions-editor-charter.md`. Recorded in `docs/ai/memory/decisions.md` + `context.md`. |
| 2026-07-03 | **Surface = leaf `ItemView`, not a Modal.** | ExecutionModal is a single-shot preview→execute confirm; the editor is iterative + `Save` + benefits from sitting beside the note (op 2). Mirrors `TomoChatView`, the existing "bridge face" pattern. |
| 2026-07-03 | **Op 2 binds to the existing insert primitive**, not a new placement model. | `anchorResolver` + `blockInsert` already resolve {callout, heading, line, block} × {before, after, inside-callout}. This is exactly ADR-026 §0's "bind to what the executor already does" and answers open point (a): the `placement.position` set the editor offers = what the resolver can honour, nothing invented. |
| 2026-07-03 | **Op 2 branches on existing-vs-proposed MOC.** | A *proposed* MOC has no section structure yet (it doesn't exist) → op 2 reduces to list/membership + ordering, not a section picker. Existing MOC → structure/anchor picker via `markdownStructure`. Answers ADR-026 open point (b). |
| 2026-07-03 | **`suggestions.json` read/write deferred behind a single `SuggestionsDoc` adapter port.** | Schema + change-signal are Tomo-owned and un-pinned. Isolating all wire knowledge in one adapter keeps the "guess surface" minimal and replaceable; PRD + plan wait for Tomo (no fabricated ACs against an un-pinned shape). |

## References

- Kokoro ADR-026 `global/decisions/ADR-026-hashi-suggestions-editor.md` (Draft — **not synced to this checkout as of 2026-07-03; reread before writing the PRD/SDD proper**)
- Charter amended: ADR-009 §3 (scope) · action/placement contracts: Kokoro ADR-016, ADR-023, ADR-024 (Hashi implementations: `src/actions/anchorResolver.ts`, `blockInsert.ts`, `linkToMoc.ts`, `insertUnderMarker.ts`)
- State machine / user-owned approval: Tomo `state-tag-lifecycle.md`
- Paired handoff (Tomo side — schema + wire): `Tomo/_inbox/from-kokoro/2026-07-03_kokoro-to-tomo_suggestions-json-optional-wire.md`
- Surface pattern precedent: spec 001 Session View (`src/ui/chat-view/TomoChatView.ts`); modal precedent (deliberately NOT followed): spec 002 `src/ui/ExecutionModal.ts`
