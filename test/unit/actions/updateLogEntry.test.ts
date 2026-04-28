/**
 * updateLogEntry handler tests.
 *
 * Covers 3 positions (after_last_line / before_first_line / at_time),
 * idempotency on identical line, and daily-note missing.
 *
 * [ref: PRD/F4]
 */

import { describe, expect, it } from "vitest";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { updateLogEntry } from "../../../src/actions/updateLogEntry.js";
import type { UpdateLogEntryAction } from "../../../src/schema/types.js";
import type { FileMetadata } from "../../../src/vault/VaultFS.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeAction = (overrides?: Partial<UpdateLogEntryAction>): UpdateLogEntryAction => ({
	action: "update_log_entry",
	id: "test-T3.4-logentry",
	daily_note_path: "daily/2026-04-28.md",
	date: "2026-04-28",
	section: "Log",
	position: "after_last_line",
	content: "Completed the refactor task",
	...overrides,
});

const makeCtx = (vault: FakeVaultFS) => ({
	vault,
	clock: { now: () => new Date("2026-04-28T10:00:00Z") },
});

/**
 * Metadata with a heading "Log" starting at line 1, running to EOF (endLine -1).
 * Line 0: # Daily Note
 * Line 1: ## Log
 * Line 2+: section content
 */
const makeHeadingMetadata = (): FileMetadata => ({
	headings: [
		{ heading: "Daily Note", level: 1, line: 0 },
		{ heading: "Log", level: 2, line: 1 },
	],
	sections: [
		{ type: "heading", line: 0, endLine: 0 },
		{ type: "heading", line: 1, endLine: -1 },
	],
});

const DAILY_PATH = "daily/2026-04-28.md";

// ---------------------------------------------------------------------------
// update_log_entry — daily note missing
// ---------------------------------------------------------------------------

describe("updateLogEntry — daily note missing", () => {
	it("daily note does not exist → failed with deterministic reason", async () => {
		const vault = new FakeVaultFS();
		const action = makeAction();
		const ctx = makeCtx(vault);

		const outcome = await updateLogEntry(action, ctx);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe(`Daily note missing: ${DAILY_PATH}`);
		}
	});
});

// ---------------------------------------------------------------------------
// update_log_entry — section not found
// ---------------------------------------------------------------------------

describe("updateLogEntry — section not found", () => {
	it("named section absent from file → failed 'Section not found'", async () => {
		const content = "# Daily Note\n\nNo sections here.\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({ section: "Log" });
		const ctx = makeCtx(vault);

		const outcome = await updateLogEntry(action, ctx);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe("Section not found: Log");
		}
		// No mutation
		expect(await vault.read(DAILY_PATH)).toBe(content);
	});
});

// ---------------------------------------------------------------------------
// update_log_entry — after_last_line position
// ---------------------------------------------------------------------------

describe("updateLogEntry — after_last_line", () => {
	it("section has existing lines → new line appended after last line of section", async () => {
		const content = [
			"# Daily Note",
			"## Log",
			"09:00 - Morning standup",
			"10:30 - Team meeting",
		].join("\n") + "\n";
		const metaMap = new Map<string, FileMetadata | null>([
			[DAILY_PATH, makeHeadingMetadata()],
		]);
		const vault = new FakeVaultFS(metaMap);
		await vault.create(DAILY_PATH, content);
		const action = makeAction({
			position: "after_last_line",
			content: "Completed the refactor task",
		});
		const ctx = makeCtx(vault);

		const outcome = await updateLogEntry(action, ctx);

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(DAILY_PATH);
		expect(result).toContain("Completed the refactor task");
	});

	it("identical line already in section → skipped-already; content unchanged", async () => {
		const content = [
			"# Daily Note",
			"## Log",
			"09:00 - Morning standup",
			"Completed the refactor task",
		].join("\n") + "\n";
		const metaMap = new Map<string, FileMetadata | null>([
			[DAILY_PATH, makeHeadingMetadata()],
		]);
		const vault = new FakeVaultFS(metaMap);
		await vault.create(DAILY_PATH, content);
		const action = makeAction({
			position: "after_last_line",
			content: "Completed the refactor task",
		});
		const ctx = makeCtx(vault);

		const outcome = await updateLogEntry(action, ctx);

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(DAILY_PATH)).toBe(content);
	});
});

// ---------------------------------------------------------------------------
// update_log_entry — before_first_line position
// ---------------------------------------------------------------------------

describe("updateLogEntry — before_first_line", () => {
	it("section has content → new line inserted before first content line", async () => {
		const content = [
			"# Daily Note",
			"## Log",
			"09:00 - Morning standup",
		].join("\n") + "\n";
		const metaMap = new Map<string, FileMetadata | null>([
			[DAILY_PATH, makeHeadingMetadata()],
		]);
		const vault = new FakeVaultFS(metaMap);
		await vault.create(DAILY_PATH, content);
		const action = makeAction({
			position: "before_first_line",
			content: "Early entry",
		});
		const ctx = makeCtx(vault);

		const outcome = await updateLogEntry(action, ctx);

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(DAILY_PATH);
		const lines = result.split("\n");
		// "## Log" is at index 1; section starts at line 2 (startLine = heading.line + 1 = 2)
		// before_first_line means the new line appears before the current first content line
		expect(result).toContain("Early entry");
		// Early entry should come before 09:00
		const earlyIdx = lines.indexOf("Early entry");
		const standupIdx = lines.indexOf("09:00 - Morning standup");
		expect(earlyIdx).toBeLessThan(standupIdx);
	});

	it("identical line already at before_first position → skipped-already; content unchanged", async () => {
		const content = [
			"# Daily Note",
			"## Log",
			"Early entry",
			"09:00 - Morning standup",
		].join("\n") + "\n";
		const metaMap = new Map<string, FileMetadata | null>([
			[DAILY_PATH, makeHeadingMetadata()],
		]);
		const vault = new FakeVaultFS(metaMap);
		await vault.create(DAILY_PATH, content);
		const action = makeAction({
			position: "before_first_line",
			content: "Early entry",
		});
		const ctx = makeCtx(vault);

		const outcome = await updateLogEntry(action, ctx);

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(DAILY_PATH)).toBe(content);
	});
});

// ---------------------------------------------------------------------------
// update_log_entry — at_time position
// ---------------------------------------------------------------------------

describe("updateLogEntry — at_time", () => {
	it("at_time inserts line with HH:MM prefix after last <= time entry", async () => {
		const content = [
			"# Daily Note",
			"## Log",
			"09:00 - Morning standup",
			"11:00 - Design review",
		].join("\n") + "\n";
		const metaMap = new Map<string, FileMetadata | null>([
			[DAILY_PATH, makeHeadingMetadata()],
		]);
		const vault = new FakeVaultFS(metaMap);
		await vault.create(DAILY_PATH, content);
		const action = makeAction({
			position: "at_time",
			content: "Coffee break",
			time: "10:00",
		});
		const ctx = makeCtx(vault);

		const outcome = await updateLogEntry(action, ctx);

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(DAILY_PATH);
		expect(result).toContain("10:00 - Coffee break");
	});

	it("at_time identical line already in section → skipped-already; content unchanged", async () => {
		const content = [
			"# Daily Note",
			"## Log",
			"09:00 - Morning standup",
			"10:00 - Coffee break",
			"11:00 - Design review",
		].join("\n") + "\n";
		const metaMap = new Map<string, FileMetadata | null>([
			[DAILY_PATH, makeHeadingMetadata()],
		]);
		const vault = new FakeVaultFS(metaMap);
		await vault.create(DAILY_PATH, content);
		const action = makeAction({
			position: "at_time",
			content: "Coffee break",
			time: "10:00",
		});
		const ctx = makeCtx(vault);

		const outcome = await updateLogEntry(action, ctx);

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(DAILY_PATH)).toBe(content);
	});
});
