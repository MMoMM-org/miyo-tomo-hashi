/**
 * `noteSpots` — the Instruction Fixer's pickable anchors and markers
 * (spec-006 follow-up, user request 2026-07-27 b + c).
 *
 * The load-bearing tests here are the two cross-checks against the executor:
 * every offered ANCHOR is fed to the real `resolveAnchor`, and every offered
 * MARKER to the real `addRelationship` handler. A picker whose rows the
 * executor cannot resolve would be worse than the free-text field it replaces —
 * it would look authoritative while producing the same failure the user came to
 * repair. Those two tests are what make the roster's correctness a property of
 * the executor rather than of this file's own opinion.
 */

import { describe, expect, it } from "vitest";

import { addRelationship } from "../../../src/actions/addRelationship.js";
import { resolveAnchor } from "../../../src/actions/anchorResolver.js";
import {
	anchorSpotKindOf,
	computeAnchorSpots,
	computeMarkerSpots,
	placementsFor,
	spotSourcePath,
	type AnchorSpotKind,
} from "../../../src/instruction-fixer/noteSpots.js";
import type { Action, AddRelationshipAction } from "../../../src/schema/types.js";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";

const NOTE = [
	"---",
	"up:: [[Atlas (MOC)]]",
	"---",
	"",
	"# Systems (MOC)",
	"",
	"> [!blocks] Key Concepts",
	"> - [[Kanban]]",
	"",
	"## Maintenance",
	"",
	"- [[Weekly review]]",
	"",
	"```md",
	"## Not a real heading",
	"> [!note] Not a real callout",
	"```",
	"",
	"## Maintenance",
	"",
	"- [[Weekly review]]",
].join("\n");

const ALL_KINDS: readonly AnchorSpotKind[] = [
	"link_to_moc",
	"insert_under_marker",
	"replace_section",
];

// --- placement rules ---------------------------------------------------------

describe("placementsFor — mirrors each handler, and they disagree", () => {
	it("offers inside on a callout for both insert kinds", () => {
		expect(placementsFor("link_to_moc", "callout")).toContain("inside");
		expect(placementsFor("insert_under_marker", "callout")).toContain("inside");
	});

	/**
	 * The one asymmetry a single shared table would have to get wrong for one of
	 * them: `linkToMoc.ts:70` rejects inside-on-heading outright, while
	 * `insertUnderMarker.ts:78` implements it as "append at the end of the
	 * heading's section".
	 */
	it("offers inside on a HEADING only for insert_under_marker", () => {
		expect(placementsFor("link_to_moc", "heading")).toEqual(["before", "after"]);
		expect(placementsFor("insert_under_marker", "heading")).toEqual([
			"inside",
			"before",
			"after",
		]);
	});

	it("never offers inside on a line anchor", () => {
		for (const kind of ALL_KINDS) {
			expect(placementsFor(kind, "line")).not.toContain("inside");
		}
	});

	it("offers no placement at all for replace_section — its wire has no such field", () => {
		expect(placementsFor("replace_section", "heading")).toEqual([]);
	});
});

// --- anchor rosters ----------------------------------------------------------

describe("computeAnchorSpots", () => {
	it("enumerates headings, callouts and body lines", () => {
		const labels = computeAnchorSpots(NOTE, "link_to_moc").map((s) => s.label);

		expect(labels).toContain("Heading: Maintenance");
		expect(labels).toContain("Callout: [!blocks] Key Concepts");
		expect(labels).toContain("Line: - [[Weekly review]]");
	});

	it("shapes a callout value as [!type] Title — what resolveCallout parses back", () => {
		const callout = computeAnchorSpots(NOTE, "link_to_moc").find(
			(s) => s.anchorType === "callout",
		);

		expect(callout?.value).toBe("[!blocks] Key Concepts");
	});

	it("skips fenced headings and callouts, the way the resolvers do", () => {
		const spots = computeAnchorSpots(NOTE, "link_to_moc");

		expect(spots.some((s) => s.anchorType === "heading" && s.value === "Not a real heading")).toBe(
			false,
		);
		expect(spots.some((s) => s.anchorType === "callout" && s.value.includes("Not a real"))).toBe(
			false,
		);
	});

	/**
	 * `resolveLine` has no fence mask (`anchorResolver.ts:114`), so a fenced line
	 * IS matchable. Hiding it would mean the picker refused to offer something
	 * the executor would happily resolve.
	 */
	it("keeps fenced lines in the LINE roster, because resolveLine matches them", () => {
		const spots = computeAnchorSpots(NOTE, "link_to_moc");

		expect(spots.some((s) => s.anchorType === "line" && s.value === "## Not a real heading")).toBe(
			true,
		);
	});

	it("de-duplicates repeated lines and never re-offers a heading or callout line", () => {
		const lines = computeAnchorSpots(NOTE, "link_to_moc")
			.filter((s) => s.anchorType === "line" && s.placement === "before")
			.map((s) => s.value);

		expect(lines.filter((v) => v === "- [[Weekly review]]")).toHaveLength(1);
		expect(lines).not.toContain("## Maintenance");
		expect(lines).not.toContain("> [!blocks] Key Concepts");
	});

	it("offers replace_section headings only, with no placement", () => {
		const spots = computeAnchorSpots(NOTE, "replace_section");

		expect(spots.length).toBeGreaterThan(0);
		expect(spots.every((s) => s.anchorType === "heading")).toBe(true);
		expect(spots.every((s) => s.placement === null)).toBe(true);
	});

	it("never offers a block anchor — no way to enumerate the combinations", () => {
		for (const kind of ALL_KINDS) {
			const types = new Set(computeAnchorSpots(NOTE, kind).map((s) => s.anchorType));
			expect(types.has("block" as never)).toBe(false);
		}
	});

	it("returns nothing for empty content", () => {
		expect(computeAnchorSpots("", "link_to_moc")).toEqual([]);
	});

	/**
	 * The cross-check: the executor's own resolver must find every value the
	 * picker offers. This is what makes the roster correct by construction
	 * rather than by inspection — a stray label prefix leaking into `value`, or
	 * a callout shaped `!type Title` instead of `[!type] Title`, fails here.
	 */
	it("offers only anchors the executor's resolveAnchor can resolve", () => {
		for (const kind of ALL_KINDS) {
			for (const spot of computeAnchorSpots(NOTE, kind)) {
				const match = resolveAnchor(NOTE, { type: spot.anchorType, value: spot.value });
				expect(match, `${kind} / ${spot.anchorType} / ${spot.value}`).not.toBeNull();
			}
		}
	});

	/**
	 * Headings are excluded because `insert_under_marker`'s heading-inside does
	 * not go through `resolveAnchor.insertInside` at all — it computes the
	 * section range via `locateSection` (`insertUnderMarker.ts:78`). Every OTHER
	 * anchor type offering `inside` must have a real insertion point.
	 */
	it("offers no inside placement the resolver reports no insertion point for", () => {
		for (const kind of ALL_KINDS) {
			for (const spot of computeAnchorSpots(NOTE, kind)) {
				if (spot.placement !== "inside" || spot.anchorType === "heading") continue;
				const match = resolveAnchor(NOTE, { type: spot.anchorType, value: spot.value });
				expect(match?.insertInside, `${spot.anchorType} / ${spot.value}`).not.toBeNull();
			}
		}
	});
});

// --- marker roster -----------------------------------------------------------

const MARKER_NOTE = ["> - up:: [[Atlas (MOC)]]", "down:: [[Kanban]]", "- plain bullet", ""].join(
	"\n",
);

describe("computeMarkerSpots", () => {
	it("offers the Dataview field opener AND the whole line, fields first", () => {
		const values = computeMarkerSpots(MARKER_NOTE).map((s) => s.value);

		expect(values).toContain("up::");
		expect(values).toContain("up:: [[Atlas (MOC)]]");
		expect(values.indexOf("up::")).toBeLessThan(values.indexOf("up:: [[Atlas (MOC)]]"));
		expect(values.indexOf("down::")).toBeLessThan(values.indexOf("plain bullet"));
	});

	it("strips the callout prefix and list bullet the locator strips", () => {
		// The raw line is `> - up:: [[Atlas (MOC)]]`; neither `>` nor `- ` may
		// survive into the marker, since the locator removes them before matching.
		const spot = computeMarkerSpots(MARKER_NOTE).find((s) => s.value === "up::");

		expect(spot).toBeDefined();
		expect(computeMarkerSpots(MARKER_NOTE).some((s) => s.value.startsWith(">"))).toBe(false);
		expect(computeMarkerSpots(MARKER_NOTE).some((s) => s.value.startsWith("- "))).toBe(false);
	});

	/**
	 * `line` is the seed the card writes into the wire's `line` field alongside
	 * `marker` (2026-07-27 manual-QA follow-up) — it exists because picking a
	 * new marker while an unrelated `line` sits untouched lets `add_relationship`
	 * silently overwrite a line that has nothing to do with the one just picked.
	 * For a field-opener spot this is the CURRENT full line, minus the same
	 * callout/bullet prefixes `marker` itself is stripped of; for a whole-line
	 * spot `line` equals `value` (picking that spot verbatim is then a no-op on
	 * disk, the handler's own `skipped-already`).
	 */
	it("seeds a safe starting `line`, prefix-stripped like the marker itself", () => {
		const spots = computeMarkerSpots(MARKER_NOTE);

		const field = spots.find((s) => s.value === "up::");
		expect(field?.line).toBe("up:: [[Atlas (MOC)]]");

		const wholeLine = spots.find((s) => s.value === "up:: [[Atlas (MOC)]]");
		expect(wholeLine?.line).toBe(wholeLine?.value);
	});

	it("never leaves the callout/bullet prefix in `line` — the handler re-adds its own", () => {
		for (const spot of computeMarkerSpots(MARKER_NOTE)) {
			expect(spot.line.startsWith(">")).toBe(false);
			expect(spot.line.startsWith("- ")).toBe(false);
		}
	});

	it("skips blank lines and de-duplicates", () => {
		// Both non-blank lines are `a::`, and the field form equals the whole
		// line, so the roster collapses to a single row.
		expect(computeMarkerSpots("a::\n\n\na::\n").map((s) => s.value)).toEqual(["a::"]);
	});

	it("returns nothing for empty content", () => {
		expect(computeMarkerSpots("")).toEqual([]);
	});

	/**
	 * The second cross-check: run the REAL handler with each offered marker and
	 * assert none of them produce "Marker not found". A marker the picker offers
	 * but the locator cannot find is the exact bug this roster exists to prevent.
	 */
	it("offers only markers addRelationship's locator actually finds", async () => {
		const path = "Atlas/200 Maps/Systems (MOC).md";

		for (const spot of computeMarkerSpots(MARKER_NOTE)) {
			const vault = new FakeVaultFS();
			await vault.create(path, MARKER_NOTE);
			const action: AddRelationshipAction = {
				action: "add_relationship",
				id: "I01",
				target_moc_path: path,
				marker: spot.value,
				line: "rel:: [[New]]",
			};

			const outcome = await addRelationship(action, {
				vault,
				clock: { now: () => new Date("2026-07-27T10:00:00Z") },
			});

			expect(outcome.kind, `marker ${spot.value}`).not.toBe("failed");
		}
	});

	/**
	 * The third cross-check, specific to the manual-QA follow-up: writing a
	 * spot's `marker` AND its OWN `line` unmodified must be a true no-op on
	 * disk (`skipped-already`) — proof that `line` really is prefix-stripped
	 * the same way the handler reconstructs it, not merely non-`failed`.
	 */
	it("marker + its own seeded line round-trips as skipped-already, not a rewrite", async () => {
		const path = "Atlas/200 Maps/Systems (MOC).md";

		for (const spot of computeMarkerSpots(MARKER_NOTE)) {
			const vault = new FakeVaultFS();
			await vault.create(path, MARKER_NOTE);
			const action: AddRelationshipAction = {
				action: "add_relationship",
				id: "I01",
				target_moc_path: path,
				marker: spot.value,
				line: spot.line,
			};

			const outcome = await addRelationship(action, {
				vault,
				clock: { now: () => new Date("2026-07-27T10:00:00Z") },
			});

			expect(outcome.kind, `marker ${spot.value}`).toBe("skipped-already");
		}
	});
});

// --- kind dispatch -----------------------------------------------------------

describe("anchorSpotKindOf / spotSourcePath", () => {
	const linkToMoc: Action = {
		id: "I07",
		action: "link_to_moc",
		target_moc: "@",
		target_moc_path: "@.md",
		anchor: { type: "heading", value: "Maintenance" },
		placement: "after",
		line_to_add: "- [[005 Important Links]]",
	};

	it("names the three anchor kinds and rejects the rest", () => {
		expect(anchorSpotKindOf(linkToMoc)).toBe("link_to_moc");
		expect(
			anchorSpotKindOf({
				id: "I06",
				action: "resolve_dead_link",
				path: "@.md",
				target: "x.jpg",
				replace: "",
			}),
		).toBeNull();
	});

	/** Same precedence the executor resolves with — path wins over stem. */
	it("prefers link_to_moc's target_moc_path over its bare stem", () => {
		expect(spotSourcePath(linkToMoc)).toBe("@.md");
		expect(spotSourcePath({ ...linkToMoc, target_moc_path: null })).toBe("@");
	});

	it("returns the marker target for add_relationship and null for kinds with no spot", () => {
		expect(
			spotSourcePath({
				id: "I08",
				action: "add_relationship",
				target_moc_path: "005 Important Links.md",
				marker: "up::",
				line: "up:: [[@]]",
			}),
		).toBe("005 Important Links.md");
		expect(
			spotSourcePath({ id: "I13", action: "delete_source", source_path: "x.md", reason: "moved" }),
		).toBeNull();
	});
});
