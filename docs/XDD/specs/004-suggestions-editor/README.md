# Specification: 004-suggestions-editor

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-07-03 |
| **Current Phase** | Design sketch — reconciled + **owner-reviewed** (2026-07-04). Layout = **Tabbed**. Editable surface broadened; field-needs handoff **sent to Tomo**. Awaiting Tomo's consume-side before PRD. |
| **Last Updated** | 2026-07-04 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| solution.md | sketch (reconciled 2026-07-04) | SDD skeleton — surface + edit-model + store shape + view lifecycle + picker contracts, reconciled to Tomo's `_suggestions.json` wire. Real `EditModel` shape, op→field mapping, `emit_digest` passthrough rule, and 3 flag-backs to Tomo (§8). |
| mockups/ | draft | HTML interface mockups (variants) to drive the "how do we build it" decision in the design phase. |
| requirements.md | — | **Deferred** until Tomo's confirm round closes the 3 flag-backs (esp. op 4 scope). Writing ACs before then would encode a guess about which ops are in v1. |
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

## Tomo wire — landed & reconciled (2026-07-04)

The wire contract arrived (`_inbox/from-tomo/2026-07-04_tomo-to-hashi_suggestions-json-wire-contract.md`). Resolved:

- **Change signal = `emit_digest`** (sha256 over the canonical editable payload). Hashi's job is to **carry it through verbatim — never recompute, never strip**. This is the "no-op" branch of the earlier open point: no dirty flag on the wire (SDD §4).
- **Editable surface is narrow:** per-suggestion MOC `selected` + `anchor`; per-proposed-MOC `name`/`parent`/`decision`/`member_ids`. Everything else is render-only (SDD §5–6).
- **Read/write via the Obsidian vault API** (Hashi's normal path; Tomo reaches the file via Kado, Hashi does not).

**Still deferred** (drift discipline, spec-002 lesson): the real `SuggestionsDoc` adapter + vendored schema are built/tested against **real Tomo emission**, not a hand-authored fixture. The executable schema `Tomo/tomo/schemas/suggestions-wire.schema.json` was **not readable in this checkout** (Tomo repo is `_outbox`-stub-only here) — vendor + verify when the Tomo branch is reachable.

### Field-needs handoff to Tomo — SENT (SDD §8)

After the owner reviewed the mockups he **broadened the editable surface**. Reframed from "asking permission" to "here are the fields the editor writes; align Pass-2" (his stance: Hashi designs from the goal, Tomo consumes the JSON). Sent: `_outbox/for-tomo/2026-07-04_hashi-to-tomo_suggestions-editor-field-needs.md`. Additive (`schema_version` stays `"1"`):

1. **User-added MOC candidates** — fuzzy-pick any vault note as a MOC target, not just Tomo's proposed set (`candidate_mocs[].source:"user"`).
2. **Per-note `decision` (approve/skip) = op 4** — the note-level accept/reject moves from the markdown checkbox into the JSON.
3. **Editable atomic-note `title`** (`stem` follows).
4. **Editable proposed-MOC `tags`** (fuzzy over vault tags).

Confirmations (no new field): merge-by-same-name; `inside` only for callout anchors. Design question: do daily-note refs belong in the wire (click-to-open)? Owner is syncing Tomo directly.

**Hashi-only affordances** (no wire change): click-to-open missing targets · explicit "Merge into…" (drives same-name collapse) · member-chip hover → atomic-note title.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-03 | ADR-026 charter amendment absorbed; inbound handoff acknowledged `done`. | `_inbox/from-kokoro/2026-07-03_kokoro-to-hashi_suggestions-editor-charter.md`. Recorded in `docs/ai/memory/decisions.md` + `context.md`. |
| 2026-07-03 | **Surface = leaf `ItemView`, not a Modal.** | ExecutionModal is a single-shot preview→execute confirm; the editor is iterative + `Save` + benefits from sitting beside the note (op 2). Mirrors `TomoChatView`, the existing "bridge face" pattern. |
| 2026-07-03 | **Op 2 binds to the existing insert primitive**, not a new placement model. | `anchorResolver` + `blockInsert` already resolve {callout, heading, line, block} × {before, after, inside-callout}. This is exactly ADR-026 §0's "bind to what the executor already does" and answers open point (a): the `placement.position` set the editor offers = what the resolver can honour, nothing invented. |
| 2026-07-03 | **Op 2 branches on existing-vs-proposed MOC.** | A *proposed* MOC has no section structure yet (it doesn't exist) → op 2 reduces to list/membership + ordering, not a section picker. Existing MOC → structure/anchor picker via `markdownStructure`. Answers ADR-026 open point (b). |
| 2026-07-03 | **`suggestions.json` read/write deferred behind a single `SuggestionsDoc` adapter port.** | Schema + change-signal are Tomo-owned and un-pinned. Isolating all wire knowledge in one adapter keeps the "guess surface" minimal and replaceable; PRD + plan wait for Tomo (no fabricated ACs against an un-pinned shape). |
| 2026-07-04 | **Wire contract landed + reconciled into the SDD sketch.** Change-signal open point CLOSED: `emit_digest` passthrough (never recompute). | `_inbox/from-tomo/2026-07-04_tomo-to-hashi_suggestions-json-wire-contract.md`. Real `EditModel` shape + op→field mapping folded into `solution.md`. Handoff set `in-progress`. |
| 2026-07-04 | **op 2 keeps type→placement gating even though the wire enum is flat.** `inside` offered for callout anchors only. | The executor (`anchorResolver`) returns `insertInside: null` for non-callouts → `link_to_moc`/`insert_under_marker` hard-fail `inside`. Offering it would author an unexecutable suggestion. The editor is deliberately *more* constrained than the raw wire (ADR-026 §0). |
| 2026-07-04 | **op 2 structure source = `markdownStructure` (real file), not Tomo's `alt_headings`.** | `alt_headings` is a Tomo snapshot that can be stale; the real note structure (race-safe, #68) is authoritative for an existing MOC. `alt_headings` kept as a fallback hint only. |
| 2026-07-04 | **Three flag-backs raised (op 1 scope / op 4 absent / `inside` gating); PRD gated on Tomo's confirm round.** | The handoff invites confirm-or-reshape. Op 4 (lifecycle state) has no v1 wire binding — a real ADR-026 reconciliation, not a Hashi omission. Recommendations recorded in SDD §8. |
| 2026-07-04 | **HTML interface mockups authored** (`mockups/`) to drive the "how do we build it" layout decision in the design phase. | Per owner request — visual variants to compare before committing the view structure. |
| 2026-07-04 | **Layout = Tabbed (variant B).** | Owner: "nicht zuviel auf einmal, aber alles sichtbar." Each list uncluttered as runs grow; both one click away. A/stacked + C/master-detail rejected. |
| 2026-07-04 | **Editable surface broadened past the v1 wire** after owner mockup review; reframed the Tomo coordination from "flag-backs / asks" to "field-needs the editor writes; Tomo consumes." | Owner stance: Hashi designs from the review goal and writes what it needs into the JSON; Tomo's scripts process it (his original Kokoro ask). op 1 broadened to a fuzzy MOC picker; op 4 kept as a per-note `decision` field (not dropped); atomic-note `title` + proposed-MOC `tags` made editable. Sent as a field-needs handoff; owner syncs Tomo directly. |
| 2026-07-04 | **Three Hashi-only affordances confirmed** (no wire change): click-to-open missing targets (creation outside Hashi), explicit "Merge into…" driving same-name collapse, member-chip hover → atomic-note title. | These hit owner asks 1c/2a/2b using data already present (titles live in the same doc; merge is same-name; Obsidian creates notes on open) — no Tomo dependency. |

## References

- Kokoro ADR-026 `global/decisions/ADR-026-hashi-suggestions-editor.md` (Draft — **not synced to this checkout as of 2026-07-03; reread before writing the PRD/SDD proper**)
- Charter amended: ADR-009 §3 (scope) · action/placement contracts: Kokoro ADR-016, ADR-023, ADR-024 (Hashi implementations: `src/actions/anchorResolver.ts`, `blockInsert.ts`, `linkToMoc.ts`, `insertUnderMarker.ts`)
- State machine / user-owned approval: Tomo `state-tag-lifecycle.md`
- Paired handoff (Tomo side — schema + wire): `Tomo/_inbox/from-kokoro/2026-07-03_kokoro-to-tomo_suggestions-json-optional-wire.md`
- Surface pattern precedent: spec 001 Session View (`src/ui/chat-view/TomoChatView.ts`); modal precedent (deliberately NOT followed): spec 002 `src/ui/ExecutionModal.ts`
