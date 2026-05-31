import "obsidian";

import { describe, expect, it } from "vitest";

import { FakeEditorAdapter } from "../../../src/ide-bridge/FakeEditorAdapter";
import type { SelectionChangedParams } from "../../../src/ide-bridge/protocol";
import { getCurrentSelection, getLatestSelection } from "../../../src/ide-bridge/tools/selection";
import type { ToolContext } from "../../../src/ide-bridge/tools/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SELECTION_PARAMS: SelectionChangedParams = {
	text: "hello world",
	filePath: "notes/plan.md",
	fileUrl: "file:///notes/plan.md",
	selection: {
		start: { line: 2, character: 4 },
		end: { line: 2, character: 15 },
		isEmpty: false,
	},
};

function makeAdapter() {
	return new FakeEditorAdapter();
}

function makeCtx(getLatest: () => SelectionChangedParams | null): ToolContext {
	return { getLatest };
}

// ---------------------------------------------------------------------------
// getCurrentSelection
// ---------------------------------------------------------------------------

describe("getCurrentSelection", () => {
	it("returns the adapter snapshot when a markdown editor is active", () => {
		const adapter = makeAdapter();
		adapter.setActiveSelection(SELECTION_PARAMS);
		const ctx = makeCtx(() => null);

		const result = getCurrentSelection(undefined, adapter, ctx);

		expect(result).not.toBeNull();
		expect(result?.text).toBe("hello world");
		expect(result?.filePath).toBe("notes/plan.md");
		expect(result?.fileUrl).toBe("file:///notes/plan.md");
		expect(result?.selection.start).toEqual({ line: 2, character: 4 });
		expect(result?.selection.end).toEqual({ line: 2, character: 15 });
		expect(result?.selection.isEmpty).toBe(false);
	});

	it("returns null when no markdown editor is active (empty result = null)", () => {
		const adapter = makeAdapter();
		// adapter has no active selection by default
		const ctx = makeCtx(() => null);

		const result = getCurrentSelection(undefined, adapter, ctx);

		expect(result).toBeNull();
	});

	it("filePath in the result is plain vault-relative (no host-absolute prefix)", () => {
		const adapter = makeAdapter();
		adapter.setActiveSelection({
			...SELECTION_PARAMS,
			filePath: "journal/2026-05-29.md",
			fileUrl: "file:///journal/2026-05-29.md",
		});
		const ctx = makeCtx(() => null);

		const result = getCurrentSelection(undefined, adapter, ctx);

		expect(result?.filePath.startsWith("/")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// getLatestSelection
// ---------------------------------------------------------------------------

describe("getLatestSelection", () => {
	it("returns the injected getter value when the stub returns canned params", () => {
		const adapter = makeAdapter();
		const ctx = makeCtx(() => SELECTION_PARAMS);

		const result = getLatestSelection(undefined, adapter, ctx);

		expect(result).toEqual(SELECTION_PARAMS);
	});

	it("returns null when the injected getter returns null", () => {
		const adapter = makeAdapter();
		const ctx = makeCtx(() => null);

		const result = getLatestSelection(undefined, adapter, ctx);

		expect(result).toBeNull();
	});

	it("does not delegate to the adapter — only reads from ctx.getLatest", () => {
		const adapter = makeAdapter();
		// Set an active selection on the adapter — getLatestSelection must ignore it
		adapter.setActiveSelection(SELECTION_PARAMS);
		const distinctParams: SelectionChangedParams = {
			...SELECTION_PARAMS,
			text: "from-tracker",
		};
		const ctx = makeCtx(() => distinctParams);

		const result = getLatestSelection(undefined, adapter, ctx);

		// Must return what the getter returned, not what the adapter holds
		expect(result?.text).toBe("from-tracker");
	});
});
