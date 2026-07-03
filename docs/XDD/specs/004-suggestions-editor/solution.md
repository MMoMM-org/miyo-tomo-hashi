# SDD — 004 Suggestions Editor (sketch)

> **Status: DRAFT SKETCH, blocked on Tomo.** This is the design skeleton the
> user asked for while we wait on Tomo's `suggestions.json` schema + change
> signal. It pins the *surface, edit-model, store shape, view lifecycle, and
> the three picker contracts* — everything that does NOT depend on the wire
> shape. All wire knowledge is quarantined behind a single `SuggestionsDoc`
> adapter port (ADR-S5) so exactly one small file changes when Tomo pins the
> schema. ADR numbers below are `ADR-Sn` (sketch) — not confirmed until the
> PRD/SDD proper is written against the synced Kokoro ADR-026.

## 0. Guiding constraint (ADR-026 §0)

Kokoro pins **intent only**. Every operation binds to what Hashi's executor
**already does**; we **push back** on anything that duplicates Tomo or
reimplements the executor. Concretely for this spec: op 2 reuses the existing
insert primitive (`anchorResolver`/`blockInsert`/`markdownStructure`) rather
than inventing a placement model, and the editor is **not** an approval gate.

## 1. Component overview

```
                          ┌─────────────────────────────┐
   suggestions.json  ───► │  SuggestionsDoc (adapter)    │  ADR-S5  (Tomo-gated)
   _suggestions.md   ◄─── │  load() / save() / signal()  │  ← the ONLY wire-aware file
                          └──────────────┬──────────────┘
                                         │ pure EditModel (id-based graph)
                          ┌──────────────▼──────────────┐
                          │  suggestionsStore : Store<T> │  ADR-S2
                          │  editModel + dirty + select  │
                          └──────────────┬──────────────┘
                        subscribe        │        intent
                          ┌──────────────▼──────────────┐
                          │  SuggestionsEditorView       │  ADR-S1 (ItemView, leaf)
                          │  renders list; opens pickers │
                          └───┬─────────┬─────────┬──────┘
                              │         │         │
                    ┌─────────▼──┐ ┌────▼─────┐ ┌─▼──────────┐
                    │ MocPicker  │ │ SpotPicker│ │ StatePicker│  ADR-S3 (SuggestModals)
                    │ (op1/op3)  │ │ (op2)     │ │ (op4)      │
                    └────────────┘ └───────────┘ └────────────┘
                              │  op2 reads structure via
                    ┌─────────▼───────────────────────────┐
                    │ markdownStructure + anchorResolver   │  REUSE (spec 002)
                    └──────────────────────────────────────┘
```

Pure/testable core (no Obsidian): `EditModel`, graph ops (op1/op3),
`markdownStructure`, `anchorResolver`. Obsidian-facing shell: the `ItemView`,
the `SuggestModal` pickers, and the `SuggestionsDoc` adapter's Obsidian side.

## 2. ADR-S1 — Surface is a leaf `ItemView`, not a Modal

Mirror `TomoChatView` (`src/ui/chat-view/`): register a `VIEW_TYPE`, open in a
workspace leaf, dockable beside the source note. **Rejected alternative:** a
`Modal` à la `ExecutionModal` — that surface is a single-shot preview→execute
confirm with a terminal `Execute` and documents "no reopen"; the editor is
iterative, `Save`-terminated, and wants to live beside the note (op 2).

Lifecycle (matches the `Modal`/store discipline in `ExecutionModal`, adapted to
`ItemView`):

- `onOpen()` → `suggestionsStore.subscribe(render)`; load current doc via the
  adapter into the store (async; render a loading state first).
- `render(state)` → rebuild the list from `state.editModel`; a dirty badge +
  `Save` / `Revert` action row. (Same "subscribe → rebuild contentEl" pattern
  as `ExecutionModal.render`.)
- `onClose()` → unsubscribe; if `state.dirty`, prompt save/discard (reuse
  `ConfirmModal`). **`ItemView` DOES extend `Component`** → prefer
  `registerDomEvent`/`registerEvent` here (unlike `Modal`/`SettingTab`, which
  do not — see `docs/ai/memory` note). Verify against the class at build time.
- Reopen is fine (unlike the modal) — the store is the single source of truth,
  the view is a stateless projection.

**Open (needs Obsidian verification, not a blocker):** whether the editor
should be one-doc-at-a-time (simplest — the active `_suggestions.md` drives it)
or multi-doc. Default: single active doc, like the executor's single run.

## 3. ADR-S2 — State: a `suggestionsStore` singleton over `util/store.ts`

Follow `executionStore` / `connectionStore` / `ideBridgeStore`: a module-level
`Store<SuggestionsState>` is the coordination point between the adapter, the
view, and the pickers.

```ts
// sketch — field names illustrative, not the wire shape
interface EditModel {
  readonly docId: string;
  readonly suggestions: readonly Suggestion[]; // id-keyed
  readonly proposedMocs: readonly ProposedMoc[]; // id-keyed nodes (op3 scope)
}

type SuggestionsState =
  | { kind: "idle" }
  | { kind: "loading"; docId: string }
  | { kind: "editing"; model: EditModel; dirty: boolean }
  | { kind: "load-failed"; docId: string; message: string };
```

All four ops are **pure `EditModel → EditModel` transforms** dispatched into the
store (re-point edge / pick spot / merge-rename node / set state), each setting
`dirty: true`. This keeps op1–op4 fully unit-testable with zero Obsidian and
zero wire dependency — the store holds the abstract graph, the adapter is the
only thing that knows how that graph serialises.

## 4. Picker contracts

### ADR-S3a — MocPicker (op 1 re-point; reused by op 3 merge target)

`FuzzySuggestModal<MocRef>` over existing MOCs (idiom: `InstancePickerModal`,
`FolderSuggest`). Returns a MOC id/path; the view dispatches a re-point
transform. MOC inventory source: vault scan / metadataCache (existing MOCs) —
**not** re-derived by Tomo. For op 3, the "candidates" list is restricted to
**proposed** MOC nodes from the `EditModel`, not vault MOCs.

### ADR-S3b — SpotPicker (op 2 choose the spot) — the executor-bound one

Two-stage, and **branches on existing-vs-proposed MOC** (ADR-026 open point b):

- **Proposed MOC** (no file yet) → there is no section structure to show. The
  picker degrades to **membership + ordering** over the proposed node's
  children (list reorder), NOT a section picker.
- **Existing MOC** → parse the note's own structure with
  `markdownStructure.parseHeadings` + `findCallout` (race-safe, content-parsed
  — the #68 guarantee), present headings + callouts, user picks:
  1. an **anchor** — one of the parsed {callout | heading | line | block}, and
  2. a **placement** — the set is derived from the chosen anchor by what
     `anchorResolver` can actually honour:
     - callout anchor → `{ inside, before, after }`
     - heading / line / block anchor → `{ before, after }` (no `inside`)

This directly answers ADR-026 open point (a): **the editor offers exactly the
`(anchor, placement)` pairs `anchorResolver` resolves — nothing invented.** The
chosen pair is stored on the suggestion; Pass 2 emits the matching
`link_to_moc` / `insert_under_marker` action. Hashi does not preview the write
here — it records intent that the existing executor will honour verbatim.

### ADR-S3c — StatePicker (op 4 lifecycle state)

`SuggestModal<LifecycleTag>` offering **only valid transitions** from the
current state, per Tomo `state-tag-lifecycle.md` §6 (exactly one lifecycle tag)
and Invariant #5 (monotonic — no backward transitions). The transition table is
Tomo-owned domain data; Hashi encodes it as a pure `validTransitions(current)`
function (unit-tested), so an invalid state can never be offered. Safer than raw
frontmatter editing because the illegal targets are simply absent from the list.

## 5. ADR-S4 — Save path

On `Save`:
1. `SuggestionsDoc.save(editModel)` → serialise + write `suggestions.json`
   (via `VaultFS`, so `FakeVaultFS` covers it in tests).
2. Re-render `_suggestions.md` from the model as a **courtesy read view** (Pass
   2 does not depend on it, but a viewer should see consistent content).
3. Emit the **change signal** Tomo chose (payload digest → nothing to do;
   explicit dirty flag → set it). **Deferred** — exact mechanism is Tomo's
   call (ADR-S5).
4. Clear `dirty`.

Failure handling mirrors the executor: a write failure surfaces a `Notice` +
keeps `dirty` (no silent data loss); no partial-model corruption because the
model is rebuilt-and-replaced, never mutated in place.

## 6. ADR-S5 — `SuggestionsDoc` adapter port (the Tomo-gated seam)

**The single file that knows the wire shape.** Everything above is written
against the abstract `EditModel`; this port is the only place that maps
`EditModel ⇄ suggestions.json` and knows the change-signal mechanism.

```ts
interface SuggestionsDoc {
  load(docPath: string): Promise<EditModel>;   // parse suggestions.json → model
  save(model: EditModel): Promise<void>;        // model → json + md re-render + signal
}
```

- Real impl (`ObsidianSuggestionsDoc`) is written **after** Tomo pins the
  schema — built/tested against **real Tomo emission**, not a hand-authored
  fixture (spec-002 lesson: synthetic fixtures never surface Tomo↔Hashi drift).
- A `FakeSuggestionsDoc` over an in-memory model lets ADR-S1..S4 be built and
  tested now, before the schema exists.

## 7. Testing posture (Constitution L1/L2)

- **Pure core** (op1–op4 transforms, `validTransitions`, spot-placement
  derivation, graph merge/rename) — unit-tested with authorization AND rejection
  cases (e.g. merge into a non-proposed MOC rejected; backward state transition
  absent).
- **Adapter** — deferred; when written, tested against captured real
  `suggestions.json` from a Tomo walk (not synthetic).
- **View + pickers** — jsdom against the obsidian mock (the `import "obsidian"`
  side-effect shim gotcha applies) + a manual-QA row set once wired.
- **Reused code** (`markdownStructure`, `anchorResolver`) already carries its
  own suite — op 2 adds only the anchor→placement-set derivation tests.

## 8. What stays open until Tomo (do not close on a guess)

1. `suggestions.json` field shape → ADR-S5 real impl.
2. Change-signal mechanism (digest vs dirty flag) → step 5.3.
3. Whether Tomo emits proposed-MOC child ordering we must preserve verbatim
   (affects op 2 proposed-branch + op 3) → confirm with schema.
4. Re-read Kokoro ADR-026 (not synced here) → reconcile any §-level intent this
   sketch under- or over-reaches before promoting to PRD.
