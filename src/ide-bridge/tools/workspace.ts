/**
 * getWorkspaceFolders tool handler.
 *
 * Always returns { workspaceFolders: [] }. The host vault's absolute filesystem
 * path is intentionally never exposed to Claude Code — the container context
 * makes the host path meaningless and potentially a privacy leak. This is a
 * deliberate design decision documented in Kokoro ADR-019 §5.
 *
 * The adapter's workspaceRoot() is available at runtime but is unconditionally
 * ignored here per the ADR; this keeps the handler honest and prevents accidental
 * path exposure if the ADR decision is ever revisited at the wrong layer.
 *
 * Spec: docs/XDD/specs/003-ide-bridge — SDD "Tool registry".
 */

import type { EditorAdapter } from "../ObsidianEditorAdapter";
import type { ToolContext } from "./types";

/** Wire shape returned by the getWorkspaceFolders tool. */
type WorkspaceFoldersResult = {
	workspaceFolders: never[];
};

/**
 * Return an empty workspaceFolders list.
 * The host vault path is never included (Kokoro ADR-019 §5).
 */
export function getWorkspaceFolders(
	_params: unknown,
	_adapter: EditorAdapter,
	_ctx: ToolContext,
): WorkspaceFoldersResult {
	return { workspaceFolders: [] };
}
