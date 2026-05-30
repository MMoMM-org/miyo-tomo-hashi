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

/**
 * Build a `tools/call` request envelope: tools are invoked through the single
 * MCP `tools/call` dispatcher, with the tool name and its arguments nested in
 * `params`.
 */
function makeToolCall(
	id: number,
	name: string,
	args?: unknown,
): RpcRequest {
	return makeRequest(id, "tools/call", { name, ...(args !== undefined && { arguments: args }) });
}

/** Parse the MCP content envelope and return the embedded tool result. */
function unwrapContent(res: { result?: unknown } | null): unknown {
	const result = res?.result as { content: Array<{ type: string; text: string }> };
	return JSON.parse(result.content[0]!.text);
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

describe("buildHandlerRegistry + dispatch (MCP tools/call)", () => {
	it("exposes exactly one method: tools/call (no per-tool direct methods)", () => {
		const registry = buildHandlerRegistry(makeAdapter(), makeCtx());
		expect(Object.keys(registry)).toEqual(["tools/call"]);
	});

	it("direct tool-name method is unknown → -32601 (tools are only reachable via tools/call)", async () => {
		const registry: HandlerRegistry = buildHandlerRegistry(makeAdapter(), makeCtx());

		const res = await dispatch(makeRequest(1, "getWorkspaceFolders"), registry);

		expect(res).toEqual({
			jsonrpc: "2.0",
			id: 1,
			error: { code: -32601, message: "Method not found" },
		});
	});

	it("tools/call routes to the named tool and wraps the return in the MCP content envelope", async () => {
		const registry: HandlerRegistry = buildHandlerRegistry(makeAdapter(), makeCtx());

		const res = await dispatch(makeToolCall(2, "getWorkspaceFolders"), registry);

		expect(res).toEqual({
			jsonrpc: "2.0",
			id: 2,
			result: { content: [{ type: "text", text: JSON.stringify({ workspaceFolders: [] }) }] },
		});
		expect(unwrapContent(res)).toEqual({ workspaceFolders: [] });
	});

	it("tools/call with an unknown tool name → -32602 invalid params", async () => {
		const registry: HandlerRegistry = buildHandlerRegistry(makeAdapter(), makeCtx());

		const res = await dispatch(makeToolCall(3, "noSuchTool"), registry);

		expect(res!.result).toBeUndefined();
		expect(res!.error!.code).toBe(-32602);
		expect(res!.error!.message).toMatch(/noSuchTool/);
	});

	it("tools/call with a missing/non-string name → -32602 invalid params", async () => {
		const registry: HandlerRegistry = buildHandlerRegistry(makeAdapter(), makeCtx());

		const res = await dispatch(makeRequest(4, "tools/call", { arguments: {} }), registry);

		expect(res!.result).toBeUndefined();
		expect(res!.error!.code).toBe(-32602);
	});

	it("error bridge: openFile with unsafe path via tools/call → -32602 error ENVELOPE (not a content result)", async () => {
		const adapter = makeAdapter();
		// No files added — the traversal path is rejected at the safety step.
		const registry: HandlerRegistry = buildHandlerRegistry(adapter, makeCtx());

		const res = await dispatch(
			makeToolCall(5, "openFile", { filePath: "../../etc/passwd" }),
			registry,
		);

		// Must be an error envelope, not a content envelope wrapping the error.
		expect(res!.result).toBeUndefined();
		expect(res!.error).toBeDefined();
		expect(res!.error!.code).toBe(-32602);
		expect(res!.error!.message).toMatch(/unsafe/);
	});

	it("error bridge: openFile with absolute path via tools/call → -32602", async () => {
		const registry: HandlerRegistry = buildHandlerRegistry(makeAdapter(), makeCtx());

		const res = await dispatch(
			makeToolCall(6, "openFile", { filePath: "/etc/passwd" }),
			registry,
		);

		expect(res!.result).toBeUndefined();
		expect(res!.error!.code).toBe(-32602);
	});

	it("openFile happy path via tools/call → content envelope wrapping { success: true }", async () => {
		const adapter = makeAdapter();
		adapter.files.add("notes/plan.md");
		const registry: HandlerRegistry = buildHandlerRegistry(adapter, makeCtx());

		const res = await dispatch(
			makeToolCall(7, "openFile", { filePath: "notes/plan.md" }),
			registry,
		);

		expect(res!.error).toBeUndefined();
		expect(unwrapContent(res)).toEqual({ success: true });
		expect(adapter.opened).toContain("notes/plan.md");
	});

	it("null tool return: getCurrentSelection with no active editor → content text \"null\"", async () => {
		const registry: HandlerRegistry = buildHandlerRegistry(makeAdapter(), makeCtx());

		const res = await dispatch(makeToolCall(8, "getCurrentSelection"), registry);

		expect(res).toEqual({
			jsonrpc: "2.0",
			id: 8,
			result: { content: [{ type: "text", text: "null" }] },
		});
		expect(res!.error).toBeUndefined();
		expect(unwrapContent(res)).toBeNull();
	});

	it("getLatestSelection via tools/call → content text \"null\" when ctx.getLatest returns null", async () => {
		const ctx: ToolContext = { getLatest: () => null };
		const registry: HandlerRegistry = buildHandlerRegistry(makeAdapter(), ctx);

		const res = await dispatch(makeToolCall(9, "getLatestSelection"), registry);

		expect(unwrapContent(res)).toBeNull();
		expect(res!.error).toBeUndefined();
	});

	it("sync stub handler: getDiagnostics via tools/call → content wrapping { diagnostics: [] }", async () => {
		const registry: HandlerRegistry = buildHandlerRegistry(makeAdapter(), makeCtx());

		const res = await dispatch(makeToolCall(10, "getDiagnostics"), registry);

		expect(unwrapContent(res)).toEqual({ diagnostics: [] });
		expect(res!.error).toBeUndefined();
	});
});
