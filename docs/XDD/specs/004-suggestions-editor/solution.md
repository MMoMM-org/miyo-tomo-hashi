# SDD — 004 Suggestions Editor (FINAL; PRD-traced)

> **Status: FINAL — ready for PLAN (2026-07-06).** PRD written (`requirements.md`);
> design traces to all 10 PRD features (§12). **All gates cleared** (§11): schema
> vendored + verified (`src/schema/suggestions-wire.schema.json`, re-vendored after the
> `daily_updates` tightening); ADR-S1..S5 owner-confirmed; **daily-editing v1 scope
> confirmed + golden-tested by Tomo**; **Kokoro reconciled ADR-026 on `main`**
> (JSON-only rebuild + own-the-whole-document + per-note decision + daily-v1). Hashi
> conforms field-for-field.
> Reconciled 2026-07-06
> against Tomo's **final** `_suggestions.json` contract
> (`_inbox/from-tomo/2026-07-05_tomo-to-hashi_final-contract-and-example.md`)
> and three real runs (`2026-07-06_0909`, `_0949`, `_1115`). Executable schema
> **vendored + verified**: `src/schema/suggestions-wire.schema.json`
> (`schema_version: "1"`, from `miyo-tomo` main). **Conform to Tomo's schema**
> (executable source of truth); Kokoro ADR-026 **reconciled** to it on `main`
> (2026-07-06, commit `d8410d4`). ADR ids below are `ADR-Sn`.

## 0. Guiding constraint (ADR-026 §0)

Kokoro pins **intent only**. Every operation binds to what Hashi's executor
**already does**; push back on anything that duplicates Tomo or reimplements the
executor. The editor is **not** an approval gate — approval stays the user's
`#MiYo-Tomo/proposed → confirmed` tag flip.

## 1. The contract in one paragraph — JSON-only

Tomo emits a `_suggestions.json` sibling next to each `_suggestions.md`. Pass 2 is
**JSON-only**: if the JSON changed, Tomo rebuilds its entire output from the JSON
alone (`build_from_wire`) and never reads the markdown; if unchanged, it uses the
markdown. The change signal is **`emit_digest`** (sha256 over the canonical
payload). **The load-bearing rule: if the editor edits *any* field, it owns the
*whole* document** — every section it did not touch must survive the round-trip
verbatim or Pass 2 drops it. This replaces Kokoro's stale "override" description
(§8).

## 2. Component overview

```
                          ┌──────────────────────────────┐
   _suggestions.json ───► │  SuggestionsDoc (adapter)     │  ADR-S5
   _suggestions.md   ◄─── │  load()/save() · FULL doc     │  ← only wire-aware file
                          └──────────────┬───────────────┘
                                         │ full EditModel (id-keyed + passthrough)
                          ┌──────────────▼───────────────┐
                          │  suggestionsStore : Store<T>  │  ADR-S2
                          └──────────────┬───────────────┘
                        subscribe        │        intent
                          ┌──────────────▼───────────────┐
                          │  SuggestionsEditorView        │  ADR-S1 (ItemView, leaf)
                          │  4 tabs: Suggest·Proposed·     │
                          │  Daily·Tag-Handler             │
                          └───┬─────────┬─────────┬────────┘
                     SpotPicker    FuzzyPicker    inline edits
                     (op 2)   (MOC/tag/tpl/loc/parent/merge)
                              │ existing MOC → real structure
                    ┌─────────▼───────────────────────────┐
                    │ markdownStructure + anchorResolver   │  REUSE (spec 002)
                    └──────────────────────────────────────┘
```

## 3. ADR-S1 — Surface: leaf `ItemView`, four tabs

Mirror `TomoChatView` (`src/ui/chat-view/`): register a `VIEW_TYPE`, open in a
workspace leaf, dockable beside the note. **Rejected:** a `Modal` (single-shot
preview→execute; the editor is iterative + `Save` + sits beside the note).

**Layout = Tabbed** (owner decision 2026-07-04, "nicht zuviel auf einmal, aber
alles sichtbar"). Four tabs, counts + empty states:

| Tab | Source | Empty in |
|-----|--------|----------|
| **Suggestions** | `suggestions[]` | — |
| **Proposed MOCs** | `proposed_mocs[]` | 0909 run |
| **Daily** | `daily_updates[]` | — |
| **Tag-Handler** | `tag_handler_groups[]` | — |

Lifecycle: `onOpen` → subscribe + `adapter.load`; `render` → rebuild active tab
from the store; `onClose` → unsubscribe + dirty-guard (`ConfirmModal`). `ItemView`
extends `Component` → use `registerDomEvent`/`registerEvent`. One active doc.

## 4. ADR-S4 — Save, `emit_digest`, and "own the whole document"

1. **Carry `emit_digest` verbatim.** Never recompute, never strip — opaque
   passthrough on the model; written back byte-identical.
2. **Full-document round-trip.** The model holds **every** field, including
   sections the UI never edits — `daily_updates` trackers/log-links the v1 editor
   doesn't surface, `tag_handler_groups`, and all read-only fields — as passthrough.
   Save serialises the whole object. A dropped field = a dropped Pass-2 section.
3. **Dirty-gated save.** `dirty` is Hashi's own in-memory UI state (never on the
   wire). Only write when a real edit happened, so an untouched doc stays
   byte-stable and Tomo keeps the markdown path.
4. Re-render `_suggestions.md` as a courtesy read view. Write failure → `Notice`
   + keep `dirty`; model is rebuilt-and-replaced, never mutated in place.

## 5. ADR-S2 — EditModel (the full wire shape)

> **Implemented shape (Phase 1, 2026-07-06) — reconciled.** The camelCase
> `interface EditModel` below is an *illustrative field reference*. The code
> (`src/types/suggestions.ts`) instead uses **wire-shaped, deeply-`readonly`
> types** mirroring the JSON schema field-for-field (snake_case: `SuggestionWire`,
> `CandidateMocWire`, `AnchorWire`, `ProposedMocWire`, `TagGroupWire`,
> `DailyUpdateWire`/`DailyLogEntryWire`/`DailyTrackerWire`/`DailyLogLinkWire`,
> and a flat root `SuggestionsWire`), and the actual edit model is:
> ```ts
> interface EditModel { doc: SuggestionsWire; dirty: boolean }
> ```
> `doc` holds the WHOLE wire object (the schema is flat at the root — `meta` was
> an SDD-side grouping, not a wire concept — so `schema_version`/`generated`/
> `run_id`/`profile`/`source_items`/`emit_digest` live on `doc`). `dirty` is
> in-memory only (§4: never serialized). **Why this supersedes the camelCase
> sketch:** wrapping the wire doc verbatim makes ADR-S4 "own the whole document"
> free — the adapter parses JSON straight into `doc` and writes `doc` straight
> back, so no field can be dropped by a lossy remap (the exact failure §1/§4
> warn against). It also matches the executable schema (source of truth) and the
> `src/schema/types.ts` (InstructionSet) precedent. Every transform is a pure
> `EditModel → EditModel` that returns the SAME reference on a no-op (so `dirty`
> only flips on a real change) and sets `dirty:true` on a real edit.

```ts
// Illustrative field reference (see reconciliation note above for the
// implemented wire-shaped types + the { doc, dirty } EditModel):
interface EditModel {
  meta: { schemaVersion:"1"; generated:string; runId:string; profile:string;
          sourceItems:number; emitDigest:string };      // all read-only / passthrough
  suggestions: Suggestion[];
  proposedMocs: ProposedMoc[];
  dailyUpdates: DailyUpdate[];    // v1: EDITED — schema-pinned shape (§6 Daily), not opaque
  tagHandlerGroups: TagGroup[];
}

interface Suggestion {
  id:string; stem:string;                              // read-only
  audioPeer?:string|null; suppressed:boolean; worthiness?:number|null; // read-only; audioPeer/worthiness OPTIONAL in wire
  title:string;                                        // EDITABLE (stem derives, Tomo)
  template:string; location:string;                    // EDITABLE (pickers)
  tags:string[];                                       // EDITABLE (fuzzy)
  decision:"approve"|"skip";                           // EDITABLE (op 4; worthiness-defaulted)
  keepSource:boolean; deleteSource:boolean;            // EDITABLE
  forceAtomic:boolean;                                 // EDITABLE — synced w/ daily (§7)
  candidateMocs:CandidateMoc[];
}
interface CandidateMoc {
  path:string; source?:"tomo"|"user";                  // path read-only key; source OPTIONAL in wire → default "tomo"
  selected:boolean; anchor:Anchor|null;                // EDITABLE (op 1 / op 2); required in wire = [path, selected]
}
interface Anchor { type:"heading"|"callout"|"line"; value:string|null;
  placement:"before"|"after"|"inside"; newSection:string|null;
  altHeadings:string[] /*hint*/; fitConfidence:number|null /* read-only advisory — lives ON the anchor per schema, not the candidate */ }

interface ProposedMoc {
  id:string; topic:string; reason?:string;             // read-only; reason OPTIONAL in wire
  name:string; parent:string;                          // EDITABLE (parent = fuzzy)
  memberIds:string[];                                  // EDITABLE (merge/move by id; render titles)
  tags?:string[]; decision:"approve"|"skip";           // EDITABLE (tags OPTIONAL in wire; decision default skip)
}
interface TagGroup { groupId:string; approved:boolean; keepSource:boolean;        // EDITABLE toggles (wire required)
  handler?:string; targetPath?:string|null; marker?:string; sourcePaths?:string[]; preview?:string } // read-only display, all OPTIONAL in wire (§8-3)

// daily_updates — schema-pinned 2026-07-06 (Tomo tightened it; additionalProperties:false)
interface DailyUpdate { date:string;                                             // read-only
  trackers:DailyTracker[]; logEntries:DailyLogEntry[]; logLinks:DailyLogLink[] }
interface DailyTracker { field:string; value:string; reason:string; sourceStem:string; // read-only
  accepted:boolean }                                                             // EDITABLE
interface DailyLogEntry { reason:string; sourceStem:string;                      // read-only
  content:string;                                                                // EDITABLE
  position:"at_time"|"after_last_line"|"before_first_line";                      // EDITABLE
  time:string|null;                                                              // EDITABLE (only when position==at_time)
  accepted:boolean;                                                              // EDITABLE
  forceAtomicNote:boolean }                                                      // EDITABLE — synced per stem w/ Suggestion.forceAtomic
interface DailyLogLink { targetStem:string; time:string|null;                    // read-only
  position:"at_time"|"after_last_line"|"before_first_line"; reason:string;       // read-only
  accepted:boolean }                                                             // EDITABLE
```

Every edit is a pure `EditModel → EditModel` transform setting `dirty`. `meta`
(incl. `emitDigest`) and `dailyUpdates`/`tagHandlerGroups` non-edited parts ride
along untouched.

## 6. Editable surface — by tab

**Suggestions** — two card modes, chosen by `suppressed`:
- **worthy** (`suppressed:false`, e.g. S05/S08): title · template · location ·
  tags · `candidate_mocs` (select + spot) + `＋ Add MOC` · keep-source · approve/skip.
- **suppressed** (`suppressed:true`, worthiness < 0.5): worthiness badge + the
  **single** real control **Force Atomic** (`force_atomic`); no MOC UI (Tomo emits
  empty `candidate_mocs`). Explains the skip default.

**Proposed MOCs:** name (inline) · parent (**fuzzy picker**) · decision approve/skip
· member chips **render the note titles** (`member_ids` → `suggestions[].title`,
id in hover) · tags (fuzzy) · "Merge into…" (same-name collapse; Tomo unions).

**Daily:** per date — a **click-to-open** link (no `[[ ]]`; Hashi checks vault
existence itself — the wire has no exists flag — and shows a "doesn't exist"
state; **Hashi never creates the daily note**, Obsidian does on open). Per log
entry: **editable content**, **position** ∈ {`after_last_line`, `before_first_line`,
`at_time`} + a **time** field (only for `at_time`), **Accept** (`accepted`),
**Force Atomic** (`force_atomic_note`). Trackers: Accept toggle. Non-edited daily
fields pass through verbatim. Deleting a daily-only source is **automatic** —
`accepted` ⇒ delete, uncheck ⇒ keep (§8-2); no separate control.

> **✅ Daily rich-editing (`content`/`position`/`time`) CONFIRMED v1 (2026-07-06).**
> Tomo confirmed all three asks (`_inbox/from-tomo/2026-07-06_tomo-to-hashi_daily-editing-confirmed-and-tested.md`):
> (1) `build_from_wire` honours edited `content`/`position`/`time` — `instruction-render`
> reads them straight off each `log_entries[]` item, gated by `accepted`, no re-derivation;
> (2) an **edited-daily golden test** was added (suite 2054 green); (3) the `daily_updates`
> schema was **tightened** to pin the exact editable-vs-read-only shape (re-vendored — §9).
> Kokoro recorded this v1 scope in ADR-026 ("rich daily editing IS v1"). No descope.

**Tag-Handler:** Approve / Keep-source (skip = not approved). Descriptive context —
`handler` / `target_path` / `marker` / `source_paths` / `preview` — is now in the
wire (read-only; §8-3 FIXED) and rendered on the card.

### Force-Atomic is one decision per source (Hashi-side sync)
A source can be **both** a suppressed suggestion **and** a daily log entry (e.g.
`call-mueller` = S01 + the 2026-07-05 entry). `suggestions[].force_atomic` and
`daily_updates[].log_entries[].force_atomic_note` are **separate wire fields**;
Hashi keeps them **in sync by `stem`/`source_stem`** so the user can't set a
contradictory state — toggling either flips both. (Owner decision 2026-07-06;
Hashi behaviour, not a Tomo change.)

## 7. Picker & affordance contracts

- **SpotPicker (op 2)** — existing MOC → parse real structure
  (`markdownStructure.parseHeadings`/`findCallout`, race-safe #68) as source of
  truth (`alt_headings` = fallback hint). User picks anchor (`{heading,callout,line}`;
  no `block`) or `new_section`, and a placement derived from anchor type by what
  `anchorResolver` honours: callout → `{inside,before,after}`; heading/line →
  `{before,after}`. `inside` is **callout-only** — the executor hard-fails it on
  non-callouts (ADR-026 §0). Proposed MOC → no structure → membership/ordering only.
- **Fuzzy pickers** (`FuzzySuggestModal`): MOC (op 1 — any vault note, `source:"user"`),
  tags (`metadataCache.getTags()`), **template**, **location** (folder), **parent**
  (proposed-MOC parent). Idiom: `InstancePickerModal`/`FolderSuggest`.
- **Merge / member-titles / click-to-open** — Hashi-only, no wire change.

## 8. Coordination with Tomo — 3 flags raised and RESOLVED (2026-07-06)

Reply sent (`_outbox/for-tomo/2026-07-06_hashi-to-tomo_final-contract-confirmed-3-flags.md`);
Tomo answered same day (`_inbox/from-tomo/2026-07-06_tomo-to-hashi_flags-1-3-fixed-2-clarified.md`).
All additive, `schema_version` stays `"1"`:

1. **`candidate_mocs` empty on worthy notes — FIXED.** Genuine wire bug: the reducer
   dropped candidates without a resolved anchor, so S05/S08's unchecked matches never
   reached the JSON. Tomo now emits **every** candidate with `selected` mirroring the
   pre-check state and **`anchor: null`** until a spot is resolved — exactly the
   editor's need. `build_from_wire` links only `selected` candidates, so JSON⇄markdown
   parity holds. The editor's worthy-note MOC list is now **real**, not mocked.
2. **Daily-only source delete — NO-OP (premise was wrong).** The markdown's
   `- [ ] Delete [[src]]` is decorative (no parser reads it). The daily-only delete is
   **automatic** downstream (`accepted daily entry + no confirmed atomic note for the
   stem → delete`), computed on the parser output identically under JSON-only. **The
   editor already controls it via the `accepted` flag** — accepted ⇒ source deleted;
   unchecked ⇒ entry not applied, source kept. No new field.
3. **`tag_handler_groups` display context — FIXED.** The wire now carries read-only
   `handler` / `target_path` / `marker` / `source_paths` / `preview`; `approved` /
   `keep_source` remain the editable toggles.

Confirmations that hold: `emit_digest` passthrough; `inside` callout-only; per-note
`decision`; daily-note existence is Hashi's job.

**One deferred capability (owner-decided 2026-07-06 — OUT of v1):** "apply the daily
update **and** keep the source note" (decouple from `accepted`) is a new control + a
vault-deletion behaviour change. Owner signed off on **deferring** it — v1 keeps
`accepted` = apply-and-delete. Revisit post-v1 as its own item if the need arises.

## 9. ADR-S5 — `SuggestionsDoc` adapter (full-document round-trip)

The single wire-aware file:

```ts
interface SuggestionsDoc {
  load(docPath:string): Promise<EditModel>;   // parse the WHOLE json → model (keep unknown fields)
  save(model:EditModel): Promise<void>;        // WHOLE model + verbatim emit_digest → json + md re-render
}
```

- **Vendored** `suggestions-wire.schema.json` into `src/schema/` (2026-07-06, from
  `miyo-tomo` main; **re-vendored** after Tomo tightened `daily_updates`) — verified against
  the `1115` run + §5 model. Build a version-`const` gate (`"1"`, fail-loud on mismatch,
  mirror the executor precedent). Verification found three §5 fixes (now applied):
  `fit_confidence` lives on `anchor` not the candidate; `worthiness` is nullable;
  `candidate_mocs[].source` is optional (default `"tomo"`). The tightened `daily_updates`
  is now a closed shape (`additionalProperties:false`) matching §5's `DailyUpdate` — its
  `additionalProperties:false` will **catch a dropped daily field in the round-trip test**.
- Real impl (`ObsidianSuggestionsDoc`) written + tested against **real Tomo
  emission** (spec-002 lesson). `FakeSuggestionsDoc` unblocks ADR-S1..S4 now.
- **Mandatory tests:** (a) load → edit one field → save → `emit_digest` byte-identical;
  (b) load → save-no-edit → canonical round-trip so Tomo's digest still matches;
  (c) **round-trip fidelity** — a doc with `daily_updates` + `tag_handler_groups` the
  UI never touches saves them back byte-for-byte (own-the-whole-document).

## 10. Testing posture (Constitution L1/L2)

- **Pure core** — field transforms, `validPlacements(anchorType)`, force-atomic
  stem-sync, proposed rename/reparent/decision/merge, daily position/time edits —
  unit-tested with authorization AND rejection cases.
- **Adapter** — deferred; real-emission fixtures + the §9 digest/round-trip tests.
- **View + pickers** — jsdom vs the obsidian mock (`import "obsidian"` side-effect
  shim) + manual-QA rows.
- **Reused** `markdownStructure`/`anchorResolver` already covered.

## 11. Open finalization gates (do not close on a guess)

**Resolved since the sketch:**
- PRD is written (`requirements.md`) — the "promote to PRD" gate is cleared; §12 traces it.
- §8 fixes confirmed against a real emission — the `1115` run carries real
  `candidate_mocs` on worthy notes (S07) and full tag-handler context.

**ALL GATES CLEARED 2026-07-06 — SDD final, ready for PLAN:**
- **Schema vendored + verified** — `suggestions-wire.schema.json` from `miyo-tomo` main into
  `src/schema/` (re-vendored after the `daily_updates` tightening), verified against the
  `1115` run; three §5 fixes applied (§9). ✅
- **Owner ✓ on ADR-S1..S5** — confirmed 2026-07-06; lean SDD structure kept (no tcs
  enterprise-template force-fit). ✅
- **Daily-editing v1 scope — CONFIRMED by Tomo** (§6 ✅): `build_from_wire` honours edited
  `content`/`position`/`time`, golden-tested, schema tightened. Daily rich-editing stays v1. ✅
- **Kokoro ADR-026 — RECONCILED by Kokoro** on `main` (commit `d8410d4`): new "Shipped
  contract (PR #128) — JSON-only Pass-2, full-doc mirror" section records override →
  JSON-only rebuild + own-the-whole-document, D2/D4 superseded, per-note `decision`, and
  the v1 daily-editing scope. Hashi spec 004 conforms field-for-field (§12). ✅

**Deferred (owner-decided 2026-07-06 — OUT of v1):** "apply daily update + keep source
note" (decouple from `accepted`) — `accepted` stays apply-and-delete. Logged in Kokoro
`open-questions.md` + the PRD "Won't Have" section; revisit post-v1 (§8).

## 12. PRD traceability

Every PRD feature (`requirements.md` → Must-Have F1–F10) maps to a design element
here — coverage check for the SDD promotion:

| PRD feature | Design element |
|-------------|----------------|
| F1 Tabbed review surface beside the note | §3 ADR-S1 (leaf `ItemView`, 4 tabs, lifecycle + dirty-guard) |
| F2 Re-point to a different MOC (op 1) | §6 Suggestions tab (`candidate_mocs` select + `＋ Add MOC`); §7 fuzzy MOC picker (`source:"user"`) |
| F3 Choose the spot inside a MOC (op 2) | §7 SpotPicker (real `markdownStructure`, anchor→placement gating, `inside` callout-only) |
| F4 Rename / merge proposed MOCs (op 3) | §6 Proposed MOCs tab (inline name, member-id graph op, "Merge into…") |
| F5 Per-note / per-MOC decision (op 4) | §5 `Suggestion.decision` / `ProposedMoc.decision` (worthiness-/skip-defaulted) |
| F6 Editable note fields (title/template/location/tags) | §5 editable fields; §7 fuzzy pickers |
| F7 Force-Atomic consistent per source | §6 "Force-Atomic is one decision per source" (stem sync) |
| F8 Edit daily updates | §6 Daily tab (content/position/time/accept/force-atomic; click-to-open; auto-delete via `accepted`) |
| F9 Approve tag-handler groups | §6 Tag-Handler tab (approve/keep-source toggles + read-only context) |
| F10 Safe save — own the whole document | §1 + §4 ADR-S4 (full-document round-trip, `emit_digest` passthrough, dirty gate, version fail-loud); §9 ADR-S5 round-trip tests |

PRD Won't-Have items (Tomo-reasoning round-trips, editing existing-MOC structure,
new approval gate, schema ownership, decoupled keep-source) are enforced by §0
(bind to what the executor does) + §8 (deferred capability).
