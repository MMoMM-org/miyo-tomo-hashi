import "obsidian";

import { describe, expect, it } from "vitest";

import { FakeEditorAdapter } from "../../../src/ide-bridge/FakeEditorAdapter";
import { dispatch } from "../../../src/ide-bridge/jsonRpc";
import type { HandlerRegistry } from "../../../src/ide-bridge/jsonRpc";
import type { RpcRequest } from "../../../src/ide-bridge/protocol";
import { buildHandlerRegistry, buildToolsList } from "../../../src/ide-bridge/tools/index";
import type { ToolContext } from "../../../src/ide-bridge/tools/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The 10 in-scope tool names per protocol.ts ToolName union. */
const IN_SCOPE_NAMES = new Set([
	"getCurrentSelection",
	"getLatestSelection",
	"getOpenEditors",
	"openFile",
	"getWorkspaceFolders",
	"getDiagnostics",
	"checkDocumentDirty",
	"saveDocument",
	"close_tab",
	"closeAllDiffTabs",
]);

/** Explicitly-excluded names that must NOT appear. */
const EXCLUDED_NAMES = ["openDiff", "executeCode"];

function makeAdapter(): FakeEditorAdapter {
	return new FakeEditorAdapter();
}

function makeCtx(): ToolContext {
	return { getLatest: () => null };
}

function makeRequest(
	id: number,
	method: string,
	params?: unknown,
): RpcRequest {
	return { jsonrpc: "2.0", id, method, ...(params !== undefined && { params }) };
}

// ---------------------------------------------------------------------------
// buildToolsList
// ---------------------------------------------------------------------------

describe("buildToolsList", () => {
	it("returns exactly 10 in-scope tool entries", () => {
		const list = buildToolsList();
		expect(list).toHaveLength(10);
	});

	it("lists exactly the 10 in-scope tool names and no others", () => {
		const list = buildToolsList();
		const names = new Set(list.map((t) => t.name));
		expect(names).toEqual(IN_SCOPE_NAMES);
	});

	it("does not include openDiff or executeCode", () => {
		const list = buildToolsList();
		const names = list.map((t) => t.name);
		for (const excluded of EXCLUDED_NAMES) {
			expect(names).not.toContain(excluded);
		}
	});

	it("each entry has name, description, and inputSchema", () => {
		const list = buildToolsList();
		for (const tool of list) {
			expect(typeof tool.name).toBe("string");
			expect(typeof tool.description).toBe("string");
			expect(tool.description.length).toBeGreaterThan(0);
			expect(tool.inputSchema).toBeDefined();
			expect(typeof tool.inputSchema).toBe("object");
		}
	});

	it("openFile inputSchema requires filePath as a string", () => {
		const list = buildToolsList();
		const openFileTool = list.find((t) => t.name === "openFile");
		expect(openFileTool).toBeDefined();
		expect(openFileTool!.inputSchema).toMatchObject({
			type: "object",
			properties: { filePath: { type: "string" } },
			required: ["filePath"],
		});
	});

	it("tools with no params have { type: 'object', properties: {} } inputSchema", () => {
		const list = buildToolsList();
		const noParamTools = list.filter((t) => t.name !== "openFile");
		for (const tool of noParamTools) {
			expect(tool.inputSchema).toMatchObject({ type: "object", properties: {} });
		}
	});
});

// ---------------------------------------------------------------------------
// buildHandlerRegistry — dispatch integration
// ---------------------------------------------------------------------------

describe("buildHandlerRegistry + dispatch", () => {
	it("getWorkspaceFolders returns { workspaceFolders: [] }", async () => {
		const adapter = makeAdapter();
		const ctx = makeCtx();
		const registry: HandlerRegistry = buildHandlerRegistry(adapter, ctx);

		const res = await dispatch(makeRequest(1, "getWorkspaceFolders"), registry);

		expect(res).toEqual({
			jsonrpc: "2.0",
			id: 1,
			result: { workspaceFolders: [] },
		});
	});

	it("unknown method returns -32601 error envelope", async () => {
		const adapter = makeAdapter();
		const ctx = makeCtx();
		const registry: HandlerRegistry = buildHandlerRegistry(adapter, ctx);

		const res = await dispatch(makeRequest(2, "nope"), registry);

		expect(res).toEqual({
			jsonrpc: "2.0",
			id: 2,
			error: { code: -32601, message: "Method not found" },
		});
	});

	it("error bridge: openFile with unsafe path returns -32602 error ENVELOPE (not result wrapping error)", async () => {
		const adapter = makeAdapter();
		// No files added — any traversal path will be rejected at safety step
		const ctx = makeCtx();
		const registry: HandlerRegistry = buildHandlerRegistry(adapter, ctx);

		const res = await dispatch(
			makeRequest(3, "openFile", { filePath: "../../etc/passwd" }),
			registry,
		);

		// Must be an error envelope, not { result: { error: ... } }
		expect(res).toBeDefined();
		expect(res!.result).toBeUndefined();
		expect(res!.error).toBeDefined();
		expect(res!.error!.code).toBe(-32602);
		expect(res!.error!.message).toMatch(/unsafe/);
	});

	it("error bridge: openFile success returns { result: { success: true } }", async () => {
		const adapter = makeAdapter();
		adapter.files.add("notes/plan.md");
		const ctx = makeCtx();
		const registry: HandlerRegistry = buildHandlerRegistry(adapter, ctx);

		const res = await dispatch(
			makeRequest(4, "openFile", { filePath: "notes/plan.md" }),
			registry,
		);

		expect(res).toEqual({
			jsonrpc: "2.0",
			id: 4,
			result: { success: true },
		});
		expect(adapter.opened).toContain("notes/plan.md");
	});

	it("null pass-through: getCurrentSelection returns result:null (not error) when no active editor", async () => {
		const adapter = makeAdapter();
		// No active selection set — adapter returns null
		const ctx = makeCtx();
		const registry: HandlerRegistry = buildHandlerRegistry(adapter, ctx);

		const res = await dispatch(makeRequest(5, "getCurrentSelection"), registry);

		expect(res).toEqual({
			jsonrpc: "2.0",
			id: 5,
			result: null,
		});
		// Must not be an error envelope
		expect(res!.error).toBeUndefined();
	});

	it("null pass-through: getLatestSelection returns result:null when ctx.getLatest returns null", async () => {
		const adapter = makeAdapter();
		const ctx: ToolContext = { getLatest: () => null };
		const registry: HandlerRegistry = buildHandlerRegistry(adapter, ctx);

		const res = await dispatch(makeRequest(6, "getLatestSelection"), registry);

		expect(res).toEqual({
			jsonrpc: "2.0",
			id: 6,
			result: null,
		});
		expect(res!.error).toBeUndefined();
	});
});
