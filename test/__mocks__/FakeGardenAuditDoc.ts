/**
 * FakeGardenAuditDoc — in-memory GardenAuditDoc adapter for tests (spec-005
 * Phase 4). Mirrors test/__mocks__/FakeSuggestionsDoc.ts exactly: unblocks
 * the Garden-Audit Editor view work without a real Obsidian vault or the
 * real `ObsidianGardenAuditDoc` adapter. Seeded by default from the Phase 1
 * current-wire.json fixture (the verified SDD §2 example) rather than a
 * synthetic doc.
 *
 * `load()`/`save()` deep-clone on the way in and out (same rationale as
 * FakeSuggestionsDoc): callers can mutate freely without corrupting the
 * fake's internal state, and `lastSaved` is a stable snapshot tests can
 * assert against — including fields the view never touches (own-the-whole-
 * document).
 */

import { validate } from "../../src/schema/garden-audit-validator.js";
import type { GardenAuditModel, GardenAuditWire } from "../../src/types/garden-audit.js";
import type { GardenAuditDoc } from "../../src/vault/GardenAuditDoc.js";
import rawFixture from "../fixtures/garden-audit/current-wire.json";

// Routed through the real schema validator (rather than an `as` cast) so a
// stale/edited fixture that no longer matches the wire schema fails loudly
// at import time instead of silently typing itself as GardenAuditWire.
const seedResult = validate(rawFixture);
if (!seedResult.ok) {
	throw new Error(
		`FakeGardenAuditDoc: vendored fixture test/fixtures/garden-audit/current-wire.json failed schema validation: ${seedResult.message}`,
	);
}

/** Default seed — the verified SDD §2 example wire. */
export const DEFAULT_SEED: GardenAuditWire = seedResult.data;

function cloneWireDoc(doc: GardenAuditWire): GardenAuditWire {
	// Structured-clone-by-serialization: the wire doc is plain JSON-shaped
	// data (no functions/Dates/cycles), so this is a safe, complete deep
	// clone that also makes lossy custom clone logic impossible to write
	// by accident.
	return JSON.parse(JSON.stringify(doc)) as GardenAuditWire;
}

export class FakeGardenAuditDoc implements GardenAuditDoc {
	/** The most recent model passed to `save()`, or null if never called. */
	lastSaved: GardenAuditModel | null = null;
	/** Number of times `save()` has been called. */
	saveCount = 0;

	constructor(private readonly seed: GardenAuditWire = DEFAULT_SEED) {}

	// docPath is part of the GardenAuditDoc contract but the in-memory fake
	// has only one seeded doc — it does not branch on path.
	async load(_docPath: string): Promise<GardenAuditModel> {
		return { doc: cloneWireDoc(this.seed), dirty: false };
	}

	async save(model: GardenAuditModel): Promise<void> {
		this.lastSaved = { doc: cloneWireDoc(model.doc), dirty: model.dirty };
		this.saveCount += 1;
	}
}
