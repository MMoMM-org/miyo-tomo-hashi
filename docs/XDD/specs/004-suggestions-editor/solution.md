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

**Layout — Tabbed (owner decision 2026-07-04).** Inside the leaf, two tabs —
*Suggestions (n)* / *Proposed MOCs (n)* — show one list at a time. Rationale:
"nicht zuviel auf einmal, aber alles sichtbar" — keeps each list uncluttered as
runs grow while both stay one click away. (Rejected: A/stacked — both lists in one
scroll, cluttered on large runs; C/master-detail — extra clicks for a quick
toggle.) Editable fields carry the accent affordance so they read as writable vs
the render-only fields.

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
  stem: string;                         // derived from title on rename (Tomo owns)
  title: string;                        // EDITABLE (op 1d rename) — needs §8-3
  decision: "approve" | "skip";         // EDITABLE (op 1b/op4) — needs §8-2
  readonly candidateMocs: readonly CandidateMoc[];
}

interface CandidateMoc {
  readonly path: string;                // stable key
  readonly source: "tomo" | "user";     // user = editor-added via fuzzy pick (§8-1)
  selected: boolean;                    // EDITABLE (op 1)
  anchor: Anchor | null;                // EDITABLE (op 2)
  readonly fitConfidence: number | null;// advisory, render-only (tomo candidates)
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
  memberIds: readonly string[];         // EDITABLE (membership moves + merge union, by id)
  tags: readonly string[];              // EDITABLE (op 2c, fuzzy over vault tags) — needs §8-4
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

## 6. Operation → field mapping (final, post owner-review 2026-07-04)

The owner reviewed the mockups and **broadened the editable surface** well past the
v1 wire: the editor is a full review surface with write access to almost everything,
not just a MOC-assigner. Design principle he set: *the editor is built from the
review goal; Hashi writes the fields it needs into the JSON and Tomo's scripts
consume them* (traces to his original Kokoro ask). The added fields were sent to
Tomo as a field-needs handoff (§8); all are additive, `schema_version` stays `"1"`.

**A — Suggestions (atomic notes)**

| # | Editor affordance | Field | Owner | Status |
|---|---|---|---|---|
| 1 · assign MOC | toggle Tomo candidates **+ fuzzy-pick any vault note** as a new candidate | `candidate_mocs[].selected` + editor-added candidate (`source:"user"`) | Hashi UI + **Tomo** (honour user-added) | §8 (1) |
| 2 · choose spot | SpotPicker (ADR-S3b) | `candidate_mocs[].anchor` | Hashi (reuses executor) | in wire |
| 1b · approve/skip note (**= op 4**) | per-note approve/skip toggle | new `suggestions[].decision` | **Tomo** (add field) | §8 (2) |
| 1d · rename note | inline-editable title | `suggestions[].title` → editable (`stem` follows) | **Tomo** (make editable) | §8 (3) |
| 1c · missing targets | referenced note names are **click-to-open** links (Obsidian creates on open) | — (render affordance) | Hashi only | — |

**B — Proposed MOCs**

| # | Editor affordance | Field | Owner | Status |
|---|---|---|---|---|
| 3 · rename / reparent | inline text | `name` / `parent` | Hashi | in wire |
| 3 · approve/create | approve·skip toggle | `decision` (default skip) | Hashi | in wire |
| 2a · **merge** | explicit "Merge into…" action → sets `name` equal + unions members | `name` + `member_ids` | Hashi (drives same-name collapse) | §8 confirm |
| 2b · member names | member chips show the atomic-note **title on hover** | resolve `member_ids` → `suggestions[].title` | Hashi only (titles are in the same doc) | — |
| 2c · edit tags | fuzzy picker over vault tags | `tags` → editable | Hashi UI + **Tomo** (make editable) | §8 (4) |

The **`inside`-only-on-callout** rule (op 2) and **real-structure-over-`alt_headings`**
still hold — see §7.

## 7. Picker & affordance contracts

### ADR-S3a — MocPicker (op 1, broadened) — `FuzzySuggestModal<TFile>`

Beyond toggling Tomo's candidates, an **"＋ Add MOC"** affordance opens a
`FuzzySuggestModal` over vault notes (idiom: `InstancePickerModal`,
`FolderSuggest`). v1 does **no "what is a MOC?" detection** (owner call) — any note
the user picks becomes a new `candidate_mocs[]` entry marked `source:"user"`,
`selected:true`, `anchor:null` (→ user then sets a spot via op 2). Pass-2 must
honour user-added candidates identically to Tomo-proposed ones. Optionally scope
the picker to the Maps folder later; not v1.

### ADR-S3b — SpotPicker (op 2) — the executor-bound one

Branches on existing-vs-proposed MOC (ADR-026 open point b):

- **Proposed MOC** (no file yet) → no structure to parse → degrades to
  **membership + ordering**, not a section picker.
- **Existing MOC** → parse the note's real structure with
  `markdownStructure.parseHeadings` + `findCallout` (race-safe, #68). This is the
  **source of truth**; Tomo's `alt_headings` is a fallback hint only. User picks:
  1. an **anchor** — a parsed heading or callout (`type ∈ {heading, callout, line}`;
     **no `block`**), or `new_section` for a not-yet-existing `## Section`, and
  2. a **placement** — **derived from the anchor type by what `anchorResolver`
     can honour**, NOT the wire's flat enum: callout → `{ inside, before, after }`;
     heading / line → `{ before, after }` (**no `inside`**).

**Why gate `inside`:** Pass-2 routes it through `link_to_moc`/`insert_under_marker`,
whose `anchorResolver` returns `insertInside: null` for non-callouts → hard-fail.
Offering it would author an unexecutable suggestion. The editor is deliberately
**more** constrained than the raw wire (ADR-026 §0). `fit_confidence` = advisory
hint, not editable.

### ADR-S3c — TagPicker (op 2c) — `FuzzySuggestModal<string>`

Fuzzy over existing vault tags (`app.metadataCache.getTags()`) with free-text add.
Edits `proposed_mocs[].tags` (once Tomo makes it editable, §8-4). Pure vault data —
no Tomo round-trip for the candidate list.

### Inline affordances (no modal)

- **op 1b decision / op 3 decision** — approve·skip segmented toggle inline on the
  row (same control both sections; op 1b needs the new `suggestions[].decision`).
- **op 1d title / op 3 name·parent** — inline text inputs; editable fields carry the
  accent affordance so they read as writable vs render-only.
- **op 2a merge** — "Merge into…" opens a `SuggestModal<ProposedMoc>` over the
  *proposed* nodes; picking a target sets `name` equal + unions `member_ids` →
  same-name collapse on save (no node-drop; Tomo unions).
- **op 2b member hover** — tooltip resolves each `member_id` to its
  `suggestions[].title` (both live in the same doc — no lookup cost).
- **op 1c click-to-open** — every referenced note name (candidate path, parent,
  and any future daily-note ref) is a link; click opens in a new tab, Obsidian
  creates the note on open. Creation stays **outside Hashi** in v1.

## 8. Field-needs handoff to Tomo (SENT 2026-07-04)

Reframed from "flag-backs / permission asks" to **"here are the fields the editor
writes; align Pass-2"** — per the owner's stance that Hashi designs from the goal
and Tomo consumes the JSON. Sent:
`_outbox/for-tomo/2026-07-04_hashi-to-tomo_suggestions-editor-field-needs.md`.
Additive requests (`schema_version` stays `"1"`):

1. **User-added MOC candidates** — Pass-2 honours `candidate_mocs[]` entries the
   editor added (`source:"user"`), incl. `selected` + `anchor`.
2. **Per-note `decision` (approve/skip) = op 4** — the note-level accept/reject
   moves from the markdown checkbox into a `suggestions[].decision` field.
   Sub-question to Tomo: does `skip` also drop `source_inbox_item`?
3. **Editable `title`** — rename the atomic note during review; `stem` follows
   (Tomo derives) unless Tomo wants it edited separately.
4. **Editable `tags`** — `proposed_mocs[].tags` becomes authoritative when edited.

Confirmations requested (no new field): **merge-by-same-name** is the editor's
merge path; **`inside` only for callout anchors**. One design question: whether
**daily-note references** belong in the suggestions wire (for click-to-open) or
stay executor-side. Owner is handling the Tomo-side sync directly.

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

1. **Tomo consumes the 4 field-needs (§8)** — user-added candidates, per-note
   `decision`, editable `title`, editable `tags` — and confirms merge-by-name +
   inside-callout-only. Owner is syncing Tomo directly. The real `EditModel`
   fields marked "needs §8-n" are provisional until Tomo's schema lands.
2. **Kokoro ADR-026 reconciliation** — op 4 is **kept** (as `suggestions[].decision`
   via the wire), not dropped; and op 1 is **broadened** (fuzzy-pick any MOC).
   ADR-026's wording should reflect both so charter ↔ wire ↔ this spec agree.
3. Vendor + verify `suggestions-wire.schema.json` (unreadable in this checkout).
4. Re-read Kokoro ADR-026 (not synced here) before promoting this sketch to a PRD.
5. Daily-note references — Tomo design question (§8): in the wire for click-to-open,
   or executor-side only?
