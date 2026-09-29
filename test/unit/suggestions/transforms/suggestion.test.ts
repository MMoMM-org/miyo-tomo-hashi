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
	dispositionOf,
	setDisposition,
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
		item_key: "100 Inbox/test-stem.md",
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
		schema_version: "2",
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

describe("setDisposition (op 4 — the approve/skip/delete-source tri-state)", () => {
	it("writes the approve triple and sets dirty", () => {
		const model = getMockModel({
			doc: getMockDoc({ suggestions: [getMockSuggestion({ id: "S01", decision: "skip" })] }),
		});

		const result = setDisposition(model, "S01", "approve");

		const s = findSuggestion(result, "S01");
		expect(s?.decision).toBe("approve");
		expect(s?.delete_source).toBe(false);
		expect(result.dirty).toBe(true);
	});

	it("writes the skip triple and sets dirty", () => {
		const model = getMockModel({
			doc: getMockDoc({ suggestions: [getMockSuggestion({ id: "S01", decision: "approve" })] }),
		});

		const result = setDisposition(model, "S01", "skip");

		const s = findSuggestion(result, "S01");
		expect(s?.decision).toBe("skip");
		expect(s?.delete_source).toBe(false);
		expect(result.dirty).toBe(true);
	});

	it("writes the delete-source triple as (skip, delete_source true) — NOT a third decision value", () => {
		const model = getMockModel({
			doc: getMockDoc({ suggestions: [getMockSuggestion({ id: "S01", decision: "approve" })] }),
		});

		const result = setDisposition(model, "S01", "delete-source");

		const s = findSuggestion(result, "S01");
		expect(s?.decision).toBe("skip");
		expect(s?.delete_source).toBe(true);
		expect(result.dirty).toBe(true);
	});

	// Tomo's measured table: delete_source is the skip leg, so moving to plain
	// Skip MUST disarm it. Leaving it set would delete the origin the owner just
	// chose to keep — the whole reason a single writer owns the triple.
	it("moving to Skip disarms an armed delete_source", () => {
		const model = getMockModel({
			doc: getMockDoc({
				suggestions: [getMockSuggestion({ id: "S01", decision: "skip", delete_source: true })],
			}),
		});

		const result = setDisposition(model, "S01", "skip");

		expect(findSuggestion(result, "S01")?.delete_source).toBe(false);
		expect(result.dirty).toBe(true);
	});

	// build_from_wire builds a skipped entry without reading keep_source, so a
	// surviving `keep_source: true` here would be a keep that does not keep.
	it("the delete-source leg clears keep_source so the saved doc carries no contradiction", () => {
		const model = getMockModel({
			doc: getMockDoc({
				suggestions: [getMockSuggestion({ id: "S01", decision: "skip", keep_source: true })],
			}),
		});

		const result = setDisposition(model, "S01", "delete-source");

		const s = findSuggestion(result, "S01");
		expect(s?.keep_source).toBe(false);
		expect(s?.delete_source).toBe(true);
	});

	// Tomo accepts (approve, delete_source true) and ignores it, but asked us to
	// write false rather than rely on the inertness.
	it("the approve leg clears an inert delete_source rather than relying on Pass 2 ignoring it", () => {
		const model = getMockModel({
			doc: getMockDoc({
				suggestions: [getMockSuggestion({ id: "S01", decision: "approve", delete_source: true })],
			}),
		});

		const result = setDisposition(model, "S01", "approve");

		expect(findSuggestion(result, "S01")?.delete_source).toBe(false);
		expect(result.dirty).toBe(true);
	});

	it("preserves keep_source on the approve and skip legs", () => {
		const model = getMockModel({
			doc: getMockDoc({
				suggestions: [getMockSuggestion({ id: "S01", decision: "skip", keep_source: true })],
			}),
		});

		expect(findSuggestion(setDisposition(model, "S01", "approve"), "S01")?.keep_source).toBe(true);
		expect(setDisposition(model, "S01", "skip")).toBe(model);
	});

	it("is a no-op (same reference, dirty false) for each leg already in effect", () => {
		const approved = getMockModel({
			doc: getMockDoc({
				suggestions: [getMockSuggestion({ id: "S01", decision: "approve", delete_source: false })],
			}),
		});
		expect(setDisposition(approved, "S01", "approve")).toBe(approved);

		const skipped = getMockModel({
			doc: getMockDoc({
				suggestions: [getMockSuggestion({ id: "S01", decision: "skip", delete_source: false })],
			}),
		});
		expect(setDisposition(skipped, "S01", "skip")).toBe(skipped);

		const deleting = getMockModel({
			doc: getMockDoc({
				suggestions: [
					getMockSuggestion({
						id: "S01",
						decision: "skip",
						delete_source: true,
						keep_source: false,
					}),
				],
			}),
		});
		expect(setDisposition(deleting, "S01", "delete-source")).toBe(deleting);
	});

	it("rejects (returns the model unchanged) for an unknown suggestionId", () => {
		const model = getMockModel();

		expect(setDisposition(model, "S99", "approve")).toBe(model);
		expect(setDisposition(model, "S99", "delete-source")).toBe(model);
		expect(model.dirty).toBe(false);
	});
});

describe("dispositionOf (the render-side inverse)", () => {
	it("reads each leg back from the triple it was written as", () => {
		expect(dispositionOf(getMockSuggestion({ decision: "approve", delete_source: false }))).toBe(
			"approve",
		);
		expect(dispositionOf(getMockSuggestion({ decision: "skip", delete_source: false }))).toBe(
			"skip",
		);
		expect(dispositionOf(getMockSuggestion({ decision: "skip", delete_source: true }))).toBe(
			"delete-source",
		);
	});

	// Pass 2 never reads delete_source under an approved item, so this state is
	// inert rather than contradictory. It must read as plain approve — and it is
	// deliberately NOT normalised away, which would dirty an untouched document.
	it("reads an inert (approve, delete_source true) as approve", () => {
		expect(dispositionOf(getMockSuggestion({ decision: "approve", delete_source: true }))).toBe(
			"approve",
		);
	});

	it("is unaffected by keep_source on every leg", () => {
		expect(
			dispositionOf(getMockSuggestion({ decision: "skip", delete_source: true, keep_source: true })),
		).toBe("delete-source");
		expect(
			dispositionOf(
				getMockSuggestion({ decision: "approve", delete_source: false, keep_source: true }),
			),
		).toBe("approve");
	});

	it("round-trips every leg through setDisposition", () => {
		const legs = ["approve", "skip", "delete-source"] as const;
		for (const leg of legs) {
			const model = getMockModel({
				doc: getMockDoc({ suggestions: [getMockSuggestion({ id: "S01", decision: "approve" })] }),
			});
			const next = setDisposition(model, "S01", leg);
			expect(dispositionOf(findSuggestion(next, "S01")!)).toBe(leg);
		}
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

	it("rejects (returns the model unchanged) for an unknown suggestionId across all note-field setters", () => {
		const model = getMockModel();

		expect(setTitle(model, "S99", "x")).toBe(model);
		expect(setTemplate(model, "S99", "x")).toBe(model);
		expect(setLocation(model, "S99", "x")).toBe(model);
		expect(setTags(model, "S99", ["x"])).toBe(model);
		expect(setKeepSource(model, "S99", true)).toBe(model);
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
		setDisposition(model, "S01", "approve");
		toggleCandidateMoc(model, "S01", "Atlas/A.md");
		addMoc(model, "S01", "Atlas/New.md");

		expect(model.doc).toBe(originalDoc);
		expect(model.doc.suggestions).toBe(originalSuggestions);
		expect(model.doc.suggestions[0]?.title).toBe("Original Title");
		expect(model.doc.suggestions[0]?.decision).toBe("skip");
		expect(model.dirty).toBe(false);
	});
});
