import "obsidian";

import { describe, expect, it } from "vitest";

import { FakeEditorAdapter } from "../../../src/ide-bridge/FakeEditorAdapter";
import {
	checkDocumentDirty,
	close_tab,
	closeAllDiffTabs,
	getDiagnostics,
	saveDocument,
} from "../../../src/ide-bridge/tools/stubs";
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
// Protocol stubs
// ---------------------------------------------------------------------------

describe("getDiagnostics", () => {
	it("returns { diagnostics: [] } unconditionally", () => {
		const adapter = makeAdapter();
		const ctx = makeCtx();

		const result = getDiagnostics(undefined, adapter, ctx);

		expect(result).toEqual({ diagnostics: [] });
	});
});

describe("checkDocumentDirty", () => {
	it("returns { isDirty: false } unconditionally", () => {
		const adapter = makeAdapter();
		const ctx = makeCtx();

		const result = checkDocumentDirty(undefined, adapter, ctx);

		expect(result).toEqual({ isDirty: false });
	});
});

describe("saveDocument", () => {
	it("returns { saved: true } unconditionally", () => {
		const adapter = makeAdapter();
		const ctx = makeCtx();

		const result = saveDocument(undefined, adapter, ctx);

		expect(result).toEqual({ saved: true });
	});
});

describe("close_tab", () => {
	it("returns { closed: true } unconditionally", () => {
		const adapter = makeAdapter();
		const ctx = makeCtx();

		const result = close_tab(undefined, adapter, ctx);

		expect(result).toEqual({ closed: true });
	});
});

describe("closeAllDiffTabs", () => {
	it("returns { closed: 0 } unconditionally", () => {
		const adapter = makeAdapter();
		const ctx = makeCtx();

		const result = closeAllDiffTabs(undefined, adapter, ctx);

		expect(result).toEqual({ closed: 0 });
	});
});
