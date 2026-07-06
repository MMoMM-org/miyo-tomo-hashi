import { describe, expect, it } from "vitest";
import { validate } from "../../../src/schema/suggestions-validator.js";
import type {
	DailyLogEntryWire,
	DailyUpdateWire,
	EditModel,
	ProposedMocWire,
	SuggestionWire,
	SuggestionsWire,
	TagGroupWire,
} from "../../../src/types/suggestions.js";

// ---------------------------------------------------------------------------
// Minimum valid fixtures — one required-field-complete item per array, per
// src/schema/suggestions-wire.schema.json.
// ---------------------------------------------------------------------------

const VALID_SUGGESTION: SuggestionWire = {
	id: "S01",
	stem: "2026-07-01_some-note",
	title: "Some Note",
	template: "[[Templates/Atomic]]",
	location: "202 Notes",
	tags: ["#example"],
	decision: "approve",
	keep_source: false,
	delete_source: false,
	force_atomic: false,
	suppressed: false,
	candidate_mocs: [{ path: "MOCs/Test.md", selected: true, anchor: null }],
};

const VALID_PROPOSED_MOC: ProposedMocWire = {
	id: "M01",
	topic: "Testing",
	name: "Testing MOC",
	parent: "MOCs",
	member_ids: ["S01"],
	decision: "skip",
};

const VALID_LOG_ENTRY: DailyLogEntryWire = {
	time: null,
	position: "after_last_line",
	content: "Did the thing.",
	reason: "captured from note",
	source_stem: "2026-07-01_some-note",
	accepted: true,
	force_atomic_note: false,
};

const VALID_DAILY_UPDATE: DailyUpdateWire = {
	date: "2026-07-06",
	trackers: [],
	log_entries: [VALID_LOG_ENTRY],
	log_links: [],
};

const VALID_TAG_GROUP: TagGroupWire = {
	group_id: "G01",
	approved: true,
	keep_source: false,
};

const VALID_FIXTURE: SuggestionsWire = {
	schema_version: "1",
	generated: "2026-07-06T10:00:00Z",
	run_id: "2026-07-06_1000",
	profile: "default",
	source_items: 3,
	emit_digest: `sha256:${"a".repeat(64)}`,
	suggestions: [VALID_SUGGESTION],
	proposed_mocs: [VALID_PROPOSED_MOC],
	daily_updates: [VALID_DAILY_UPDATE],
	tag_handler_groups: [VALID_TAG_GROUP],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validate (suggestions wire)", () => {
	it("accepts a schema_version '1' doc and returns a typed SuggestionsWire", () => {
		const result = validate(VALID_FIXTURE);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.schema_version).toBe("1");
			expect(result.data.suggestions).toHaveLength(1);
			expect(result.data.daily_updates[0]?.log_entries[0]?.content).toBe(
				"Did the thing.",
			);
		}
	});

	it("rejects schema_version '2' with the fail-loud version-mismatch message", () => {
		// Mirrors the executor precedent (src/schema/validator.ts M14): the
		// literal "Schema version mismatch — expected X, got Y" form is
		// parsed downstream to drive an "upgrade" prompt — never a silent
		// pass-through of an unknown version.
		const result = validate({ ...VALID_FIXTURE, schema_version: "2" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toBe(
				"Schema version mismatch — expected 1, got 2",
			);
		}
	});

	it("rejects a missing schema_version, naming the field", () => {
		const fixture = { ...VALID_FIXTURE } as Record<string, unknown>;
		delete fixture.schema_version;
		const result = validate(fixture);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain("schema_version");
	});

	it("rejects a daily_updates log_entries[] item carrying an unknown field", () => {
		// additionalProperties:false on the tightened daily shape (SDD §6) —
		// an extra key must fail loud, not silently pass through.
		const fixture = {
			...VALID_FIXTURE,
			daily_updates: [
				{
					...VALID_DAILY_UPDATE,
					log_entries: [
						{ ...VALID_LOG_ENTRY, unexpected_field: "should not be here" },
					],
				},
			],
		};
		expect(validate(fixture).ok).toBe(false);
	});

	it("rejects an unknown top-level property (additionalProperties:false at root)", () => {
		const fixture = { ...VALID_FIXTURE, extra_root_field: true };
		expect(validate(fixture).ok).toBe(false);
	});

	it("rejects non-object input (number)", () => {
		expect(validate(42).ok).toBe(false);
	});

	it("rejects null input", () => {
		expect(validate(null).ok).toBe(false);
	});

	it("rejects array input", () => {
		expect(validate([]).ok).toBe(false);
	});

	it("validateSuggestionsWire raw export is still accessible from the module", async () => {
		const mod = await import("../../../src/schema/suggestions-validator.js");
		expect(typeof mod.validateSuggestionsWire).toBe("function");
	});
});

describe("EditModel (in-memory edit model)", () => {
	it("holds the whole validated wire doc verbatim, starting clean (dirty:false)", () => {
		const result = validate(VALID_FIXTURE);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const model: EditModel = { doc: result.data, dirty: false };

		// "Own the whole document" (ADR-S4): every wire field survives,
		// including read-only/passthrough ones like emit_digest and
		// tag_handler_groups — not just the fields the editor UI touches.
		expect(model.doc).toEqual(VALID_FIXTURE);
		expect(model.doc.emit_digest).toBe(VALID_FIXTURE.emit_digest);
		expect(model.doc.tag_handler_groups).toEqual(
			VALID_FIXTURE.tag_handler_groups,
		);
		// dirty is in-memory UI state, never part of the wire doc.
		expect(model.dirty).toBe(false);
		expect("dirty" in model.doc).toBe(false);
	});
});
