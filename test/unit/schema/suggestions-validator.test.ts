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
	item_key: "100 Inbox/2026-07-01_some-note.md",
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
	source_item_key: "100 Inbox/2026-07-01_some-note.md",
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
	schema_version: "2",
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
	it("accepts a schema_version '2' doc and returns a typed SuggestionsWire", () => {
		const result = validate(VALID_FIXTURE);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.schema_version).toBe("2");
			expect(result.data.suggestions).toHaveLength(1);
			expect(result.data.daily_updates[0]?.log_entries[0]?.content).toBe(
				"Did the thing.",
			);
		}
	});

	it("rejects schema_version '3' with the fail-loud version-mismatch message", () => {
		// Mirrors the executor precedent (src/schema/validator.ts M14): the
		// literal "Schema version mismatch — expected X, got Y" form is
		// parsed downstream to drive an "upgrade" prompt — never a silent
		// pass-through of an unknown version.
		const result = validate({ ...VALID_FIXTURE, schema_version: "3" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toBe(
				"Schema version mismatch — expected 2, got 3",
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

	// -----------------------------------------------------------------------
	// Tomo wire drift (handoff 2026-09-09): spec 031 added `attachments` and
	// spec 034 added `item_key` to suggestions[] without moving
	// schema_version, so every current run was rejected by
	// additionalProperties:false. Both are vendored EXACTLY as Tomo declares
	// them — item_key required, attachments optional. The two sides pin ONE
	// schema; updating one without the other is meant to fail loud rather
	// than degrade quietly.
	// -----------------------------------------------------------------------

	it("accepts a suggestion carrying item_key and attachments (current Tomo runs)", () => {
		const fixture = {
			...VALID_FIXTURE,
			suggestions: [
				{
					...VALID_SUGGESTION,
					item_key: "100 Inbox/Places/Dresden.md",
					attachments: ["100 Inbox/attachments/photo.jpg"],
				},
			],
		};
		const result = validate(fixture);
		expect(result.ok).toBe(true);
	});

	it("rejects a suggestion missing item_key (a Tomo older than this Hashi)", () => {
		// Deliberate parity with Tomo's own `required` list: the two sides pin
		// ONE wire. A pre-034 run failing loud here is the designed outcome —
		// half-opening a doc whose join key is absent would silently reinstate
		// the same-stem ambiguity item_key exists to remove.
		const { item_key: _dropped, ...withoutItemKey } = VALID_SUGGESTION;
		const fixture = { ...VALID_FIXTURE, suggestions: [withoutItemKey] };
		const result = validate(fixture);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain("item_key");
	});

	it("accepts a suggestion without attachments (still optional — Tomo does not require it)", () => {
		expect(validate(VALID_FIXTURE).ok).toBe(true);
	});

	it("preserves item_key and attachments on the validated doc (save round-trip)", () => {
		// The adapter re-serializes result.data, so unknown-to-the-editor
		// passthrough fields must survive validation unstripped.
		const fixture = {
			...VALID_FIXTURE,
			suggestions: [
				{
					...VALID_SUGGESTION,
					item_key: "100 Inbox/Reise/Dresden.md",
					attachments: ["a.png", "b.pdf"],
				},
			],
		};
		const result = validate(fixture);
		if (!result.ok) throw new Error(result.message);
		expect(result.data.suggestions[0]?.item_key).toBe(
			"100 Inbox/Reise/Dresden.md",
		);
		expect(result.data.suggestions[0]?.attachments).toEqual(["a.png", "b.pdf"]);
	});

	it("names the offending key when a suggestion carries an unknown field", () => {
		// Regression for the diagnosis half of the same handoff: the notice
		// used to read "must NOT have additional properties" with no key.
		const fixture = {
			...VALID_FIXTURE,
			suggestions: [{ ...VALID_SUGGESTION, totally_new_field: 1 }],
		};
		const result = validate(fixture);
		if (result.ok) throw new Error("expected validation to fail");
		expect(result.message).toContain("'totally_new_field'");
		expect(result.message).toContain("/suggestions/0");
	});

	it("names every offending key on the same object, not just the first", () => {
		const fixture = {
			...VALID_FIXTURE,
			suggestions: [
				{ ...VALID_SUGGESTION, future_one: 1, future_two: 2 },
			],
		};
		const result = validate(fixture);
		if (result.ok) throw new Error("expected validation to fail");
		expect(result.message).toContain("'future_one'");
		expect(result.message).toContain("'future_two'");
		expect(result.message).toContain("properties");
	});

	// -----------------------------------------------------------------------
	// Tomo spec 035 F9: source_item_key, required on all three daily buckets.
	// trackers[] and log_entries[] had an ambiguous key (source_stem);
	// log_links[] had NO source field at all, so it gains an identity rather
	// than a better one. One rejection test per bucket — they are three
	// separate closed objects, and a widening that misses one is invisible.
	// -----------------------------------------------------------------------

	it("rejects a log_entry missing source_item_key", () => {
		const { source_item_key: _drop, ...entry } = VALID_LOG_ENTRY;
		const fixture = {
			...VALID_FIXTURE,
			daily_updates: [{ ...VALID_DAILY_UPDATE, log_entries: [entry] }],
		};
		const result = validate(fixture);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain("source_item_key");
	});

	it("rejects a tracker missing source_item_key", () => {
		const fixture = {
			...VALID_FIXTURE,
			daily_updates: [{
				...VALID_DAILY_UPDATE,
				trackers: [{
					field: "mood", value: "good", reason: "r",
					source_stem: "some-note", accepted: true,
				}],
			}],
		};
		const result = validate(fixture);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain("source_item_key");
	});

	it("rejects a log_link missing source_item_key — the bucket that had no source field at all", () => {
		const fixture = {
			...VALID_FIXTURE,
			daily_updates: [{
				...VALID_DAILY_UPDATE,
				log_links: [{
					target_stem: "some-atomic", time: null,
					position: "after_last_line", reason: "r", accepted: true,
				}],
			}],
		};
		const result = validate(fixture);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain("source_item_key");
	});

	it("accepts all three daily buckets carrying source_item_key", () => {
		const fixture = {
			...VALID_FIXTURE,
			daily_updates: [{
				date: "2026-09-11",
				trackers: [{
					field: "mood", value: "good", reason: "r",
					source_stem: "some-note", source_item_key: "100 Inbox/some-note.md",
					accepted: true,
				}],
				log_entries: [VALID_LOG_ENTRY],
				log_links: [{
					target_stem: "some-atomic", time: null,
					position: "after_last_line", reason: "r",
					source_item_key: "100 Inbox/origin.md", accepted: true,
				}],
			}],
		};
		const result = validate(fixture);
		expect(result.ok, result.ok ? "" : result.message).toBe(true);
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
