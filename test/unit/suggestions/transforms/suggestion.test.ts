/**
 * Suggestion field transforms (T1.3) — pure `EditModel → EditModel` behavior
 * for op 1 (candidate-MOC re-point / add), op 4 (approve/skip decision), and
 * the plain note-editable fields (title/template/location/tags/keepSource/
 * deleteSource). SDD §5-§6.
 *
 * Every transform is exercised through its public function only (no reach
 * into `EditModel.doc` internals beyond assertion), and every authorization
 * case is paired with a rejection/no-op case per MiYo Constitution L1
 * (Testing — permission/validation logic must prove both).
 */

import { describe, expect, it } from "vitest";
import {
	addMoc,
	setDecision,
	setDeleteSource,
	setKeepSource,
	setLocation,
	setTags,
	setTemplate,
	setTitle,
	toggleCandidateMoc,
} from "../../../../src/suggestions/transforms/suggestion.js";
import type {
	CandidateMocWire,
	EditModel,
	SuggestionsWire,
	SuggestionWire,
} from "../../../../src/types/suggestions.js";

// ---------------------------------------------------------------------------
// Factories — fresh state per test, no shared mutable fixtures.
// ---------------------------------------------------------------------------

function getMockCandidateMoc(overrides?: Partial<CandidateMocWire>): CandidateMocWire {
	return {
		path: "Atlas/200 Maps/Test (MOC).md",
		selected: false,
		source: "tomo",
		anchor: null,
		...overrides,
	};
}

function getMockSuggestion(overrides?: Partial<SuggestionWire>): SuggestionWire {
	return {
		id: "S01",
		stem: "test-stem",
		title: "Original Title",
		template: "t_note_tomo.md",
		location: "Atlas/202 Notes/",
		tags: ["topic/test"],
		audio_peer: null,
		decision: "skip",
		keep_source: false,
		delete_source: false,
		force_atomic: false,
		suppressed: false,
		worthiness: 0.8,
		candidate_mocs: [],
		...overrides,
	};
}

function getMockDoc(overrides?: Partial<SuggestionsWire>): SuggestionsWire {
	return {
		schema_version: "1",
		generated: "2026-01-01T00:00:00Z",
		run_id: "test-run",
		profile: "test",
		source_items: 1,
		emit_digest: `sha256:${"0".repeat(64)}`,
		suggestions: [getMockSuggestion()],
		proposed_mocs: [],
		daily_updates: [],
		tag_handler_groups: [],
		...overrides,
	};
}

function getMockModel(overrides?: Partial<EditModel>): EditModel {
	return {
		doc: getMockDoc(),
		dirty: false,
		...overrides,
	};
}

/** Find suggestion S01 in a resulting model's doc — used throughout assertions. */
function findSuggestion(model: EditModel, id: string): SuggestionWire | undefined {
	return model.doc.suggestions.find((s) => s.id === id);
}

describe("toggleCandidateMoc (op 1 independent multi-select)", () => {
	it("checks an unselected candidate WITHOUT touching the others", () => {
		const model = getMockModel({
			doc: getMockDoc({
				suggestions: [
					getMockSuggestion({
						id: "S01",
						candidate_mocs: [
							getMockCandidateMoc({ path: "Atlas/A.md", selected: true }),
							getMockCandidateMoc({ path: "Atlas/B.md", selected: false }),
							getMockCandidateMoc({ path: "Atlas/C.md", selected: false }),
						],
					}),
				],
			}),
		});
		Object.freeze(model.doc.suggestions[0]?.candidate_mocs);

		const result = toggleCandidateMoc(model, "S01", "Atlas/B.md");

		const candidates = findSuggestion(result, "S01")?.candidate_mocs ?? [];
		// A stays selected (independent), B flips on, C stays off.
		expect(candidates.find((c) => c.path === "Atlas/A.md")?.selected).toBe(true);
		expect(candidates.find((c) => c.path === "Atlas/B.md")?.selected).toBe(true);
		expect(candidates.find((c) => c.path === "Atlas/C.md")?.selected).toBe(false);
		expect(result.dirty).toBe(true);
	});

	it("unchecks (deselects) an already-selected candidate", () => {
		const model = getMockModel({
			doc: getMockDoc({
				suggestions: [
					getMockSuggestion({
						id: "S01",
						candidate_mocs: [
							getMockCandidateMoc({ path: "Atlas/A.md", selected: true }),
							getMockCandidateMoc({ path: "Atlas/B.md", selected: false }),
						],
					}),
				],
			}),
		});

		const result = toggleCandidateMoc(model, "S01", "Atlas/A.md");

		const candidates = findSuggestion(result, "S01")?.candidate_mocs ?? [];
		expect(candidates.find((c) => c.path === "Atlas/A.md")?.selected).toBe(false);
		expect(candidates.find((c) => c.path === "Atlas/B.md")?.selected).toBe(false);
		expect(result.dirty).toBe(true);
	});

	it("does not mutate the original model's candidate array", () => {
		const original = getMockModel({
			doc: getMockDoc({
				suggestions: [
					getMockSuggestion({
						id: "S01",
						candidate_mocs: [
							getMockCandidateMoc({ path: "Atlas/A.md", selected: true }),
							getMockCandidateMoc({ path: "Atlas/B.md", selected: false }),
						],
					}),
				],
			}),
		});
		const originalCandidates = findSuggestion(original, "S01")?.candidate_mocs;

		toggleCandidateMoc(original, "S01", "Atlas/B.md");

		expect(findSuggestion(original, "S01")?.candidate_mocs).toBe(originalCandidates);
		expect(findSuggestion(original, "S01")?.candidate_mocs[0]?.selected).toBe(true);
		expect(findSuggestion(original, "S01")?.candidate_mocs[1]?.selected).toBe(false);
	});

	it("rejects (returns the model unchanged) when the suggestion is suppressed", () => {
		// SDD §6: suppressed notes expose no MOC UI, so this is not a reachable
		// action for them — the transform must refuse rather than silently apply.
		const model = getMockModel({
			doc: getMockDoc({
				suggestions: [
					getMockSuggestion({
						id: "S01",
						suppressed: true,
						candidate_mocs: [getMockCandidateMoc({ path: "Atlas/A.md", selected: false })],
					}),
				],
			}),
		});

		const result = toggleCandidateMoc(model, "S01", "Atlas/A.md");

		expect(result).toBe(model);
		expect(result.dirty).toBe(false);
	});

	it("rejects (returns the model unchanged) for an unknown candidate path", () => {
		const model = getMockModel({
			doc: getMockDoc({
				suggestions: [
					getMockSuggestion({
						id: "S01",
						candidate_mocs: [getMockCandidateMoc({ path: "Atlas/A.md", selected: false })],
					}),
				],
			}),
		});

		const result = toggleCandidateMoc(model, "S01", "Atlas/UNKNOWN.md");

		expect(result).toBe(model);
		expect(result.dirty).toBe(false);
	});

	it("rejects (returns the model unchanged) for an unknown suggestionId", () => {
		const model = getMockModel();

		const result = toggleCandidateMoc(model, "S99", "Atlas/A.md");

		expect(result).toBe(model);
		expect(result.dirty).toBe(false);
	});
});

describe("addMoc (op 1 ＋Add MOC)", () => {
	it("appends a new user-sourced candidate, selected, without touching existing candidates", () => {
		const model = getMockModel({
			doc: getMockDoc({
				suggestions: [
					getMockSuggestion({
						id: "S01",
						candidate_mocs: [getMockCandidateMoc({ path: "Atlas/A.md", selected: true })],
					}),
				],
			}),
		});

		const result = addMoc(model, "S01", "Atlas/New.md");

		const candidates = findSuggestion(result, "S01")?.candidate_mocs ?? [];
		expect(candidates).toHaveLength(2);
		expect(candidates[0]).toEqual(getMockCandidateMoc({ path: "Atlas/A.md", selected: true }));
		expect(candidates[1]).toEqual({
			path: "Atlas/New.md",
			selected: true,
			source: "user",
			anchor: null,
		});
		expect(result.dirty).toBe(true);
	});

	it("does not mutate the original candidate array", () => {
		const original = getMockModel({
			doc: getMockDoc({
				suggestions: [getMockSuggestion({ id: "S01", candidate_mocs: [] })],
			}),
		});
		const originalCandidates = findSuggestion(original, "S01")?.candidate_mocs;

		addMoc(original, "S01", "Atlas/New.md");

		expect(findSuggestion(original, "S01")?.candidate_mocs).toBe(originalCandidates);
		expect(findSuggestion(original, "S01")?.candidate_mocs).toHaveLength(0);
	});

	it("rejects (returns the model unchanged) when the suggestion is suppressed", () => {
		const model = getMockModel({
			doc: getMockDoc({
				suggestions: [getMockSuggestion({ id: "S01", suppressed: true, candidate_mocs: [] })],
			}),
		});

		const result = addMoc(model, "S01", "Atlas/New.md");

		expect(result).toBe(model);
		expect(result.dirty).toBe(false);
	});

	it("rejects (returns the model unchanged) for an unknown suggestionId", () => {
		const model = getMockModel();

		const result = addMoc(model, "S99", "Atlas/New.md");

		expect(result).toBe(model);
		expect(result.dirty).toBe(false);
	});
});

describe("setDecision (op 4 approve/skip)", () => {
	it("flips skip to approve and sets dirty", () => {
		const model = getMockModel({
			doc: getMockDoc({ suggestions: [getMockSuggestion({ id: "S01", decision: "skip" })] }),
		});

		const result = setDecision(model, "S01", "approve");

		expect(findSuggestion(result, "S01")?.decision).toBe("approve");
		expect(result.dirty).toBe(true);
	});

	it("flips approve to skip and sets dirty", () => {
		const model = getMockModel({
			doc: getMockDoc({ suggestions: [getMockSuggestion({ id: "S01", decision: "approve" })] }),
		});

		const result = setDecision(model, "S01", "skip");

		expect(findSuggestion(result, "S01")?.decision).toBe("skip");
		expect(result.dirty).toBe(true);
	});

	it("is a no-op (unchanged, dirty false) when setting the same decision", () => {
		const model = getMockModel({
			doc: getMockDoc({ suggestions: [getMockSuggestion({ id: "S01", decision: "approve" })] }),
		});

		const result = setDecision(model, "S01", "approve");

		expect(result).toBe(model);
		expect(result.dirty).toBe(false);
	});

	it("rejects (returns the model unchanged) for an unknown suggestionId", () => {
		const model = getMockModel();

		const result = setDecision(model, "S99", "approve");

		expect(result).toBe(model);
		expect(result.dirty).toBe(false);
	});
});

describe("note-field transforms", () => {
	it("setTitle edits title and sets dirty; same value is a no-op", () => {
		const model = getMockModel({
			doc: getMockDoc({ suggestions: [getMockSuggestion({ id: "S01", title: "Old" })] }),
		});

		const changed = setTitle(model, "S01", "New");
		expect(findSuggestion(changed, "S01")?.title).toBe("New");
		expect(changed.dirty).toBe(true);

		const unchanged = setTitle(model, "S01", "Old");
		expect(unchanged).toBe(model);
		expect(unchanged.dirty).toBe(false);
	});

	it("setTemplate edits template and sets dirty; same value is a no-op", () => {
		const model = getMockModel({
			doc: getMockDoc({
				suggestions: [getMockSuggestion({ id: "S01", template: "t_note_tomo.md" })],
			}),
		});

		const changed = setTemplate(model, "S01", "t_note_other.md");
		expect(findSuggestion(changed, "S01")?.template).toBe("t_note_other.md");
		expect(changed.dirty).toBe(true);

		const unchanged = setTemplate(model, "S01", "t_note_tomo.md");
		expect(unchanged).toBe(model);
		expect(unchanged.dirty).toBe(false);
	});

	it("setLocation edits location and sets dirty; same value is a no-op", () => {
		const model = getMockModel({
			doc: getMockDoc({
				suggestions: [getMockSuggestion({ id: "S01", location: "Atlas/202 Notes/" })],
			}),
		});

		const changed = setLocation(model, "S01", "Atlas/203 Other/");
		expect(findSuggestion(changed, "S01")?.location).toBe("Atlas/203 Other/");
		expect(changed.dirty).toBe(true);

		const unchanged = setLocation(model, "S01", "Atlas/202 Notes/");
		expect(unchanged).toBe(model);
		expect(unchanged.dirty).toBe(false);
	});

	it("setTags edits tags and sets dirty; same value (by content) is a no-op", () => {
		const model = getMockModel({
			doc: getMockDoc({
				suggestions: [getMockSuggestion({ id: "S01", tags: ["topic/a"] })],
			}),
		});

		const changed = setTags(model, "S01", ["topic/a", "topic/b"]);
		expect(findSuggestion(changed, "S01")?.tags).toEqual(["topic/a", "topic/b"]);
		expect(changed.dirty).toBe(true);

		const unchanged = setTags(model, "S01", ["topic/a"]);
		expect(unchanged).toBe(model);
		expect(unchanged.dirty).toBe(false);
	});

	it("setKeepSource flips keep_source and sets dirty; same value is a no-op", () => {
		const model = getMockModel({
			doc: getMockDoc({ suggestions: [getMockSuggestion({ id: "S01", keep_source: false })] }),
		});

		const changed = setKeepSource(model, "S01", true);
		expect(findSuggestion(changed, "S01")?.keep_source).toBe(true);
		expect(changed.dirty).toBe(true);

		const unchanged = setKeepSource(model, "S01", false);
		expect(unchanged).toBe(model);
		expect(unchanged.dirty).toBe(false);
	});

	it("setDeleteSource flips delete_source and sets dirty; same value is a no-op", () => {
		const model = getMockModel({
			doc: getMockDoc({ suggestions: [getMockSuggestion({ id: "S01", delete_source: false })] }),
		});

		const changed = setDeleteSource(model, "S01", true);
		expect(findSuggestion(changed, "S01")?.delete_source).toBe(true);
		expect(changed.dirty).toBe(true);

		const unchanged = setDeleteSource(model, "S01", false);
		expect(unchanged).toBe(model);
		expect(unchanged.dirty).toBe(false);
	});

	it("rejects (returns the model unchanged) for an unknown suggestionId across all note-field setters", () => {
		const model = getMockModel();

		expect(setTitle(model, "S99", "x")).toBe(model);
		expect(setTemplate(model, "S99", "x")).toBe(model);
		expect(setLocation(model, "S99", "x")).toBe(model);
		expect(setTags(model, "S99", ["x"])).toBe(model);
		expect(setKeepSource(model, "S99", true)).toBe(model);
		expect(setDeleteSource(model, "S99", true)).toBe(model);
	});
});

describe("immutability across all transforms", () => {
	it("never mutates the input model's doc or suggestions array", () => {
		const model = getMockModel({
			doc: getMockDoc({
				suggestions: [
					getMockSuggestion({
						id: "S01",
						candidate_mocs: [getMockCandidateMoc({ path: "Atlas/A.md", selected: false })],
					}),
				],
			}),
		});
		const originalDoc = model.doc;
		const originalSuggestions = model.doc.suggestions;

		setTitle(model, "S01", "Changed");
		setDecision(model, "S01", "approve");
		toggleCandidateMoc(model, "S01", "Atlas/A.md");
		addMoc(model, "S01", "Atlas/New.md");

		expect(model.doc).toBe(originalDoc);
		expect(model.doc.suggestions).toBe(originalSuggestions);
		expect(model.doc.suggestions[0]?.title).toBe("Original Title");
		expect(model.doc.suggestions[0]?.decision).toBe("skip");
		expect(model.dirty).toBe(false);
	});
});
