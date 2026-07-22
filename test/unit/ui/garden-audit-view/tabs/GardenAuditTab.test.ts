/**
 * Unit tests for GardenAuditTab (spec-005 Phase 4, T4.2) — the tier-grouped
 * findings shell (Integrity/Structure/Advisory, each with a count; findings
 * in wire order within a tier; each row shows its finding id). Cards
 * themselves (target control, candidates, suggest toggle) are Phase 5 — the
 * per-finding row here is a deliberate placeholder.
 */

import "obsidian";
import { App } from "obsidian";
import { describe, expect, it } from "vitest";

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

function makeCtx(): GardenAuditTabContext {
	return { app: new App(), apply: () => {} };
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
