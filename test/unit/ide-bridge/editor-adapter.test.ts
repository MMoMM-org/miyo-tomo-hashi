import "obsidian";

import { describe, expect, it } from "vitest";

import { FakeEditorAdapter } from "./FakeEditorAdapter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter() {
	return new FakeEditorAdapter();
}

// ---------------------------------------------------------------------------
// getCurrentSelection — active MarkdownView
// ---------------------------------------------------------------------------

describe("getCurrentSelection", () => {
	it("returns null when no active editor is set", () => {
		const adapter = makeAdapter();
		expect(adapter.getCurrentSelection()).toBeNull();
	});

	it("returns SelectionChangedParams when an active selection is set", () => {
		const adapter = makeAdapter();
		adapter.setActiveSelection({
			text: "hello world",
			filePath: "notes/plan.md",
			fileUrl: "file:///notes/plan.md",
			selection: {
				start: { line: 0, character: 0 },
				end: { line: 0, character: 11 },
				isEmpty: false,
			},
		});

		const result = adapter.getCurrentSelection();

		expect(result).not.toBeNull();
		expect(result?.text).toBe("hello world");
		expect(result?.filePath).toBe("notes/plan.md");
		expect(result?.fileUrl).toBe("file:///notes/plan.md");
		expect(result?.selection.start).toEqual({ line: 0, character: 0 });
		expect(result?.selection.end).toEqual({ line: 0, character: 11 });
		expect(result?.selection.isEmpty).toBe(false);
	});

	it("filePath is plain vault-relative (no host-absolute path)", () => {
		const adapter = makeAdapter();
		adapter.setActiveSelection({
			text: "",
			filePath: "journal/2026-05-29.md",
			fileUrl: "file:///journal/2026-05-29.md",
			selection: {
				start: { line: 3, character: 0 },
				end: { line: 3, character: 0 },
				isEmpty: true,
			},
		});

		const result = adapter.getCurrentSelection();

		// vault-relative: must not start with /
		expect(result?.filePath.startsWith("/")).toBe(false);
		// fileUrl path must be vault-relative
		expect(result?.fileUrl).toBe("file:///journal/2026-05-29.md");
	});

	it("cursor-only position returns isEmpty:true", () => {
		const adapter = makeAdapter();
		adapter.setActiveSelection({
			text: "",
			filePath: "notes/empty-cursor.md",
			fileUrl: "file:///notes/empty-cursor.md",
			selection: {
				start: { line: 5, character: 10 },
				end: { line: 5, character: 10 },
				isEmpty: true,
			},
		});

		const result = adapter.getCurrentSelection();
		expect(result?.selection.isEmpty).toBe(true);
		expect(result?.text).toBe("");
	});

	it("clears to null after setActiveSelection(null)", () => {
		const adapter = makeAdapter();
		adapter.setActiveSelection({
			text: "some text",
			filePath: "notes/x.md",
			fileUrl: "file:///notes/x.md",
			selection: { start: { line: 0, character: 0 }, end: { line: 0, character: 9 }, isEmpty: false },
		});
		adapter.setActiveSelection(null);
		expect(adapter.getCurrentSelection()).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// getOpenEditors — vault-relative paths, isDirty:false
// ---------------------------------------------------------------------------

describe("getOpenEditors", () => {
	it("returns empty array when no files are registered", () => {
		const adapter = makeAdapter();
		expect(adapter.getOpenEditors()).toEqual([]);
	});

	it("returns registered files with isDirty:false", () => {
		const adapter = makeAdapter();
		adapter.files.add("notes/plan.md");
		adapter.files.add("journal/2026-05-29.md");

		const editors = adapter.getOpenEditors();

		expect(editors).toHaveLength(2);
		const paths = editors.map((e) => e.filePath);
		expect(paths).toContain("notes/plan.md");
		expect(paths).toContain("journal/2026-05-29.md");
		for (const e of editors) {
			expect(e.isDirty).toBe(false);
		}
	});

	it("all returned entries have isDirty:false (adapter always reports clean)", () => {
		const adapter = makeAdapter();
		adapter.files.add("notes/a.md");
		adapter.files.add("notes/b.md");
		const editors = adapter.getOpenEditors();
		expect(editors.every((e) => e.isDirty === false)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// openFile — records the opened path
// ---------------------------------------------------------------------------

describe("openFile", () => {
	it("records the path in the opened capture list", () => {
		const adapter = makeAdapter();
		adapter.openFile("notes/target.md");
		expect(adapter.opened).toContain("notes/target.md");
	});

	it("records multiple distinct calls in order", () => {
		const adapter = makeAdapter();
		adapter.openFile("notes/first.md");
		adapter.openFile("notes/second.md");
		expect(adapter.opened).toEqual(["notes/first.md", "notes/second.md"]);
	});

	it("does not affect getCurrentSelection", () => {
		const adapter = makeAdapter();
		adapter.openFile("notes/target.md");
		expect(adapter.getCurrentSelection()).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// workspaceRoot
// ---------------------------------------------------------------------------

describe("workspaceRoot", () => {
	it("returns the configured root string", () => {
		const adapter = new FakeEditorAdapter("my-vault-root");
		expect(adapter.workspaceRoot()).toBe("my-vault-root");
	});

	it("returns empty string by default", () => {
		const adapter = makeAdapter();
		expect(adapter.workspaceRoot()).toBe("");
	});
});
