/**
 * Tool registry — the single wiring point that binds all Phase 2 tool handlers
 * to their JSON-RPC method names, descriptions, and JSON-Schema input shapes.
 *
 * This module owns two public responsibilities:
 *   1. `buildToolsList()` — produce the wire-format `tools/list` array that is
 *      sent to Claude Code so it knows which tools are available and how to
 *      invoke them (name + description + inputSchema).
 *   2. `buildHandlerRegistry(adapter, ctx)` — produce a `HandlerRegistry` that
 *      can be passed directly to `dispatch()`. Each entry in the registry is a
 *      curried wrapper that calls the underlying tool handler with (params,
 *      adapter, ctx). The wrapper also contains the "error bridge": if a handler
 *      returns an object with an `"error"` key, the wrapper throws the error
 *      object so that `dispatch` produces a proper JSON-RPC error envelope
 *      (code -32602) rather than a `result` wrapping the error. Null results
 *      pass through as-is so that `getCurrentSelection`/`getLatestSelection`
 *      can legitimately return `result: null`.
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
		handler: openFile as ToolHandler,
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

/**
 * Produce a `HandlerRegistry` suitable for passing to `dispatch()`.
 *
 * Each entry is a curried wrapper around the tool handler with:
 * - `(params, adapter, ctx)` supplied at registry build time.
 * - Error bridge: if the (awaited) result is a non-null object with an `"error"`
 *   key, the wrapper throws `result.error` so that `dispatch`'s `thrownToEnvelope`
 *   picks up the numeric code and produces a proper -32602 error envelope.
 * - Null pass-through: null results are returned as-is so that tools like
 *   `getCurrentSelection` can legitimately produce `result: null`.
 */
export function buildHandlerRegistry(
	adapter: EditorAdapter,
	ctx: ToolContext,
): HandlerRegistry {
	const registry: HandlerRegistry = {};

	for (const name of Object.keys(TOOL_REGISTRY) as ToolName[]) {
		const { handler } = TOOL_REGISTRY[name];
		registry[name] = async (params: unknown): Promise<unknown> => {
			const result = await (handler(params, adapter, ctx) as Promise<unknown>);
			// Error bridge: translate returned { error } into a throw so dispatch
			// produces a proper JSON-RPC error envelope. Guard against null (which
			// is a valid result for getCurrentSelection/getLatestSelection).
			if (result !== null && typeof result === "object" && "error" in result) {
				throw (result as { error: unknown }).error;
			}
			return result;
		};
	}

	return registry;
}
