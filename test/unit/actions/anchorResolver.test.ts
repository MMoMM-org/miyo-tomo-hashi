/**
 * anchorResolver — locates an Anchor in a vault file and reports the
 * line indices needed for `link_to_moc`'s two placement modes:
 *   - insertInside: the line at which a new line written WITH `> ` prefix
 *     would land as the last content line inside the matched callout
 *     (null for non-callout anchors — placement: "inside" is invalid).
 *   - insertAfter: the line at which a new line written verbatim would
 *     land immediately after the anchor's terminal line (for callout:
 *     after the callout closes; for heading: after the heading line
 *     itself; for line: after the matched line).
 *
 * Resolution reads ONLY the file content — no metadataCache. This is the
 * fix for the metadataCache race (miyo-tomo-hashi#68): a batch with ≥2
 * inserts into the same file would race Obsidian's async cache rebuild, so
 * resolving from content is the only race-free source of truth.
 *
 * Anchor types:
 *   - callout: `[!type] Title` shape — matches the opening line of the
 *     callout whose type+title equal the value (case-insensitive). Body
 *     extends through consecutive `>`-prefixed lines.
 *   - heading: matches a heading by text (without leading `#`s),
 *     case-sensitive, any heading level.
 *   - line: matches a body line by literal stripped content (substring).
 *
 * [ref: PRD/F4 link_to_moc; SDD/Anchor Model 2026-05-01; #68]
 */

import { describe, expect, it } from "vitest";
import { resolveAnchor } from "../../../src/actions/anchorResolver.js";
import type { Anchor } from "../../../src/schema/types.js";

// ---------------------------------------------------------------------------
// callout anchor
// ---------------------------------------------------------------------------

describe("resolveAnchor — callout", () => {
	it("matches `[!blocks] Key Concepts` against a [!blocks] callout (insertInside + insertAfter both at endLine+1)", () => {
		const content = [
			"> [!connect] Your way around",       // 0
			"> up:: ",                             // 1
			"",                                    // 2
			"> [!blocks] Key Concepts",            // 3
			"> body line",                         // 4
		].join("\n");
		const anchor: Anchor = { type: "callout", value: "[!blocks] Key Concepts" };
		const result = resolveAnchor(content, anchor);
		expect(result).toEqual({ kind: "callout", anchorLine: 3, insertInside: 5, insertAfter: 5 });
	});

	it("does NOT match a callout with mismatched type (`[!compass] X` vs `[!blocks] X`) → null", () => {
		const content = [
			"> [!blocks] Key Concepts",
			"> body",
		].join("\n");
		const anchor: Anchor = { type: "callout", value: "[!compass] Key Concepts" };
		expect(resolveAnchor(content, anchor)).toBeNull();
	});

	it("callout match is case-insensitive on type and title", () => {
		const content = [
			"> [!Compass] Something you should look at perhaps..",
			"> body",
		].join("\n");
		const anchor: Anchor = {
			type: "callout",
			value: "[!compass] something YOU should look at perhaps..",
		};
		const result = resolveAnchor(content, anchor);
		expect(result?.kind).toBe("callout");
		expect(result?.anchorLine).toBe(0);
	});

	it("computes the callout body extent from consecutive `>` lines, stopping at the first non-`>` line", () => {
		const content = [
			"# Heading",                  // 0
			"> [!note] Projects",         // 1  opener
			"> - one",                    // 2  body
			">",                          // 3  body (empty quote line)
			"> - two",                    // 4  body (terminal)
			"",                           // 5  blank → ends callout
			"After",                      // 6
		].join("\n");
		const anchor: Anchor = { type: "callout", value: "[!note] Projects" };
		const result = resolveAnchor(content, anchor);
		// endLine = 4 → insertion at 5
		expect(result).toEqual({ kind: "callout", anchorLine: 1, insertInside: 5, insertAfter: 5 });
	});

	it("matches the FIRST callout when two share the same type+title (deterministic, no cache)", () => {
		const content = [
			"> [!note] Dup",              // 0  first
			"> a",                        // 1
			"",                           // 2
			"> [!note] Dup",              // 3  second
			"> b",                        // 4
		].join("\n");
		const anchor: Anchor = { type: "callout", value: "[!note] Dup" };
		const result = resolveAnchor(content, anchor);
		expect(result?.anchorLine).toBe(0);
	});

	it("does NOT match a callout opener that lives inside a fenced code block", () => {
		const content = [
			"# Doc",                      // 0
			"```md",                      // 1  fence open
			"> [!note] Example",          // 2  fenced — not a real anchor
			"```",                        // 3  fence close
			"body",                       // 4
		].join("\n");
		const anchor: Anchor = { type: "callout", value: "[!note] Example" };
		expect(resolveAnchor(content, anchor)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// heading anchor
// ---------------------------------------------------------------------------

describe("resolveAnchor — heading", () => {
	it("matches `Sources` against `## Sources` (insertInside null; insertAfter at heading.line+1)", () => {
		const content = [
			"# Top",                  // 0
			"intro",                  // 1
			"## Sources",             // 2
			"- a",                    // 3
			"- b",                    // 4
			"## Next section",        // 5
		].join("\n");
		const anchor: Anchor = { type: "heading", value: "Sources" };
		const result = resolveAnchor(content, anchor);
		expect(result).toEqual({
			kind: "heading",
			anchorLine: 2,
			insertInside: null,
			insertAfter: 3,
		});
	});

	it("matches at any heading level (h1 through h6)", () => {
		const content = "###### Deep Heading\nbody\n";
		const anchor: Anchor = { type: "heading", value: "Deep Heading" };
		const result = resolveAnchor(content, anchor);
		expect(result?.kind).toBe("heading");
		expect(result?.anchorLine).toBe(0);
	});

	it("returns null when no heading matches the value", () => {
		const content = "## Other\nbody\n";
		const anchor: Anchor = { type: "heading", value: "Missing" };
		expect(resolveAnchor(content, anchor)).toBeNull();
	});

	it("does NOT match a heading-like line inside a fenced code block", () => {
		const content = [
			"intro",                  // 0
			"~~~",                    // 1  fence open (tilde)
			"## Fake Heading",        // 2  fenced — not a real heading
			"~~~",                    // 3  fence close
		].join("\n");
		const anchor: Anchor = { type: "heading", value: "Fake Heading" };
		expect(resolveAnchor(content, anchor)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// line anchor
// ---------------------------------------------------------------------------

describe("resolveAnchor — line", () => {
	it("matches the first body line whose stripped content equals the value", () => {
		const content = [
			"# Top",                       // 0
			"random preamble",             // 1
			"<!-- bookmark: source-list -->", // 2
			"- existing item",             // 3
		].join("\n");
		const anchor: Anchor = {
			type: "line",
			value: "<!-- bookmark: source-list -->",
		};
		const result = resolveAnchor(content, anchor);
		expect(result).toEqual({
			kind: "line",
			anchorLine: 2,
			insertInside: null,
			insertAfter: 3,
		});
	});

	it("returns null when no body line matches", () => {
		const content = "# Top\nbody\n";
		const anchor: Anchor = { type: "line", value: "nonexistent marker" };
		expect(resolveAnchor(content, anchor)).toBeNull();
	});

	it("matches by substring inclusion (anchor value contained in line)", () => {
		const content = "## Sources\n- See also: <related-marker> for full list\n";
		const anchor: Anchor = { type: "line", value: "<related-marker>" };
		const result = resolveAnchor(content, anchor);
		expect(result?.kind).toBe("line");
		expect(result?.anchorLine).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// block anchor — N consecutive lines, exact per line (trailing-trim)
// ---------------------------------------------------------------------------

describe("resolveAnchor — block", () => {
	it("matches a two-line header+separator block (anchorLine = i, insertAfter = i + k)", () => {
		const content = [
			"## Captures",                    // 0
			"",                               // 1
			"| Date | Type | Description |",  // 2
			"| --- | --- | --- |",            // 3
			"| 2026-06-24 | feature | x |",   // 4
		].join("\n");
		const anchor: Anchor = {
			type: "block",
			value: "| Date | Type | Description |\n| --- | --- | --- |",
		};
		const result = resolveAnchor(content, anchor);
		// k = 2, matched at i = 2 → insertAfter = 4 (above the existing data row)
		expect(result).toEqual({
			kind: "block",
			anchorLine: 2,
			insertInside: null,
			insertAfter: 4,
		});
	});

	it("picks the UNIQUE table when an earlier table shares the non-unique separator row", () => {
		const content = [
			"## Log A",                       // 0
			"| Stamp | Note |",               // 1
			"| --- | --- |",                  // 2  separator — collides with the second table's
			"| a | b |",                      // 3
			"",                               // 4
			"## Log B",                       // 5
			"| Date | Type | Description |",  // 6  the header we anchor on
			"| --- | --- | --- |",            // 7
			"| 2026-06-24 | feature | x |",   // 8
		].join("\n");
		const anchor: Anchor = {
			type: "block",
			value: "| Date | Type | Description |\n| --- | --- | --- |",
		};
		const result = resolveAnchor(content, anchor);
		// A single-line `line` anchor on `| --- | --- |` would have hit line 2;
		// the two-row block is unique → matches at line 6, insertAfter = 8.
		expect(result).toEqual({
			kind: "block",
			anchorLine: 6,
			insertInside: null,
			insertAfter: 8,
		});
	});

	it("tolerates trailing whitespace on file lines (exact match after trailing-trim)", () => {
		const content = ["| H1 | H2 |   ", "| --- | --- |\t"].join("\n");
		const anchor: Anchor = { type: "block", value: "| H1 | H2 |\n| --- | --- |" };
		const result = resolveAnchor(content, anchor);
		expect(result?.kind).toBe("block");
		expect(result?.anchorLine).toBe(0);
		expect(result?.insertAfter).toBe(2);
	});

	it("returns null when the consecutive block does not appear (partial match is not enough)", () => {
		const content = [
			"| Date | Type | Description |", // 0  header present…
			"intervening line",             // 1  …but separator does not follow
			"| --- | --- | --- |",          // 2
		].join("\n");
		const anchor: Anchor = {
			type: "block",
			value: "| Date | Type | Description |\n| --- | --- | --- |",
		};
		expect(resolveAnchor(content, anchor)).toBeNull();
	});

	it("matches the FIRST occurrence when an identical block appears twice (deterministic)", () => {
		const content = [
			"| H |",      // 0
			"| --- |",    // 1
			"",           // 2
			"| H |",      // 3
			"| --- |",    // 4
		].join("\n");
		const anchor: Anchor = { type: "block", value: "| H |\n| --- |" };
		expect(resolveAnchor(content, anchor)?.anchorLine).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Null anchor value
// ---------------------------------------------------------------------------

describe("resolveAnchor — null value", () => {
	it("returns null when anchor.value is null (Tomo emission gap; Hashi runtime fail)", () => {
		const content = "> [!blocks] Key Concepts\n> body\n";
		const anchor: Anchor = { type: "callout", value: null };
		expect(resolveAnchor(content, anchor)).toBeNull();
	});
});
