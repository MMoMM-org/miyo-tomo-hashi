/**
 * getOpenEditors tool handler.
 *
 * Wraps EditorAdapter.getOpenEditors() (which returns a flat array) into the
 * wire shape expected by Claude Code: { tabs: [{ filePath, isDirty }] }.
 * filePaths are vault-relative (ADR-7); isDirty is always false in v0.1 (the
 * Obsidian API does not expose a reliable per-leaf dirty flag without hooking
 * vault events — this is documented as a v0.1 limitation in the SDD).
 *
 * Spec: docs/XDD/specs/003-ide-bridge — SDD "Tool registry".
 */

import type { EditorAdapter } from "../ObsidianEditorAdapter";
import type { ToolContext } from "./types";

/** Wire shape returned by the getOpenEditors tool. */
type OpenEditorsResult = {
	tabs: { filePath: string; isDirty: false }[];
};

/**
 * Return the list of currently open markdown editors as { tabs }.
 * Returns { tabs: [] } when no markdown tabs are open.
 */
export function getOpenEditors(
	_params: unknown,
	adapter: EditorAdapter,
	_ctx: ToolContext,
): OpenEditorsResult {
	return { tabs: adapter.getOpenEditors() };
}
