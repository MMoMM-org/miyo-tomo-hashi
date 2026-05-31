/**
 * Tool registry — the single wiring point that binds all Phase 2 tool handlers
 * to their JSON-RPC method names, descriptions, and JSON-Schema input shapes.
 *
 * This module owns two public responsibilities:
 *   1. `buildToolsList()` — produce the wire-format `tools/list` array that is
 *      sent to Claude Code so it knows which tools are available and how to
 *      invoke them (name + description + inputSchema).
 *   2. `buildHandlerRegistry(adapter, ctx)` — produce a `HandlerRegistry` that
 *      can be passed directly to `dispatch()`. The registry exposes exactly ONE
 *      method, `"tools/call"`, an MCP dispatcher that routes by tool name. Tools
 *      are NOT exposed as direct JSON-RPC methods — a direct `getCurrentSelection`
 *      method correctly resolves to `-32601` (method not found). The dispatcher:
 *        - reads `params` as `{ name, arguments? }`; an unknown/non-string name
 *          throws `{ code: -32602 }` (invalid params);
 *        - invokes the tool handler with the tool's own `arguments`;
 *        - preserves the "error bridge": if a handler returns an object with an
 *          `"error"` key, the wrapper throws it so `dispatch` produces the
 *          handler's numeric code (e.g. openFile traversal → -32602);
 *        - on success wraps the (JSON-stringified) return value in the MCP
 *          content envelope `{ content: [{ type: "text", text }] }`. The stringify
 *          is uniform: a null tool return becomes content text `"null"`.
 *
 * The exact set of registered names is exhaustively derived from `ToolName`
 * (protocol.ts). `openDiff` and `executeCode` are intentionally absent per the
 * SDD §Tool registry — they are not in the `ToolName` union.
 *
 * Spec: docs/XDD/specs/003-ide-bridge — SDD "Tool registry".
 */

import type { EditorAdapter } from "../ObsidianEditorAdapter";
import type { HandlerRegistry } from "../jsonRpc";
import type { ToolName } from "../protocol";
import { getCurrentSelection, getLatestSelection } from "./selection";
import { getOpenEditors } from "./openEditors";
import { openFile } from "./openFile";
import { getWorkspaceFolders } from "./workspace";
import {
	checkDocumentDirty,
	close_tab,
	closeAllDiffTabs,
	getDiagnostics,
	saveDocument,
} from "./stubs";
import type { ToolContext } from "./types";

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

/** JSON Schema for tools that accept no parameters. */
const EMPTY_SCHEMA = { type: "object", properties: {} } as const;

/** JSON Schema for the openFile tool. */
const OPEN_FILE_SCHEMA = {
	type: "object",
	properties: { filePath: { type: "string" } },
	required: ["filePath"],
} as const;

// ---------------------------------------------------------------------------
// Internal registry entry type
// ---------------------------------------------------------------------------

type ToolHandler = (params: unknown, adapter: EditorAdapter, ctx: ToolContext) => unknown;

type RegistryEntry = {
	description: string;
	inputSchema: Record<string, unknown>;
	handler: ToolHandler;
};

// ---------------------------------------------------------------------------
// Full registry — exhaustively covers every ToolName
// ---------------------------------------------------------------------------

/**
 * The internal registry keyed by ToolName.
 * Adding or removing a key here must stay in sync with the ToolName union in
 * protocol.ts — TypeScript enforces this via the Record<ToolName, …> type.
 */
const TOOL_REGISTRY: Record<ToolName, RegistryEntry> = {
	getCurrentSelection: {
		description: "Return the current editor selection and cursor position, or null when no markdown editor is active.",
		inputSchema: EMPTY_SCHEMA,
		handler: getCurrentSelection,
	},
	getLatestSelection: {
		description: "Return the last selection broadcast by the selection tracker, or null when no selection has been recorded yet.",
		inputSchema: EMPTY_SCHEMA,
		handler: getLatestSelection,
	},
	getOpenEditors: {
		description: "List all currently open markdown editor tabs with their vault-relative file paths.",
		inputSchema: EMPTY_SCHEMA,
		handler: getOpenEditors,
	},
	openFile: {
		description: "Open a vault file by vault-relative path in the Obsidian workspace.",
		inputSchema: OPEN_FILE_SCHEMA,
		handler: openFile,
	},
	getWorkspaceFolders: {
		description: "Return the workspace folder list. Always returns an empty array — the vault host path is intentionally not exposed.",
		inputSchema: EMPTY_SCHEMA,
		handler: getWorkspaceFolders,
	},
	getDiagnostics: {
		description: "Return file diagnostics. Always returns an empty list — Obsidian does not expose per-file diagnostics to plugins.",
		inputSchema: EMPTY_SCHEMA,
		handler: getDiagnostics,
	},
	checkDocumentDirty: {
		description: "Check whether a document has unsaved changes. Always returns isDirty: false — Obsidian auto-saves.",
		inputSchema: EMPTY_SCHEMA,
		handler: checkDocumentDirty,
	},
	saveDocument: {
		description: "Save a document explicitly. Always succeeds — Obsidian auto-saves all documents.",
		inputSchema: EMPTY_SCHEMA,
		handler: saveDocument,
	},
	close_tab: {
		description: "Close an editor tab. Always reports success — tab lifecycle is managed by Obsidian.",
		inputSchema: EMPTY_SCHEMA,
		handler: close_tab,
	},
	closeAllDiffTabs: {
		description: "Close all diff editor tabs. Always returns 0 — Obsidian does not have diff tabs.",
		inputSchema: EMPTY_SCHEMA,
		handler: closeAllDiffTabs,
	},
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Wire entry returned in the `tools/list` response — handler is stripped. */
export type ToolListEntry = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
};

/**
 * Build the `tools/list` array for the IDE Bridge wire protocol.
 * Each entry contains the name, description, and inputSchema.
 * The handler is intentionally excluded — this is the wire shape only.
 */
export function buildToolsList(): ToolListEntry[] {
	return (Object.keys(TOOL_REGISTRY) as ToolName[]).map((name) => {
		const { description, inputSchema } = TOOL_REGISTRY[name];
		return { name, description, inputSchema };
	});
}

/** Parameters of an MCP `tools/call` request. */
type ToolsCallParams = { name?: unknown; arguments?: unknown };

/**
 * Error carrying a JSON-RPC numeric `code`. `dispatch`'s `thrownToEnvelope`
 * reads `.code`/`.message` off any thrown object, so throwing a real Error (vs.
 * a plain object literal) keeps the same wire behaviour while satisfying the
 * `@typescript-eslint/only-throw-error` rule.
 */
class RpcCodeError extends Error {
	constructor(readonly code: number, message: string) {
		super(message);
		this.name = "RpcCodeError";
	}
}

/** Re-throw a handler's `{ code, message }` error shape as an RpcCodeError. */
function asRpcError(error: unknown): RpcCodeError {
	if (error !== null && typeof error === "object" && "code" in error) {
		const { code, message } = error as { code: unknown; message?: unknown };
		if (typeof code === "number") {
			return new RpcCodeError(code, typeof message === "string" ? message : "Internal error");
		}
	}
	return new RpcCodeError(-32603, "Internal error");
}

/** Wrap a tool's return value in the MCP content envelope. */
function toContentEnvelope(result: unknown): { content: [{ type: "text"; text: string }] } {
	// Uniform stringify: null → "null". The `?? "null"` fallback guards against a
	// future handler accidentally returning `undefined` (JSON.stringify(undefined)
	// returns the JS value undefined, not a string), keeping text unconditionally
	// well-shaped.
	return { content: [{ type: "text", text: JSON.stringify(result) ?? "null" }] };
}

/**
 * Produce a `HandlerRegistry` suitable for passing to `dispatch()`.
 *
 * The registry exposes a single method, `"tools/call"`, an MCP dispatcher:
 * - Reads `{ name, arguments? }` from the request params. A missing/non-string
 *   name or one not in TOOL_REGISTRY throws `{ code: -32602 }` (invalid params).
 * - Invokes `TOOL_REGISTRY[name].handler(arguments, adapter, ctx)`.
 * - Error bridge: if the (awaited) result is a non-null object with an `"error"`
 *   key, throws `result.error` so `dispatch`'s `thrownToEnvelope` picks up the
 *   numeric code (e.g. openFile traversal → -32602) and produces an error envelope.
 * - On success wraps the JSON-stringified return value in the MCP content
 *   envelope. A null tool return becomes content text `"null"` — no special-casing.
 */
export function buildHandlerRegistry(
	adapter: EditorAdapter,
	ctx: ToolContext,
): HandlerRegistry {
	const dispatcher = async (params: unknown): Promise<unknown> => {
		const { name, arguments: args } = (params ?? {}) as ToolsCallParams;
		if (typeof name !== "string" || !(name in TOOL_REGISTRY)) {
			throw new RpcCodeError(-32602, `Unknown tool: ${String(name)}`);
		}

		const { handler } = TOOL_REGISTRY[name as ToolName];
		const result = await handler(args, adapter, ctx);
		// Error bridge: translate a returned { error } into a throw so dispatch
		// produces a proper JSON-RPC error envelope. Guard against null (a valid
		// result for getCurrentSelection/getLatestSelection).
		if (result !== null && typeof result === "object" && "error" in result) {
			throw asRpcError((result as { error: unknown }).error);
		}
		return toContentEnvelope(result);
	};

	return { "tools/call": dispatcher };
}
