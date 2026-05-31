/**
 * JSON-RPC 2.0 + selection protocol types for the IDE Bridge — the wire
 * contract between Hashi's localhost WebSocket server and Claude Code.
 *
 * Spec: docs/XDD/specs/003-ide-bridge — SDD "Application Data Models".
 *
 * ADR-7 / Kokoro ADR-019 §2.3: there is deliberately NO `vaultRelativePath`
 * field. The standard `filePath` IS the plain vault-relative path, and
 * `fileUrl` is a `file://` URL whose path component is that same vault-relative
 * path (never a host-absolute path). Do not add custom path-field extensions —
 * Claude Code consumes the standard fields.
 */

/** 0-based line/character position. */
export type Pos = { line: number; character: number };

/** The tool method names exposed over the bridge. */
export type ToolName =
	| "getCurrentSelection"
	| "getLatestSelection"
	| "getOpenEditors"
	| "openFile"
	| "getWorkspaceFolders"
	| "getDiagnostics"
	| "checkDocumentDirty"
	| "saveDocument"
	/** snake_case is the intentional wire name per SDD §Tool registry — do NOT rename to closeTab. */
	| "close_tab"
	| "closeAllDiffTabs";

/** JSON-RPC 2.0 error object. */
export type RpcError = { code: number; message: string; data?: unknown };

/**
 * JSON-RPC 2.0 request. `id` is OPTIONAL: a request with no `id` is a
 * notification, which never receives a response.
 */
export type RpcRequest = {
	jsonrpc: "2.0";
	id?: number | string | null;
	method: string;
	params?: unknown;
};

/** JSON-RPC 2.0 response (exactly one of `result` / `error` is present). */
export type RpcResponse = {
	jsonrpc: "2.0";
	id: number | string | null;
	result?: unknown;
	error?: RpcError;
};

/**
 * Payload of a `selection_changed` notification.
 *
 * `filePath` is the PLAIN vault-relative path (e.g. "notes/plan.md").
 * `fileUrl` is a `file://` URL whose path is that vault-relative path — never a
 * host-absolute path. There is intentionally no separate `vaultRelativePath`.
 */
export type SelectionChangedParams = {
	/** Selected text, capped at 100KB upstream; "" if cursor-only. */
	text: string;
	/** Plain vault-relative path, e.g. "notes/plan.md". */
	filePath: string;
	/** `file://` URL whose path is the vault-relative path (no host path). */
	fileUrl: string;
	selection: { start: Pos; end: Pos; isEmpty: boolean };
};
