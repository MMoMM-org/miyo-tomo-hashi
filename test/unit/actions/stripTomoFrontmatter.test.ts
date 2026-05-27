import { describe, expect, it } from "vitest";
import { stripTomoFrontmatter } from "../../../src/actions/types.js";

describe("stripTomoFrontmatter", () => {
	it("removes a tomo: block with indented children", () => {
		const input = [
			"---",
			"title: My Note",
			"tomo:",
			"  doc_type: source",
			"  state: captured",
			"  run_id: 2026-05-27T11-46-31Z-7af985",
			"  updated_at: 2026-05-27T11:57:42Z",
			"tags:",
			"  - topic/japan",
			"---",
			"",
			"# Content",
		].join("\n");

		const result = stripTomoFrontmatter(input);

		expect(result).not.toContain("tomo:");
		expect(result).not.toContain("doc_type");
		expect(result).toContain("title: My Note");
		expect(result).toContain("tags:");
		expect(result).toContain("# Content");
	});

	it("returns content unchanged when no tomo: block is present", () => {
		const input = "---\ntitle: Clean Note\ntags:\n  - foo\n---\n\n# Body\n";
		expect(stripTomoFrontmatter(input)).toBe(input);
	});

	it("returns content unchanged when there is no frontmatter", () => {
		const input = "# No frontmatter\n\nJust a note.\n";
		expect(stripTomoFrontmatter(input)).toBe(input);
	});

	it("handles tomo: as the last key before closing ---", () => {
		const input = [
			"---",
			"title: Note",
			"tomo:",
			"  doc_type: source",
			"  state: captured",
			"---",
			"",
			"Body text",
		].join("\n");

		const result = stripTomoFrontmatter(input);

		expect(result).not.toContain("tomo:");
		expect(result).toContain("title: Note");
		expect(result).toContain("Body text");
	});

	it("handles tomo: as the first key in frontmatter", () => {
		const input = [
			"---",
			"tomo:",
			"  doc_type: instructions",
			"  state: pending-apply",
			"title: First Key",
			"---",
			"",
			"Body",
		].join("\n");

		const result = stripTomoFrontmatter(input);

		expect(result).not.toContain("tomo:");
		expect(result).toContain("title: First Key");
	});

	it("preserves tomo in body text (only strips frontmatter)", () => {
		const input = [
			"---",
			"title: About Tomo",
			"---",
			"",
			"tomo: is a cool project",
		].join("\n");

		expect(stripTomoFrontmatter(input)).toBe(input);
	});
});
