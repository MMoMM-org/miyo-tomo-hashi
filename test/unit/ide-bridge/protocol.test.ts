import { describe, expect, it } from "vitest";

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
