/**
 * updateLogLink handler tests.
 *
 * Covers 3 positions (after_last_line / before_first_line / at_time),
 * format `- [[stem]]` for after/before; format `- HH:MM: [[stem]]` for at_time
 * (aligned with `update_log_entry` since they coexist in the same Daily Log
 * section), and idempotency on identical link line.
 *
 * [ref: PRD/F4]
 */

import { describe, expect, it } from "vitest";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { updateLogLink } from "../../../src/actions/updateLogLink.js";
import type { UpdateLogLinkAction } from "../../../src/schema/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeAction = (overrides?: Partial<UpdateLogLinkAction>): UpdateLogLinkAction => ({
	action: "update_log_link",
	id: "test-T3.4-loglink",
	daily_note_path: "daily/2026-04-28.md",
	date: "2026-04-28",
	section: "Links",
	position: "after_last_line",
	target_stem: "Notes/my-project",
	...overrides,
});

const makeCtx = (vault: FakeVaultFS) => ({
	vault,
	clock: { now: () => new Date("2026-04-28T10:00:00Z") },
});

const DAILY_PATH = "daily/2026-04-28.md";

// ---------------------------------------------------------------------------
// update_log_link — daily note missing
// ---------------------------------------------------------------------------

describe("updateLogLink — daily note missing", () => {
	it("daily note does not exist → failed with deterministic reason", async () => {
		const vault = new FakeVaultFS();
		const action = makeAction();
		const ctx = makeCtx(vault);

		const outcome = await updateLogLink(action, ctx);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe(`Daily note missing: ${DAILY_PATH}`);
		}
	});
});

// ---------------------------------------------------------------------------
// update_log_link — section not found
// ---------------------------------------------------------------------------

describe("updateLogLink — section not found", () => {
	it("named section absent from file → failed 'Section not found'", async () => {
		const content = "# Daily Note\n\nNo sections here.\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({ section: "Links" });
		const ctx = makeCtx(vault);

		const outcome = await updateLogLink(action, ctx);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe("Section not found: Links");
		}
		// No mutation
		expect(await vault.read(DAILY_PATH)).toBe(content);
	});
});

// ---------------------------------------------------------------------------
// update_log_link — link line format
// ---------------------------------------------------------------------------

describe("updateLogLink — link line format", () => {
	it("after_last_line → inserts '- [[stem]]' line", async () => {
		const content = [
			"# Daily Note",
			"## Links",
			"- [[existing-note]]",
		].join("\n") + "\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({
			position: "after_last_line",
			target_stem: "Notes/my-project",
		});
		const ctx = makeCtx(vault);

		const outcome = await updateLogLink(action, ctx);

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(DAILY_PATH);
		expect(result).toContain("- [[Notes/my-project]]");
	});

	it("before_first_line → inserts '- [[stem]]' before first content line", async () => {
		const content = [
			"# Daily Note",
			"## Links",
			"- [[existing-note]]",
		].join("\n") + "\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({
			position: "before_first_line",
			target_stem: "Notes/my-project",
		});
		const ctx = makeCtx(vault);

		const outcome = await updateLogLink(action, ctx);

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(DAILY_PATH);
		const lines = result.split("\n");
		const newLinkIdx = lines.indexOf("- [[Notes/my-project]]");
		const existingIdx = lines.indexOf("- [[existing-note]]");
		expect(newLinkIdx).toBeLessThan(existingIdx);
	});

	it("at_time → inserts `- HH:MM: [[stem]]` line, aligned with update_log_entry shape", async () => {
		const content = [
			"# Daily Note",
			"## Links",
			"- 09:00: [[morning-note]]",
			"- 11:00: [[noon-note]]",
		].join("\n") + "\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({
			position: "at_time",
			target_stem: "Notes/my-project",
			time: "10:00",
		});
		const ctx = makeCtx(vault);

		const outcome = await updateLogLink(action, ctx);

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(DAILY_PATH);
		expect(result).toContain("- 10:00: [[Notes/my-project]]");
		// Sort by HH:MM
		const lines = result.split("\n");
		const morningIdx = lines.indexOf("- 09:00: [[morning-note]]");
		const newIdx = lines.indexOf("- 10:00: [[Notes/my-project]]");
		const noonIdx = lines.indexOf("- 11:00: [[noon-note]]");
		expect(morningIdx).toBeLessThan(newIdx);
		expect(newIdx).toBeLessThan(noonIdx);
	});
});

// ---------------------------------------------------------------------------
// update_log_link — idempotency
// ---------------------------------------------------------------------------

describe("updateLogLink — idempotency", () => {
	it("identical '- [[stem]]' line already in section → skipped-already; content unchanged", async () => {
		const content = [
			"# Daily Note",
			"## Links",
			"- [[existing-note]]",
			"- [[Notes/my-project]]",
		].join("\n") + "\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({
			position: "after_last_line",
			target_stem: "Notes/my-project",
		});
		const ctx = makeCtx(vault);

		const outcome = await updateLogLink(action, ctx);

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(DAILY_PATH)).toBe(content);
	});

	it("identical at_time link line already in section → skipped-already; content unchanged", async () => {
		const content = [
			"# Daily Note",
			"## Links",
			"- 09:00: [[morning-note]]",
			"- 10:00: [[Notes/my-project]]",
			"- 11:00: [[noon-note]]",
		].join("\n") + "\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({
			position: "at_time",
			target_stem: "Notes/my-project",
			time: "10:00",
		});
		const ctx = makeCtx(vault);

		const outcome = await updateLogLink(action, ctx);

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(DAILY_PATH)).toBe(content);
	});
});
