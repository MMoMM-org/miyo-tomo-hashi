/**
 * FakeSuggestionsDoc — behavior tests for the in-memory SuggestionsDoc
 * adapter (T1.2). Exercises it purely through the public SuggestionsDoc
 * port (load/save) — no reach into private fields.
 *
 * The seed is a REAL Tomo emission (test/fixtures/suggestions/1115.json,
 * copied verbatim from _inbox/from-tomo/2026-07-06_1115_suggestions.json)
 * rather than a synthetic fixture — spec-002 lesson: test against real
 * Tomo output so drift between Tomo's actual wire shape and a hand-rolled
 * fixture can't hide a bug.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_SEED, FakeSuggestionsDoc } from "../../__mocks__/FakeSuggestionsDoc.js";
import { validate } from "../../../src/schema/suggestions-validator.js";
import type { SuggestionsDoc } from "../../../src/vault/SuggestionsDoc.js";
import type { EditModel, SuggestionsWire } from "../../../src/types/suggestions.js";
import rawFixture from "../../fixtures/suggestions/1115.json";

describe("1115 fixture", () => {
	it("is a real, schema-valid Tomo emission (belt-and-suspenders against a stale fixture)", () => {
		const result = validate(rawFixture);
		expect(result.ok).toBe(true);
	});
});

describe("FakeSuggestionsDoc", () => {
	it("load() returns a clean EditModel wrapping the seeded doc", async () => {
		const doc: SuggestionsDoc = new FakeSuggestionsDoc();
		const model = await doc.load("any/path/1115_suggestions.json");

		expect(model.dirty).toBe(false);
		expect(model.doc).toEqual(rawFixture);
	});

	it("load() returns a fresh deep clone each time — mutating one model never leaks into another", async () => {
		const doc = new FakeSuggestionsDoc();
		const first = await doc.load("path.json");
		const firstSuggestion = first.doc.suggestions[0] as { title: string };
		firstSuggestion.title = "MUTATED";

		const second = await doc.load("path.json");
		expect(second.doc.suggestions[0]?.title).toBe(DEFAULT_SEED.suggestions[0]?.title);
		expect(second.doc.suggestions[0]?.title).not.toBe("MUTATED");
	});

	it("save() captures the whole model handed to it", async () => {
		const doc = new FakeSuggestionsDoc();
		const model = await doc.load("path.json");
		const edited: EditModel = {
			doc: { ...model.doc, run_id: "edited-run-id" },
			dirty: true,
		};

		await doc.save(edited);

		expect(doc.lastSaved).toEqual(edited);
		expect(doc.lastSaved?.doc.run_id).toBe("edited-run-id");
		expect(doc.saveCount).toBe(1);
	});

	it("save() increments saveCount across multiple saves", async () => {
		const doc = new FakeSuggestionsDoc();
		const model = await doc.load("path.json");

		await doc.save(model);
		await doc.save(model);

		expect(doc.saveCount).toBe(2);
	});

	it("round-trips unknown/read-only fields verbatim — load then save with no edits reproduces the seed byte-for-byte (own-the-whole-document)", async () => {
		const doc = new FakeSuggestionsDoc();
		const model = await doc.load("path.json");

		await doc.save(model);

		// daily_updates + tag_handler_groups + emit_digest are fields the
		// Suggestions Editor UI never edits directly — proving they survive
		// is the whole point of the "own the whole document" adapter contract
		// (SDD §9 / ADR-S4-S5).
		expect(doc.lastSaved?.doc).toEqual(rawFixture);
		expect(doc.lastSaved?.doc.daily_updates).toEqual(DEFAULT_SEED.daily_updates);
		expect(doc.lastSaved?.doc.tag_handler_groups).toEqual(DEFAULT_SEED.tag_handler_groups);
		expect(doc.lastSaved?.doc.emit_digest).toBe(DEFAULT_SEED.emit_digest);
	});

	it("save() deep-clones the model — mutating the caller's model after save() does not change lastSaved", async () => {
		const doc = new FakeSuggestionsDoc();
		const model = await doc.load("path.json");
		const edited: EditModel = {
			doc: { ...model.doc, run_id: "pre-mutation-run-id" },
			dirty: true,
		};

		await doc.save(edited);

		// Mutate the caller's model in place after save() has returned.
		const firstSuggestion = edited.doc.suggestions[0] as { title: string };
		firstSuggestion.title = "MUTATED-AFTER-SAVE";
		(edited.doc as { run_id: string }).run_id = "mutated-after-save";

		expect(doc.lastSaved?.doc.run_id).toBe("pre-mutation-run-id");
		expect(doc.lastSaved?.doc.suggestions[0]?.title).toBe(DEFAULT_SEED.suggestions[0]?.title);
		expect(doc.lastSaved?.doc.suggestions[0]?.title).not.toBe("MUTATED-AFTER-SAVE");
	});

	it("accepts a custom seed doc via the constructor, for downstream tasks to script scenarios", async () => {
		const custom: SuggestionsWire = {
			schema_version: "1",
			generated: "2026-01-01T00:00:00Z",
			run_id: "custom-run",
			profile: "test",
			source_items: 0,
			emit_digest: `sha256:${"0".repeat(64)}`,
			suggestions: [],
			proposed_mocs: [],
			daily_updates: [],
			tag_handler_groups: [],
		};

		const doc = new FakeSuggestionsDoc(custom);
		const model = await doc.load("path.json");

		expect(model.doc).toEqual(custom);
		expect(model.doc).not.toBe(custom); // still a clone, not the same reference
	});
});
