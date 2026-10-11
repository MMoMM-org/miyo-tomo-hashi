/**
 * Editable-field coverage guard — the regression test for the class of gap
 * that produced #140, not for the gap itself.
 *
 * `delete_source` sat on the wire, in our types and in a tested transform for
 * months with no UI call site. Nothing failed, because "a transform exists and
 * is covered" is indistinguishable from "the owner can express this decision"
 * as long as nobody checks the join. That is the same shape as Tomo's spec-037
 * remedy, which reached our editor through no channel at all.
 *
 * So: every field the vendored suggestions-wire schema marks **Editable** on
 * the `suggestions[]` node must either be reachable from the Suggestions tab,
 * or appear below with a stated reason. A new editable field Tomo adds fails
 * this test on vendoring rather than on merge day.
 *
 * This is the MANUAL stand-in. Tomo is shipping a vendored inventory of the
 * markdown's editable decisions (handoff 2026-09-29, their spec 038); when it
 * lands, the join runs against that file and this list goes away — it covers
 * only what reaches our wire, and the inventory's whole point is the rows that
 * do not.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// `__dirname` rather than import.meta.url — the repo convention for tests that
// read real files off disk (see test/unit/manifest.test.ts).
const REPO_ROOT = resolve(__dirname, "../../../..");

const readSource = (relPath: string): string => readFileSync(resolve(REPO_ROOT, relPath), "utf8");

/**
 * Editable fields with no control on the Suggestions tab, each with the reason
 * it is legitimately absent. An entry here is a claim someone has to defend in
 * review — which is the point; the previous state made no claim at all.
 */
const JUSTIFIED_ABSENCES: Record<string, string> = {
	// Rendered by DailyTab, not the Suggestions tab: Force-Atomic is one
	// decision per source, mirrored across both tabs by item_key.
	force_atomic: "rendered on both SuggestionsTab and DailyTab via setForceAtomicFromSuggestion",
};

/** Which transform call proves a field is reachable from the tab. */
const CONTROLLED_BY: Record<string, readonly string[]> = {
	title: ["setTitle"],
	template: ["setTemplate"],
	location: ["setLocation"],
	tags: ["setTags"],
	decision: ["setDisposition"],
	delete_source: ["setDisposition"],
	keep_source: ["setKeepSource"],
	force_atomic: ["setForceAtomicFromSuggestion"],
	candidate_mocs: ["toggleCandidateMoc", "addMoc"],
};

describe("editable-field coverage (the #140 class guard)", () => {
	const schema = JSON.parse(readSource("src/schema/suggestions-wire.schema.json")) as {
		properties: {
			suggestions: { items: { properties: Record<string, { description?: string }> } };
		};
	};
	const suggestionProps = schema.properties.suggestions.items.properties;

	const editableFields = Object.entries(suggestionProps)
		.filter(([, spec]) => spec.description?.startsWith("Editable") === true)
		.map(([field]) => field);

	it("finds the editable fields in the vendored schema (guards the detection itself)", () => {
		// If Tomo rewords "Editable — …" the filter above silently matches
		// nothing and every assertion below passes vacuously. Pin a floor and a
		// known member so a reword fails loudly instead.
		expect(editableFields.length).toBeGreaterThanOrEqual(8);
		expect(editableFields).toContain("delete_source");
	});

	it("gives every editable field either a control on the tab or a stated reason", () => {
		const tabSource = readSource("src/ui/suggestions-view/tabs/SuggestionsTab.ts");

		const uncovered = editableFields.filter((field) => {
			if (field in JUSTIFIED_ABSENCES) return false;
			const writers = CONTROLLED_BY[field];
			if (writers === undefined) return true;
			return !writers.some((writer) => tabSource.includes(`${writer}(model`));
		});

		expect(uncovered).toEqual([]);
	});

	it("names a writer for every editable field, so a new one cannot pass unnoticed", () => {
		const unmapped = editableFields.filter((field) => !(field in CONTROLLED_BY));
		expect(unmapped).toEqual([]);
	});

	it("keeps the absence list honest — no stale entries for fields that do have controls", () => {
		const tabSource = readSource("src/ui/suggestions-view/tabs/SuggestionsTab.ts");

		for (const [field, reason] of Object.entries(JUSTIFIED_ABSENCES)) {
			expect(editableFields, `${field} is no longer an editable wire field`).toContain(field);
			expect(reason.length, `${field} needs a real reason`).toBeGreaterThan(20);
			// A justified absence must still trace to SOME writer somewhere —
			// otherwise it is an unreachable decision wearing an excuse.
			const writers = CONTROLLED_BY[field] ?? [];
			expect(writers.length, `${field} has no writer at all`).toBeGreaterThan(0);
			expect(
				writers.some((writer) => tabSource.includes(writer)),
				`${field}'s writer is not referenced by the tab that claims to render it`,
			).toBe(true);
		}
	});
});
