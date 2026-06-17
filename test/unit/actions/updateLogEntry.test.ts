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
	it("appends `- <content>` line after last line of section (Hashi composes bullet)", async () => {
		const content = [
			"# Daily Note",
			"## Log",
			"- 09:00: Morning standup",
			"- 10:30: Team meeting",
		].join("\n") + "\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({
			position: "after_last_line",
			content: "Completed the refactor task",
		});
		const ctx = makeCtx(vault);

		const outcome = await updateLogEntry(action, ctx);

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(DAILY_PATH);
		expect(result).toContain("- Completed the refactor task");
	});

	it("identical `- <content>` line already in section → skipped-already; content unchanged", async () => {
		const content = [
			"# Daily Note",
			"## Log",
			"- 09:00: Morning standup",
			"- Completed the refactor task",
		].join("\n") + "\n";
		const vault = new FakeVaultFS();
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
	it("inserts `- <content>` line before first content line of section", async () => {
		const content = [
			"# Daily Note",
			"## Log",
			"- 09:00: Morning standup",
		].join("\n") + "\n";
		const vault = new FakeVaultFS();
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
		expect(result).toContain("- Early entry");
		const earlyIdx = lines.indexOf("- Early entry");
		const standupIdx = lines.indexOf("- 09:00: Morning standup");
		expect(earlyIdx).toBeLessThan(standupIdx);
	});

	it("identical `- <content>` line already at before_first position → skipped-already; content unchanged", async () => {
		const content = [
			"# Daily Note",
			"## Log",
			"- Early entry",
			"- 09:00: Morning standup",
		].join("\n") + "\n";
		const vault = new FakeVaultFS();
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
	it("at_time inserts `- HH:MM: <content>` line, sort-positioned by HH:MM", async () => {
		const content = [
			"# Daily Note",
			"## Log",
			"- 09:00: Morning standup",
			"- 11:00: Design review",
		].join("\n") + "\n";
		const vault = new FakeVaultFS();
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
		expect(result).toContain("- 10:00: Coffee break");
		// Sort: 09:00 < 10:00 < 11:00
		const lines = result.split("\n");
		const standupIdx = lines.indexOf("- 09:00: Morning standup");
		const coffeeIdx = lines.indexOf("- 10:00: Coffee break");
		const designIdx = lines.indexOf("- 11:00: Design review");
		expect(standupIdx).toBeLessThan(coffeeIdx);
		expect(coffeeIdx).toBeLessThan(designIdx);
	});

	it("at_time identical `- HH:MM: <content>` line already in section → skipped-already; content unchanged", async () => {
		const content = [
			"# Daily Note",
			"## Log",
			"- 09:00: Morning standup",
			"- 10:00: Coffee break",
			"- 11:00: Design review",
		].join("\n") + "\n";
		const vault = new FakeVaultFS();
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
