import "obsidian";

import { describe, expect, it } from "vitest";

import { FakeEditorAdapter } from "../../../src/ide-bridge/FakeEditorAdapter";
import { getOpenEditors } from "../../../src/ide-bridge/tools/openEditors";
import type { ToolContext } from "../../../src/ide-bridge/tools/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter() {
	return new FakeEditorAdapter();
}

function makeCtx(): ToolContext {
	return { getLatest: () => null };
}

// ---------------------------------------------------------------------------
// getOpenEditors
// ---------------------------------------------------------------------------

describe("getOpenEditors", () => {
	it("returns { tabs: [] } when no markdown tabs are open", () => {
		const adapter = makeAdapter();
		const ctx = makeCtx();

		const result = getOpenEditors(undefined, adapter, ctx);

		expect(result).toEqual({ tabs: [] });
	});

	it("returns { tabs: [{ filePath, isDirty:false }] } for each open editor", () => {
		const adapter = makeAdapter();
		adapter.files.add("notes/plan.md");
		adapter.files.add("journal/2026-05-29.md");
		const ctx = makeCtx();

		const result = getOpenEditors(undefined, adapter, ctx);

		expect(result.tabs).toHaveLength(2);
		const paths = result.tabs.map((t) => t.filePath);
		expect(paths).toContain("notes/plan.md");
		expect(paths).toContain("journal/2026-05-29.md");
		for (const tab of result.tabs) {
			expect(tab.isDirty).toBe(false);
		}
	});

	it("filePaths in tabs are vault-relative (no host-absolute prefix)", () => {
		const adapter = makeAdapter();
		adapter.files.add("deep/nested/note.md");
		const ctx = makeCtx();

		const result = getOpenEditors(undefined, adapter, ctx);

		for (const tab of result.tabs) {
			expect(tab.filePath.startsWith("/")).toBe(false);
		}
	});

	it("isDirty is always false regardless of adapter state", () => {
		const adapter = makeAdapter();
		adapter.files.add("a.md");
		adapter.files.add("b.md");
		const ctx = makeCtx();

		const result = getOpenEditors(undefined, adapter, ctx);

		expect(result.tabs.every((t) => t.isDirty === false)).toBe(true);
	});
});
