import { describe, expect, it } from "vitest";
import { insertAtPosition } from "../../../src/actions/logPosition.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const join = (...lines: string[]) => lines.join("\n");

// ---------------------------------------------------------------------------
// after_last_line
// ---------------------------------------------------------------------------

describe("insertAtPosition — after_last_line", () => {
	it("appends new line at EOF (content already ends with newline)", () => {
		const content = "line one\nline two\n";
		const result = insertAtPosition(content, "- new entry", "after_last_line");
		expect(result).toBe("line one\nline two\n- new entry\n");
	});

	it("appends with newline when content is missing trailing newline", () => {
		const content = "line one\nline two";
		const result = insertAtPosition(content, "- new entry", "after_last_line");
		expect(result).toBe("line one\nline two\n- new entry\n");
	});

	it("appends to empty content", () => {
		const result = insertAtPosition("", "- new entry", "after_last_line");
		expect(result).toBe("- new entry\n");
	});
});

// ---------------------------------------------------------------------------
// before_first_line
// ---------------------------------------------------------------------------

describe("insertAtPosition — before_first_line", () => {
	it("prepends new line before existing content", () => {
		const content = "line one\nline two\n";
		const result = insertAtPosition(content, "- prepended", "before_first_line");
		expect(result).toBe("- prepended\nline one\nline two\n");
	});

	it("prepends to empty content", () => {
		const result = insertAtPosition("", "- prepended", "before_first_line");
		expect(result).toBe("- prepended\n");
	});
});

// ---------------------------------------------------------------------------
// at_time
// ---------------------------------------------------------------------------

describe("insertAtPosition — at_time", () => {
	it("inserts after the last line whose `- HH:MM:` prefix is <= atTime (chronological position)", () => {
		const content = join(
			"- 09:00: breakfast",
			"- 10:00: standup",
			"- 12:00: lunch",
			"",
		);
		const result = insertAtPosition(content, "- 11:00: code review", "at_time", "11:00");
		expect(result).toBe(join(
			"- 09:00: breakfast",
			"- 10:00: standup",
			"- 11:00: code review",
			"- 12:00: lunch",
			"",
		));
	});

	it("inserts at beginning when atTime is before all existing time lines", () => {
		const content = join("- 10:00: standup", "- 12:00: lunch", "");
		const result = insertAtPosition(content, "- 08:00: wake up", "at_time", "08:00");
		expect(result).toBe(join("- 08:00: wake up", "- 10:00: standup", "- 12:00: lunch", ""));
	});

	it("inserts at end when atTime is after all existing time lines", () => {
		const content = join("- 09:00: breakfast", "- 10:00: standup", "");
		const result = insertAtPosition(content, "- 18:00: dinner", "at_time", "18:00");
		expect(result).toBe(join("- 09:00: breakfast", "- 10:00: standup", "- 18:00: dinner", ""));
	});

	it("falls back to append when no time-prefixed lines exist", () => {
		const content = "plain text\nno timestamps\n";
		const result = insertAtPosition(content, "- 11:00: entry", "at_time", "11:00");
		expect(result).toBe("plain text\nno timestamps\n- 11:00: entry\n");
	});

	it("inserts after the LAST equal-time line when multiple equal times exist", () => {
		const content = join("- 10:00: first", "- 10:00: second", "- 11:00: later", "");
		const result = insertAtPosition(content, "- 10:00: third", "at_time", "10:00");
		// Should go after "- 10:00: second" (the last equal-time line)
		expect(result).toBe(join("- 10:00: first", "- 10:00: second", "- 10:00: third", "- 11:00: later", ""));
	});

	it("non-bullet time-prefix lines (legacy `HH:MM …` shape) are not recognised — falls back to append", () => {
		// Old shape, retired by 2026-04-29 contract; matcher must reject it
		const content = join("09:00 old shape", "10:00 also old", "");
		const result = insertAtPosition(content, "- 11:00: new shape", "at_time", "11:00");
		// No matching time-prefix lines → append at end
		expect(result).toBe(join("09:00 old shape", "10:00 also old", "- 11:00: new shape", ""));
	});
});
