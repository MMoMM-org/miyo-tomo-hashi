/**
 * Behavior tests for the proposed-MOC graph-op transforms (T1.5): rename,
 * reparent, decision-flip, and the two merge flavours (explicit source→target,
 * and same-name "Merge into…" collapse). Pure EditModel → EditModel — no
 * obsidian import, no I/O.
 *
 * The vendored 1115 fixture (test/fixtures/suggestions/1115.json, consumed by
 * FakeSuggestionsDoc) ships an EMPTY proposed_mocs list, so it can't exercise
 * these ops. We build focused custom SuggestionsWire seeds inline instead —
 * per the task brief and the "don't fabricate coverage against an empty
 * fixture" lesson.
 */

import { describe, expect, it } from "vitest";
import type { EditModel, ProposedMocWire, SuggestionsWire } from "../../../../src/types/suggestions.js";
import {
	mergeProposedMocs,
	reparentProposedMoc,
	renameProposedMoc,
	setProposedMocDecision,
} from "../../../../src/suggestions/transforms/proposedMoc.js";

// ---------------------------------------------------------------------------
// Test factories — fresh state per test, no shared mutable fixtures.
// ---------------------------------------------------------------------------

const getMockProposedMoc = (overrides?: Partial<ProposedMocWire>): ProposedMocWire => ({
	id: "M01",
	topic: "test-topic",
	name: "Test MOC",
	parent: "",
	member_ids: ["S01", "S02"],
	decision: "skip",
	...overrides,
});

const getMockWire = (proposedMocs: readonly ProposedMocWire[]): SuggestionsWire => ({
	schema_version: "1",
	generated: "2026-07-06T11:15:00Z",
	run_id: "test-run",
	profile: "test-profile",
	source_items: 0,
	emit_digest: `sha256:${"0".repeat(64)}`,
	suggestions: [],
	proposed_mocs: proposedMocs,
	daily_updates: [],
	tag_handler_groups: [],
});

const getMockModel = (proposedMocs: readonly ProposedMocWire[], dirty = false): EditModel => ({
	doc: getMockWire(proposedMocs),
	dirty,
});

// Standard two-node fixture used by most tests: A (M01) and B (M02).
const twoMocModel = (): EditModel =>
	getMockModel([
		getMockProposedMoc({ id: "M01", name: "Cooking", member_ids: ["S01", "S02"] }),
		getMockProposedMoc({ id: "M02", name: "Baking", member_ids: ["S02", "S03"] }),
	]);

describe("renameProposedMoc", () => {
	it("edits only the target node's name, leaving member_ids and other nodes untouched", () => {
		const model = twoMocModel();

		const result = renameProposedMoc(model, "M01", "Culinary Arts");

		expect(result.doc.proposed_mocs[0]?.name).toBe("Culinary Arts");
		expect(result.doc.proposed_mocs[0]?.member_ids).toEqual(["S01", "S02"]);
		expect(result.doc.proposed_mocs[0]?.id).toBe("M01");
		expect(result.doc.proposed_mocs[0]?.parent).toBe("");
		// Sibling node fully untouched.
		expect(result.doc.proposed_mocs[1]).toEqual(model.doc.proposed_mocs[1]);
	});

	it("sets dirty true", () => {
		const model = twoMocModel();

		const result = renameProposedMoc(model, "M01", "Culinary Arts");

		expect(result.dirty).toBe(true);
	});

	it("does not mutate the original model or doc", () => {
		const model = twoMocModel();
		const originalName = model.doc.proposed_mocs[0]?.name;

		renameProposedMoc(model, "M01", "Culinary Arts");

		expect(model.doc.proposed_mocs[0]?.name).toBe(originalName);
		expect(model.dirty).toBe(false);
	});

	it("is a no-op when the name is unchanged — same reference, dirty false", () => {
		const model = twoMocModel();

		const result = renameProposedMoc(model, "M01", "Cooking");

		expect(result).toBe(model);
		expect(result.dirty).toBe(false);
	});

	it("rejects an unknown mocId — model unchanged, dirty false", () => {
		const model = twoMocModel();

		const result = renameProposedMoc(model, "M99", "Nope");

		expect(result).toEqual(model);
		expect(result.dirty).toBe(false);
	});
});

describe("reparentProposedMoc", () => {
	it("edits only the target node's parent and sets dirty", () => {
		const model = twoMocModel();

		const result = reparentProposedMoc(model, "M02", "Food & Drink");

		expect(result.doc.proposed_mocs[1]?.parent).toBe("Food & Drink");
		expect(result.doc.proposed_mocs[1]?.member_ids).toEqual(["S02", "S03"]);
		expect(result.dirty).toBe(true);
		expect(result.doc.proposed_mocs[0]).toEqual(model.doc.proposed_mocs[0]);
	});

	it("does not mutate the original model", () => {
		const model = twoMocModel();

		reparentProposedMoc(model, "M02", "Food & Drink");

		expect(model.doc.proposed_mocs[1]?.parent).toBe("");
	});

	it("is a no-op when the parent is unchanged — same reference, dirty false", () => {
		const model = twoMocModel();

		const result = reparentProposedMoc(model, "M01", "");

		expect(result).toBe(model);
		expect(result.dirty).toBe(false);
	});

	it("rejects an unknown mocId — model unchanged, dirty false", () => {
		const model = twoMocModel();

		const result = reparentProposedMoc(model, "M99", "Nowhere");

		expect(result).toEqual(model);
		expect(result.dirty).toBe(false);
	});
});

describe("setProposedMocDecision", () => {
	it("flips decision from skip to approve and sets dirty", () => {
		const model = twoMocModel();

		const result = setProposedMocDecision(model, "M01", "approve");

		expect(result.doc.proposed_mocs[0]?.decision).toBe("approve");
		expect(result.dirty).toBe(true);
	});

	it("flips decision from approve back to skip", () => {
		const model = getMockModel([getMockProposedMoc({ id: "M01", decision: "approve" })]);

		const result = setProposedMocDecision(model, "M01", "skip");

		expect(result.doc.proposed_mocs[0]?.decision).toBe("skip");
	});

	it("leaves other fields untouched", () => {
		const model = twoMocModel();

		const result = setProposedMocDecision(model, "M01", "approve");

		expect(result.doc.proposed_mocs[0]?.member_ids).toEqual(["S01", "S02"]);
		expect(result.doc.proposed_mocs[0]?.name).toBe("Cooking");
	});

	it("does not mutate the original model", () => {
		const model = twoMocModel();

		setProposedMocDecision(model, "M01", "approve");

		expect(model.doc.proposed_mocs[0]?.decision).toBe("skip");
	});

	it("is a no-op when the decision is unchanged — same reference, dirty false", () => {
		const model = twoMocModel();

		const result = setProposedMocDecision(model, "M01", "skip");

		expect(result).toBe(model);
		expect(result.dirty).toBe(false);
	});

	it("rejects an unknown mocId — model unchanged, dirty false", () => {
		const model = twoMocModel();

		const result = setProposedMocDecision(model, "M99", "approve");

		expect(result).toEqual(model);
		expect(result.dirty).toBe(false);
	});
});

describe("mergeProposedMocs", () => {
	it("unions source member_ids into target by id, deduping, target's members first", () => {
		const model = twoMocModel(); // M01: [S01, S02], M02: [S02, S03]

		const result = mergeProposedMocs(model, "M01", "M02");

		const target = result.doc.proposed_mocs.find((m) => m.id === "M02");
		// Target's own members first, then new ones from source (S02 already present, S01 new).
		expect(target?.member_ids).toEqual(["S02", "S03", "S01"]);
	});

	it("drops the source node from proposed_mocs", () => {
		const model = twoMocModel();

		const result = mergeProposedMocs(model, "M01", "M02");

		expect(result.doc.proposed_mocs.find((m) => m.id === "M01")).toBeUndefined();
		expect(result.doc.proposed_mocs).toHaveLength(1);
	});

	it("sets dirty true", () => {
		const model = twoMocModel();

		const result = mergeProposedMocs(model, "M01", "M02");

		expect(result.dirty).toBe(true);
	});

	it("never orphans a member id — union contains every id from both source and target", () => {
		const model = getMockModel([
			getMockProposedMoc({ id: "M01", name: "A", member_ids: ["S01", "S02", "S03"] }),
			getMockProposedMoc({ id: "M02", name: "B", member_ids: ["S04", "S05"] }),
		]);
		const allSourceMembers = ["S01", "S02", "S03"];
		const allTargetMembers = ["S04", "S05"];

		const result = mergeProposedMocs(model, "M01", "M02");

		const target = result.doc.proposed_mocs.find((m) => m.id === "M02");
		for (const id of [...allSourceMembers, ...allTargetMembers]) {
			expect(target?.member_ids).toContain(id);
		}
	});

	it("does not mutate the original model", () => {
		const model = twoMocModel();

		mergeProposedMocs(model, "M01", "M02");

		expect(model.doc.proposed_mocs).toHaveLength(2);
		expect(model.doc.proposed_mocs.find((m) => m.id === "M01")?.member_ids).toEqual(["S01", "S02"]);
	});

	it("rejects a self-merge — model unchanged, dirty false", () => {
		const model = twoMocModel();

		const result = mergeProposedMocs(model, "M01", "M01");

		expect(result).toEqual(model);
		expect(result.dirty).toBe(false);
	});

	it("rejects when sourceId is unknown — model unchanged, dirty false", () => {
		const model = twoMocModel();

		const result = mergeProposedMocs(model, "M99", "M02");

		expect(result).toEqual(model);
		expect(result.dirty).toBe(false);
	});

	it("rejects when targetId is unknown — model unchanged, dirty false", () => {
		const model = twoMocModel();

		const result = mergeProposedMocs(model, "M01", "M99");

		expect(result).toEqual(model);
		expect(result.dirty).toBe(false);
	});
});

describe("mergeProposedMocs — tag union", () => {
	it("unions source tags into target (deduped, target's first)", () => {
		const model = getMockModel([
			getMockProposedMoc({ id: "M01", name: "AI", member_ids: ["S01"], tags: ["a", "shared"] }),
			getMockProposedMoc({ id: "M02", name: "Cooking", member_ids: ["S02"], tags: ["shared", "b"] }),
		]);

		const result = mergeProposedMocs(model, "M01", "M02");

		const target = result.doc.proposed_mocs.find((m) => m.id === "M02");
		// target's tags first, then source's not-already-present, deduped.
		expect(target?.tags).toEqual(["shared", "b", "a"]);
	});

	it("leaves tags absent when neither side had any", () => {
		const model = getMockModel([
			getMockProposedMoc({ id: "M01", name: "AI", member_ids: ["S01"], tags: undefined }),
			getMockProposedMoc({ id: "M02", name: "Cooking", member_ids: ["S02"], tags: undefined }),
		]);

		const result = mergeProposedMocs(model, "M01", "M02");

		expect(result.doc.proposed_mocs.find((m) => m.id === "M02")?.tags).toBeUndefined();
	});
});

describe("mergeProposedMocs — reason count retarget", () => {
	it("updates the target reason's leading '1 note' to the merged member count, pluralized", () => {
		const model = getMockModel([
			getMockProposedMoc({
				id: "M01",
				name: "Cooking",
				member_ids: ["S01"],
				reason: "1 note share topic Cooking and have no dedicated MOC.",
			}),
			getMockProposedMoc({ id: "M02", name: "AI", member_ids: ["S02"] }),
		]);

		// M02 merges INTO M01 → M01 now has 2 members.
		const result = mergeProposedMocs(model, "M02", "M01");

		expect(result.doc.proposed_mocs.find((m) => m.id === "M01")?.reason).toBe(
			"2 notes share topic Cooking and have no dedicated MOC.",
		);
	});

	it("leaves a reason with no leading count unchanged (Hashi never rewrites the rest of Tomo's copy)", () => {
		const model = getMockModel([
			getMockProposedMoc({
				id: "M01",
				name: "X",
				member_ids: ["S01"],
				reason: "Groups related captures.",
			}),
			getMockProposedMoc({ id: "M02", name: "Y", member_ids: ["S02"] }),
		]);

		const result = mergeProposedMocs(model, "M02", "M01");

		expect(result.doc.proposed_mocs.find((m) => m.id === "M01")?.reason).toBe(
			"Groups related captures.",
		);
	});
});
