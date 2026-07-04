# SDD — 004 Suggestions Editor (sketch, reconciled with Tomo wire)

> **Status: DRAFT SKETCH.** Surface + edit-model + store shape + view lifecycle
> + picker contracts are pinned. **Reconciled 2026-07-04** against Tomo's
> `_suggestions.json` wire contract (`_inbox/from-tomo/2026-07-04_tomo-to-hashi_suggestions-json-wire-contract.md`;
> executable schema `Tomo/tomo/schemas/suggestions-wire.schema.json`
> `schema_version: "1"` — **not readable in this checkout**; only the orientation
> shape + field semantics from the handoff were available). ADR numbers are
> `ADR-Sn` (sketch) — not confirmed until the PRD/SDD proper is written against
> the synced Kokoro ADR-026 + the vendored schema.

## 0. Guiding constraint (ADR-026 §0)

Kokoro pins **intent only**. Every operation binds to what Hashi's executor
**already does**; we **push back** on anything that duplicates Tomo or
reimplements the executor. The editor is **not** an approval gate — approval
stays the user's `#MiYo-Tomo/proposed → confirmed` tag flip.

## 1. The wire contract in one paragraph (what changed after reconciliation)

Tomo emits a `_suggestions.json` sibling next to each `_suggestions.md` (same
stem/folder). The **editable review surface is narrow**: per-suggestion MOC
**selection** (`candidate_mocs[].selected`) and **anchor** (`candidate_mocs[].anchor`),
plus per-proposed-MOC **name / parent / decision** and **membership** (`member_ids`).
Everything else (`title`, `id`, `stem`, `topic`, `run_id`, `generated`, …) is
**render-only**. The change signal is **`emit_digest`** — a sha256 of the
canonicalised editable payload that Hashi **must carry through verbatim and never
recompute** (§4). This reconciliation surfaced three deltas vs the original ADR-026
op list, tracked in §8 as flag-backs to Tomo.

## 2. Component overview

```
                          ┌─────────────────────────────┐
   _suggestions.json ───► │  SuggestionsDoc (adapter)    │  ADR-S5
   _suggestions.md   ◄─── │  load()/save() · digest      │  ← the ONLY wire-aware file
                          └──────────────┬──────────────┘
                                         │ pure EditModel (id-keyed)
                          ┌──────────────▼──────────────┐
                          │  suggestionsStore : Store<T> │  ADR-S2
                          │  editModel + dirty + select  │
                          └──────────────┬──────────────┘
                        subscribe        │        intent
                          ┌──────────────▼──────────────┐
                          │  SuggestionsEditorView       │  ADR-S1 (ItemView, leaf)
                          │  Suggestions · Proposed MOCs │
                          └───┬───────────────────┬──────┘
                              │                   │
                    ┌─────────▼──────┐   ┌────────▼─────────┐
                    │ SpotPicker(op2)│   │ inline toggles/  │
                    │ SuggestModal   │   │ text (op1/op3)   │
                    └───────┬────────┘   └──────────────────┘
                            │ existing MOC → real structure
                    ┌───────▼──────────────────────────────┐
                    │ markdownStructure + anchorResolver    │  REUSE (spec 002)
                    └───────────────────────────────────────┘
```

Pure/testable core (no Obsidian): `EditModel`, the editable-field transforms,
`markdownStructure`, `anchorResolver`, the digest **passthrough** rule. Obsidian
shell: the `ItemView`, the `SpotPicker` modal, the adapter's Obsidian side.

## 3. ADR-S1 — Surface is a leaf `ItemView`, not a Modal

Unchanged by reconciliation. Mirror `TomoChatView` (`src/ui/chat-view/`):
register a `VIEW_TYPE`, open in a workspace leaf, dockable beside the source
note. **Rejected:** a `Modal` à la `ExecutionModal` — single-shot preview→execute
with a terminal `Execute`; the editor is iterative, `Save`-terminated, wants to
live beside the note (op 2 references note structure).

Lifecycle:
- `onOpen()` → `suggestionsStore.subscribe(render)`; `adapter.load(docPath)` into
  the store (async; loading state first).
- `render(state)` → rebuild from `state.editModel`; dirty badge + `Save` /
  `Revert`. Same subscribe→rebuild pattern as `ExecutionModal.render`.
- `onClose()` → unsubscribe; if `state.dirty`, `ConfirmModal` save/discard.
  `ItemView` **does** extend `Component` → `registerDomEvent`/`registerEvent`
  here (unlike `Modal`/`SettingTab`). Verify against the class at build time.
- Reopen is fine — the store is the source of truth, the view is a projection.

Default: one active `_suggestions.json` at a time (matches the executor's single
run). Multi-doc deferred.

## 4. ADR-S4 — Save path & the `emit_digest` rule (RESOLVED by the wire)

The change-signal open point is **closed**: Tomo chose the **payload-digest**
mechanism. Hashi's obligations:

1. **Carry `emit_digest` through verbatim.** Never recompute, never strip. Load
   keeps it as an **opaque passthrough field** on the `EditModel`; save writes
   the exact same string back.
2. **Free to reformat/reorder keys** on save — the digest is over a canonical
   re-serialization, so formatting alone is not "an edit."
3. **Editing any editable field** makes Tomo's Pass-2 recompute differ from the
   stored digest → Tomo treats the JSON as authoritative. Hashi does **nothing**
   to signal this beyond writing the changed field.
4. **Writing back unchanged** → digest still matches → Tomo falls back to the
   markdown. So a no-op save is genuinely a no-op. **Consequence:** Hashi should
   only write the file when the user actually changed an editable field — a
   `dirty`-gated save avoids a spurious "JSON was touched" read on Tomo's side.
   (`dirty` is Hashi's own in-memory UI state, NOT written to the wire.)

Save steps: `adapter.save(model)` → serialise editable fields + verbatim
`emit_digest` → write `_suggestions.json` via `VaultFS`; re-render
`_suggestions.md` as a courtesy read view; **no digest recompute, no dirty flag
on the wire**. Write failure → `Notice` + keep `dirty` (no silent loss); model
is rebuilt-and-replaced, never mutated in place.

## 5. ADR-S2 — State: `suggestionsStore` singleton over `util/store.ts`

Real shape from the wire (id-keyed for stable graph ops):

```ts
// reconciled to the wire; passthrough fields kept verbatim
interface EditModel {
  readonly meta: {                      // all render-only + digest passthrough
    readonly schemaVersion: "1";
    readonly generated: string;
    readonly runId: string;
    readonly profile: string;
    readonly sourceItems: number;
    readonly emitDigest: string;        // OPAQUE — written back unchanged (§4)
  };
  readonly suggestions: readonly Suggestion[];
  readonly proposedMocs: readonly ProposedMoc[];
}

interface Suggestion {
  readonly id: string;                  // render-only (e.g. "S01", "S01#1")
  readonly stem: string;                // render-only
  readonly title: string;               // render-only (display)
  readonly candidateMocs: readonly CandidateMoc[];
}

interface CandidateMoc {
  readonly path: string;                // stable key, render-only
  selected: boolean;                    // EDITABLE (op 1)
  anchor: Anchor | null;                // EDITABLE (op 2)
  readonly fitConfidence: number | null;// advisory, render-only
}

interface Anchor {                       // note: wire enum has NO `block`
  type: "heading" | "callout" | "line";
  value: string | null;
  placement: "before" | "after" | "inside";
  newSection: string | null;            // target a not-yet-existing `## Section`
  readonly altHeadings: readonly string[]; // Tomo's snapshot pick-list (hint)
}

interface ProposedMoc {
  readonly id: string;                  // stable ⇒ merge/rename is a graph op
  readonly topic: string;               // render-only
  name: string;                         // EDITABLE (rename)
  parent: string;                       // EDITABLE (reparent)
  memberIds: readonly string[];         // EDITABLE (membership moves, by id)
  readonly tags: readonly string[];     // render-only
  readonly reason: string;              // render-only
  decision: "approve" | "skip";         // EDITABLE (default "skip")
}

type SuggestionsState =
  | { kind: "idle" }
  | { kind: "loading"; docPath: string }
  | { kind: "editing"; model: EditModel; dirty: boolean }
  | { kind: "load-failed"; docPath: string; message: string };
```

Every edit is a pure `EditModel → EditModel` transform setting `dirty: true` —
fully unit-testable with zero Obsidian and zero JSON I/O. The `meta.emitDigest`
is never derived from the model; it rides along untouched.

## 6. Operation → wire-field mapping (post-reconciliation)

| ADR-026 op | Wire binding | Editor affordance | Notes |
|---|---|---|---|
| **1 — re-point to MOC** | toggle `candidate_mocs[].selected` | checkbox/switch per candidate row | **Narrower than ADR-026's "picker over existing MOCs":** the candidate set is Tomo-provided; adding an arbitrary vault MOC is **not** in the wire. Flag-back §8-A. |
| **2 — choose spot** | edit `candidate_mocs[].anchor` | SpotPicker (ADR-S3) | Retains type→placement gating per executor (below). `alt_headings` = hint; real structure via `markdownStructure` is authoritative for existing MOCs. |
| **3 — merge/rename proposed** | `proposed_mocs[].name` / `parent` / `member_ids` | inline text + member chips | **Merge model changed:** same-`name` ⇒ Tomo collapses + unions members; OR move `member_ids` by id. Hashi does **not** drop nodes. |
| **(3b) — approve/create MOC** | `proposed_mocs[].decision` | approve/skip toggle | **New editable surface** beyond ADR-026's four ops; default `skip`. |
| **4 — change lifecycle state** | *(absent in v1 wire)* | — | **Not expressible.** Deferred / flag-back §8-B. |

## 7. Picker contracts

### ADR-S3b — SpotPicker (op 2) — the executor-bound one

Branches on existing-vs-proposed MOC (ADR-026 open point b):

- **Proposed MOC** (no file yet) → no structure to parse → the picker degrades to
  **membership + ordering**, not a section picker (a proposed MOC's "candidate"
  is a not-yet-created file; only `new_section` / ordering apply).
- **Existing MOC** → parse the note's real structure with
  `markdownStructure.parseHeadings` + `findCallout` (race-safe, content-parsed —
  the #68 guarantee). This is the **source of truth**; Tomo's `alt_headings` is a
  fallback hint only (it can be stale). User picks:
  1. an **anchor** — a parsed heading or callout (wire `type ∈ {heading, callout,
     line}`; **no `block`** — the wire doesn't emit it), or `new_section` to
     target a not-yet-existing `## Section`, and
  2. a **placement** — **derived from the anchor type by what `anchorResolver`
     can honour**, NOT the wire's flat enum:
     - callout anchor → `{ inside, before, after }`
     - heading / line anchor → `{ before, after }` (**no `inside`**)

**Why gate `inside` even though the wire enum permits it structurally:** Pass-2
execution routes an `inside` anchor through `link_to_moc` / `insert_under_marker`,
whose `anchorResolver` returns `insertInside: null` for non-callouts → the handler
**hard-fails**. Offering `inside` on a heading would let the user author a
suggestion the executor cannot apply. Gating it in the editor is exactly the
ADR-026 §0 "bind to what the executor already does" push-back — the editor is
**more** constrained than the raw wire, on purpose. `fit_confidence` renders as an
advisory hint (not editable).

### op 1 & op 3 — inline, no dedicated modal

- **op 1** (`selected`) is a per-candidate toggle rendered inline on the
  suggestion row — no picker needed for v1 (the candidate set is fixed by Tomo).
- **op 3** rename/reparent are inline text inputs; membership moves are
  drag/though-more-likely a "move to MOC" `SuggestModal<ProposedMoc>` over the
  *proposed* nodes; `decision` is an approve/skip toggle. Merge is emergent
  (same-name) — surface a hint when two proposed MOCs share a `name`.

### ADR-S3c — StatePicker (op 4) — **removed from v1 sketch**

Op 4 has no wire binding (§6). The StatePicker is **not built for v1**. If we
decide the lifecycle transition belongs in the editor, it is a flag-back to Tomo
to extend the schema (§8-B), not something Hashi can synthesize alone (the
transition table + the on-disk representation are Tomo-owned).

## 8. Flag-backs to Tomo (raised at reconciliation; awaiting the confirm round)

The handoff explicitly invites: *"confirm the contract works … or flag fields you
need reshaped."* Three items:

- **A — op 1 scope.** ADR-026 op 1 reads as "re-point to a *different* MOC (id/path
  picker over existing MOCs)"; the wire only lets the user toggle among
  Tomo-proposed `candidate_mocs`. **Recommendation: accept the toggle model for
  v1** (simpler; the Session View escape hatch covers "I want a MOC Tomo didn't
  propose"). Confirm with Tomo that this is the intended reading, or ask for an
  additive "user-added candidate path" field.
- **B — op 4 lifecycle state.** ADR-026 lists it as one of the four ops, but it is
  **not in the v1 wire** ("the atomic-note decision stays a markdown checkbox").
  **Decision needed:** drop op 4 from the v1 editor (recommended — keep v1 to the
  three surfaces the wire supports) OR ask Tomo for an additive lifecycle-state
  field. Either way, Kokoro ADR-026 and this spec must agree.
- **C — `inside` on non-callout.** The wire's `placement` enum is flat
  ({before, after, inside}) but `inside` is only executable on callout anchors.
  Confirm Tomo never emits, and will accept from the editor, `inside` **only** for
  callout anchors (Hashi enforces this regardless).

## 9. ADR-S5 — `SuggestionsDoc` adapter port (schema now known; still one seam)

Still the single wire-aware file, now with a known target:

```ts
interface SuggestionsDoc {
  load(docPath: string): Promise<EditModel>;   // parse _suggestions.json → model (keep emit_digest opaque)
  save(model: EditModel): Promise<void>;        // editable fields + verbatim emit_digest → json + md re-render
}
```

- **Vendor** `suggestions-wire.schema.json` into `src/schema/` (mirror the
  `instructions.schema.json` precedent) once the Tomo branch is reachable; add a
  version-`const` gate (`"1"`) that fails loud like the executor's, so a future
  bump rejects legibly rather than mis-parsing.
- Real impl (`ObsidianSuggestionsDoc`) written + tested against **real Tomo
  emission** (spec-002 lesson: synthetic fixtures never surface Tomo↔Hashi drift).
  `FakeSuggestionsDoc` over an in-memory model unblocks ADR-S1..S4 tests now.
- **Digest safety test (mandatory):** load → mutate one editable field → save →
  assert `emit_digest` byte-identical to input; and load → save-with-no-edit →
  assert file content round-trips such that Tomo's canonical digest still matches
  (canonical-form round-trip, not byte-identity).

## 10. Testing posture (Constitution L1/L2)

- **Pure core** — the field transforms, `validPlacements(anchorType)` derivation,
  proposed-MOC rename/reparent/decision/membership, same-name-merge detection —
  unit-tested with authorization AND rejection cases (e.g. `inside` absent for a
  heading anchor; membership move to a non-proposed MOC rejected).
- **Adapter** — deferred; tested against captured real `_suggestions.json`, plus
  the digest-passthrough tests in §9.
- **View + SpotPicker** — jsdom against the obsidian mock (the `import "obsidian"`
  side-effect shim gotcha applies) + a manual-QA row set once wired.
- **Reused code** (`markdownStructure`, `anchorResolver`) already covered — op 2
  adds only the anchor→placement-set derivation + the alt_headings-vs-real-structure
  precedence tests.

## 11. Still open until PRD (do not close on a guess)

1. Flag-backs §8-A / §8-B / §8-C → need Tomo's confirm round + possibly a Kokoro
   ADR-026 reconciliation for op 4.
2. Vendor + verify `suggestions-wire.schema.json` (unreadable in this checkout).
3. Re-read Kokoro ADR-026 (not synced here) before promoting this sketch to a PRD.
4. Membership-move UX (drag vs `SuggestModal`) — pick at design phase (the HTML
   mockups feed this decision).
