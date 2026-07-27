/**
 * Instruction Fixer target-field transform (spec-006 Phase 1, T1.3) —
 * `setTargetField` pure setter tests.
 *
 * Every whitelisted (kind, field) pair gets an accept case (ADR-5's 7 repair
 * kinds), paired with rejection/no-op cases per MiYo Constitution L1
 * (Testing — permission/validation logic must prove both): a non-whitelisted
 * field, a view-only kind, and an unknown id all return the SAME model
 * reference untouched.
 */

import { describe, expect, it } from "vitest";

import {
	setAnchorSpot,
	setMarkerSpot,
	setTargetField,
	TARGET_FIELD_WHITELIST,
} from "../../../src/instruction-fixer/transforms.js";
import type { Action } from "../../../src/schema/types.js";
import type { InstructionFixerModel } from "../../../src/vault/InstructionSetDoc.js";

// ---------------------------------------------------------------------------
// Factories — fresh state per test, no shared mutable fixtures.
// ---------------------------------------------------------------------------

function makeModel(actions: Action[], dirty = false): InstructionFixerModel {
	return {
		doc: {
			schema_version: "2",
			type: "tomo-instructions",
			generated: "2026-07-20T10:15:00Z",
			profile: "default",
			actions,
		},
		dirty,
	};
}

function linkToMoc(overrides?: Partial<Action & { action: "link_to_moc" }>): Action {
	return {
		id: "I01",
		action: "link_to_moc",
		target_moc: "Hobbies (MOC)",
		target_moc_path: "Atlas/200 Maps/Hobbies (MOC).md",
		anchor: { type: "heading", value: "Key Concepts" },
		placement: "after",
		line_to_add: "- [[New Note]]",
		...overrides,
	} as Action;
}

function insertUnderMarker(): Action {
	return {
		id: "I02",
		action: "insert_under_marker",
		target_path: "Atlas/202 Notes/Existing.md",
		anchor: { type: "heading", value: "Notes" },
		placement: "inside",
		content: "some content",
	};
}

function replaceSection(): Action {
	return {
		id: "I03",
		action: "replace_section",
		target_path: "Atlas/202 Notes/Existing.md",
		anchor: { type: "heading", value: "Notes" },
		content: "new body",
	};
}

function addRelationship(): Action {
	return {
		id: "I04",
		action: "add_relationship",
		target_moc_path: "Atlas/200 Maps/Hobbies (MOC).md",
		marker: "## Related",
		line: "- [[Some Note]]",
	};
}

function editNoteText(): Action {
	return {
		id: "I05",
		action: "edit_note_text",
		path: "Atlas/202 Notes/Existing.md",
		match: "[[Missing Note]]",
		replace: "",
	};
}

function removeUpLink(): Action {
	return {
		id: "I06",
		action: "remove_up_link",
		path: "Atlas/202 Notes/Existing.md",
		link: "[[Old Parent]]",
	};
}

function resolveDeadLink(): Action {
	return {
		id: "I07",
		action: "resolve_dead_link",
		path: "Atlas/202 Notes/Existing.md",
		target: "Missing Note",
		replace: "[[Found Note]]",
	};
}

function moveNote(): Action {
	return {
		id: "I08",
		action: "move_note",
		source: "100 Inbox/note.md",
		destination: "Atlas/note.md",
		title: "Note",
	};
}

function skip(): Action {
	return {
		id: "I09",
		action: "skip",
		source_path: "100 Inbox/orphan.md",
		reason: "duplicate",
	};
}

// ---------------------------------------------------------------------------
// TARGET_FIELD_WHITELIST — the ADR-5 roster
// ---------------------------------------------------------------------------

describe("TARGET_FIELD_WHITELIST", () => {
	it("lists exactly the 7 repair kinds with ADR-5's editable fields", () => {
		expect(TARGET_FIELD_WHITELIST).toEqual({
			link_to_moc: ["target_moc", "target_moc_path", "anchor"],
			insert_under_marker: ["target_path", "anchor"],
			replace_section: ["target_path", "anchor"],
			add_relationship: ["target_moc_path", "marker", "line"],
			edit_note_text: ["path", "match", "replace"],
			remove_up_link: ["path", "link"],
			resolve_dead_link: ["path", "target", "replace"],
		});
	});
});

// ---------------------------------------------------------------------------
// Accept paths — one per (kind, field) in the ADR-5 roster
// ---------------------------------------------------------------------------

describe("setTargetField — accept paths", () => {
	it("link_to_moc: target_moc", () => {
		const model = makeModel([linkToMoc()]);
		const next = setTargetField(model, "I01", "target_moc", "Cooking (MOC)");
		expect(next).not.toBe(model);
		expect(next.dirty).toBe(true);
		const action = next.doc.actions[0];
		expect(action?.action === "link_to_moc" && action.target_moc).toBe("Cooking (MOC)");
	});

	it("link_to_moc: target_moc_path", () => {
		const model = makeModel([linkToMoc()]);
		const next = setTargetField(model, "I01", "target_moc_path", "Atlas/200 Maps/Cooking (MOC).md");
		expect(next).not.toBe(model);
		expect(next.dirty).toBe(true);
		const action = next.doc.actions[0];
		expect(action?.action === "link_to_moc" && action.target_moc_path).toBe(
			"Atlas/200 Maps/Cooking (MOC).md",
		);
	});

	it("link_to_moc: anchor (sets anchor.value, preserves anchor.type)", () => {
		const model = makeModel([linkToMoc()]);
		const next = setTargetField(model, "I01", "anchor", "Related Links");
		expect(next).not.toBe(model);
		expect(next.dirty).toBe(true);
		const action = next.doc.actions[0];
		expect(action?.action === "link_to_moc" && action.anchor).toEqual({
			type: "heading",
			value: "Related Links",
		});
	});

	it("insert_under_marker: target_path", () => {
		const model = makeModel([insertUnderMarker()]);
		const next = setTargetField(model, "I02", "target_path", "Atlas/202 Notes/Other.md");
		expect(next).not.toBe(model);
		expect(next.dirty).toBe(true);
		const action = next.doc.actions[0];
		expect(action?.action === "insert_under_marker" && action.target_path).toBe(
			"Atlas/202 Notes/Other.md",
		);
	});

	it("insert_under_marker: anchor", () => {
		const model = makeModel([insertUnderMarker()]);
		const next = setTargetField(model, "I02", "anchor", "Different Heading");
		expect(next).not.toBe(model);
		const action = next.doc.actions[0];
		expect(action?.action === "insert_under_marker" && action.anchor.value).toBe(
			"Different Heading",
		);
	});

	it("replace_section: target_path", () => {
		const model = makeModel([replaceSection()]);
		const next = setTargetField(model, "I03", "target_path", "Atlas/202 Notes/Other.md");
		expect(next).not.toBe(model);
		const action = next.doc.actions[0];
		expect(action?.action === "replace_section" && action.target_path).toBe(
			"Atlas/202 Notes/Other.md",
		);
	});

	it("replace_section: anchor", () => {
		const model = makeModel([replaceSection()]);
		const next = setTargetField(model, "I03", "anchor", "Different Heading");
		expect(next).not.toBe(model);
		const action = next.doc.actions[0];
		expect(action?.action === "replace_section" && action.anchor.value).toBe(
			"Different Heading",
		);
	});

	it("add_relationship: target_moc_path", () => {
		const model = makeModel([addRelationship()]);
		const next = setTargetField(model, "I04", "target_moc_path", "Atlas/200 Maps/Other.md");
		expect(next).not.toBe(model);
		const action = next.doc.actions[0];
		expect(action?.action === "add_relationship" && action.target_moc_path).toBe(
			"Atlas/200 Maps/Other.md",
		);
	});

	it("add_relationship: marker", () => {
		const model = makeModel([addRelationship()]);
		const next = setTargetField(model, "I04", "marker", "## See Also");
		expect(next).not.toBe(model);
		const action = next.doc.actions[0];
		expect(action?.action === "add_relationship" && action.marker).toBe("## See Also");
	});

	it("add_relationship: line", () => {
		const model = makeModel([addRelationship()]);
		const next = setTargetField(model, "I04", "line", "- [[Other Note]]");
		expect(next).not.toBe(model);
		const action = next.doc.actions[0];
		expect(action?.action === "add_relationship" && action.line).toBe("- [[Other Note]]");
	});

	it("edit_note_text: path", () => {
		const model = makeModel([editNoteText()]);
		const next = setTargetField(model, "I05", "path", "Atlas/202 Notes/Other.md");
		expect(next).not.toBe(model);
		const action = next.doc.actions[0];
		expect(action?.action === "edit_note_text" && action.path).toBe("Atlas/202 Notes/Other.md");
	});

	it("edit_note_text: match", () => {
		const model = makeModel([editNoteText()]);
		const next = setTargetField(model, "I05", "match", "[[Other Missing]]");
		expect(next).not.toBe(model);
		const action = next.doc.actions[0];
		expect(action?.action === "edit_note_text" && action.match).toBe("[[Other Missing]]");
	});

	it("edit_note_text: replace", () => {
		const model = makeModel([editNoteText()]);
		const next = setTargetField(model, "I05", "replace", "[[Found Note]]");
		expect(next).not.toBe(model);
		const action = next.doc.actions[0];
		expect(action?.action === "edit_note_text" && action.replace).toBe("[[Found Note]]");
	});

	it("remove_up_link: path", () => {
		const model = makeModel([removeUpLink()]);
		const next = setTargetField(model, "I06", "path", "Atlas/202 Notes/Other.md");
		expect(next).not.toBe(model);
		const action = next.doc.actions[0];
		expect(action?.action === "remove_up_link" && action.path).toBe("Atlas/202 Notes/Other.md");
	});

	it("remove_up_link: link", () => {
		const model = makeModel([removeUpLink()]);
		const next = setTargetField(model, "I06", "link", "[[New Parent]]");
		expect(next).not.toBe(model);
		const action = next.doc.actions[0];
		expect(action?.action === "remove_up_link" && action.link).toBe("[[New Parent]]");
	});

	it("resolve_dead_link: path", () => {
		const model = makeModel([resolveDeadLink()]);
		const next = setTargetField(model, "I07", "path", "Atlas/202 Notes/Other.md");
		expect(next).not.toBe(model);
		const action = next.doc.actions[0];
		expect(action?.action === "resolve_dead_link" && action.path).toBe(
			"Atlas/202 Notes/Other.md",
		);
	});

	it("resolve_dead_link: target", () => {
		const model = makeModel([resolveDeadLink()]);
		const next = setTargetField(model, "I07", "target", "Other Missing");
		expect(next).not.toBe(model);
		const action = next.doc.actions[0];
		expect(action?.action === "resolve_dead_link" && action.target).toBe("Other Missing");
	});

	it("resolve_dead_link: replace", () => {
		const model = makeModel([resolveDeadLink()]);
		const next = setTargetField(model, "I07", "replace", "[[Other Found]]");
		expect(next).not.toBe(model);
		const action = next.doc.actions[0];
		expect(action?.action === "resolve_dead_link" && action.replace).toBe("[[Other Found]]");
	});
});

// ---------------------------------------------------------------------------
// Reject / no-op paths — same reference, no dirty flip
// ---------------------------------------------------------------------------

describe("setTargetField — reject / no-op paths", () => {
	it("unknown id returns the SAME model reference", () => {
		const model = makeModel([linkToMoc()]);
		const next = setTargetField(model, "I99", "target_moc", "Cooking (MOC)");
		expect(next).toBe(model);
	});

	it("non-whitelisted field on a repair kind is rejected (same reference)", () => {
		const model = makeModel([linkToMoc()]);
		// `placement` exists on link_to_moc but is not in the ADR-5 whitelist.
		const next = setTargetField(model, "I01", "placement", "before");
		expect(next).toBe(model);
	});

	it("view-only kind (move_note) rejects every field (same reference)", () => {
		const model = makeModel([moveNote()]);
		const next = setTargetField(model, "I08", "destination", "Atlas/Other.md");
		expect(next).toBe(model);
	});

	it("view-only kind (skip) rejects every field (same reference)", () => {
		const model = makeModel([skip()]);
		const next = setTargetField(model, "I09", "reason", "changed my mind");
		expect(next).toBe(model);
	});

	it("setting a whitelisted field to its current value is a no-op (same reference, dirty unchanged)", () => {
		const model = makeModel([linkToMoc()]);
		const next = setTargetField(model, "I01", "target_moc", "Hobbies (MOC)");
		expect(next).toBe(model);
		expect(next.dirty).toBe(false);
	});

	it("setting anchor to its current value is a no-op (same reference)", () => {
		const model = makeModel([linkToMoc()]);
		const next = setTargetField(model, "I01", "anchor", "Key Concepts");
		expect(next).toBe(model);
	});
});

// ---------------------------------------------------------------------------
// Empty / whitespace handling — per-field semantics, no silent trimming
// ---------------------------------------------------------------------------

describe("setTargetField — first-time fill-in of an unresolved-at-emission field", () => {
	it("fills an omitted (undefined) optional field — e.g. link_to_moc.target_moc_path", () => {
		const seed = linkToMoc();
		// `target_moc_path` is optional on the wire (LinkToMocAction.target_moc_path?:
		// string | null) — this is the actual "target was unresolved at emission"
		// scenario the Fixer exists for, not an edit of an already-populated value.
		const { target_moc_path, ...withoutPath } = seed as Extract<Action, { action: "link_to_moc" }>;
		void target_moc_path;
		const model = makeModel([withoutPath as Action]);
		const next = setTargetField(model, "I01", "target_moc_path", "Atlas/200 Maps/Cooking (MOC).md");
		expect(next).not.toBe(model);
		expect(next.dirty).toBe(true);
		const action = next.doc.actions[0];
		expect(action?.action === "link_to_moc" && action.target_moc_path).toBe(
			"Atlas/200 Maps/Cooking (MOC).md",
		);
	});

	it("fills an explicit null optional field — e.g. link_to_moc.target_moc_path", () => {
		const model = makeModel([linkToMoc({ target_moc_path: null })]);
		const next = setTargetField(model, "I01", "target_moc_path", "Atlas/200 Maps/Cooking (MOC).md");
		expect(next).not.toBe(model);
		expect(next.dirty).toBe(true);
		const action = next.doc.actions[0];
		expect(action?.action === "link_to_moc" && action.target_moc_path).toBe(
			"Atlas/200 Maps/Cooking (MOC).md",
		);
	});

	it("fills an anchor left null at emission — anchor.value: null is the documented unresolved state", () => {
		const model = makeModel([linkToMoc({ anchor: { type: "heading", value: null } })]);
		const next = setTargetField(model, "I01", "anchor", "Key Concepts");
		expect(next).not.toBe(model);
		expect(next.dirty).toBe(true);
		const action = next.doc.actions[0];
		expect(action?.action === "link_to_moc" && action.anchor).toEqual({
			type: "heading",
			value: "Key Concepts",
		});
	});
});

describe("setTargetField — empty/whitespace value handling", () => {
	it("accepts an empty string for a plain whitelisted field (e.g. add_relationship line)", () => {
		const model = makeModel([addRelationship()]);
		const next = setTargetField(model, "I04", "line", "");
		expect(next).not.toBe(model);
		expect(next.dirty).toBe(true);
		const action = next.doc.actions[0];
		expect(action?.action === "add_relationship" && action.line).toBe("");
	});

	it("accepts an empty anchor value verbatim — never coerced to null", () => {
		const model = makeModel([linkToMoc()]);
		const next = setTargetField(model, "I01", "anchor", "");
		expect(next).not.toBe(model);
		const action = next.doc.actions[0];
		expect(action?.action === "link_to_moc" && action.anchor).toEqual({
			type: "heading",
			value: "",
		});
	});

	it("does not trim whitespace-only values — literal-match fields depend on exact text", () => {
		const model = makeModel([editNoteText()]);
		const next = setTargetField(model, "I05", "match", "   ");
		expect(next).not.toBe(model);
		const action = next.doc.actions[0];
		expect(action?.action === "edit_note_text" && action.match).toBe("   ");
	});
});

// ---------------------------------------------------------------------------
// Duplicate id — documents intentional first-match behaviour
// ---------------------------------------------------------------------------

describe("setTargetField — duplicate id", () => {
	it("replaces only the FIRST action matching a duplicated id, leaving the rest untouched", () => {
		const first = linkToMoc({ id: "DUPE", target_moc: "First (MOC)" } as Partial<
			Action & { action: "link_to_moc" }
		>);
		const second = linkToMoc({ id: "DUPE", target_moc: "Second (MOC)" } as Partial<
			Action & { action: "link_to_moc" }
		>);
		const model = makeModel([first, second]);
		const next = setTargetField(model, "DUPE", "target_moc", "Renamed (MOC)");
		expect(next).not.toBe(model);
		const [a, b] = next.doc.actions;
		expect(a?.action === "link_to_moc" && a.target_moc).toBe("Renamed (MOC)");
		expect(b?.action === "link_to_moc" && b.target_moc).toBe("Second (MOC)");
	});
});

// ---------------------------------------------------------------------------
// setAnchorSpot — the picker's write path (ADR-5 amendment, 2026-07-27)
//
// Same both-directions discipline as `setTargetField` above (Constitution L1,
// Testing): every accept case is paired with the rejection that proves the
// widened write surface did not become an open one.
// ---------------------------------------------------------------------------

describe("setAnchorSpot — accepts", () => {
	it("writes anchor.type, anchor.value and placement together", () => {
		const model = makeModel([linkToMoc()]);
		const next = setAnchorSpot(model, "I01", {
			anchorType: "callout",
			value: "[!blocks] Key Concepts",
			placement: "inside",
		});

		const action = next.doc.actions[0];
		expect(next).not.toBe(model);
		expect(next.dirty).toBe(true);
		expect(action?.action === "link_to_moc" && action.anchor).toEqual({
			type: "callout",
			value: "[!blocks] Key Concepts",
		});
		expect(action?.action === "link_to_moc" && action.placement).toBe("inside");
	});

	/**
	 * The whole reason the three fields move as one: writing the value while
	 * leaving `type: "heading"` behind would emit a triple the resolver cannot
	 * resolve — a repair that fails for a reason the user did not cause.
	 */
	it("never leaves a stale anchor.type behind a new value", () => {
		const model = makeModel([linkToMoc()]);
		const next = setAnchorSpot(model, "I01", {
			anchorType: "line",
			value: "- [[Weekly review]]",
			placement: "before",
		});

		const action = next.doc.actions[0];
		expect(action?.action === "link_to_moc" && action.anchor.type).toBe("line");
	});
});

describe("setAnchorSpot — rejects (same model reference, dirty untouched)", () => {
	/**
	 * `replace_section` has no `placement` on its wire, and the schema is
	 * `additionalProperties: false` — growing the key here would make the very
	 * next Save fail validation.
	 */
	it("adds no placement key to a kind whose wire has none", () => {
		const model = makeModel([replaceSection()]);
		const next = setAnchorSpot(model, "I03", {
			anchorType: "heading",
			value: "Summary",
			placement: null,
		});

		expect(Object.keys(next.doc.actions[0] ?? {})).not.toContain("placement");
	});

	it("ignores a placement offered for a kind that has no placement field", () => {
		const model = makeModel([replaceSection()]);
		const next = setAnchorSpot(model, "I03", {
			anchorType: "heading",
			value: "Summary",
			placement: "inside",
		});

		expect(Object.keys(next.doc.actions[0] ?? {})).not.toContain("placement");
	});

	it("rejects an anchor type outside the schema enum", () => {
		const model = makeModel([linkToMoc()]);
		const next = setAnchorSpot(model, "I01", {
			anchorType: "footnote" as never,
			value: "x",
			placement: "after",
		});

		expect(next).toBe(model);
	});

	it("rejects a placement outside the schema enum", () => {
		const model = makeModel([linkToMoc()]);
		const next = setAnchorSpot(model, "I01", {
			anchorType: "heading",
			value: "Key Concepts",
			placement: "underneath" as never,
		});

		expect(next).toBe(model);
	});

	it("rejects a kind that carries no anchor", () => {
		const model = makeModel([editNoteText()]);
		const next = setAnchorSpot(model, "I05", {
			anchorType: "heading",
			value: "Notes",
			placement: "after",
		});

		expect(next).toBe(model);
	});

	it("rejects an unknown id", () => {
		const model = makeModel([linkToMoc()]);
		expect(
			setAnchorSpot(model, "NOPE", { anchorType: "heading", value: "x", placement: "after" }),
		).toBe(model);
	});

	it("is a no-op when the picked spot is the one already on the wire", () => {
		const model = makeModel([linkToMoc()]);
		const next = setAnchorSpot(model, "I01", {
			anchorType: "heading",
			value: "Key Concepts",
			placement: "after",
		});

		expect(next).toBe(model);
	});

	it("is NOT a no-op when only the placement differs", () => {
		const model = makeModel([linkToMoc()]);
		const next = setAnchorSpot(model, "I01", {
			anchorType: "heading",
			value: "Key Concepts",
			placement: "before",
		});

		expect(next).not.toBe(model);
		const action = next.doc.actions[0];
		expect(action?.action === "link_to_moc" && action.placement).toBe("before");
	});
});

// ---------------------------------------------------------------------------
// setMarkerSpot — the marker picker's write path (ADR-5 amendment,
// 2026-07-27, second correction: swap the marker PREFIX in `line`, keep
// whatever follows it)
// ---------------------------------------------------------------------------

function addRelationshipWithFieldMarker(
	overrides?: Partial<Action & { action: "add_relationship" }>,
): Action {
	return {
		id: "I08",
		action: "add_relationship",
		target_moc: "@",
		target_moc_path: "005 Important Links.md",
		marker: "up::",
		line: "up:: [[@]]",
		...overrides,
	} as Action;
}

describe("setMarkerSpot — accepts", () => {
	/** The exact case that motivated this transform: I08's own shape. */
	it("swaps the marker prefix in `line`, keeping the payload that followed it", () => {
		const model = makeModel([addRelationshipWithFieldMarker()]);
		const next = setMarkerSpot(model, "I08", "parent::");

		const action = next.doc.actions[0];
		expect(next).not.toBe(model);
		expect(next.dirty).toBe(true);
		expect(action?.action === "add_relationship" && action.marker).toBe("parent::");
		expect(action?.action === "add_relationship" && action.line).toBe("parent:: [[@]]");
	});

	it("preserves everything after the marker verbatim, however long", () => {
		const model = makeModel([
			addRelationshipWithFieldMarker({ line: "up:: [[A]], [[B]], [[C]]" }),
		]);
		const next = setMarkerSpot(model, "I08", "related::");

		const action = next.doc.actions[0];
		expect(action?.action === "add_relationship" && action.line).toBe(
			"related:: [[A]], [[B]], [[C]]",
		);
	});

	it("falls back to marker-only when `line` does NOT start with the current marker", () => {
		// Tomo's own aggregation can already have replaced the whole line with
		// something that no longer shares a prefix with `marker` — there is no
		// reliable split point, so `line` is left exactly as it was.
		const model = makeModel([
			addRelationshipWithFieldMarker({ marker: "## Related", line: "- [[Some Note]]" }),
		]);
		const next = setMarkerSpot(model, "I08", "## Backlinks");

		const action = next.doc.actions[0];
		expect(next).not.toBe(model);
		expect(action?.action === "add_relationship" && action.marker).toBe("## Backlinks");
		expect(action?.action === "add_relationship" && action.line).toBe("- [[Some Note]]");
	});
});

describe("setMarkerSpot — rejects / no-ops", () => {
	it("rejects a kind that carries no marker", () => {
		const model = makeModel([linkToMoc()]);
		const next = setMarkerSpot(model, "I01", "up::");

		expect(next).toBe(model);
	});

	it("rejects an unknown id", () => {
		const model = makeModel([addRelationshipWithFieldMarker()]);
		expect(setMarkerSpot(model, "NOPE", "parent::")).toBe(model);
	});

	it("is a no-op when the picked marker is the one already on the wire", () => {
		const model = makeModel([addRelationshipWithFieldMarker()]);
		const next = setMarkerSpot(model, "I08", "up::");

		expect(next).toBe(model);
	});
});
