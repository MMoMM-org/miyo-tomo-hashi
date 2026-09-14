import { describe, expect, it } from "vitest";
import { FakeSuggestionsDoc } from "../../../__mocks__/FakeSuggestionsDoc.js";
import {
	setForceAtomicFromDaily,
	setForceAtomicFromSuggestion,
} from "../../../../src/suggestions/transforms/forceAtomicSync.js";
import { validate } from "../../../../src/schema/suggestions-validator.js";
import threeBucketRun from "../../../fixtures/suggestions/three-bucket-run.json";
import type {
	DailyLogEntryWire,
	DailyUpdateWire,
	EditModel,
	SuggestionWire,
	SuggestionsWire,
} from "../../../../src/types/suggestions.js";

// ---------------------------------------------------------------------------
// Factories — minimal, schema-complete objects with type-safe overrides.
// No `let`/`beforeEach`; every test builds its own fresh state (T1.4 scope:
// force_atomic identity-sync between suggestions[] and daily log_entries[]).
//
// The join key is `item_key` / `source_item_key` (the note's vault-relative
// path), NOT the display stem — so overrides below always move both together,
// the way a real emission does.
// ---------------------------------------------------------------------------

const SHARED_KEY = "100 Inbox/shared-stem.md";
const OTHER_KEY = "100 Inbox/other-stem.md";

const getMockSuggestion = (overrides?: Partial<SuggestionWire>): SuggestionWire => ({
	id: "S01",
	stem: "shared-stem",
	item_key: SHARED_KEY,
	title: "Some Note",
	template: "[[Templates/Atomic]]",
	location: "202 Notes",
	tags: [],
	decision: "approve",
	keep_source: false,
	delete_source: false,
	force_atomic: false,
	suppressed: false,
	candidate_mocs: [],
	...overrides,
});

const getMockLogEntry = (overrides?: Partial<DailyLogEntryWire>): DailyLogEntryWire => ({
	time: null,
	position: "after_last_line",
	content: "Some log content.",
	reason: "test fixture",
	source_stem: "shared-stem",
	source_item_key: SHARED_KEY,
	accepted: false,
	force_atomic_note: false,
	...overrides,
});

const getMockDailyUpdate = (overrides?: Partial<DailyUpdateWire>): DailyUpdateWire => ({
	date: "2026-07-06",
	trackers: [],
	log_entries: [getMockLogEntry()],
	log_links: [],
	...overrides,
});

const getMockWire = (overrides?: Partial<SuggestionsWire>): SuggestionsWire => ({
	schema_version: "2",
	generated: "2026-07-06T11:15:00Z",
	run_id: "test-run",
	profile: "test-profile",
	source_items: 1,
	emit_digest: "sha256:" + "0".repeat(64),
	suggestions: [getMockSuggestion()],
	proposed_mocs: [],
	daily_updates: [getMockDailyUpdate()],
	tag_handler_groups: [],
	...overrides,
});

const getMockModel = (overrides?: Partial<SuggestionsWire>): EditModel => ({
	doc: getMockWire(overrides),
	dirty: false,
});

describe("setForceAtomicFromSuggestion", () => {
	it("flips the matching daily log entry's force_atomic_note to keep both fields equal", () => {
		const model = getMockModel();

		const result = setForceAtomicFromSuggestion(model, "S01", true);

		expect(result.doc.suggestions[0]?.force_atomic).toBe(true);
		expect(result.doc.daily_updates[0]?.log_entries[0]?.force_atomic_note).toBe(true);
		expect(result.dirty).toBe(true);
	});

	it("updates every log entry across all daily_updates dates sharing the item_key", () => {
		const model = getMockModel({
			suggestions: [getMockSuggestion({ id: "S01", item_key: SHARED_KEY, force_atomic: false })],
			daily_updates: [
				getMockDailyUpdate({
					date: "2026-07-05",
					log_entries: [
						getMockLogEntry({ source_item_key: SHARED_KEY, force_atomic_note: false }),
					],
				}),
				getMockDailyUpdate({
					date: "2026-07-06",
					log_entries: [
						getMockLogEntry({ source_item_key: SHARED_KEY, force_atomic_note: false }),
					],
				}),
			],
		});

		const result = setForceAtomicFromSuggestion(model, "S01", true);

		expect(result.doc.daily_updates[0]?.log_entries[0]?.force_atomic_note).toBe(true);
		expect(result.doc.daily_updates[1]?.log_entries[0]?.force_atomic_note).toBe(true);
	});

	it("leaves unrelated notes (suggestion and daily entry) untouched", () => {
		const model = getMockModel({
			suggestions: [
				getMockSuggestion({ id: "S01", stem: "shared-stem", item_key: SHARED_KEY }),
				getMockSuggestion({ id: "S02", stem: "other-stem", item_key: OTHER_KEY }),
			],
			daily_updates: [
				getMockDailyUpdate({
					log_entries: [
						getMockLogEntry({ source_stem: "shared-stem", source_item_key: SHARED_KEY }),
						getMockLogEntry({ source_stem: "other-stem", source_item_key: OTHER_KEY }),
					],
				}),
			],
		});

		const result = setForceAtomicFromSuggestion(model, "S01", true);

		expect(result.doc.suggestions[1]?.force_atomic).toBe(false);
		expect(result.doc.daily_updates[0]?.log_entries[1]?.force_atomic_note).toBe(false);
	});

	// The defect this join was repointed to fix (our 2026-09-12 handoff §4):
	// same display stem, two different notes. Keyed on the stem, toggling one
	// reached across and flipped the other.
	it("leaves a NAMESAKE in another folder untouched — same stem, different item_key", () => {
		const imagesKey = "100 Inbox/Images/Test.md";
		const assetsKey = "100 Inbox/assets/Test.md";
		const model = getMockModel({
			suggestions: [
				getMockSuggestion({ id: "S01", stem: "Test", item_key: imagesKey }),
				getMockSuggestion({ id: "S02", stem: "Test", item_key: assetsKey }),
			],
			daily_updates: [
				getMockDailyUpdate({
					log_entries: [
						getMockLogEntry({ source_stem: "Test", source_item_key: assetsKey }),
					],
				}),
			],
		});

		const result = setForceAtomicFromSuggestion(model, "S01", true);

		expect(result.doc.suggestions[0]?.force_atomic).toBe(true);
		expect(result.doc.suggestions[1]?.force_atomic).toBe(false);
		// The log entry belongs to the OTHER Test note and must not move.
		expect(result.doc.daily_updates[0]?.log_entries[0]?.force_atomic_note).toBe(false);
	});

	// The same defect, driven by the real emission rather than a hand-built
	// model: Tomo's 2026-09-14 three-bucket run carries stem "Test" as a
	// suggestion (100 Inbox/Images/Test.md) and, separately, as a 2026-09-06
	// log entry belonging to 100 Inbox/assets/Test.md. Promoting the
	// suggestion must not tick Force Atomic on the other note's log entry.
	it("does not cross-wire the namesake pair in the vendored three-bucket run", () => {
		const parsed = validate(threeBucketRun);
		if (!parsed.ok) throw new Error(parsed.message);
		const model: EditModel = { doc: parsed.data, dirty: false };

		const namesake = model.doc.suggestions.find((s) => s.stem === "Test");
		const entry = model.doc.daily_updates
			.flatMap((du) => du.log_entries)
			.find((le) => le.source_stem === "Test");
		if (!namesake || !entry) throw new Error("fixture no longer carries the Test namesake pair");
		// Guard the premise: same display stem, genuinely different notes.
		expect(namesake.item_key).not.toBe(entry.source_item_key);

		const result = setForceAtomicFromSuggestion(model, namesake.id, true);

		expect(result.doc.suggestions.find((s) => s.id === namesake.id)?.force_atomic).toBe(true);
		const entryAfter = result.doc.daily_updates
			.flatMap((du) => du.log_entries)
			.find((le) => le.source_item_key === entry.source_item_key);
		expect(entryAfter?.force_atomic_note).toBe(false);
	});

	it("is a no-op (dirty:false, unchanged) for an unknown suggestion id", () => {
		const model = getMockModel();

		const result = setForceAtomicFromSuggestion(model, "S99", true);

		expect(result).toBe(model);
		expect(result.dirty).toBe(model.dirty);
	});

	it("is a no-op when the value already matches everywhere", () => {
		const model = getMockModel({
			suggestions: [getMockSuggestion({ id: "S01", force_atomic: true })],
			daily_updates: [
				getMockDailyUpdate({
					log_entries: [getMockLogEntry({ force_atomic_note: true })],
				}),
			],
		});

		const result = setForceAtomicFromSuggestion(model, "S01", true);

		expect(result).toBe(model);
		expect(result.dirty).toBe(model.dirty);
	});

	it("does not mutate the original model or doc", () => {
		const model = getMockModel();
		const snapshot = JSON.parse(JSON.stringify(model)) as EditModel;

		setForceAtomicFromSuggestion(model, "S01", true);

		expect(model).toEqual(snapshot);
	});

	it("stays consistent for the real call-vendor dual-appearance case (S01 + 2026-07-05 log entry)", async () => {
		const callVendorKey = "100 Inbox/call-vendor.md";
		const model = await new FakeSuggestionsDoc().load("x");

		const toggledOn = setForceAtomicFromSuggestion(model, "S01", true);
		const suggestion = toggledOn.doc.suggestions.find((s) => s.id === "S01");
		const dailyEntry = toggledOn.doc.daily_updates
			.flatMap((du) => du.log_entries)
			.find((le) => le.source_item_key === callVendorKey);
		expect(suggestion?.force_atomic).toBe(true);
		expect(dailyEntry?.force_atomic_note).toBe(true);
		expect(suggestion?.force_atomic).toBe(dailyEntry?.force_atomic_note);

		const toggledOff = setForceAtomicFromDaily(toggledOn, callVendorKey, false);
		const suggestionOff = toggledOff.doc.suggestions.find((s) => s.id === "S01");
		const dailyEntryOff = toggledOff.doc.daily_updates
			.flatMap((du) => du.log_entries)
			.find((le) => le.source_item_key === callVendorKey);
		expect(suggestionOff?.force_atomic).toBe(false);
		expect(dailyEntryOff?.force_atomic_note).toBe(false);
		expect(suggestionOff?.force_atomic).toBe(dailyEntryOff?.force_atomic_note);

		// isolation: the unrelated workout-log daily entry is untouched throughout
		const workoutEntry = toggledOff.doc.daily_updates
			.flatMap((du) => du.log_entries)
			.find((le) => le.source_item_key === "100 Inbox/workout-log.md");
		expect(workoutEntry?.force_atomic_note).toBe(false);
	});
});

describe("setForceAtomicFromDaily", () => {
	it("flips the matching suggestion's force_atomic to keep both fields equal", () => {
		const model = getMockModel();

		const result = setForceAtomicFromDaily(model, SHARED_KEY, true);

		expect(result.doc.daily_updates[0]?.log_entries[0]?.force_atomic_note).toBe(true);
		expect(result.doc.suggestions[0]?.force_atomic).toBe(true);
		expect(result.dirty).toBe(true);
	});

	it("updates every suggestion sharing the item_key", () => {
		const model = getMockModel({
			suggestions: [
				getMockSuggestion({ id: "S01", item_key: SHARED_KEY, force_atomic: false }),
				getMockSuggestion({ id: "S02", item_key: SHARED_KEY, force_atomic: false }),
			],
			daily_updates: [
				getMockDailyUpdate({
					log_entries: [
						getMockLogEntry({ source_item_key: SHARED_KEY, force_atomic_note: false }),
					],
				}),
			],
		});

		const result = setForceAtomicFromDaily(model, SHARED_KEY, true);

		expect(result.doc.suggestions[0]?.force_atomic).toBe(true);
		expect(result.doc.suggestions[1]?.force_atomic).toBe(true);
	});

	it("leaves unrelated notes (suggestion and daily entry) untouched", () => {
		const model = getMockModel({
			suggestions: [
				getMockSuggestion({ id: "S01", stem: "shared-stem", item_key: SHARED_KEY }),
				getMockSuggestion({ id: "S02", stem: "other-stem", item_key: OTHER_KEY }),
			],
			daily_updates: [
				getMockDailyUpdate({
					log_entries: [
						getMockLogEntry({ source_stem: "shared-stem", source_item_key: SHARED_KEY }),
						getMockLogEntry({ source_stem: "other-stem", source_item_key: OTHER_KEY }),
					],
				}),
			],
		});

		const result = setForceAtomicFromDaily(model, SHARED_KEY, true);

		expect(result.doc.suggestions[1]?.force_atomic).toBe(false);
		expect(result.doc.daily_updates[0]?.log_entries[1]?.force_atomic_note).toBe(false);
	});

	it("is a no-op (dirty:false, unchanged) for an item_key with no matches anywhere", () => {
		const model = getMockModel();

		const result = setForceAtomicFromDaily(model, "100 Inbox/no-such-note.md", true);

		expect(result).toBe(model);
		expect(result.dirty).toBe(model.dirty);
	});

	it("is a no-op when the value already matches everywhere", () => {
		const model = getMockModel({
			suggestions: [getMockSuggestion({ id: "S01", force_atomic: true })],
			daily_updates: [
				getMockDailyUpdate({
					log_entries: [getMockLogEntry({ force_atomic_note: true })],
				}),
			],
		});

		const result = setForceAtomicFromDaily(model, SHARED_KEY, true);

		expect(result).toBe(model);
		expect(result.dirty).toBe(model.dirty);
	});

	it("does not mutate the original model or doc", () => {
		const model = getMockModel();
		const snapshot = JSON.parse(JSON.stringify(model)) as EditModel;

		setForceAtomicFromDaily(model, SHARED_KEY, true);

		expect(model).toEqual(snapshot);
	});
});
