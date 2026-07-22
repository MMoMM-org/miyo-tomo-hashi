/**
 * Garden-audit apply-decision transforms (spec-005 Phase 2, T2.2) — pure
 * `GardenAuditModel → GardenAuditModel` setters for the fixable-finding
 * decision fields (selected/repoint/replace/file_under/suggest_requested).
 *
 * Every transform is exercised through its public function only, and every
 * authorization case is paired with a rejection/no-op case per MiYo
 * Constitution L1 (Testing — permission/validation logic must prove both):
 * here that means advisory findings (no `decision` block) never get one
 * fabricated.
 */

import { describe, expect, it } from "vitest";
import {
	setFileUnder,
	setReplace,
	setRepoint,
	setSelected,
	setSuggestRequested,
} from "../../../src/garden-audit/transforms.js";
import type {
	DecisionWire,
	FindingWire,
	GardenAuditModel,
	GardenAuditWire,
} from "../../../src/types/garden-audit.js";

// ---------------------------------------------------------------------------
// Factories — fresh state per test, no shared mutable fixtures.
// ---------------------------------------------------------------------------

function getMockDecision(overrides?: Partial<DecisionWire>): DecisionWire {
	return {
		selected: false,
		action: null,
		candidates: [],
		suggest_requested: false,
		...overrides,
	};
}

function getMockFinding(overrides?: Partial<FindingWire>): FindingWire {
	return {
		id: "F01",
		check: "broken_up",
		tier: "integrity",
		fixable: true,
		target: { path: "Notes/Child.md", stem: "Child" },
		detail: { up_target: "Deleted MOC" },
		decision: getMockDecision(),
		...overrides,
	};
}

function getMockDoc(overrides?: Partial<GardenAuditWire>): GardenAuditWire {
	return {
		schema_version: "1",
		generated: "2026-01-01T00:00:00Z",
		run_id: "test-run",
		profile: "test",
		emit_digest: `sha256:${"0".repeat(64)}`,
		findings: [getMockFinding()],
		...overrides,
	};
}

function getMockModel(overrides?: Partial<GardenAuditWire>): GardenAuditModel {
	return { doc: getMockDoc(overrides), dirty: false };
}

// ---------------------------------------------------------------------------
// setSelected
// ---------------------------------------------------------------------------

describe("setSelected", () => {
	it("flips the target finding's decision.selected and marks dirty", () => {
		const model = getMockModel();

		const next = setSelected(model, "F01", true);

		expect(next.dirty).toBe(true);
		expect(next.doc.findings[0]?.decision?.selected).toBe(true);
		expect(next).not.toBe(model);
	});

	it("is a no-op (same reference, dirty untouched) when the value is unchanged", () => {
		const model = getMockModel();

		const next = setSelected(model, "F01", false); // already false

		expect(next).toBe(model);
		expect(next.dirty).toBe(false);
	});

	it("leaves an advisory finding (no decision) untouched rather than fabricating one", () => {
		const advisory = getMockFinding({
			id: "F09",
			check: "stale_moc",
			tier: "advisory",
			fixable: false,
			detail: { mtime: "2026-01-01T00:00:00Z" },
			decision: undefined,
		});
		const model: GardenAuditModel = { doc: getMockDoc({ findings: [advisory] }), dirty: false };

		const next = setSelected(model, "F09", true);

		expect(next).toBe(model);
		expect(next.doc.findings[0]?.decision).toBeUndefined();
	});

	it("touches only the target finding — sibling findings and doc-level fields ride through untouched", () => {
		const sibling = getMockFinding({ id: "F02" });
		const model: GardenAuditModel = {
			doc: getMockDoc({ findings: [getMockFinding({ id: "F01" }), sibling] }),
			dirty: false,
		};

		const next = setSelected(model, "F01", true);

		expect(next.doc.findings[1]).toBe(sibling); // identity-preserved, not just deep-equal
		expect(next.doc.emit_digest).toBe(model.doc.emit_digest);
	});
});

// ---------------------------------------------------------------------------
// setRepoint — ADR-5 action-gating (broken_up)
// ---------------------------------------------------------------------------

describe("setRepoint (ADR-5 action-gating)", () => {
	it("a non-empty repoint sets decision.action to add_relationship", () => {
		const model = getMockModel();

		const next = setRepoint(model, "F01", "[[020 Active MOC]]");

		expect(next.dirty).toBe(true);
		expect(next.doc.findings[0]?.decision).toMatchObject({
			repoint: "[[020 Active MOC]]",
			action: "add_relationship",
		});
	});

	it("clearing repoint to empty sets decision.action to edit_note_text", () => {
		const model: GardenAuditModel = {
			doc: getMockDoc({
				findings: [
					getMockFinding({
						decision: getMockDecision({ repoint: "[[Old MOC]]", action: "add_relationship" }),
					}),
				],
			}),
			dirty: false,
		};

		const next = setRepoint(model, "F01", "");

		expect(next.doc.findings[0]?.decision).toMatchObject({
			repoint: "",
			action: "edit_note_text",
		});
	});

	it("never leaves a selected broken_up finding with action:null after a repoint edit", () => {
		const model: GardenAuditModel = {
			doc: getMockDoc({
				findings: [getMockFinding({ decision: getMockDecision({ selected: true, action: null }) })],
			}),
			dirty: false,
		};

		const selectedAndEmpty = setRepoint(model, "F01", "");
		const selectedAndSet = setRepoint(model, "F01", "[[Target]]");

		expect(selectedAndEmpty.doc.findings[0]?.decision?.action).not.toBeNull();
		expect(selectedAndSet.doc.findings[0]?.decision?.action).not.toBeNull();
	});

	it("is a no-op when both repoint and the resulting action are already correct", () => {
		const model: GardenAuditModel = {
			doc: getMockDoc({
				findings: [
					getMockFinding({
						decision: getMockDecision({ repoint: "[[Target]]", action: "add_relationship" }),
					}),
				],
			}),
			dirty: false,
		};

		const next = setRepoint(model, "F01", "[[Target]]");

		expect(next).toBe(model);
	});
});

// ---------------------------------------------------------------------------
// setReplace (dead_link) — plain field setter, no action side effect
// ---------------------------------------------------------------------------

describe("setReplace", () => {
	function deadLinkModel(overrides?: Partial<DecisionWire>): GardenAuditModel {
		return {
			doc: getMockDoc({
				findings: [
					getMockFinding({
						check: "dead_link",
						tier: "integrity",
						detail: { dead_target: "Missing Note", count: 1 },
						decision: getMockDecision({ action: "edit_note_text", ...overrides }),
					}),
				],
			}),
			dirty: false,
		};
	}

	it("sets decision.replace and marks dirty, leaving action untouched", () => {
		const model = deadLinkModel();

		const next = setReplace(model, "F01", "[[New Note]]");

		expect(next.dirty).toBe(true);
		expect(next.doc.findings[0]?.decision).toMatchObject({
			replace: "[[New Note]]",
			action: "edit_note_text",
		});
	});

	it("is a no-op when the value is unchanged", () => {
		const model = deadLinkModel({ replace: "[[New Note]]" });

		const next = setReplace(model, "F01", "[[New Note]]");

		expect(next).toBe(model);
	});
});

// ---------------------------------------------------------------------------
// setFileUnder (orphan/unparented) — plain field setter
// ---------------------------------------------------------------------------

describe("setFileUnder", () => {
	function orphanModel(overrides?: Partial<DecisionWire>): GardenAuditModel {
		return {
			doc: getMockDoc({
				findings: [
					getMockFinding({
						check: "orphan",
						tier: "structure",
						detail: { candidate_mocs: [] },
						decision: getMockDecision({ action: "link_to_moc", ...overrides }),
					}),
				],
			}),
			dirty: false,
		};
	}

	it("sets decision.file_under and marks dirty", () => {
		const model = orphanModel();

		const next = setFileUnder(model, "F01", "[[000 Home MOC]]");

		expect(next.dirty).toBe(true);
		expect(next.doc.findings[0]?.decision?.file_under).toBe("[[000 Home MOC]]");
	});

	it("is a no-op when the value is unchanged", () => {
		const model = orphanModel({ file_under: "[[000 Home MOC]]" });

		const next = setFileUnder(model, "F01", "[[000 Home MOC]]");

		expect(next).toBe(model);
	});
});

// ---------------------------------------------------------------------------
// setSuggestRequested — dirty NOT gated on Tomo's digest (PRD F5)
// ---------------------------------------------------------------------------

describe("setSuggestRequested", () => {
	it("marks dirty even though suggest_requested is excluded from Tomo's emit_digest", () => {
		const model = getMockModel();

		const next = setSuggestRequested(model, "F01", true);

		expect(next.dirty).toBe(true);
		expect(next.doc.findings[0]?.decision?.suggest_requested).toBe(true);
	});

	it("is a no-op when the value is unchanged", () => {
		const model: GardenAuditModel = {
			doc: getMockDoc({
				findings: [getMockFinding({ decision: getMockDecision({ suggest_requested: true }) })],
			}),
			dirty: false,
		};

		const next = setSuggestRequested(model, "F01", true);

		expect(next).toBe(model);
	});

	it("leaves an advisory finding untouched rather than fabricating a decision", () => {
		const advisory = getMockFinding({
			id: "F09",
			check: "stale_moc",
			tier: "advisory",
			fixable: false,
			detail: {},
			decision: undefined,
		});
		const model: GardenAuditModel = { doc: getMockDoc({ findings: [advisory] }), dirty: false };

		const next = setSuggestRequested(model, "F09", true);

		expect(next).toBe(model);
		expect(next.doc.findings[0]?.decision).toBeUndefined();
	});
});
