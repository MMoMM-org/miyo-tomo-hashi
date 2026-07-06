import { describe, it, expect } from "vitest";
import {
	setDailyLogContent,
	setDailyLogPosition,
	setDailyLogTime,
	setDailyTrackerAccepted,
	setDailyLogAccepted,
	setDailyLogLinkAccepted,
} from "../../../../src/suggestions/transforms/daily.js";
import type {
	DailyLogEntryWire,
	DailyLogLinkWire,
	DailyTrackerWire,
	DailyUpdateWire,
	EditModel,
	SuggestionsWire,
} from "../../../../src/types/suggestions.js";

// ---------------------------------------------------------------------------
// Factories — build complete, valid wire objects with overrides, per the
// suggestions-editor testing convention (fresh state per test, no shared
// mutable fixtures).
// ---------------------------------------------------------------------------

function getMockTracker(overrides?: Partial<DailyTrackerWire>): DailyTrackerWire {
	return {
		field: "mood",
		value: "good",
		reason: "mentioned in log",
		source_stem: "2026-07-06-note",
		accepted: false,
		...overrides,
	};
}

function getMockLogEntry(overrides?: Partial<DailyLogEntryWire>): DailyLogEntryWire {
	return {
		time: "09:00",
		position: "at_time",
		content: "Had coffee",
		reason: "mentioned in log",
		source_stem: "2026-07-06-note",
		accepted: false,
		force_atomic_note: false,
		...overrides,
	};
}

function getMockLogLink(overrides?: Partial<DailyLogLinkWire>): DailyLogLinkWire {
	return {
		target_stem: "some-atomic-note",
		time: "10:00",
		position: "at_time",
		reason: "mentioned in log",
		accepted: false,
		...overrides,
	};
}

function getMockDailyUpdate(overrides?: Partial<DailyUpdateWire>): DailyUpdateWire {
	return {
		date: "2026-07-06",
		trackers: [getMockTracker()],
		log_entries: [getMockLogEntry()],
		log_links: [getMockLogLink()],
		...overrides,
	};
}

function getMockWire(overrides?: Partial<SuggestionsWire>): SuggestionsWire {
	return {
		schema_version: "1",
		generated: "2026-07-06T11:15:00Z",
		run_id: "run-1",
		profile: "default",
		source_items: 1,
		emit_digest: `sha256:${"a".repeat(64)}`,
		suggestions: [],
		proposed_mocs: [],
		daily_updates: [getMockDailyUpdate()],
		tag_handler_groups: [],
		...overrides,
	};
}

function getMockEditModel(overrides?: Partial<EditModel>): EditModel {
	return {
		doc: getMockWire(),
		dirty: false,
		...overrides,
	};
}

/** A two-daily-update model with multiple items per array, for sibling-preservation checks. */
function getMultiDailyModel(): EditModel {
	return getMockEditModel({
		doc: getMockWire({
			daily_updates: [
				getMockDailyUpdate({
					date: "2026-07-06",
					trackers: [
						getMockTracker({ field: "mood", value: "good" }),
						getMockTracker({ field: "sleep", value: "7h" }),
					],
					log_entries: [
						getMockLogEntry({ content: "First entry" }),
						getMockLogEntry({ content: "Second entry" }),
					],
					log_links: [
						getMockLogLink({ target_stem: "note-a" }),
						getMockLogLink({ target_stem: "note-b" }),
					],
				}),
				getMockDailyUpdate({
					date: "2026-07-05",
					trackers: [getMockTracker({ field: "weight", value: "70kg" })],
					log_entries: [getMockLogEntry({ content: "Yesterday entry" })],
					log_links: [getMockLogLink({ target_stem: "note-c" })],
				}),
			],
		}),
	});
}

describe("setDailyLogContent", () => {
	it("sets the content of the addressed log entry and marks dirty", () => {
		const model = getMultiDailyModel();

		const result = setDailyLogContent(model, "2026-07-06", 0, "Updated content");

		expect(result.dirty).toBe(true);
		expect(result.doc.daily_updates[0]?.log_entries[0]?.content).toBe("Updated content");
	});

	it("preserves untouched siblings verbatim: other entries, other dates, trackers, links", () => {
		const model = getMultiDailyModel();
		const before = structuredClone(model);

		const result = setDailyLogContent(model, "2026-07-06", 0, "Updated content");

		// Other log entry in the same daily update, untouched.
		expect(result.doc.daily_updates[0]?.log_entries[1]).toEqual(
			before.doc.daily_updates[0]?.log_entries[1],
		);
		// Other date's daily update, untouched.
		expect(result.doc.daily_updates[1]).toEqual(before.doc.daily_updates[1]);
		// Trackers and links for the touched date, untouched.
		expect(result.doc.daily_updates[0]?.trackers).toEqual(before.doc.daily_updates[0]?.trackers);
		expect(result.doc.daily_updates[0]?.log_links).toEqual(
			before.doc.daily_updates[0]?.log_links,
		);
	});

	it("does not mutate the original model or doc", () => {
		const model = getMultiDailyModel();
		const before = structuredClone(model);

		setDailyLogContent(model, "2026-07-06", 0, "Updated content");

		expect(model).toEqual(before);
	});

	it("returns the model unchanged with dirty:false for an unknown date", () => {
		const model = getMultiDailyModel();

		const result = setDailyLogContent(model, "1999-01-01", 0, "Nope");

		expect(result.dirty).toBe(false);
		expect(result.doc).toBe(model.doc);
	});

	it("returns the model unchanged with dirty:false for an out-of-range entry index", () => {
		const model = getMultiDailyModel();

		const result = setDailyLogContent(model, "2026-07-06", 99, "Nope");

		expect(result.dirty).toBe(false);
		expect(result.doc).toBe(model.doc);
	});

	it("returns the model unchanged with dirty:false when content already equals the requested value", () => {
		const model = getMultiDailyModel();
		const existingContent = model.doc.daily_updates[0]?.log_entries[0]?.content as string;

		const result = setDailyLogContent(model, "2026-07-06", 0, existingContent);

		expect(result.dirty).toBe(false);
		expect(result.doc).toBe(model.doc);
	});
});

describe("setDailyLogPosition", () => {
	it("sets position and marks dirty", () => {
		const model = getMockEditModel({
			doc: getMockWire({
				daily_updates: [
					getMockDailyUpdate({
						log_entries: [getMockLogEntry({ position: "at_time", time: "09:00" })],
					}),
				],
			}),
		});

		const result = setDailyLogPosition(model, "2026-07-06", 0, "after_last_line");

		expect(result.dirty).toBe(true);
		expect(result.doc.daily_updates[0]?.log_entries[0]?.position).toBe("after_last_line");
	});

	it("clears time to null when switching away from at_time", () => {
		const model = getMockEditModel({
			doc: getMockWire({
				daily_updates: [
					getMockDailyUpdate({
						log_entries: [getMockLogEntry({ position: "at_time", time: "09:00" })],
					}),
				],
			}),
		});

		const afterLast = setDailyLogPosition(model, "2026-07-06", 0, "after_last_line");
		expect(afterLast.doc.daily_updates[0]?.log_entries[0]?.time).toBeNull();

		const beforeFirst = setDailyLogPosition(model, "2026-07-06", 0, "before_first_line");
		expect(beforeFirst.doc.daily_updates[0]?.log_entries[0]?.time).toBeNull();
	});

	it("preserves the existing time when switching to at_time", () => {
		const model = getMockEditModel({
			doc: getMockWire({
				daily_updates: [
					getMockDailyUpdate({
						log_entries: [getMockLogEntry({ position: "after_last_line", time: null })],
					}),
				],
			}),
		});

		const result = setDailyLogPosition(model, "2026-07-06", 0, "at_time");

		expect(result.doc.daily_updates[0]?.log_entries[0]?.position).toBe("at_time");
		expect(result.doc.daily_updates[0]?.log_entries[0]?.time).toBeNull();
	});

	it("returns unchanged with dirty:false for an unknown date", () => {
		const model = getMultiDailyModel();

		const result = setDailyLogPosition(model, "does-not-exist", 0, "after_last_line");

		expect(result.dirty).toBe(false);
		expect(result.doc).toBe(model.doc);
	});

	it("returns unchanged with dirty:false for an out-of-range entry index", () => {
		const model = getMultiDailyModel();

		const result = setDailyLogPosition(model, "2026-07-06", 42, "after_last_line");

		expect(result.dirty).toBe(false);
		expect(result.doc).toBe(model.doc);
	});

	it("returns unchanged with dirty:false when position already equals the requested value", () => {
		const model = getMockEditModel({
			doc: getMockWire({
				daily_updates: [
					getMockDailyUpdate({
						log_entries: [getMockLogEntry({ position: "at_time", time: "09:00" })],
					}),
				],
			}),
		});

		const result = setDailyLogPosition(model, "2026-07-06", 0, "at_time");

		expect(result.dirty).toBe(false);
		expect(result.doc).toBe(model.doc);
	});
});

describe("setDailyLogTime", () => {
	it("sets time when position is at_time and marks dirty", () => {
		const model = getMockEditModel({
			doc: getMockWire({
				daily_updates: [
					getMockDailyUpdate({
						log_entries: [getMockLogEntry({ position: "at_time", time: "09:00" })],
					}),
				],
			}),
		});

		const result = setDailyLogTime(model, "2026-07-06", 0, "14:30");

		expect(result.dirty).toBe(true);
		expect(result.doc.daily_updates[0]?.log_entries[0]?.time).toBe("14:30");
	});

	it("rejects (unchanged, dirty:false) when position is after_last_line", () => {
		const model = getMockEditModel({
			doc: getMockWire({
				daily_updates: [
					getMockDailyUpdate({
						log_entries: [getMockLogEntry({ position: "after_last_line", time: null })],
					}),
				],
			}),
		});

		const result = setDailyLogTime(model, "2026-07-06", 0, "14:30");

		expect(result.dirty).toBe(false);
		expect(result.doc).toBe(model.doc);
		expect(result.doc.daily_updates[0]?.log_entries[0]?.time).toBeNull();
	});

	it("rejects (unchanged, dirty:false) when position is before_first_line", () => {
		const model = getMockEditModel({
			doc: getMockWire({
				daily_updates: [
					getMockDailyUpdate({
						log_entries: [getMockLogEntry({ position: "before_first_line", time: null })],
					}),
				],
			}),
		});

		const result = setDailyLogTime(model, "2026-07-06", 0, "14:30");

		expect(result.dirty).toBe(false);
		expect(result.doc).toBe(model.doc);
	});

	it("returns unchanged with dirty:false for an unknown date", () => {
		const model = getMultiDailyModel();

		const result = setDailyLogTime(model, "does-not-exist", 0, "14:30");

		expect(result.dirty).toBe(false);
		expect(result.doc).toBe(model.doc);
	});

	it("returns unchanged with dirty:false for an out-of-range entry index", () => {
		const model = getMultiDailyModel();

		const result = setDailyLogTime(model, "2026-07-06", 99, "14:30");

		expect(result.dirty).toBe(false);
		expect(result.doc).toBe(model.doc);
	});

	it("returns unchanged with dirty:false when position is at_time and time already equals the requested value", () => {
		const model = getMockEditModel({
			doc: getMockWire({
				daily_updates: [
					getMockDailyUpdate({
						log_entries: [getMockLogEntry({ position: "at_time", time: "09:00" })],
					}),
				],
			}),
		});

		const result = setDailyLogTime(model, "2026-07-06", 0, "09:00");

		expect(result.dirty).toBe(false);
		expect(result.doc).toBe(model.doc);
	});
});

describe("setDailyTrackerAccepted", () => {
	it("toggles a tracker's accepted flag and marks dirty", () => {
		const model = getMultiDailyModel();

		const result = setDailyTrackerAccepted(model, "2026-07-06", 1, true);

		expect(result.dirty).toBe(true);
		expect(result.doc.daily_updates[0]?.trackers[1]?.accepted).toBe(true);
		// Sibling tracker untouched.
		expect(result.doc.daily_updates[0]?.trackers[0]?.accepted).toBe(false);
	});

	it("returns unchanged with dirty:false for an unknown date", () => {
		const model = getMultiDailyModel();

		const result = setDailyTrackerAccepted(model, "nope", 0, true);

		expect(result.dirty).toBe(false);
		expect(result.doc).toBe(model.doc);
	});

	it("returns unchanged with dirty:false for an out-of-range tracker index", () => {
		const model = getMultiDailyModel();

		const result = setDailyTrackerAccepted(model, "2026-07-06", 99, true);

		expect(result.dirty).toBe(false);
		expect(result.doc).toBe(model.doc);
	});

	it("returns unchanged with dirty:false when accepted already equals the requested value", () => {
		const model = getMultiDailyModel();

		const result = setDailyTrackerAccepted(model, "2026-07-06", 0, false);

		expect(result.dirty).toBe(false);
		expect(result.doc).toBe(model.doc);
	});
});

describe("setDailyLogAccepted", () => {
	it("toggles a log entry's accepted flag and marks dirty", () => {
		const model = getMultiDailyModel();

		const result = setDailyLogAccepted(model, "2026-07-06", 1, true);

		expect(result.dirty).toBe(true);
		expect(result.doc.daily_updates[0]?.log_entries[1]?.accepted).toBe(true);
		expect(result.doc.daily_updates[0]?.log_entries[0]?.accepted).toBe(false);
	});

	it("returns unchanged with dirty:false for an unknown date", () => {
		const model = getMultiDailyModel();

		const result = setDailyLogAccepted(model, "nope", 0, true);

		expect(result.dirty).toBe(false);
		expect(result.doc).toBe(model.doc);
	});

	it("returns unchanged with dirty:false for an out-of-range entry index", () => {
		const model = getMultiDailyModel();

		const result = setDailyLogAccepted(model, "2026-07-06", 99, true);

		expect(result.dirty).toBe(false);
		expect(result.doc).toBe(model.doc);
	});

	it("returns unchanged with dirty:false when accepted already equals the requested value", () => {
		const model = getMultiDailyModel();

		const result = setDailyLogAccepted(model, "2026-07-06", 0, false);

		expect(result.dirty).toBe(false);
		expect(result.doc).toBe(model.doc);
	});
});

describe("setDailyLogLinkAccepted", () => {
	it("toggles a log link's accepted flag and marks dirty", () => {
		const model = getMultiDailyModel();

		const result = setDailyLogLinkAccepted(model, "2026-07-06", 1, true);

		expect(result.dirty).toBe(true);
		expect(result.doc.daily_updates[0]?.log_links[1]?.accepted).toBe(true);
		expect(result.doc.daily_updates[0]?.log_links[0]?.accepted).toBe(false);
	});

	it("preserves siblings (other date, trackers, entries) when toggling a link", () => {
		const model = getMultiDailyModel();
		const before = structuredClone(model);

		const result = setDailyLogLinkAccepted(model, "2026-07-06", 1, true);

		expect(result.doc.daily_updates[1]).toEqual(before.doc.daily_updates[1]);
		expect(result.doc.daily_updates[0]?.trackers).toEqual(before.doc.daily_updates[0]?.trackers);
		expect(result.doc.daily_updates[0]?.log_entries).toEqual(
			before.doc.daily_updates[0]?.log_entries,
		);
	});

	it("returns unchanged with dirty:false for an unknown date", () => {
		const model = getMultiDailyModel();

		const result = setDailyLogLinkAccepted(model, "nope", 0, true);

		expect(result.dirty).toBe(false);
		expect(result.doc).toBe(model.doc);
	});

	it("returns unchanged with dirty:false for an out-of-range link index", () => {
		const model = getMultiDailyModel();

		const result = setDailyLogLinkAccepted(model, "2026-07-06", 99, true);

		expect(result.dirty).toBe(false);
		expect(result.doc).toBe(model.doc);
	});

	it("returns unchanged with dirty:false when accepted already equals the requested value", () => {
		const model = getMultiDailyModel();

		const result = setDailyLogLinkAccepted(model, "2026-07-06", 0, false);

		expect(result.dirty).toBe(false);
		expect(result.doc).toBe(model.doc);
	});
});

describe("no-op paths preserve a pre-existing dirty:true (regression)", () => {
	// A no-op (same-value call, unknown date, or bad index) must never
	// fabricate a new model or force dirty back to false — that would wipe
	// an already-pending, unsaved edit from an earlier real transform. Every
	// no-op path must return the EXACT SAME model reference the caller
	// passed in, dirty value included.

	it("a same-value no-op returns the identical model reference and preserves dirty:true", () => {
		const model: EditModel = { ...getMultiDailyModel(), dirty: true };

		// entry 0's accepted is already false (see getMockLogEntry default).
		const result = setDailyLogAccepted(model, "2026-07-06", 0, false);

		expect(result).toBe(model);
		expect(result.dirty).toBe(true);
	});

	it("an unknown-date rejection returns the identical model reference and preserves dirty:true", () => {
		const model: EditModel = { ...getMultiDailyModel(), dirty: true };

		const result = setDailyLogAccepted(model, "does-not-exist", 0, true);

		expect(result).toBe(model);
		expect(result.dirty).toBe(true);
	});

	it("an out-of-range index rejection returns the identical model reference and preserves dirty:true", () => {
		const model: EditModel = { ...getMultiDailyModel(), dirty: true };

		const result = setDailyLogAccepted(model, "2026-07-06", 99, true);

		expect(result).toBe(model);
		expect(result.dirty).toBe(true);
	});
});
