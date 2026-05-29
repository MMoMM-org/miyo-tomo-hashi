/**
 * Protocol-completeness stub handlers.
 *
 * These handlers return fixed shapes for protocol-required tools that have no
 * implementation in Hashi v0.1:
 * - getDiagnostics: Obsidian auto-saves; diagnostics are in-editor only.
 * - checkDocumentDirty: isDirty tracking requires vault event hooks (future scope).
 * - saveDocument: Not applicable (Obsidian auto-saves).
 * - close_tab: Tab lifecycle is Obsidian-managed; no closing via JSON-RPC.
 * - closeAllDiffTabs: Diff tabs do not exist in Obsidian's editor model.
 *
 * Returning constant shapes prevents client code (Claude Code) from treating
 * these tools as unimplemented or missing. Future scopes (v0.2+) may replace
 * these with real implementations.
 *
 * Spec: docs/XDD/specs/003-ide-bridge — SDD "Tool registry".
 */

import type { EditorAdapter } from "../ObsidianEditorAdapter";
import type { ToolContext } from "./types";

/** Wire shape returned by the getDiagnostics tool. */
type GetDiagnosticsResult = {
	diagnostics: [];
};

/** Wire shape returned by the checkDocumentDirty tool. */
type CheckDocumentDirtyResult = {
	isDirty: false;
};

/** Wire shape returned by the saveDocument tool. */
type SaveDocumentResult = {
	saved: true;
};

/** Wire shape returned by the close_tab tool. */
type CloseTabResult = {
	closed: true;
};

/** Wire shape returned by the closeAllDiffTabs tool. */
type CloseAllDiffTabsResult = {
	closed: 0;
};

/**
 * Return an empty diagnostics list.
 * Obsidian does not expose per-file diagnostic information to plugins.
 */
export function getDiagnostics(
	_params: unknown,
	_adapter: EditorAdapter,
	_ctx: ToolContext,
): GetDiagnosticsResult {
	return { diagnostics: [] };
}

/**
 * Return isDirty: false (document always clean).
 * Obsidian auto-saves; dirty-flag tracking is not exposed to plugins.
 */
export function checkDocumentDirty(
	_params: unknown,
	_adapter: EditorAdapter,
	_ctx: ToolContext,
): CheckDocumentDirtyResult {
	return { isDirty: false };
}

/**
 * Return saved: true (save always succeeds).
 * Obsidian auto-saves; no explicit save action is needed.
 */
export function saveDocument(
	_params: unknown,
	_adapter: EditorAdapter,
	_ctx: ToolContext,
): SaveDocumentResult {
	return { saved: true };
}

/**
 * Return closed: true (tab always closes).
 * Tab lifecycle is managed entirely by Obsidian; Hashi cannot close tabs.
 * Future scopes may implement tab management via workspace.detachLeaf.
 */
export function close_tab(
	_params: unknown,
	_adapter: EditorAdapter,
	_ctx: ToolContext,
): CloseTabResult {
	return { closed: true };
}

/**
 * Return closed: 0 (no diff tabs closed).
 * Obsidian's editor model does not have diff tabs; this tool always returns 0.
 */
export function closeAllDiffTabs(
	_params: unknown,
	_adapter: EditorAdapter,
	_ctx: ToolContext,
): CloseAllDiffTabsResult {
	return { closed: 0 };
}
