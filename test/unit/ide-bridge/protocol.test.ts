import "obsidian";

import { describe, expect, it } from "vitest";

import { FakeEditorAdapter } from "../../../src/ide-bridge/FakeEditorAdapter";
import { dispatch } from "../../../src/ide-bridge/jsonRpc";
import { buildHandlerRegistry } from "../../../src/ide-bridge/tools/index";
import type { ToolContext } from "../../../src/ide-bridge/tools/types";
import type {
	Pos,
	RpcError,
	RpcRequest,
	RpcResponse,
	SelectionChangedParams,
	ToolName,
} from "../../../src/ide-bridge/protocol";

describe("protocol types", () => {
	it("RpcRequest / RpcResponse / RpcError have the expected shape", () => {
		const request: RpcRequest = {
			jsonrpc: "2.0",
			id: 1,
			method: "getCurrentSelection",
			params: {},
		};
		const error: RpcError = { code: -32601, message: "Method not found" };
		const response: RpcResponse = {
			jsonrpc: "2.0",
			id: 1,
			error,
		};

		expect(request.method).toBe("getCurrentSelection");
		expect(error.code).toBe(-32601);
		expect(error.message).toBe("Method not found");
		expect(response.error?.message).toBe("Method not found");
	});

	it("SelectionChangedParams carries plain vault-relative filePath and no vaultRelativePath field", () => {
		const start: Pos = { line: 0, character: 0 };
		const end: Pos = { line: 2, character: 5 };
		const params: SelectionChangedParams = {
			text: "hello",
			filePath: "notes/plan.md",
			// file:// URL carrying the vault-relative path only — no host vault
			// root (ADR-7). Canonical wire form is finalized in Phase 2 where
			// fileUrl is constructed.
			fileUrl: "file:///notes/plan.md",
			selection: { start, end, isEmpty: false },
		};

		expect(params.filePath).toBe("notes/plan.md");
		expect(params.selection.start.line).toBe(0);
		expect(params.selection.end.character).toBe(5);
		expect(params.selection.isEmpty).toBe(false);

		// ADR-7 / Kokoro ADR-019 §2.3: no custom path-field extension. The
		// standard filePath IS the vault-relative path. Guard against a future
		// reintroduction of vaultRelativePath at runtime.
		expect("vaultRelativePath" in params).toBe(false);
	});

	it("tools are invoked through tools/call, not as direct JSON-RPC methods", async () => {
		const ctx: ToolContext = { getLatest: () => null };
		const registry = buildHandlerRegistry(new FakeEditorAdapter(), ctx);

		// A direct tool-name method is no longer registered → -32601.
		const direct = await dispatch(
			{ jsonrpc: "2.0", id: 1, method: "getCurrentSelection" },
			registry,
		);
		expect(direct!.error!.code).toBe(-32601);

		// The same tool reached through the MCP tools/call dispatcher succeeds and
		// is wrapped in the content envelope.
		const viaCall = await dispatch(
			{
				jsonrpc: "2.0",
				id: 2,
				method: "tools/call",
				params: { name: "getCurrentSelection" },
			},
			registry,
		);
		const result = viaCall!.result as { content: Array<{ type: string; text: string }> };
		expect(result.content[0]!.type).toBe("text");
		expect(JSON.parse(result.content[0]!.text)).toBeNull();
	});

	it("ToolName union accepts every tool method name", () => {
		const names: ToolName[] = [
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
		];
		expect(names).toHaveLength(10);
		expect(new Set(names).size).toBe(10);
	});
});
