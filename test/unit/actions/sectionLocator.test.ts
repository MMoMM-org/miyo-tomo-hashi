import { describe, expect, it } from "vitest";
import { locateSection } from "../../../src/actions/sectionLocator.js";
import type { FileMetadata } from "../../../src/vault/VaultFS.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeMetadata = (
	headings: FileMetadata["headings"],
	sections: FileMetadata["sections"],
): FileMetadata => ({ headings, sections });

// ---------------------------------------------------------------------------
// Heading match
// ---------------------------------------------------------------------------

describe("locateSection — heading match", () => {
	it("finds the right line range, terminates at next same-level heading", () => {
		const content = [
			"## Projects",
			"- item one",
			"- item two",
			"## Archive",
			"- old item",
		].join("\n");
		const metadata = makeMetadata(
			[
				{ heading: "Projects", level: 2, line: 0 },
				{ heading: "Archive", level: 2, line: 3 },
			],
			[],
		);
		const result = locateSection(metadata, content, "Projects");
		expect(result).toEqual({ startLine: 1, endLine: 2, kind: "heading" });
	});

	it("terminates at next higher-level heading", () => {
		const content = [
			"# Top",
			"## Sub",
			"body",
			"# NextTop",
		].join("\n");
		const metadata = makeMetadata(
			[
				{ heading: "Top", level: 1, line: 0 },
				{ heading: "Sub", level: 2, line: 1 },
				{ heading: "NextTop", level: 1, line: 3 },
			],
			[],
		);
		// "Sub" terminates at NextTop (level 1 <= level 2)
		const result = locateSection(metadata, content, "Sub");
		expect(result).toEqual({ startLine: 2, endLine: 2, kind: "heading" });
	});

	it("heading match at EOF — endLine is -1", () => {
		const content = ["## Projects", "- item one"].join("\n");
		const metadata = makeMetadata(
			[{ heading: "Projects", level: 2, line: 0 }],
			[],
		);
		const result = locateSection(metadata, content, "Projects");
		expect(result).toEqual({ startLine: 1, endLine: -1, kind: "heading" });
	});
});

// ---------------------------------------------------------------------------
// Callout match
// ---------------------------------------------------------------------------

describe("locateSection — callout match", () => {
	it("matches callout (case-insensitive title)", () => {
		const content = [
			"> [!note] Projects",
			"> body line",
		].join("\n");
		const metadata = makeMetadata(
			[],
			[{ type: "callout", line: 0, endLine: 1 }],
		);
		const result = locateSection(metadata, content, "PROJECTS");
		expect(result).toEqual({ startLine: 1, endLine: 1, kind: "callout" });
	});

	it("matches > [!notes]-style callout with body", () => {
		const content = [
			"some preamble",
			"> [!notes] Daily Log",
			"> - 09:00 standup",
			"> - 10:00 review",
		].join("\n");
		const metadata = makeMetadata(
			[],
			[{ type: "callout", line: 1, endLine: 3 }],
		);
		const result = locateSection(metadata, content, "Daily Log");
		expect(result).toEqual({ startLine: 2, endLine: 3, kind: "callout" });
	});
});

// ---------------------------------------------------------------------------
// Callout match — prefixed section_name (Tomo's emission shape)
// ---------------------------------------------------------------------------
//
// Tomo's `link_to_moc.section_name` is emitted with the full `[!type] Title`
// shape (e.g., `"[!blocks] Key Concepts"`). The locator must match against the
// matching callout's type AND title — not strip the prefix and match by title
// only, which previously caused every link_to_moc action to fall through to
// the first-callout fallback (landed all 13 links of the 2026-04-30 walk in
// `[!connect] Your way around` instead of `[!blocks] Key Concepts`).

describe("locateSection — callout match with [!type] prefix", () => {
	it("prefixed `[!blocks] Key Concepts` matches the [!blocks] callout, not [!connect]", () => {
		const content = [
			"> [!connect] Your way around",
			"> up:: ",
			"> [!blocks] Key Concepts",
			"> body",
		].join("\n");
		const metadata = makeMetadata(
			[],
			[
				{ type: "callout", line: 0, endLine: 1 },
				{ type: "callout", line: 2, endLine: 3 },
			],
		);
		const result = locateSection(metadata, content, "[!blocks] Key Concepts");
		expect(result).toEqual({ startLine: 3, endLine: 3, kind: "callout" });
	});

	it("prefixed type that doesn't match any callout type → null (no fallback to title-only)", () => {
		const content = [
			"> [!note] Projects",
			"> body",
		].join("\n");
		const metadata = makeMetadata(
			[],
			[{ type: "callout", line: 0, endLine: 1 }],
		);
		// User asked for [!blocks] Projects, but only [!note] Projects exists — must NOT match
		const result = locateSection(metadata, content, "[!blocks] Projects");
		expect(result).toBeNull();
	});

	it("prefixed match is case-insensitive on both type and title", () => {
		const content = [
			"> [!Compass] Something you should look at perhaps..",
			"> body",
		].join("\n");
		const metadata = makeMetadata(
			[],
			[{ type: "callout", line: 0, endLine: 1 }],
		);
		const result = locateSection(metadata, content, "[!compass] something YOU should look at perhaps..");
		expect(result?.kind).toBe("callout");
		expect(result?.startLine).toBe(1);
	});

	it("plain title `Projects` (no prefix) still matches callout `[!note] Projects` (backward compat)", () => {
		const content = [
			"> [!note] Projects",
			"> body",
		].join("\n");
		const metadata = makeMetadata(
			[],
			[{ type: "callout", line: 0, endLine: 1 }],
		);
		const result = locateSection(metadata, content, "Projects");
		expect(result).toEqual({ startLine: 1, endLine: 1, kind: "callout" });
	});

	it("prefixed section_name skips heading match — even if heading shares the title", () => {
		const content = [
			"## Key Concepts",
			"heading body",
			"> [!blocks] Key Concepts",
			"> callout body",
		].join("\n");
		const metadata = makeMetadata(
			[{ heading: "Key Concepts", level: 2, line: 0 }],
			[{ type: "callout", line: 2, endLine: 3 }],
		);
		// Prefix is callout-specific intent — must hit the callout, not the heading
		const result = locateSection(metadata, content, "[!blocks] Key Concepts");
		expect(result?.kind).toBe("callout");
	});
});

// ---------------------------------------------------------------------------
// No match
// ---------------------------------------------------------------------------

describe("locateSection — no match", () => {
	it("returns null when no heading or callout matches", () => {
		const content = ["## Other", "body"].join("\n");
		const metadata = makeMetadata(
			[{ heading: "Other", level: 2, line: 0 }],
			[],
		);
		const result = locateSection(metadata, content, "Nonexistent");
		expect(result).toBeNull();
	});

	it("returns null when content has no sections at all", () => {
		const metadata = makeMetadata([], []);
		const result = locateSection(metadata, "plain text", "Projects");
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Priority: heading wins over callout with the same name
// ---------------------------------------------------------------------------

describe("locateSection — priority", () => {
	it("heading wins when both heading and callout share the name", () => {
		const content = [
			"## Projects",
			"heading body",
			"> [!note] Projects",
			"> callout body",
		].join("\n");
		const metadata = makeMetadata(
			[{ heading: "Projects", level: 2, line: 0 }],
			[{ type: "callout", line: 2, endLine: 3 }],
		);
		const result = locateSection(metadata, content, "Projects");
		expect(result?.kind).toBe("heading");
	});
});
