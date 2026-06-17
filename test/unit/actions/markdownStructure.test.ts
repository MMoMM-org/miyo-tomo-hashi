/**
 * markdownStructure — shared content-only parsing for callouts and headings,
 * used by anchorResolver and sectionLocator. These helpers replace the async
 * metadataCache lookups that raced multi-action batches into one file (#68).
 */

import { describe, expect, it } from "vitest";
import {
	fencedLineMask,
	findCallout,
	parseHeadings,
} from "../../../src/actions/markdownStructure.js";

describe("fencedLineMask", () => {
	it("marks fenced lines (and the delimiters) inside ``` blocks", () => {
		const lines = ["a", "```", "b", "```", "c"];
		expect(fencedLineMask(lines)).toEqual([false, true, true, true, false]);
	});

	it("handles ~~~ fences too", () => {
		const lines = ["~~~", "x", "~~~"];
		expect(fencedLineMask(lines)).toEqual([true, true, true]);
	});

	it("leaves all lines unmarked when there is no fence", () => {
		expect(fencedLineMask(["a", "b"])).toEqual([false, false]);
	});
});

describe("parseHeadings", () => {
	it("returns headings with text, level, and line in document order", () => {
		const lines = ["# Top", "body", "### Deep", "## Mid"];
		expect(parseHeadings(lines)).toEqual([
			{ heading: "Top", level: 1, line: 0 },
			{ heading: "Deep", level: 3, line: 2 },
			{ heading: "Mid", level: 2, line: 3 },
		]);
	});

	it("skips heading-like lines inside fenced code blocks", () => {
		const lines = ["# Real", "```", "## Fenced", "```"];
		expect(parseHeadings(lines)).toEqual([{ heading: "Real", level: 1, line: 0 }]);
	});

	it("ignores `#` without a following space (not an ATX heading)", () => {
		expect(parseHeadings(["#notaheading", "#tag"])).toEqual([]);
	});
});

describe("findCallout", () => {
	it("finds a callout by type + title (case-insensitive) and reports its span", () => {
		const lines = ["> [!Note] Daily Log", "> - a", "> - b", "", "after"];
		expect(findCallout(lines, "note", "daily log")).toEqual({ openerLine: 0, endLine: 2 });
	});

	it("matches any type when type is null (plain-title lookup)", () => {
		const lines = ["> [!whatever] Projects", "> body"];
		expect(findCallout(lines, null, "Projects")).toEqual({ openerLine: 0, endLine: 1 });
	});

	it("returns the first matching callout when several share type+title", () => {
		const lines = ["> [!note] Dup", "> a", "", "> [!note] Dup", "> b"];
		expect(findCallout(lines, "note", "Dup")?.openerLine).toBe(0);
	});

	it("does not match a callout opener inside a fenced code block", () => {
		const lines = ["```", "> [!note] Fenced", "```"];
		expect(findCallout(lines, "note", "Fenced")).toBeNull();
	});

	it("returns null when type is given but does not match", () => {
		expect(findCallout(["> [!note] X", "> y"], "blocks", "X")).toBeNull();
	});
});
