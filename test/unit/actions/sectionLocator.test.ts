/**
 * sectionLocator — resolves a named section within a vault file, reading ONLY
 * the file content (no metadataCache) so batches of update_* actions against
 * the same daily note don't race Obsidian's async cache rebuild (#68).
 */

import { describe, expect, it } from "vitest";
import { locateSection } from "../../../src/actions/sectionLocator.js";

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
		const result = locateSection(content, "Projects");
		expect(result).toEqual({ startLine: 1, endLine: 2, kind: "heading" });
	});

	it("terminates at next higher-level heading", () => {
		const content = [
			"# Top",
			"## Sub",
			"body",
			"# NextTop",
		].join("\n");
		// "Sub" terminates at NextTop (level 1 <= level 2)
		const result = locateSection(content, "Sub");
		expect(result).toEqual({ startLine: 2, endLine: 2, kind: "heading" });
	});

	it("heading match at EOF — endLine is -1", () => {
		const content = ["## Projects", "- item one"].join("\n");
		const result = locateSection(content, "Projects");
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
		const result = locateSection(content, "PROJECTS");
		expect(result).toEqual({ startLine: 1, endLine: 1, kind: "callout" });
	});

	it("matches > [!notes]-style callout with body", () => {
		const content = [
			"some preamble",
			"> [!notes] Daily Log",
			"> - 09:00 standup",
			"> - 10:00 review",
		].join("\n");
		const result = locateSection(content, "Daily Log");
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
		const result = locateSection(content, "[!blocks] Key Concepts");
		expect(result).toEqual({ startLine: 3, endLine: 3, kind: "callout" });
	});

	it("prefixed type that doesn't match any callout type → null (no fallback to title-only)", () => {
		const content = [
			"> [!note] Projects",
			"> body",
		].join("\n");
		// User asked for [!blocks] Projects, but only [!note] Projects exists — must NOT match
		const result = locateSection(content, "[!blocks] Projects");
		expect(result).toBeNull();
	});

	it("prefixed match is case-insensitive on both type and title", () => {
		const content = [
			"> [!Compass] Something you should look at perhaps..",
			"> body",
		].join("\n");
		const result = locateSection(content, "[!compass] something YOU should look at perhaps..");
		expect(result?.kind).toBe("callout");
		expect(result?.startLine).toBe(1);
	});

	it("plain title `Projects` (no prefix) still matches callout `[!note] Projects` (backward compat)", () => {
		const content = [
			"> [!note] Projects",
			"> body",
		].join("\n");
		const result = locateSection(content, "Projects");
		expect(result).toEqual({ startLine: 1, endLine: 1, kind: "callout" });
	});

	it("prefixed section_name skips heading match — even if heading shares the title", () => {
		const content = [
			"## Key Concepts",
			"heading body",
			"> [!blocks] Key Concepts",
			"> callout body",
		].join("\n");
		// Prefix is callout-specific intent — must hit the callout, not the heading
		const result = locateSection(content, "[!blocks] Key Concepts");
		expect(result?.kind).toBe("callout");
	});
});

// ---------------------------------------------------------------------------
// No match
// ---------------------------------------------------------------------------

describe("locateSection — no match", () => {
	it("returns null when no heading or callout matches", () => {
		const content = ["## Other", "body"].join("\n");
		const result = locateSection(content, "Nonexistent");
		expect(result).toBeNull();
	});

	it("returns null when content has no sections at all", () => {
		const result = locateSection("plain text", "Projects");
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
		const result = locateSection(content, "Projects");
		expect(result?.kind).toBe("heading");
	});
});

// ---------------------------------------------------------------------------
// metadataCache race (#68): resolution must not depend on cache freshness.
// A heading/callout inside a fenced code block must NOT be matched — mirroring
// what the metadataCache excluded — so content scanning stays equivalent.
// ---------------------------------------------------------------------------

describe("locateSection — fenced code blocks (#68 content-parity)", () => {
	it("does not match a heading inside a fenced code block", () => {
		const content = [
			"intro",
			"```",
			"## Fenced",
			"```",
		].join("\n");
		expect(locateSection(content, "Fenced")).toBeNull();
	});

	it("does not match a callout opener inside a fenced code block", () => {
		const content = [
			"```md",
			"> [!note] Fenced",
			"```",
		].join("\n");
		expect(locateSection(content, "[!note] Fenced")).toBeNull();
	});
});
