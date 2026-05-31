import "obsidian";

import { describe, expect, it } from "vitest";

import { FakeEditorAdapter } from "../../../src/ide-bridge/FakeEditorAdapter";
import type { SelectionChangedParams } from "../../../src/ide-bridge/protocol";
import { getWorkspaceFolders } from "../../../src/ide-bridge/tools/workspace";
import type { ToolContext } from "../../../src/ide-bridge/tools/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SELECTION_PARAMS: SelectionChangedParams = {
	text: "some text",
	filePath: "notes/plan.md",
	fileUrl: "file:///notes/plan.md",
	selection: {
		start: { line: 0, character: 0 },
		end: { line: 0, character: 9 },
		isEmpty: false,
	},
};

function makeAdapter() {
	return new FakeEditorAdapter();
}

function makeCtx(getLatest: () => SelectionChangedParams | null = () => null): ToolContext {
	return { getLatest };
}

// ---------------------------------------------------------------------------
// getWorkspaceFolders
// ---------------------------------------------------------------------------

describe("getWorkspaceFolders", () => {
	it("always returns { workspaceFolders: [] } regardless of editor state", () => {
		const adapter = makeAdapter();
		const ctx = makeCtx();

		const result = getWorkspaceFolders(undefined, adapter, ctx);

		expect(result).toEqual({ workspaceFolders: [] });
	});

	it("returns { workspaceFolders: [] } even when an active selection is present", () => {
		const adapter = makeAdapter();
		adapter.setActiveSelection(SELECTION_PARAMS);
		const ctx = makeCtx(() => SELECTION_PARAMS);

		const result = getWorkspaceFolders(undefined, adapter, ctx);

		expect(result).toEqual({ workspaceFolders: [] });
	});

	it("returns { workspaceFolders: [] } even when open editors are registered", () => {
		const adapter = makeAdapter();
		adapter.files.add("notes/plan.md");
		const ctx = makeCtx();

		const result = getWorkspaceFolders(undefined, adapter, ctx);

		expect(result).toEqual({ workspaceFolders: [] });
	});

	it("workspaceFolders array is always empty (Kokoro ADR-019 §5 — host path meaningless in container)", () => {
		const adapter = new FakeEditorAdapter("vault-root-value");
		const ctx = makeCtx();

		const result = getWorkspaceFolders(undefined, adapter, ctx);

		// Even if the adapter has a non-empty workspaceRoot, the tool ignores it
		expect(result.workspaceFolders).toHaveLength(0);
	});
});
