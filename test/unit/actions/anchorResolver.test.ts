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
 * Anchor types:
 *   - callout: `[!type] Title` shape — matches the opening line of the
 *     callout whose type+title equal the value (case-insensitive).
 *   - heading: matches a heading by text (without leading `#`s),
 *     case-sensitive, any heading level.
 *   - line: matches a body line by literal stripped content (substring).
 *
 * [ref: PRD/F4 link_to_moc; SDD/Anchor Model 2026-05-01]
 */

import { describe, expect, it } from "vitest";
import { resolveAnchor } from "../../../src/actions/anchorResolver.js";
import type { Anchor } from "../../../src/schema/types.js";
import type { FileMetadata } from "../../../src/vault/VaultFS.js";

const makeMetadata = (
	headings: FileMetadata["headings"],
	sections: FileMetadata["sections"],
): FileMetadata => ({ headings, sections });

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
		const metadata = makeMetadata(
			[],
			[
				{ type: "callout", line: 0, endLine: 1 },
				{ type: "callout", line: 3, endLine: 4 },
			],
		);
		const anchor: Anchor = { type: "callout", value: "[!blocks] Key Concepts" };
		const result = resolveAnchor(metadata, content, anchor);
		expect(result).toEqual({ kind: "callout", anchorLine: 3, insertInside: 5, insertAfter: 5 });
	});

	it("does NOT match a callout with mismatched type (`[!compass] X` vs `[!blocks] X`) → null", () => {
		const content = [
			"> [!blocks] Key Concepts",
			"> body",
		].join("\n");
		const metadata = makeMetadata(
			[],
			[{ type: "callout", line: 0, endLine: 1 }],
		);
		const anchor: Anchor = { type: "callout", value: "[!compass] Key Concepts" };
		expect(resolveAnchor(metadata, content, anchor)).toBeNull();
	});

	it("callout match is case-insensitive on type and title", () => {
		const content = [
			"> [!Compass] Something you should look at perhaps..",
			"> body",
		].join("\n");
		const metadata = makeMetadata(
			[],
			[{ type: "callout", line: 0, endLine: 1 }],
		);
		const anchor: Anchor = {
			type: "callout",
			value: "[!compass] something YOU should look at perhaps..",
		};
		const result = resolveAnchor(metadata, content, anchor);
		expect(result?.kind).toBe("callout");
		expect(result?.anchorLine).toBe(0);
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
		const metadata = makeMetadata(
			[
				{ heading: "Top", level: 1, line: 0 },
				{ heading: "Sources", level: 2, line: 2 },
				{ heading: "Next section", level: 2, line: 5 },
			],
			[],
		);
		const anchor: Anchor = { type: "heading", value: "Sources" };
		const result = resolveAnchor(metadata, content, anchor);
		expect(result).toEqual({
			kind: "heading",
			anchorLine: 2,
			insertInside: null,
			insertAfter: 3,
		});
	});

	it("matches at any heading level (h1 through h6)", () => {
		const content = "###### Deep Heading\nbody\n";
		const metadata = makeMetadata(
			[{ heading: "Deep Heading", level: 6, line: 0 }],
			[],
		);
		const anchor: Anchor = { type: "heading", value: "Deep Heading" };
		const result = resolveAnchor(metadata, content, anchor);
		expect(result?.kind).toBe("heading");
		expect(result?.anchorLine).toBe(0);
	});

	it("returns null when no heading matches the value", () => {
		const content = "## Other\nbody\n";
		const metadata = makeMetadata(
			[{ heading: "Other", level: 2, line: 0 }],
			[],
		);
		const anchor: Anchor = { type: "heading", value: "Missing" };
		expect(resolveAnchor(metadata, content, anchor)).toBeNull();
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
		const metadata = makeMetadata([{ heading: "Top", level: 1, line: 0 }], []);
		const anchor: Anchor = {
			type: "line",
			value: "<!-- bookmark: source-list -->",
		};
		const result = resolveAnchor(metadata, content, anchor);
		expect(result).toEqual({
			kind: "line",
			anchorLine: 2,
			insertInside: null,
			insertAfter: 3,
		});
	});

	it("returns null when no body line matches", () => {
		const content = "# Top\nbody\n";
		const metadata = makeMetadata([{ heading: "Top", level: 1, line: 0 }], []);
		const anchor: Anchor = { type: "line", value: "nonexistent marker" };
		expect(resolveAnchor(metadata, content, anchor)).toBeNull();
	});

	it("matches by substring inclusion (anchor value contained in line)", () => {
		const content = "## Sources\n- See also: <related-marker> for full list\n";
		const metadata = makeMetadata([{ heading: "Sources", level: 2, line: 0 }], []);
		const anchor: Anchor = { type: "line", value: "<related-marker>" };
		const result = resolveAnchor(metadata, content, anchor);
		expect(result?.kind).toBe("line");
		expect(result?.anchorLine).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Null anchor value
// ---------------------------------------------------------------------------

describe("resolveAnchor — null value", () => {
	it("returns null when anchor.value is null (Tomo emission gap; Hashi runtime fail)", () => {
		const content = "> [!blocks] Key Concepts\n> body\n";
		const metadata = makeMetadata(
			[],
			[{ type: "callout", line: 0, endLine: 1 }],
		);
		const anchor: Anchor = { type: "callout", value: null };
		expect(resolveAnchor(metadata, content, anchor)).toBeNull();
	});
});
