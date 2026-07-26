/**
 * Unit tests for sections.ts — the pure, DOM-free gate-derived grouping
 * extracted out of InstructionFixerView (spec-006 Phase 3, T3.1/T3.2 review
 * seam). Previously this logic was only exercised through DOM assertions in
 * InstructionFixerView.test.ts; these tests exercise `groupActionsByGate`
 * (and its helpers) directly, with no rendered leaf involved.
 */

import { describe, expect, it } from "vitest";

import type { ActionOutcome } from "../../../../src/executor/state";
import type { Action } from "../../../../src/schema/types";
import {
	badgeText,
	gateFor,
	gateTag,
	groupActionsByGate,
	outcomeFor,
	outcomeReason,
} from "../../../../src/ui/instruction-fixer/sections";
import { NO_TRUSTED_SIGNAL } from "../../../../src/ui/instruction-fixer/outcomeSource";

const I07: Action = {
	id: "I07",
	action: "link_to_moc",
	target_moc: "Systems (MOC)",
	target_moc_path: "Atlas/200 Maps/Systems (MOC).md",
	anchor: { type: "heading", value: "Tools" },
	placement: "after",
	line_to_add: "- [[Kanban]]",
	source_note_title: "Kanban",
	applied: false,
};

const I09: Action = {
	id: "I09",
	action: "edit_note_text",
	path: "Atlas/202 Notes/Existing.md",
	match: "[[Missing Note]]",
	replace: "",
	occurrence: "first",
	applied: true,
};

const I12: Action = {
	id: "I12",
	action: "move_note",
	source: "100 Inbox/Kanban.md",
	destination: "Atlas/202 Notes/Kanban.md",
	title: "Kanban",
	applied: false,
};

/** I07 failed, I09 applied, I12 never reached (absent → read-only-no-signal). */
function tracedOutcomes(): ReadonlyMap<string, ActionOutcome> {
	return new Map<string, ActionOutcome>([
		["I07", { kind: "failed", reason: "anchor not found: ## Tools" }],
		["I09", { kind: "applied" }],
	]);
}

describe("groupActionsByGate", () => {
	it("partitions all three gate states, failed-first: Needs repair / Applied / Not attempted", () => {
		const groups = groupActionsByGate([I07, I09, I12], tracedOutcomes());

		expect(groups).toEqual([
			{ label: "Needs repair", tag: null, actions: [I07] },
			{ label: "Applied", tag: null, actions: [I09] },
			{ label: "Not attempted", tag: null, actions: [I12] },
		]);
	});

	it("omits a group with no members instead of rendering it empty", () => {
		const outcomes = new Map<string, ActionOutcome>([
			["I07", { kind: "failed", reason: "boom" }],
		]);

		const groups = groupActionsByGate([I07], outcomes);

		expect(groups).toEqual([{ label: "Needs repair", tag: null, actions: [I07] }]);
	});

	it("returns no groups for an empty action list", () => {
		expect(groupActionsByGate([], tracedOutcomes())).toEqual([]);
	});

	it("puts every action in one group when they all share a gate", () => {
		const outcomes = new Map<string, ActionOutcome>([
			["I07", { kind: "failed", reason: "boom" }],
			["I12", { kind: "skipped-dependency", dependsOn: "I07" }],
		]);

		const groups = groupActionsByGate([I07, I12], outcomes);

		expect(groups).toEqual([{ label: "Needs repair", tag: null, actions: [I07, I12] }]);
	});

	it("collapses everything into one read-only 'All actions' group under NO_TRUSTED_SIGNAL", () => {
		const groups = groupActionsByGate([I07, I09, I12], NO_TRUSTED_SIGNAL);

		expect(groups).toEqual([
			{ label: "All actions", tag: "read-only", actions: [I07, I09, I12] },
		]);
	});

	it("derives each action's gate from its OWN applied flag (never a sibling's)", () => {
		// Both I07 and I09 sit in a trusted `failed` map; only I09 carries
		// applied:true, so only I09 may freeze.
		const outcomes = new Map<string, ActionOutcome>([
			["I07", { kind: "failed", reason: "boom" }],
			["I09", { kind: "failed", reason: "boom" }],
		]);

		expect(gateFor(I07, outcomes)).toBe("editable");
		expect(gateFor(I09, outcomes)).toBe("frozen-applied");
	});
});

describe("outcomeFor", () => {
	it("returns the trusted outcome for a known action id", () => {
		expect(outcomeFor(I07, tracedOutcomes())).toEqual({
			kind: "failed",
			reason: "anchor not found: ## Tools",
		});
	});

	it("returns null when the action has no entry (never attempted)", () => {
		expect(outcomeFor(I12, tracedOutcomes())).toBeNull();
	});

	it("returns null under NO_TRUSTED_SIGNAL regardless of action id", () => {
		expect(outcomeFor(I07, NO_TRUSTED_SIGNAL)).toBeNull();
	});
});

describe("gateTag", () => {
	it("is null for editable, 'frozen' for frozen-applied, 'read-only' for read-only-no-signal", () => {
		expect(gateTag("editable")).toBeNull();
		expect(gateTag("frozen-applied")).toBe("frozen");
		expect(gateTag("read-only-no-signal")).toBe("read-only");
	});
});

describe("badgeText", () => {
	it("renders the outcome's own kind verbatim", () => {
		expect(badgeText({ kind: "applied" })).toBe("applied");
		expect(badgeText({ kind: "failed", reason: "boom" })).toBe("failed");
	});

	it("renders an em dash for no outcome", () => {
		expect(badgeText(null)).toBe("—");
	});
});

describe("outcomeReason", () => {
	it("returns a failed outcome's reason", () => {
		expect(outcomeReason({ kind: "failed", reason: "anchor not found" })).toBe(
			"anchor not found",
		);
	});

	it("returns null for an empty failed reason", () => {
		expect(outcomeReason({ kind: "failed", reason: "" })).toBeNull();
	});

	it("returns a skipped-dependency's blocker as 'depends on X'", () => {
		expect(outcomeReason({ kind: "skipped-dependency", dependsOn: "I07" })).toBe(
			"depends on I07",
		);
	});

	it("returns null for an empty skipped-dependency blocker", () => {
		expect(outcomeReason({ kind: "skipped-dependency", dependsOn: "" })).toBeNull();
	});

	it("returns null for applied/skipped-already/skipped-cancelled and no outcome", () => {
		expect(outcomeReason({ kind: "applied" })).toBeNull();
		expect(outcomeReason({ kind: "skipped-already" })).toBeNull();
		expect(outcomeReason({ kind: "skipped-cancelled" })).toBeNull();
		expect(outcomeReason(null)).toBeNull();
	});
});
