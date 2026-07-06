import { describe, expect, it } from "vitest";
import { FakeSuggestionsDoc } from "../../../__mocks__/FakeSuggestionsDoc.js";
import {
	setForceAtomicFromDaily,
	setForceAtomicFromSuggestion,
} from "../../../../src/suggestions/transforms/forceAtomicSync.js";
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
// force_atomic stem-sync between suggestions[] and daily log_entries[]).
// ---------------------------------------------------------------------------

const getMockSuggestion = (overrides?: Partial<SuggestionWire>): SuggestionWire => ({
	id: "S01",
	stem: "shared-stem",
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
	schema_version: "1",
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

	it("updates every log entry across all daily_updates dates sharing the stem", () => {
		const model = getMockModel({
			suggestions: [getMockSuggestion({ id: "S01", stem: "shared-stem", force_atomic: false })],
			daily_updates: [
				getMockDailyUpdate({
					date: "2026-07-05",
					log_entries: [getMockLogEntry({ source_stem: "shared-stem", force_atomic_note: false })],
				}),
				getMockDailyUpdate({
					date: "2026-07-06",
					log_entries: [getMockLogEntry({ source_stem: "shared-stem", force_atomic_note: false })],
				}),
			],
		});

		const result = setForceAtomicFromSuggestion(model, "S01", true);

		expect(result.doc.daily_updates[0]?.log_entries[0]?.force_atomic_note).toBe(true);
		expect(result.doc.daily_updates[1]?.log_entries[0]?.force_atomic_note).toBe(true);
	});

	it("leaves unrelated stems (suggestion and daily entry) untouched", () => {
		const model = getMockModel({
			suggestions: [
				getMockSuggestion({ id: "S01", stem: "shared-stem", force_atomic: false }),
				getMockSuggestion({ id: "S02", stem: "other-stem", force_atomic: false }),
			],
			daily_updates: [
				getMockDailyUpdate({
					log_entries: [
						getMockLogEntry({ source_stem: "shared-stem", force_atomic_note: false }),
						getMockLogEntry({ source_stem: "other-stem", force_atomic_note: false }),
					],
				}),
			],
		});

		const result = setForceAtomicFromSuggestion(model, "S01", true);

		expect(result.doc.suggestions[1]?.force_atomic).toBe(false);
		expect(result.doc.daily_updates[0]?.log_entries[1]?.force_atomic_note).toBe(false);
	});

	it("is a no-op (dirty:false, unchanged) for an unknown suggestion id", () => {
		const model = getMockModel();

		const result = setForceAtomicFromSuggestion(model, "S99", true);

		expect(result).toBe(model);
		expect(result.dirty).toBe(model.dirty);
	});

	it("is a no-op when the value already matches everywhere", () => {
		const model = getMockModel({
			suggestions: [getMockSuggestion({ id: "S01", stem: "shared-stem", force_atomic: true })],
			daily_updates: [
				getMockDailyUpdate({
					log_entries: [getMockLogEntry({ source_stem: "shared-stem", force_atomic_note: true })],
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
		const model = await new FakeSuggestionsDoc().load("x");

		const toggledOn = setForceAtomicFromSuggestion(model, "S01", true);
		const suggestion = toggledOn.doc.suggestions.find((s) => s.id === "S01");
		const dailyEntry = toggledOn.doc.daily_updates
			.flatMap((du) => du.log_entries)
			.find((le) => le.source_stem === "call-vendor");
		expect(suggestion?.force_atomic).toBe(true);
		expect(dailyEntry?.force_atomic_note).toBe(true);
		expect(suggestion?.force_atomic).toBe(dailyEntry?.force_atomic_note);

		const toggledOff = setForceAtomicFromDaily(toggledOn, "call-vendor", false);
		const suggestionOff = toggledOff.doc.suggestions.find((s) => s.id === "S01");
		const dailyEntryOff = toggledOff.doc.daily_updates
			.flatMap((du) => du.log_entries)
			.find((le) => le.source_stem === "call-vendor");
		expect(suggestionOff?.force_atomic).toBe(false);
		expect(dailyEntryOff?.force_atomic_note).toBe(false);
		expect(suggestionOff?.force_atomic).toBe(dailyEntryOff?.force_atomic_note);

		// isolation: the unrelated workout-log daily entry is untouched throughout
		const workoutEntry = toggledOff.doc.daily_updates
			.flatMap((du) => du.log_entries)
			.find((le) => le.source_stem === "workout-log");
		expect(workoutEntry?.force_atomic_note).toBe(false);
	});
});

describe("setForceAtomicFromDaily", () => {
	it("flips the matching suggestion's force_atomic to keep both fields equal", () => {
		const model = getMockModel();

		const result = setForceAtomicFromDaily(model, "shared-stem", true);

		expect(result.doc.daily_updates[0]?.log_entries[0]?.force_atomic_note).toBe(true);
		expect(result.doc.suggestions[0]?.force_atomic).toBe(true);
		expect(result.dirty).toBe(true);
	});

	it("updates every suggestion sharing the stem", () => {
		const model = getMockModel({
			suggestions: [
				getMockSuggestion({ id: "S01", stem: "shared-stem", force_atomic: false }),
				getMockSuggestion({ id: "S02", stem: "shared-stem", force_atomic: false }),
			],
			daily_updates: [
				getMockDailyUpdate({
					log_entries: [getMockLogEntry({ source_stem: "shared-stem", force_atomic_note: false })],
				}),
			],
		});

		const result = setForceAtomicFromDaily(model, "shared-stem", true);

		expect(result.doc.suggestions[0]?.force_atomic).toBe(true);
		expect(result.doc.suggestions[1]?.force_atomic).toBe(true);
	});

	it("leaves unrelated stems (suggestion and daily entry) untouched", () => {
		const model = getMockModel({
			suggestions: [
				getMockSuggestion({ id: "S01", stem: "shared-stem", force_atomic: false }),
				getMockSuggestion({ id: "S02", stem: "other-stem", force_atomic: false }),
			],
			daily_updates: [
				getMockDailyUpdate({
					log_entries: [
						getMockLogEntry({ source_stem: "shared-stem", force_atomic_note: false }),
						getMockLogEntry({ source_stem: "other-stem", force_atomic_note: false }),
					],
				}),
			],
		});

		const result = setForceAtomicFromDaily(model, "shared-stem", true);

		expect(result.doc.suggestions[1]?.force_atomic).toBe(false);
		expect(result.doc.daily_updates[0]?.log_entries[1]?.force_atomic_note).toBe(false);
	});

	it("is a no-op (dirty:false, unchanged) for a stem with no matches anywhere", () => {
		const model = getMockModel();

		const result = setForceAtomicFromDaily(model, "no-such-stem", true);

		expect(result).toBe(model);
		expect(result.dirty).toBe(model.dirty);
	});

	it("is a no-op when the value already matches everywhere", () => {
		const model = getMockModel({
			suggestions: [getMockSuggestion({ id: "S01", stem: "shared-stem", force_atomic: true })],
			daily_updates: [
				getMockDailyUpdate({
					log_entries: [getMockLogEntry({ source_stem: "shared-stem", force_atomic_note: true })],
				}),
			],
		});

		const result = setForceAtomicFromDaily(model, "shared-stem", true);

		expect(result).toBe(model);
		expect(result.dirty).toBe(model.dirty);
	});

	it("does not mutate the original model or doc", () => {
		const model = getMockModel();
		const snapshot = JSON.parse(JSON.stringify(model)) as EditModel;

		setForceAtomicFromDaily(model, "shared-stem", true);

		expect(model).toEqual(snapshot);
	});
});
