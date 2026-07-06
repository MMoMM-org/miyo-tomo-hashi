/**
 * FakeSuggestionsDoc — in-memory SuggestionsDoc adapter for tests (T1.2).
 *
 * Unblocks the Suggestions Editor domain core (T1.3-T1.9) and Phase 3 view
 * work without a real Obsidian vault or the (later-phase) real
 * `ObsidianSuggestionsDoc` adapter. Seeded by default from a REAL Tomo
 * emission (test/fixtures/suggestions/1115.json) rather than a synthetic
 * fixture — spec-002 lesson: test against real Tomo output, since a
 * hand-rolled fixture can silently drift from what Tomo actually emits.
 *
 * `load()` deep-clones the seed so callers can mutate the returned
 * `EditModel` freely without corrupting the fake's internal state or
 * leaking mutations into a later `load()` call. `save()` deep-clones the
 * model it is handed before recording it (`lastSaved`, `saveCount`), so
 * `lastSaved` is a stable snapshot — a caller mutating its model after
 * `save()` returns cannot retroactively change what the test observes —
 * symmetric with `load()`'s clone-on-the-way-out. Tests can then assert
 * exactly what the domain core sent for persistence — including fields
 * the editor UI never touches (own-the-whole-document, SDD §9).
 */

import { validate } from "../../src/schema/suggestions-validator.js";
import type { EditModel, SuggestionsWire } from "../../src/types/suggestions.js";
import type { SuggestionsDoc } from "../../src/vault/SuggestionsDoc.js";
import rawFixture from "../fixtures/suggestions/1115.json";

// Routed through the real schema validator (rather than an `as` cast) so a
// stale/edited fixture that no longer matches the wire schema fails loudly
// at import time instead of silently typing itself as SuggestionsWire.
const seedResult = validate(rawFixture);
if (!seedResult.ok) {
	throw new Error(
		`FakeSuggestionsDoc: vendored fixture test/fixtures/suggestions/1115.json failed schema validation: ${seedResult.message}`,
	);
}

/** Default seed — the real 2026-07-06 11:15 Tomo run. */
export const DEFAULT_SEED: SuggestionsWire = seedResult.data;

function cloneWireDoc(doc: SuggestionsWire): SuggestionsWire {
	// Structured-clone-by-serialization: the wire doc is plain JSON-shaped
	// data (no functions/Dates/cycles), so this is a safe, complete deep
	// clone that also makes lossy custom clone logic impossible to write
	// by accident.
	return JSON.parse(JSON.stringify(doc)) as SuggestionsWire;
}

export class FakeSuggestionsDoc implements SuggestionsDoc {
	/** The most recent model passed to `save()`, or null if never called. */
	lastSaved: EditModel | null = null;
	/** Number of times `save()` has been called. */
	saveCount = 0;

	constructor(private readonly seed: SuggestionsWire = DEFAULT_SEED) {}

	// docPath is part of the SuggestionsDoc contract but the in-memory fake
	// has only one seeded doc — it does not branch on path.
	async load(_docPath: string): Promise<EditModel> {
		return { doc: cloneWireDoc(this.seed), dirty: false };
	}

	async save(model: EditModel): Promise<void> {
		this.lastSaved = { doc: cloneWireDoc(model.doc), dirty: model.dirty };
		this.saveCount += 1;
	}
}
