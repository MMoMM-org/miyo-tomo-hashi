/**
 * updateTracker handler tests.
 *
 * Covers 3 sub-modes (inline_field / callout_body / checkbox),
 * idempotency (field already at target value → skipped-already),
 * overwrite-on-differ (Tomo's intent wins; existing value rewritten),
 * `inline_field` matcher across 3 Dataview positions (line-anchored
 * with bullet/indent tolerance, inline-bracketed `[f:: v]`, inline-
 * parenthesized `(f:: v)`), multi-word field names, and
 * daily-note missing → failed.
 *
 * [ref: PRD/F4]
 */

import { describe, expect, it } from "vitest";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { updateTracker } from "../../../src/actions/updateTracker.js";
import type { UpdateTrackerAction } from "../../../src/schema/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeAction = (overrides?: Partial<UpdateTrackerAction>): UpdateTrackerAction => ({
	action: "update_tracker",
	id: "test-T3.4-tracker",
	daily_note_path: "daily/2026-04-28.md",
	date: "2026-04-28",
	field: "mood",
	value: "good",
	syntax: "inline_field",
	...overrides,
});

const makeCtx = (vault: FakeVaultFS) => ({
	vault,
	clock: { now: () => new Date("2026-04-28T10:00:00Z") },
});

const DAILY_PATH = "daily/2026-04-28.md";

// ---------------------------------------------------------------------------
// update_tracker — daily note missing
// ---------------------------------------------------------------------------

describe("updateTracker — daily note missing", () => {
	it("daily note does not exist → failed with deterministic reason", async () => {
		const vault = new FakeVaultFS();
		const action = makeAction();
		const ctx = makeCtx(vault);

		const outcome = await updateTracker(action, ctx);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe(`Daily note missing: ${DAILY_PATH}`);
		}
	});
});

// ---------------------------------------------------------------------------
// update_tracker — inline_field sub-mode
// ---------------------------------------------------------------------------

describe("updateTracker — inline_field", () => {
	it("field absent from file → failed 'Tracker field not found'", async () => {
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, "# Daily note\n\nSome content\n");
		const action = makeAction({ syntax: "inline_field", field: "mood", value: "good" });
		const ctx = makeCtx(vault);

		const outcome = await updateTracker(action, ctx);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe("Tracker field not found: mood");
		}
		// No mutation
		expect(await vault.read(DAILY_PATH)).toBe("# Daily note\n\nSome content\n");
	});

	it("field already at target value → skipped-already; content unchanged", async () => {
		const content = "# Daily note\n\nmood:: good\n\nmore content\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({ syntax: "inline_field", field: "mood", value: "good" });
		const ctx = makeCtx(vault);

		const outcome = await updateTracker(action, ctx);

		expect(outcome.kind).toBe("skipped-already");
		// No mutation — idempotency guard
		expect(await vault.read(DAILY_PATH)).toBe(content);
	});

	it("field at different value → applied; existing value overwritten (Tomo's intent wins)", async () => {
		const content = "# Daily note\n\nmood:: bad\n\nmore content\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({ syntax: "inline_field", field: "mood", value: "good" });
		const ctx = makeCtx(vault);

		const outcome = await updateTracker(action, ctx);

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(DAILY_PATH);
		expect(result).toBe("# Daily note\n\nmood:: good\n\nmore content\n");
	});

	it("bullet-prefixed line `- field:: value` → matched and overwritten in place; bullet preserved", async () => {
		const content = "# Daily note\n\n- Sport:: false\n\nmore content\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({ syntax: "inline_field", field: "Sport", value: true });
		const ctx = makeCtx(vault);

		const outcome = await updateTracker(action, ctx);

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(DAILY_PATH);
		expect(result).toBe("# Daily note\n\n- Sport:: true\n\nmore content\n");
	});

	it("inline-bracketed form `[field:: value]` mid-prose → matched and rewritten; brackets preserved", async () => {
		const content = "# Daily\n\nHeute Workout. [Sport:: false] Mehr Text.\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({ syntax: "inline_field", field: "Sport", value: true });
		const ctx = makeCtx(vault);

		const outcome = await updateTracker(action, ctx);

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(DAILY_PATH);
		expect(result).toBe("# Daily\n\nHeute Workout. [Sport:: true] Mehr Text.\n");
	});

	it("inline-parenthesized form `(field:: value)` mid-prose → matched and rewritten; parens preserved", async () => {
		const content = "# Daily\n\nBewegt heute (Sport:: false). Mehr.\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({ syntax: "inline_field", field: "Sport", value: true });
		const ctx = makeCtx(vault);

		const outcome = await updateTracker(action, ctx);

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(DAILY_PATH);
		expect(result).toBe("# Daily\n\nBewegt heute (Sport:: true). Mehr.\n");
	});

	it("priority: line-anchored beats inline forms when both present", async () => {
		const content = "# Daily\n\nmood:: bad\n\n[mood:: bad] note.\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({ syntax: "inline_field", field: "mood", value: "good" });
		const ctx = makeCtx(vault);

		const outcome = await updateTracker(action, ctx);

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(DAILY_PATH);
		// Only the line-anchored occurrence is rewritten
		expect(result).toBe("# Daily\n\nmood:: good\n\n[mood:: bad] note.\n");
	});

	it("multi-word field name `For Me` → matched verbatim and rewritten", async () => {
		const content = "# Daily\n\nFor Me:: alt-text-one\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({ syntax: "inline_field", field: "For Me", value: "morgen früh aufstehen" });
		const ctx = makeCtx(vault);

		const outcome = await updateTracker(action, ctx);

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(DAILY_PATH);
		expect(result).toBe("# Daily\n\nFor Me:: morgen früh aufstehen\n");
	});

	it("field present with numeric value at target → skipped-already", async () => {
		const content = "# Daily\n\nscore:: 5\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({ syntax: "inline_field", field: "score", value: 5 });
		const ctx = makeCtx(vault);

		const outcome = await updateTracker(action, ctx);

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(DAILY_PATH)).toBe(content);
	});

	it("field present with boolean value at target → skipped-already", async () => {
		const content = "# Daily\n\ndone:: true\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({ syntax: "inline_field", field: "done", value: true });
		const ctx = makeCtx(vault);

		const outcome = await updateTracker(action, ctx);

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(DAILY_PATH)).toBe(content);
	});
});

// ---------------------------------------------------------------------------
// update_tracker — callout_body sub-mode
// ---------------------------------------------------------------------------

describe("updateTracker — callout_body", () => {
	it("field in callout body already at target value → skipped-already; content unchanged", async () => {
		const content = [
			"> [!tracker] Daily Tracker",
			"> mood:: good",
			"> energy:: high",
			">",
		].join("\n") + "\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({
			syntax: "callout_body",
			field: "mood",
			value: "good",
			section: "Daily Tracker",
		});
		const ctx = makeCtx(vault);

		const outcome = await updateTracker(action, ctx);

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(DAILY_PATH)).toBe(content);
	});

	it("field in callout body at different value → applied; existing value overwritten", async () => {
		const content = [
			"> [!tracker] Daily Tracker",
			"> mood:: bad",
			"> energy:: high",
			">",
		].join("\n") + "\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({
			syntax: "callout_body",
			field: "mood",
			value: "good",
			section: "Daily Tracker",
		});
		const ctx = makeCtx(vault);

		const outcome = await updateTracker(action, ctx);

		expect(outcome.kind).toBe("applied");
		const expected = [
			"> [!tracker] Daily Tracker",
			"> mood:: good",
			"> energy:: high",
			">",
		].join("\n") + "\n";
		expect(await vault.read(DAILY_PATH)).toBe(expected);
	});

	it("multi-word field name `For Me` in callout body → matched verbatim and rewritten", async () => {
		const content = [
			"> [!tracker] Daily Tracker",
			"> For Me:: alt",
			">",
		].join("\n") + "\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({
			syntax: "callout_body",
			field: "For Me",
			value: "Tee mit Yuki",
			section: "Daily Tracker",
		});
		const ctx = makeCtx(vault);

		const outcome = await updateTracker(action, ctx);

		expect(outcome.kind).toBe("applied");
		const expected = [
			"> [!tracker] Daily Tracker",
			"> For Me:: Tee mit Yuki",
			">",
		].join("\n") + "\n";
		expect(await vault.read(DAILY_PATH)).toBe(expected);
	});

	it("field not found in callout body → failed 'Tracker field not found'", async () => {
		const content = [
			"> [!tracker] Daily Tracker",
			"> energy:: high",
			">",
		].join("\n") + "\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({
			syntax: "callout_body",
			field: "mood",
			value: "good",
			section: "Daily Tracker",
		});
		const ctx = makeCtx(vault);

		const outcome = await updateTracker(action, ctx);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe("Tracker field not found: mood");
		}
		expect(await vault.read(DAILY_PATH)).toBe(content);
	});

	it("section not found → failed 'Section not found'", async () => {
		const content = "# Daily\n\nNo callout here.\n";
		const vault = new FakeVaultFS(); // no metadata → null
		await vault.create(DAILY_PATH, content);
		const action = makeAction({
			syntax: "callout_body",
			field: "mood",
			value: "good",
			section: "Missing Section",
		});
		const ctx = makeCtx(vault);

		const outcome = await updateTracker(action, ctx);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe("Section not found: Missing Section");
		}
		expect(await vault.read(DAILY_PATH)).toBe(content);
	});
});

// ---------------------------------------------------------------------------
// update_tracker — checkbox sub-mode
// ---------------------------------------------------------------------------

describe("updateTracker — checkbox", () => {
	it("checkbox unchecked, value truthy → applied; checkbox now checked", async () => {
		const content = "# Daily\n\n- [ ] done\n\nmore content\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({ syntax: "checkbox", field: "done", value: true });
		const ctx = makeCtx(vault);

		const outcome = await updateTracker(action, ctx);

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(DAILY_PATH);
		expect(result).toContain("- [x] done");
		expect(result).not.toContain("- [ ] done");
	});

	it("checkbox checked, value falsy → applied; checkbox now unchecked", async () => {
		const content = "# Daily\n\n- [x] done\n\nmore content\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({ syntax: "checkbox", field: "done", value: false });
		const ctx = makeCtx(vault);

		const outcome = await updateTracker(action, ctx);

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(DAILY_PATH);
		expect(result).toContain("- [ ] done");
		expect(result).not.toContain("- [x] done");
	});

	it("checkbox already at target state (checked, value truthy) → skipped-already; content unchanged", async () => {
		const content = "# Daily\n\n- [x] done\n\nmore content\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({ syntax: "checkbox", field: "done", value: true });
		const ctx = makeCtx(vault);

		const outcome = await updateTracker(action, ctx);

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(DAILY_PATH)).toBe(content);
	});

	it("checkbox already at target state (unchecked, value falsy) → skipped-already; content unchanged", async () => {
		const content = "# Daily\n\n- [ ] done\n\nmore content\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({ syntax: "checkbox", field: "done", value: false });
		const ctx = makeCtx(vault);

		const outcome = await updateTracker(action, ctx);

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(DAILY_PATH)).toBe(content);
	});

	it("checkbox field not found → failed 'Tracker field not found'", async () => {
		const content = "# Daily\n\nNo checkbox here.\n";
		const vault = new FakeVaultFS();
		await vault.create(DAILY_PATH, content);
		const action = makeAction({ syntax: "checkbox", field: "done", value: true });
		const ctx = makeCtx(vault);

		const outcome = await updateTracker(action, ctx);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe("Tracker field not found: done");
		}
		expect(await vault.read(DAILY_PATH)).toBe(content);
	});
});
