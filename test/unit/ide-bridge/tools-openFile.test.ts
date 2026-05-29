import "obsidian";

import { describe, expect, it, beforeEach } from "vitest";

import { FakeEditorAdapter } from "../../../src/ide-bridge/FakeEditorAdapter";
import { openFile } from "../../../src/ide-bridge/tools/openFile";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(): FakeEditorAdapter {
	return new FakeEditorAdapter();
}

// ---------------------------------------------------------------------------
// openFile — path-safety (T2.3)
// ---------------------------------------------------------------------------

describe("openFile", () => {
	// --- traversal rejected ---

	it("rejects traversal paths with -32602 + 'unsafe'", async () => {
		const adapter = makeAdapter();
		const res = await openFile({ filePath: "../../etc/passwd" }, adapter);
		expect(res).toEqual({ error: { code: -32602, message: expect.stringContaining("unsafe") } });
	});

	it("rejects absolute POSIX paths with -32602 + 'unsafe'", async () => {
		const adapter = makeAdapter();
		const res = await openFile({ filePath: "/etc/passwd" }, adapter);
		expect(res).toEqual({ error: { code: -32602, message: expect.stringContaining("unsafe") } });
	});

	// --- empty path rejected ---

	it("rejects empty string with -32602 (not 'unsafe')", async () => {
		const adapter = makeAdapter();
		const res = await openFile({ filePath: "" }, adapter);
		expect(res).toEqual({ error: { code: -32602, message: expect.any(String) } });
		// empty-string error should NOT say "unsafe" — it's a missing-param error
		expect((res as { error: { code: number; message: string } }).error.message).not.toContain("unsafe");
	});

	// --- non-string / missing param rejected ---

	it("rejects missing filePath with -32602", async () => {
		const adapter = makeAdapter();
		const res = await openFile({}, adapter);
		expect(res).toEqual({ error: { code: -32602, message: expect.any(String) } });
	});

	it("rejects non-string filePath with -32602", async () => {
		const adapter = makeAdapter();
		const res = await openFile({ filePath: 42 }, adapter);
		expect(res).toEqual({ error: { code: -32602, message: expect.any(String) } });
	});

	// --- missing-but-safe path rejected (not "unsafe") ---

	it("rejects a safe but non-existent path with -32602 (message contains 'not found', not 'unsafe')", async () => {
		const adapter = makeAdapter();
		// "notes/missing.md" not in adapter.files
		const res = await openFile({ filePath: "notes/missing.md" }, adapter);
		expect(res).toEqual({ error: { code: -32602, message: expect.stringContaining("not found") } });
		expect((res as { error: { code: number; message: string } }).error.message).not.toContain("unsafe");
	});

	// --- happy path ---

	it("opens an existing vault file and returns success", async () => {
		const adapter = makeAdapter();
		adapter.files.add("notes/plan.md");
		const res = await openFile({ filePath: "notes/plan.md" }, adapter);
		expect(res).toEqual({ success: true });
		expect(adapter.opened).toContain("notes/plan.md");
	});

	it("records the vault-relative path in adapter.opened", async () => {
		const adapter = makeAdapter();
		adapter.files.add("journal/2026-05-29.md");
		await openFile({ filePath: "journal/2026-05-29.md" }, adapter);
		expect(adapter.opened[adapter.opened.length - 1]).toBe("journal/2026-05-29.md");
	});
});
