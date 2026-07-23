/**
 * Unit tests for GardenAuditTab (spec-005 Phase 4 T4.2 + Phase 5 T5.2) — the
 * tier-grouped findings shell (Integrity/Structure/Advisory, each with a
 * count; findings in wire order within a tier; each row shows its finding
 * id), PLUS (T5.2) the real fixable-finding cards: Apply/Skip → `selected`,
 * per-check TargetControl → the right transform (with broken_up's ADR-5
 * action-gating), and an openable note-title link. Advisory findings render
 * through their own strictly-read-only card (T5.5).
 */

import "obsidian";
import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import type { DeadLinkContextResult } from "../../../../../src/garden-audit/deadLinkContext";
import type {
	FindingWire,
	GardenAuditModel,
	GardenAuditWire,
} from "../../../../../src/types/garden-audit";
import { GardenAuditTab } from "../../../../../src/ui/garden-audit-view/tabs/GardenAuditTab";
import type { GardenAuditTabContext } from "../../../../../src/ui/garden-audit-view/tabContract";

// ---------------------------------------------------------------------------
// Factories — fresh state per test, no shared mutable fixtures.
// ---------------------------------------------------------------------------

function getMockFinding(overrides?: Partial<FindingWire>): FindingWire {
	return {
		id: "F01",
		check: "dead_link",
		tier: "integrity",
		fixable: true,
		target: { path: "Notes/Src.md", stem: "Src" },
		detail: {},
		decision: { selected: false, action: null },
		...overrides,
	};
}

function getMockDoc(findings: readonly FindingWire[]): GardenAuditWire {
	return {
		schema_version: "1",
		generated: "2026-01-01T00:00:00Z",
		run_id: "test-run",
		profile: "test",
		emit_digest: `sha256:${"0".repeat(64)}`,
		findings,
	};
}

function getMockModel(findings: readonly FindingWire[]): GardenAuditModel {
	return { doc: getMockDoc(findings), dirty: false };
}

/** Default stub — resolves "note-not-found" for every call; tests that care
 * about the dead-link context wiring override this explicitly. */
function stubDeadLinkContext(): GardenAuditTabContext["deadLinkContext"] {
	return vi.fn(async (): Promise<DeadLinkContextResult> => ({ status: "note-not-found" }));
}

function makeCtx(): GardenAuditTabContext {
	return { app: new App(), apply: () => {}, deadLinkContext: stubDeadLinkContext() };
}

/**
 * A `GardenAuditTabContext` whose `apply` actually runs the transform against
 * a live `GardenAuditModel`, so card-interaction tests can assert the model
 * OUTCOME (per the task brief: "tests assert the outcome through the card")
 * instead of just spying on which transform got called.
 */
function makeRecordingCtx(model: GardenAuditModel): {
	ctx: GardenAuditTabContext;
	getModel: () => GardenAuditModel;
} {
	let current = model;
	const ctx: GardenAuditTabContext = {
		app: new App(),
		apply: (transform) => {
			current = transform(current);
		},
		deadLinkContext: stubDeadLinkContext(),
	};
	return { ctx, getModel: () => current };
}

function finding(model: GardenAuditModel, id: string): FindingWire {
	return model.doc.findings.find((f) => f.id === id)!;
}

describe("GardenAuditTab.count", () => {
	it("returns the total finding count across all tiers", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({ id: "F01" }),
			getMockFinding({
				id: "F09",
				tier: "advisory",
				check: "stale_moc",
				fixable: false,
				decision: undefined,
			}),
		]);

		expect(tab.count(model)).toBe(2);
	});
});

describe("GardenAuditTab.render — tier grouping", () => {
	it("renders exactly three tier sections — Integrity, Structure, Advisory — each with a count", () => {
		const tab = new GardenAuditTab();
		const findings = [
			getMockFinding({ id: "F01", tier: "integrity", check: "dead_link" }),
			getMockFinding({ id: "F02", tier: "integrity", check: "broken_up" }),
			getMockFinding({ id: "F03", tier: "structure", check: "orphan" }),
			getMockFinding({
				id: "F09",
				tier: "advisory",
				check: "stale_moc",
				fixable: false,
				decision: undefined,
			}),
		];
		const container = document.createElement("div");

		tab.render(container, getMockModel(findings), makeCtx());

		const sections = container.querySelectorAll(".hashi-ga-tier");
		expect(sections).toHaveLength(3);

		// Source text stays Title Case (repo convention — see
		// .hashi-se-sec-label in SuggestionsTab.ts): the visual all-caps
		// comes from CSS text-transform, not baked into the DOM text.
		const [integrity, structure, advisory] = Array.from(sections);
		expect(integrity!.querySelector(".hashi-ga-tier-label")?.textContent).toBe("Integrity");
		expect(integrity!.querySelector(".hashi-ga-tier-count")?.textContent).toBe("2");
		expect(structure!.querySelector(".hashi-ga-tier-label")?.textContent).toBe("Structure");
		expect(structure!.querySelector(".hashi-ga-tier-count")?.textContent).toBe("1");
		expect(advisory!.querySelector(".hashi-ga-tier-label")?.textContent).toBe("Advisory");
		expect(advisory!.querySelector(".hashi-ga-tier-count")?.textContent).toBe("1");
	});

	it("renders an empty tier's count as 0 with no finding rows underneath", () => {
		const tab = new GardenAuditTab();
		const findings = [
			getMockFinding({
				id: "F09",
				tier: "advisory",
				check: "stale_moc",
				fixable: false,
				decision: undefined,
			}),
		];
		const container = document.createElement("div");

		tab.render(container, getMockModel(findings), makeCtx());

		const integrity = container.querySelectorAll(".hashi-ga-tier")[0]!;
		expect(integrity.querySelector(".hashi-ga-tier-count")?.textContent).toBe("0");
		expect(integrity.querySelectorAll(".hashi-ga-finding-row")).toHaveLength(0);
	});

	it("renders findings within a tier in wire order, not re-sorted", () => {
		const tab = new GardenAuditTab();
		const findings = [
			getMockFinding({ id: "F05", tier: "integrity", check: "dead_link" }),
			getMockFinding({ id: "F02", tier: "integrity", check: "broken_up" }),
			getMockFinding({ id: "F03", tier: "integrity", check: "dead_link" }),
		];
		const container = document.createElement("div");

		tab.render(container, getMockModel(findings), makeCtx());

		const ids = Array.from(container.querySelectorAll(".hashi-ga-finding-row")).map((row) =>
			row.getAttribute("data-finding-id"),
		);
		expect(ids).toEqual(["F05", "F02", "F03"]);
	});

	it("each finding row shows its finding id", () => {
		const tab = new GardenAuditTab();
		const findings = [getMockFinding({ id: "F07", tier: "structure", check: "orphan" })];
		const container = document.createElement("div");

		tab.render(container, getMockModel(findings), makeCtx());

		const row = container.querySelector(".hashi-ga-finding-row");
		expect(row?.textContent).toContain("F07");
	});
});

describe("GardenAuditTab.render — nothing-to-apply (T4.4, all-advisory run)", () => {
	it("renders a 'Nothing to apply' line alongside the advisory cards when no finding is fixable", () => {
		const tab = new GardenAuditTab();
		const findings = [
			getMockFinding({
				id: "F09",
				tier: "advisory",
				check: "stale_moc",
				fixable: false,
				decision: undefined,
			}),
			getMockFinding({
				id: "F10",
				tier: "advisory",
				check: "duplicate_stem",
				fixable: false,
				decision: undefined,
			}),
		];
		const container = document.createElement("div");

		tab.render(container, getMockModel(findings), makeCtx());

		// The advisory cards still render...
		expect(container.querySelectorAll(".hashi-ga-finding-row")).toHaveLength(2);
		// ...alongside the nothing-to-apply note (not instead of the cards,
		// and NOT worded "no findings" — there are findings, just none
		// fixable).
		const note = container.querySelector(".hashi-ga-nothing-to-apply");
		expect(note?.textContent).toBe(
			"Nothing to apply — this run has no fixable findings.",
		);
	});

	it("does NOT render the nothing-to-apply line when at least one finding is fixable", () => {
		const tab = new GardenAuditTab();
		const findings = [
			getMockFinding({ id: "F01", tier: "integrity", check: "dead_link", fixable: true }),
			getMockFinding({
				id: "F09",
				tier: "advisory",
				check: "stale_moc",
				fixable: false,
				decision: undefined,
			}),
		];
		const container = document.createElement("div");

		tab.render(container, getMockModel(findings), makeCtx());

		expect(container.querySelector(".hashi-ga-nothing-to-apply")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// T5.2 — fixable cards
// ---------------------------------------------------------------------------

describe("GardenAuditTab.render — fixable cards, Apply/Skip", () => {
	it("Apply flips decision.selected to true and marks the model dirty", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F01",
				check: "dead_link",
				detail: { dead_target: "Missing Note", count: 1 },
				decision: { selected: false, action: null, replace: "" },
			}),
		]);
		const { ctx, getModel } = makeRecordingCtx(model);
		const container = document.createElement("div");

		tab.render(container, model, ctx);
		const applyButton = container.querySelector(".hashi-ga-apply") as HTMLButtonElement;
		applyButton.click();

		expect(finding(getModel(), "F01").decision?.selected).toBe(true);
		expect(getModel().dirty).toBe(true);
	});

	it("Skip flips decision.selected to false", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F01",
				check: "dead_link",
				detail: { dead_target: "Missing Note", count: 1 },
				decision: { selected: true, action: "edit_note_text", replace: "" },
			}),
		]);
		const { ctx, getModel } = makeRecordingCtx(model);
		const container = document.createElement("div");

		tab.render(container, model, ctx);
		const skipButton = container.querySelector(".hashi-ga-skip") as HTMLButtonElement;
		skipButton.click();

		expect(finding(getModel(), "F01").decision?.selected).toBe(false);
	});

	it("marks the active Apply/Skip button with aria-pressed=true and the other false", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F01",
				check: "dead_link",
				detail: {},
				decision: { selected: true, action: "edit_note_text", replace: "" },
			}),
		]);
		const container = document.createElement("div");

		tab.render(container, model, makeCtx());

		expect(
			container.querySelector(".hashi-ga-apply")?.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			container.querySelector(".hashi-ga-skip")?.getAttribute("aria-pressed"),
		).toBe("false");
	});
});

describe("GardenAuditTab.render — broken_up card (ADR-5 action-gating)", () => {
	function makeBrokenUpModel(repoint: string, action: string | null): GardenAuditModel {
		return getMockModel([
			getMockFinding({
				id: "F02",
				check: "broken_up",
				tier: "integrity",
				target: { path: "Notes/Child.md", stem: "Child" },
				detail: { up_target: "Deleted MOC" },
				decision: { selected: true, action, repoint },
			}),
		]);
	}

	it("renders the up_target detail line and a Repoint-to target control", () => {
		const tab = new GardenAuditTab();
		const model = makeBrokenUpModel("", "edit_note_text");
		const container = document.createElement("div");

		tab.render(container, model, makeCtx());

		expect(container.textContent).toContain("Deleted MOC");
		expect(container.textContent).toContain("Repoint to");
		expect(container.querySelector(".hashi-ga-target-inp")).not.toBeNull();
	});

	it("a non-empty repoint sets decision.action to add_relationship (ADR-5)", () => {
		const tab = new GardenAuditTab();
		const model = makeBrokenUpModel("", "edit_note_text");
		const { ctx, getModel } = makeRecordingCtx(model);
		const container = document.createElement("div");

		tab.render(container, model, ctx);
		const input = container.querySelector(".hashi-ga-target-inp") as HTMLInputElement;
		input.value = "020 Active MOC";
		input.dispatchEvent(new Event("change"));

		const decision = finding(getModel(), "F02").decision;
		expect(decision?.repoint).toBe("020 Active MOC");
		expect(decision?.action).toBe("add_relationship");
	});

	it("an empty repoint sets decision.action to edit_note_text — NEVER null (ADR-5)", () => {
		const tab = new GardenAuditTab();
		const model = makeBrokenUpModel("020 Active MOC", "add_relationship");
		const { ctx, getModel } = makeRecordingCtx(model);
		const container = document.createElement("div");

		tab.render(container, model, ctx);
		const input = container.querySelector(".hashi-ga-target-inp") as HTMLInputElement;
		input.value = "";
		input.dispatchEvent(new Event("change"));

		const decision = finding(getModel(), "F02").decision;
		expect(decision?.repoint).toBe("");
		expect(decision?.action).toBe("edit_note_text");
		expect(decision?.action).not.toBeNull();
	});
});

describe("GardenAuditTab.render — dead_link card", () => {
	function makeDeadLinkModel(): GardenAuditModel {
		return getMockModel([
			getMockFinding({
				id: "F04",
				check: "dead_link",
				tier: "integrity",
				target: { path: "MOCs/020 Active MOC.md", stem: "020 Active MOC" },
				detail: { dead_target: "023 Sparks MOC", count: 1 },
				decision: { selected: true, action: "edit_note_text", replace: "" },
			}),
		]);
	}

	it("shows dead_target and its count, and a Replace-with target control", () => {
		const tab = new GardenAuditTab();
		const model = makeDeadLinkModel();
		const container = document.createElement("div");

		tab.render(container, model, makeCtx());

		expect(container.textContent).toContain("023 Sparks MOC");
		expect(container.textContent).toContain("1×");
		expect(container.textContent).toContain("Replace with");
		// dead_link's TargetControl empty label is "unlink", not "remove".
		expect(container.textContent).toContain("unlink");
	});

	it("changing the replace target dispatches setReplace", () => {
		const tab = new GardenAuditTab();
		const model = makeDeadLinkModel();
		const { ctx, getModel } = makeRecordingCtx(model);
		const container = document.createElement("div");

		tab.render(container, model, ctx);
		const input = container.querySelector(".hashi-ga-target-inp") as HTMLInputElement;
		input.value = "025 New Target";
		input.dispatchEvent(new Event("change"));

		expect(finding(getModel(), "F04").decision?.replace).toBe("025 New Target");
	});
});

describe("GardenAuditTab.render — unparented/orphan cards (file_under)", () => {
	it.each(["orphan", "unparented"] as const)(
		"%s: renders a File-under target control and dispatches setFileUnder on change",
		(check) => {
			const tab = new GardenAuditTab();
			const model = getMockModel([
				getMockFinding({
					id: "F03",
					check,
					tier: "structure",
					target: { path: "Notes/Orphan.md", stem: "Orphan" },
					detail: { candidate_mocs: [] },
					decision: { selected: true, action: "link_to_moc", file_under: "" },
				}),
			]);
			const { ctx, getModel } = makeRecordingCtx(model);
			const container = document.createElement("div");

			tab.render(container, model, ctx);
			expect(container.textContent).toContain("File under");

			const input = container.querySelector(".hashi-ga-target-inp") as HTMLInputElement;
			input.value = "021 Fleeting MOC";
			input.dispatchEvent(new Event("change"));

			expect(finding(getModel(), "F03").decision?.file_under).toBe("021 Fleeting MOC");
		},
	);
});

describe("GardenAuditTab.render — no-scan-candidate hint (2026-07-23 user QA)", () => {
	const HINT_TEXT = "No scan candidate — an empty target has no fallback here.";

	it.each(["orphan", "unparented"] as const)(
		"%s: shows the hint when detail.candidate_mocs is an empty array",
		(check) => {
			const tab = new GardenAuditTab();
			const model = getMockModel([
				getMockFinding({
					id: "F03",
					check,
					tier: "structure",
					target: { path: "Notes/Orphan.md", stem: "Orphan" },
					detail: { candidate_mocs: [] },
					decision: { selected: true, action: "link_to_moc", file_under: "" },
				}),
			]);
			const ctx = makeCtx();
			const container = document.createElement("div");

			tab.render(container, model, ctx);

			expect(container.textContent).toContain(HINT_TEXT);
		},
	);

	it.each(["orphan", "unparented"] as const)(
		"%s: shows the hint when detail.candidate_mocs is missing entirely",
		(check) => {
			const tab = new GardenAuditTab();
			const model = getMockModel([
				getMockFinding({
					id: "F03",
					check,
					tier: "structure",
					target: { path: "Notes/Orphan.md", stem: "Orphan" },
					detail: {},
					decision: { selected: true, action: "link_to_moc", file_under: "" },
				}),
			]);
			const ctx = makeCtx();
			const container = document.createElement("div");

			tab.render(container, model, ctx);

			expect(container.textContent).toContain(HINT_TEXT);
		},
	);

	it("does not show the hint when a valid scan candidate is present", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F03",
				check: "orphan",
				tier: "structure",
				target: { path: "Notes/Orphan.md", stem: "Orphan" },
				detail: { candidate_mocs: [{ target_moc: "020 Active MOC", score: 0.6 }] },
				decision: { selected: true, action: "link_to_moc", file_under: "" },
			}),
		]);
		const ctx = makeCtx();
		const container = document.createElement("div");

		tab.render(container, model, ctx);

		expect(container.textContent).not.toContain(HINT_TEXT);
	});

	it("never shows the hint on a dead_link card (no fallback semantics)", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F02",
				check: "dead_link",
				tier: "integrity",
				target: { path: "Notes/Child.md", stem: "Child" },
				detail: { dead_target: "Deleted MOC", count: 1 },
				decision: { selected: false, action: null, replace: "" },
			}),
		]);
		const ctx = makeCtx();
		const container = document.createElement("div");

		tab.render(container, model, ctx);

		expect(container.textContent).not.toContain(HINT_TEXT);
	});

	it("never shows the hint on a broken_up card (no fallback semantics)", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F02",
				check: "broken_up",
				tier: "integrity",
				target: { path: "Notes/Child.md", stem: "Child" },
				detail: { up_target: "Deleted MOC" },
				decision: { selected: false, action: null, repoint: "" },
			}),
		]);
		const ctx = makeCtx();
		const container = document.createElement("div");

		tab.render(container, model, ctx);

		expect(container.textContent).not.toContain(HINT_TEXT);
	});
});

describe("GardenAuditTab.render — target note title is an openable link", () => {
	it("renders the finding's target stem as a clickable link that opens the note", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F02",
				check: "broken_up",
				target: { path: "Notes/Child.md", stem: "Child" },
				detail: { up_target: "Deleted MOC" },
				decision: { selected: false, action: null, repoint: "" },
			}),
		]);
		const ctx = makeCtx();
		const container = document.createElement("div");

		tab.render(container, model, ctx);
		const link = container.querySelector(".hashi-se-wlink");

		expect(link?.textContent).toBe("Child");
		link?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(ctx.app.workspace.openLinkText).toHaveBeenCalledWith("Child", "", "split");
	});

	it("renders the finding's target path as a clickable link when stem is null", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F02",
				check: "broken_up",
				target: { path: "Notes/Child.md", stem: null },
				detail: { up_target: "Deleted MOC" },
				decision: { selected: false, action: null, repoint: "" },
			}),
		]);
		const ctx = makeCtx();
		const container = document.createElement("div");

		tab.render(container, model, ctx);
		const link = container.querySelector(".hashi-se-wlink");

		expect(link?.textContent).toBe("Notes/Child.md");
		link?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(ctx.app.workspace.openLinkText).toHaveBeenCalledWith(
			"Notes/Child.md",
			"",
			"split",
		);
	});

	it("hovering the note link fires hover-link so Obsidian's page preview is available", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F02",
				check: "broken_up",
				target: { path: "Notes/Child.md", stem: "Child" },
				detail: { up_target: "Deleted MOC" },
				decision: { selected: false, action: null, repoint: "" },
			}),
		]);
		const ctx = makeCtx();
		const container = document.createElement("div");

		tab.render(container, model, ctx);
		const link = container.querySelector(".hashi-se-wlink")!;
		link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

		expect(ctx.app.workspace.trigger).toHaveBeenCalledWith(
			"hover-link",
			expect.objectContaining({ linktext: "Child", targetEl: link }),
		);
	});

	it("a target note that no longer resolves renders plain text + 'note not found', not a link", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F02",
				check: "broken_up",
				target: { path: "Notes/Child.md", stem: "Child" },
				detail: { up_target: "Deleted MOC" },
				decision: { selected: false, action: null, repoint: "" },
			}),
		]);
		const ctx = makeCtx();
		vi.mocked(ctx.app.metadataCache.getFirstLinkpathDest).mockReturnValue(null);
		const container = document.createElement("div");

		expect(() => tab.render(container, model, ctx)).not.toThrow();
		expect(container.querySelector(".hashi-se-wlink")).toBeNull();
		const missing = container.querySelector(".hashi-ga-note-missing");
		expect(missing?.textContent).toBe("Child (note not found)");

		missing?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(ctx.app.workspace.openLinkText).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// T5.3 — candidate chips (display-only, click-to-pick)
// ---------------------------------------------------------------------------

describe("GardenAuditTab.render — candidate chips (T5.3)", () => {
	it("renders decision.candidates as a scored LLM chip row of buttons", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F04",
				check: "dead_link",
				detail: { dead_target: "023 Sparks MOC", count: 1 },
				decision: {
					selected: true,
					action: "edit_note_text",
					replace: "",
					candidates: [
						{ stem: "020 Active MOC", score: 0.6 },
						{ stem: "021 Fleeting MOC", score: 0.4 },
					],
				},
			}),
		]);
		const container = document.createElement("div");

		tab.render(container, model, makeCtx());

		const chips = container.querySelectorAll(".hashi-ga-chip");
		expect(chips).toHaveLength(2);
		expect(chips[0]?.tagName).toBe("BUTTON");
		expect(chips[0]?.getAttribute("type")).toBe("button");
		expect(chips[0]?.textContent).toContain("020 Active MOC");
		expect(chips[0]?.textContent).toContain(".60");
	});

	it("renders detail.candidate_mocs as a distinct scan chip row for unparented/orphan", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F03",
				check: "orphan",
				tier: "structure",
				target: { path: "Notes/Orphan.md", stem: "Orphan" },
				detail: {
					candidate_mocs: [{ target_moc: "020 Active MOC", score: 0.6 }],
				},
				decision: { selected: true, action: "link_to_moc", file_under: "" },
			}),
		]);
		const container = document.createElement("div");

		tab.render(container, model, makeCtx());

		const scanRow = container.querySelector(".hashi-ga-chip-row--scan");
		expect(scanRow).not.toBeNull();
		const chip = scanRow?.querySelector(".hashi-ga-chip");
		expect(chip?.textContent).toContain("020 Active MOC");
		expect(chip?.textContent).toContain(".60");
	});

	it("LLM row and scan row are distinct rows when both are present (unparented)", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F03",
				check: "unparented",
				tier: "structure",
				target: { path: "Notes/Unparented.md", stem: "Unparented" },
				detail: {
					candidate_mocs: [{ target_moc: "020 Active MOC", score: 0.6 }],
				},
				decision: {
					selected: true,
					action: "link_to_moc",
					file_under: "",
					candidates: [{ stem: "021 Fleeting MOC", score: 0.8 }],
				},
			}),
		]);
		const container = document.createElement("div");

		tab.render(container, model, makeCtx());

		expect(container.querySelectorAll(".hashi-ga-chip-row--llm")).toHaveLength(1);
		expect(container.querySelectorAll(".hashi-ga-chip-row--scan")).toHaveLength(1);
		expect(container.querySelectorAll(".hashi-ga-chip")).toHaveLength(2);
	});

	it("clicking an LLM chip writes its stem into the replace target field (dead_link) without flipping selected", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F04",
				check: "dead_link",
				detail: { dead_target: "023 Sparks MOC", count: 1 },
				decision: {
					selected: false,
					action: null,
					replace: "",
					candidates: [{ stem: "020 Active MOC", score: 0.6 }],
				},
			}),
		]);
		const { ctx, getModel } = makeRecordingCtx(model);
		const container = document.createElement("div");

		tab.render(container, model, ctx);
		const chip = container.querySelector(".hashi-ga-chip") as HTMLButtonElement;
		chip.click();

		const decision = finding(getModel(), "F04").decision;
		expect(decision?.replace).toBe("020 Active MOC");
		expect(decision?.selected).toBe(false);
	});

	it("clicking a scan chip writes target_moc into file_under (orphan) via setFileUnder", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F03",
				check: "orphan",
				tier: "structure",
				target: { path: "Notes/Orphan.md", stem: "Orphan" },
				detail: {
					candidate_mocs: [{ target_moc: "020 Active MOC", score: 0.6 }],
				},
				decision: { selected: true, action: "link_to_moc", file_under: "" },
			}),
		]);
		const { ctx, getModel } = makeRecordingCtx(model);
		const container = document.createElement("div");

		tab.render(container, model, ctx);
		const chip = container.querySelector(".hashi-ga-chip") as HTMLButtonElement;
		chip.click();

		expect(finding(getModel(), "F03").decision?.file_under).toBe("020 Active MOC");
	});

	it("clicking a repoint (broken_up) chip dispatches setRepoint and derives action per ADR-5", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F02",
				check: "broken_up",
				target: { path: "Notes/Child.md", stem: "Child" },
				detail: { up_target: "Deleted MOC" },
				decision: {
					selected: true,
					action: "edit_note_text",
					repoint: "",
					candidates: [{ stem: "020 Active MOC", score: 0.6 }],
				},
			}),
		]);
		const { ctx, getModel } = makeRecordingCtx(model);
		const container = document.createElement("div");

		tab.render(container, model, ctx);
		const chip = container.querySelector(".hashi-ga-chip") as HTMLButtonElement;
		chip.click();

		const decision = finding(getModel(), "F02").decision;
		expect(decision?.repoint).toBe("020 Active MOC");
		expect(decision?.action).toBe("add_relationship");
	});

	it("highlights the chip whose stem matches the committed target with is-active + aria-pressed", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F04",
				check: "dead_link",
				detail: { dead_target: "023 Sparks MOC", count: 1 },
				decision: {
					selected: true,
					action: "edit_note_text",
					replace: "021 Fleeting MOC",
					candidates: [
						{ stem: "020 Active MOC", score: 0.6 },
						{ stem: "021 Fleeting MOC", score: 0.4 },
					],
				},
			}),
		]);
		const container = document.createElement("div");

		tab.render(container, model, makeCtx());

		const chips = Array.from(container.querySelectorAll(".hashi-ga-chip"));
		const active = chips.find((c) => c.textContent?.includes("021 Fleeting MOC"));
		const inactive = chips.find((c) => c.textContent?.includes("020 Active MOC"));
		expect(active?.classList.contains("is-active")).toBe(true);
		expect(active?.getAttribute("aria-pressed")).toBe("true");
		expect(inactive?.classList.contains("is-active")).toBe(false);
		expect(inactive?.getAttribute("aria-pressed")).toBe("false");
	});

	it("skips a malformed candidate_mocs entry (missing target_moc) without crashing", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F03",
				check: "orphan",
				tier: "structure",
				target: { path: "Notes/Orphan.md", stem: "Orphan" },
				detail: {
					candidate_mocs: [
						{ score: 0.6 },
						{ target_moc: "020 Active MOC", score: 0.6 },
						{ target_moc: "bad score", score: "not-a-number" },
					],
				},
				decision: { selected: true, action: "link_to_moc", file_under: "" },
			}),
		]);
		const container = document.createElement("div");

		expect(() => tab.render(container, model, makeCtx())).not.toThrow();
		const scanRow = container.querySelector(".hashi-ga-chip-row--scan");
		expect(scanRow?.querySelectorAll(".hashi-ga-chip")).toHaveLength(1);
	});

	it("renders no chip row when candidates and candidate_mocs are both empty/absent", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F04",
				check: "dead_link",
				detail: { dead_target: "023 Sparks MOC", count: 1 },
				decision: { selected: true, action: "edit_note_text", replace: "" },
			}),
		]);
		const container = document.createElement("div");

		tab.render(container, model, makeCtx());

		expect(container.querySelector(".hashi-ga-chip-row")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Target edit on a skipped finding auto-selects Apply (2026-07-23 user
// decision) — a committed target change (textbox commit or picker pick,
// which share the SAME `onChange`) flips a Skip finding to Apply when the
// per-check transform actually changed the model. Candidate chips are
// EXCLUDED (covered above in T5.3 — chips dispatch their transforms
// directly, never through this onChange).
// ---------------------------------------------------------------------------

describe("GardenAuditTab.render — target edit on a skipped finding auto-selects Apply", () => {
	it("broken_up: skip + commit a new repoint target flips selected to true (ADR-5 action too)", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F02",
				check: "broken_up",
				tier: "integrity",
				target: { path: "Notes/Child.md", stem: "Child" },
				detail: { up_target: "Deleted MOC" },
				decision: { selected: false, action: null, repoint: "" },
			}),
		]);
		const { ctx, getModel } = makeRecordingCtx(model);
		const container = document.createElement("div");

		tab.render(container, model, ctx);
		const input = container.querySelector(".hashi-ga-target-inp") as HTMLInputElement;
		input.value = "New Target";
		input.dispatchEvent(new Event("change"));

		const decision = finding(getModel(), "F02").decision;
		expect(decision?.repoint).toBe("New Target");
		expect(decision?.action).toBe("add_relationship");
		expect(decision?.selected).toBe(true);
	});

	it("dead_link: skip + commit a new replace target flips selected to true", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F04",
				check: "dead_link",
				detail: { dead_target: "023 Sparks MOC", count: 1 },
				decision: { selected: false, action: null, replace: "" },
			}),
		]);
		const { ctx, getModel } = makeRecordingCtx(model);
		const container = document.createElement("div");

		tab.render(container, model, ctx);
		const input = container.querySelector(".hashi-ga-target-inp") as HTMLInputElement;
		input.value = "New Target";
		input.dispatchEvent(new Event("change"));

		const decision = finding(getModel(), "F04").decision;
		expect(decision?.replace).toBe("New Target");
		expect(decision?.selected).toBe(true);
	});

	it.each(["orphan", "unparented"] as const)(
		"%s: skip + commit a new file_under target flips selected to true",
		(check) => {
			const tab = new GardenAuditTab();
			const model = getMockModel([
				getMockFinding({
					id: "F03",
					check,
					tier: "structure",
					target: { path: "Notes/Orphan.md", stem: "Orphan" },
					detail: {},
					decision: { selected: false, action: null, file_under: "" },
				}),
			]);
			const { ctx, getModel } = makeRecordingCtx(model);
			const container = document.createElement("div");

			tab.render(container, model, ctx);
			const input = container.querySelector(".hashi-ga-target-inp") as HTMLInputElement;
			input.value = "New Target";
			input.dispatchEvent(new Event("change"));

			const decision = finding(getModel(), "F03").decision;
			expect(decision?.file_under).toBe("New Target");
			expect(decision?.selected).toBe(true);
		},
	);

	// The picker button's "choose" callback (TargetControl.ts) calls the SAME
	// `onChange` a textbox commit does (see TargetControl.test.ts's
	// picker-button describe block for the picker's own wiring) — so driving
	// the shared onChange via the textbox exercises the identical dispatch
	// path a picker pick would take. No separate picker-path test needed here.
	it("a committed change dispatched via the shared onChange (picker-equivalent path) flips selected", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F04",
				check: "dead_link",
				detail: { dead_target: "023 Sparks MOC", count: 1 },
				decision: { selected: false, action: null, replace: "" },
			}),
		]);
		const { ctx, getModel } = makeRecordingCtx(model);
		const container = document.createElement("div");

		tab.render(container, model, ctx);
		const input = container.querySelector(".hashi-ga-target-inp") as HTMLInputElement;
		// Enter-key commit — the second of TargetControl's two commit paths,
		// alongside the picker's onChoose callback; both call the identical
		// onChange the change-event path above already exercises.
		input.value = "Picked Target";
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

		const decision = finding(getModel(), "F04").decision;
		expect(decision?.replace).toBe("Picked Target");
		expect(decision?.selected).toBe(true);
	});

	it("chip click on a skipped finding does NOT flip selected (candidates stay excluded)", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F03",
				check: "orphan",
				tier: "structure",
				target: { path: "Notes/Orphan.md", stem: "Orphan" },
				detail: {
					candidate_mocs: [{ target_moc: "020 Active MOC", score: 0.6 }],
				},
				decision: { selected: false, action: null, file_under: "" },
			}),
		]);
		const { ctx, getModel } = makeRecordingCtx(model);
		const container = document.createElement("div");

		tab.render(container, model, ctx);
		const chip = container.querySelector(".hashi-ga-chip") as HTMLButtonElement;
		chip.click();

		const decision = finding(getModel(), "F03").decision;
		expect(decision?.file_under).toBe("020 Active MOC");
		expect(decision?.selected).toBe(false);
	});

	it("already-Apply: a target edit leaves selected true (trivial no-op via setSelected)", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F04",
				check: "dead_link",
				detail: { dead_target: "023 Sparks MOC", count: 1 },
				decision: { selected: true, action: "edit_note_text", replace: "" },
			}),
		]);
		const { ctx, getModel } = makeRecordingCtx(model);
		const container = document.createElement("div");

		tab.render(container, model, ctx);
		const input = container.querySelector(".hashi-ga-target-inp") as HTMLInputElement;
		input.value = "New Target";
		input.dispatchEvent(new Event("change"));

		const decision = finding(getModel(), "F04").decision;
		expect(decision?.replace).toBe("New Target");
		expect(decision?.selected).toBe(true);
	});

	it("a NO-OP commit (re-committing the current value) does NOT flip selected", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F04",
				check: "dead_link",
				detail: { dead_target: "023 Sparks MOC", count: 1 },
				decision: { selected: false, action: null, replace: "Unchanged Target" },
			}),
		]);
		const { ctx, getModel } = makeRecordingCtx(model);
		const container = document.createElement("div");

		tab.render(container, model, ctx);
		const input = container.querySelector(".hashi-ga-target-inp") as HTMLInputElement;
		input.value = "Unchanged Target";
		input.dispatchEvent(new Event("change"));

		const decision = finding(getModel(), "F04").decision;
		expect(decision?.replace).toBe("Unchanged Target");
		expect(decision?.selected).toBe(false);
	});

	it("explicit-empty commit (clearing a non-empty target) flips selected to true", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F04",
				check: "dead_link",
				detail: { dead_target: "023 Sparks MOC", count: 1 },
				decision: { selected: false, action: null, replace: "Previous Target" },
			}),
		]);
		const { ctx, getModel } = makeRecordingCtx(model);
		const container = document.createElement("div");

		tab.render(container, model, ctx);
		const input = container.querySelector(".hashi-ga-target-inp") as HTMLInputElement;
		input.value = "";
		input.dispatchEvent(new Event("change"));

		const decision = finding(getModel(), "F04").decision;
		expect(decision?.replace).toBe("");
		expect(decision?.selected).toBe(true);
	});
});

describe("GardenAuditTab.render — advisory findings never get a fixable card", () => {
	it("renders no Apply/Skip control for an advisory finding", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F09",
				tier: "advisory",
				check: "stale_moc",
				fixable: false,
				decision: undefined,
			}),
		]);
		const container = document.createElement("div");

		tab.render(container, model, makeCtx());

		expect(container.querySelector(".hashi-ga-apply")).toBeNull();
		expect(container.querySelector(".hashi-ga-skip")).toBeNull();
		expect(container.querySelector(".hashi-ga-target-inp")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// T5.4 — Suggest-targets toggle + two-run hints
// ---------------------------------------------------------------------------

describe("GardenAuditTab.render — suggest-targets toggle (T5.4)", () => {
	it("renders the checkbox UNCHECKED when suggest_requested is absent/false", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F04",
				check: "dead_link",
				detail: { dead_target: "023 Sparks MOC", count: 1 },
				decision: { selected: true, action: "edit_note_text", replace: "" },
			}),
		]);
		const container = document.createElement("div");

		tab.render(container, model, makeCtx());

		const checkbox = container.querySelector(".hashi-ga-suggest-toggle") as HTMLInputElement;
		expect(checkbox).not.toBeNull();
		expect(checkbox.checked).toBe(false);
		expect(container.textContent).toContain("Suggest targets");
	});

	it("renders the checkbox CHECKED when suggest_requested is true", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F04",
				check: "dead_link",
				detail: { dead_target: "023 Sparks MOC", count: 1 },
				decision: {
					selected: true,
					action: "edit_note_text",
					replace: "",
					suggest_requested: true,
				},
			}),
		]);
		const container = document.createElement("div");

		tab.render(container, model, makeCtx());

		const checkbox = container.querySelector(".hashi-ga-suggest-toggle") as HTMLInputElement;
		expect(checkbox.checked).toBe(true);
	});

	it("toggling the checkbox ON dispatches setSuggestRequested, marks dirty, and touches NO other decision field", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F04",
				check: "dead_link",
				detail: { dead_target: "023 Sparks MOC", count: 1 },
				decision: {
					selected: true,
					action: "edit_note_text",
					replace: "021 Fleeting MOC",
					candidates: [],
				},
			}),
		]);
		const { ctx, getModel } = makeRecordingCtx(model);
		const container = document.createElement("div");

		tab.render(container, model, ctx);
		const checkbox = container.querySelector(".hashi-ga-suggest-toggle") as HTMLInputElement;
		checkbox.checked = true;
		checkbox.dispatchEvent(new Event("change"));

		const decision = finding(getModel(), "F04").decision;
		expect(decision?.suggest_requested).toBe(true);
		expect(getModel().dirty).toBe(true);
		// Suggest-only edit — every other apply-decision field is untouched.
		expect(decision?.selected).toBe(true);
		expect(decision?.action).toBe("edit_note_text");
		expect(decision?.replace).toBe("021 Fleeting MOC");
	});

	it("toggling the checkbox OFF dispatches setSuggestRequested(false)", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F04",
				check: "dead_link",
				detail: {},
				decision: {
					selected: true,
					action: "edit_note_text",
					replace: "",
					suggest_requested: true,
				},
			}),
		]);
		const { ctx, getModel } = makeRecordingCtx(model);
		const container = document.createElement("div");

		tab.render(container, model, ctx);
		const checkbox = container.querySelector(".hashi-ga-suggest-toggle") as HTMLInputElement;
		checkbox.checked = false;
		checkbox.dispatchEvent(new Event("change"));

		expect(finding(getModel(), "F04").decision?.suggest_requested).toBe(false);
	});

	it.each(["broken_up", "orphan", "unparented"] as const)(
		"%s card also gets the suggest-targets toggle",
		(check) => {
			const tab = new GardenAuditTab();
			const model = getMockModel([
				getMockFinding({
					id: "F02",
					check,
					tier: check === "broken_up" ? "integrity" : "structure",
					detail: {},
					decision: { selected: true, action: "edit_note_text" },
				}),
			]);
			const container = document.createElement("div");

			tab.render(container, model, makeCtx());

			expect(container.querySelector(".hashi-ga-suggest-toggle")).not.toBeNull();
		},
	);

	const PENDING_TEXT = "Suggestions pending — run /garden-audit --suggest in Tomo, then reopen.";
	const EMPTY_TEXT = "No suggestions found.";

	it("pending hint: suggest_requested:true, no `suggested` key, empty candidates", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F04",
				check: "dead_link",
				detail: {},
				decision: {
					selected: true,
					action: "edit_note_text",
					replace: "",
					candidates: [],
					suggest_requested: true,
				},
			}),
		]);
		const container = document.createElement("div");

		tab.render(container, model, makeCtx());

		expect(container.textContent).toContain(PENDING_TEXT);
		expect(container.textContent).not.toContain(EMPTY_TEXT);
	});

	it("legacy wire (no `suggested` key anywhere) behaves as the pending branch by construction", () => {
		const tab = new GardenAuditTab();
		// Pre-030 decision shape — `suggested` was never a field on this wire.
		const decision = {
			selected: true,
			action: "edit_note_text",
			replace: "",
			suggest_requested: true,
		};
		expect("suggested" in decision).toBe(false);
		const model = getMockModel([
			getMockFinding({ id: "F04", check: "dead_link", detail: {}, decision }),
		]);
		const container = document.createElement("div");

		tab.render(container, model, makeCtx());

		expect(container.textContent).toContain(PENDING_TEXT);
	});

	it.each([true, false])(
		"ran-empty hint shows regardless of suggest_requested (suggested:true, candidates:[], suggest_requested:%s)",
		(suggestRequested) => {
			const tab = new GardenAuditTab();
			const model = getMockModel([
				getMockFinding({
					id: "F04",
					check: "dead_link",
					detail: {},
					decision: {
						selected: true,
						action: "edit_note_text",
						replace: "",
						candidates: [],
						suggest_requested: suggestRequested,
						suggested: true,
					},
				}),
			]);
			const container = document.createElement("div");

			tab.render(container, model, makeCtx());

			expect(container.textContent).toContain(EMPTY_TEXT);
			expect(container.textContent).not.toContain(PENDING_TEXT);
		},
	);

	it("candidates present → chips render and NEITHER hint text appears", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F04",
				check: "dead_link",
				detail: { dead_target: "023 Sparks MOC", count: 1 },
				decision: {
					selected: true,
					action: "edit_note_text",
					replace: "",
					candidates: [{ stem: "020 Active MOC", score: 0.6 }],
					suggest_requested: true,
					suggested: true,
				},
			}),
		]);
		const container = document.createElement("div");

		tab.render(container, model, makeCtx());

		expect(container.querySelectorAll(".hashi-ga-chip")).toHaveLength(1);
		expect(container.textContent).not.toContain(PENDING_TEXT);
		expect(container.textContent).not.toContain(EMPTY_TEXT);
	});

	it("neither hint renders when suggest_requested is absent/false and suggested is absent", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getMockFinding({
				id: "F04",
				check: "dead_link",
				detail: {},
				decision: { selected: true, action: "edit_note_text", replace: "" },
			}),
		]);
		const container = document.createElement("div");

		tab.render(container, model, makeCtx());

		expect(container.textContent).not.toContain(PENDING_TEXT);
		expect(container.textContent).not.toContain(EMPTY_TEXT);
	});
});

// ---------------------------------------------------------------------------
// T5.5 — advisory read-only cards
// ---------------------------------------------------------------------------

describe("GardenAuditTab.render — advisory read-only cards (T5.5)", () => {
	function getStaleMocFinding(overrides?: Partial<FindingWire>): FindingWire {
		return getMockFinding({
			id: "F09",
			tier: "advisory",
			check: "stale_moc",
			fixable: false,
			target: { path: "MOCs/Old.md", stem: "Old" },
			detail: { mtime: "2026-01-01T00:00:00Z" },
			decision: undefined,
			...overrides,
		});
	}

	function getDuplicateStemFinding(overrides?: Partial<FindingWire>): FindingWire {
		return getMockFinding({
			id: "F10",
			tier: "advisory",
			check: "duplicate_stem",
			fixable: false,
			target: { path: "Notes/A.md", stem: "A" },
			detail: { dupes: ["Notes/A.md", "Folder/Deep/A.md"] },
			decision: undefined,
			...overrides,
		});
	}

	it("stale_moc card renders the last-modified mtime detail", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([getStaleMocFinding()]);
		const container = document.createElement("div");

		tab.render(container, model, makeCtx());

		expect(container.textContent).toContain("2026-01-01T00:00:00Z");
	});

	it("duplicate_stem card renders the FULL colliding paths from dupes (not just stems)", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([getDuplicateStemFinding()]);
		const container = document.createElement("div");

		tab.render(container, model, makeCtx());

		expect(container.textContent).toContain("Notes/A.md");
		expect(container.textContent).toContain("Folder/Deep/A.md");
	});

	it.each([
		["stale_moc", getStaleMocFinding] as const,
		["duplicate_stem", getDuplicateStemFinding] as const,
	])("%s card exposes no Apply/Skip, target field, or chip controls", (_check, factory) => {
		const tab = new GardenAuditTab();
		const model = getMockModel([factory()]);
		const container = document.createElement("div");

		tab.render(container, model, makeCtx());

		expect(container.querySelector(".hashi-ga-apply")).toBeNull();
		expect(container.querySelector(".hashi-ga-skip")).toBeNull();
		expect(container.querySelector(".hashi-ga-target-inp")).toBeNull();
		expect(container.querySelector(".hashi-ga-target-field")).toBeNull();
		expect(container.querySelector(".hashi-ga-chip")).toBeNull();
		expect(container.querySelector(".hashi-ga-chip-row")).toBeNull();
		expect(container.querySelector(".hashi-ga-suggest")).toBeNull();
		expect(container.querySelector(".hashi-ga-suggest-toggle")).toBeNull();
	});

	it("the only interactive element (button/a/input) in an advisory card is the note link", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([getStaleMocFinding()]);
		const container = document.createElement("div");

		tab.render(container, model, makeCtx());

		const card = container.querySelector(".hashi-ga-card")!;
		expect(card.querySelectorAll("button, a, input")).toHaveLength(0);
		const link = card.querySelector(".hashi-se-wlink");
		expect(link).not.toBeNull();
		expect(link?.getAttribute("role")).toBe("link");
	});

	it("renders the advisory card dimmed via the --advisory modifier class", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([getStaleMocFinding()]);
		const container = document.createElement("div");

		tab.render(container, model, makeCtx());

		expect(container.querySelector(".hashi-ga-card--advisory")).not.toBeNull();
		expect(container.querySelector(".hashi-ga-card-readonly-tag")?.textContent).toBe(
			"(read-only)",
		);
	});

	it("clicking every clickable element in an advisory card dispatches NO transform — only the note link opens", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([getStaleMocFinding()]);
		let applyCalls = 0;
		const app = new App();
		const ctx: GardenAuditTabContext = {
			app,
			apply: (transform) => {
				applyCalls += 1;
				transform(model);
			},
			deadLinkContext: stubDeadLinkContext(),
		};
		const container = document.createElement("div");

		tab.render(container, model, ctx);

		const card = container.querySelector(".hashi-ga-card")!;
		const clickables = card.querySelectorAll<HTMLElement>("button, a, input, [role='link']");
		for (const el of Array.from(clickables)) {
			el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		}

		expect(applyCalls).toBe(0);
		expect(app.workspace.openLinkText).toHaveBeenCalledWith("Old", "", "split");
	});

	it("stale_moc degrades gracefully when mtime is missing/malformed — no crash", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([getStaleMocFinding({ detail: {} })]);
		const container = document.createElement("div");

		expect(() => tab.render(container, model, makeCtx())).not.toThrow();
		expect(container.querySelector(".hashi-ga-apply")).toBeNull();
	});

	it("duplicate_stem degrades gracefully when dupes is missing or malformed — no crash", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getDuplicateStemFinding({ detail: { dupes: "not-an-array" } }),
		]);
		const container = document.createElement("div");

		expect(() => tab.render(container, model, makeCtx())).not.toThrow();
		expect(container.textContent).toContain("(no colliding paths reported)");
	});

	it("duplicate_stem skips non-string entries within a malformed dupes array — no crash", () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([
			getDuplicateStemFinding({
				detail: { dupes: ["Notes/A.md", 42, null, "Folder/Deep/A.md"] },
			}),
		]);
		const container = document.createElement("div");

		expect(() => tab.render(container, model, makeCtx())).not.toThrow();
		expect(container.textContent).toContain("Notes/A.md");
		expect(container.textContent).toContain("Folder/Deep/A.md");
	});
});

// ---------------------------------------------------------------------------
// T6.1 — dead-link context (async, cached, off the main thread)
// ---------------------------------------------------------------------------

describe("GardenAuditTab.render — dead-link context (T6.1)", () => {
	function makeDeadLinkFinding(overrides?: Partial<FindingWire>): FindingWire {
		return getMockFinding({
			id: "F04",
			check: "dead_link",
			tier: "integrity",
			target: { path: "MOCs/020 Active MOC.md", stem: "020 Active MOC" },
			detail: { dead_target: "023 Sparks MOC", count: 1 },
			decision: { selected: true, action: "edit_note_text", replace: "" },
			...overrides,
		});
	}

	async function flushMicrotasks(): Promise<void> {
		await Promise.resolve();
		await Promise.resolve();
	}

	it("shows a loading placeholder synchronously, then the resolved snippet after flush", async () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([makeDeadLinkFinding()]);
		const deadLinkContext = vi.fn(
			async (): Promise<DeadLinkContextResult> => ({
				status: "ok",
				occurrences: [
					{ line: "- see [[023 Sparks MOC]] for background.", heading: "Sparks" },
				],
			}),
		);
		const ctx: GardenAuditTabContext = { app: new App(), apply: () => {}, deadLinkContext };
		const container = document.createElement("div");
		document.body.appendChild(container);

		tab.render(container, model, ctx);

		expect(container.querySelector(".hashi-ga-context")?.textContent).toBe(
			"Loading context…",
		);
		expect(deadLinkContext).toHaveBeenCalledWith("MOCs/020 Active MOC.md", "023 Sparks MOC");

		await flushMicrotasks();

		const text = container.querySelector(".hashi-ga-context")?.textContent;
		expect(text).toContain("- see [[023 Sparks MOC]] for background.");
		expect(text).toContain("Sparks");

		document.body.removeChild(container);
	});

	it("renders 'Note not found.' when the affected note is missing/moved — card stays intact", async () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([makeDeadLinkFinding()]);
		const deadLinkContext = vi.fn(
			async (): Promise<DeadLinkContextResult> => ({ status: "note-not-found" }),
		);
		const ctx: GardenAuditTabContext = { app: new App(), apply: () => {}, deadLinkContext };
		const container = document.createElement("div");
		document.body.appendChild(container);

		tab.render(container, model, ctx);
		await flushMicrotasks();

		expect(container.querySelector(".hashi-ga-context-missing")?.textContent).toBe(
			"Note not found.",
		);
		// The rest of the card renders normally alongside the degraded context.
		expect(container.textContent).toContain("Replace with");

		document.body.removeChild(container);
	});

	it("renders 'No longer found in note.' when the note resolves but the wikilink has since been removed", async () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([makeDeadLinkFinding()]);
		const deadLinkContext = vi.fn(
			async (): Promise<DeadLinkContextResult> => ({ status: "ok", occurrences: [] }),
		);
		const ctx: GardenAuditTabContext = { app: new App(), apply: () => {}, deadLinkContext };
		const container = document.createElement("div");
		document.body.appendChild(container);

		tab.render(container, model, ctx);
		await flushMicrotasks();

		expect(container.querySelector(".hashi-ga-context-missing")?.textContent).toBe(
			"No longer found in note.",
		);
		// The rest of the card renders normally alongside the hint.
		expect(container.textContent).toContain("Replace with");

		document.body.removeChild(container);
	});

	it("only dead_link cards call deadLinkContext — broken_up/orphan/advisory never do", () => {
		const tab = new GardenAuditTab();
		const deadLinkContext = vi.fn(
			async (): Promise<DeadLinkContextResult> => ({ status: "note-not-found" }),
		);
		const model = getMockModel([
			getMockFinding({
				id: "F02",
				check: "broken_up",
				tier: "integrity",
				target: { path: "Notes/Child.md", stem: "Child" },
				detail: { up_target: "Deleted MOC" },
				decision: { selected: false, action: null, repoint: "" },
			}),
			getMockFinding({
				id: "F03",
				check: "orphan",
				tier: "structure",
				target: { path: "Notes/Orphan.md", stem: "Orphan" },
				detail: {},
				decision: { selected: false, action: null, file_under: "" },
			}),
			getMockFinding({
				id: "F09",
				tier: "advisory",
				check: "stale_moc",
				fixable: false,
				target: { path: "MOCs/Old.md", stem: "Old" },
				detail: { mtime: "2026-01-01T00:00:00Z" },
				decision: undefined,
			}),
			makeDeadLinkFinding(),
		]);
		const ctx: GardenAuditTabContext = { app: new App(), apply: () => {}, deadLinkContext };
		const container = document.createElement("div");

		tab.render(container, model, ctx);

		expect(deadLinkContext).toHaveBeenCalledTimes(1);
		expect(deadLinkContext).toHaveBeenCalledWith("MOCs/020 Active MOC.md", "023 Sparks MOC");
	});

	it("stale-completion guard: re-rendering before resolve drops the stale result — no throw, no duplicate", async () => {
		const tab = new GardenAuditTab();
		const model = getMockModel([makeDeadLinkFinding()]);
		const resolvers: Array<(result: DeadLinkContextResult) => void> = [];
		const deadLinkContext = vi.fn(
			() =>
				new Promise<DeadLinkContextResult>((resolve) => {
					resolvers.push(resolve);
				}),
		);
		const ctx: GardenAuditTabContext = { app: new App(), apply: () => {}, deadLinkContext };
		const container = document.createElement("div");
		document.body.appendChild(container);

		// First render — captures the stale placeholder + its resolver.
		tab.render(container, model, ctx);
		expect(resolvers).toHaveLength(1);

		// A second render rebuilds the subtree (mirrors GardenAuditEditorView's
		// real convention: the caller empties the container before re-
		// rendering), detaching the first render's placeholder from the doc.
		container.empty();
		tab.render(container, model, ctx);
		expect(resolvers).toHaveLength(2);

		// Resolve the STALE (first) call first — it must not throw, and must
		// not mutate anything now that its placeholder is detached.
		expect(() => {
			resolvers[0]?.({
				status: "ok",
				occurrences: [{ line: "STALE — must never appear", heading: null }],
			});
		}).not.toThrow();
		await flushMicrotasks();

		// Then the fresh (second) call resolves normally.
		resolvers[1]?.({
			status: "ok",
			occurrences: [{ line: "- see [[023 Sparks MOC]] fresh", heading: null }],
		});
		await flushMicrotasks();

		const contextBlocks = container.querySelectorAll(".hashi-ga-context");
		expect(contextBlocks).toHaveLength(1);
		expect(container.textContent).not.toContain("STALE");
		expect(container.textContent).toContain("fresh");

		document.body.removeChild(container);
	});
});
