/**
 * getCurrentSelection and getLatestSelection tool handlers.
 *
 * getCurrentSelection takes a live snapshot from the EditorAdapter (the active
 * MarkdownView's cursor/selection), returning null when no editor is active.
 * getLatestSelection reads the tracker's last-broadcast cache via the injected
 * ctx.getLatest getter — it never touches the adapter directly.
 *
 * The split avoids coupling these two different semantics (live snapshot vs.
 * cached broadcast) into a single handler, and keeps getLatestSelection free of
 * any dependency on T2.6 (the tracker, wired by T3.2 at runtime).
 *
 * Spec: docs/XDD/specs/003-ide-bridge — SDD "Tool registry".
 */

import type { EditorAdapter } from "../ObsidianEditorAdapter";
import type { SelectionChangedParams } from "../protocol";
import type { ToolContext } from "./types";

/**
 * Return the current editor selection as a live adapter snapshot, or null
 * when no MarkdownView is active. The empty-result contract is null (not {}).
 */
export function getCurrentSelection(
	_params: unknown,
	adapter: EditorAdapter,
	_ctx: ToolContext,
): SelectionChangedParams | null {
	return adapter.getCurrentSelection();
}

/**
 * Return the last selection broadcast by the tracker, or null.
 * Delegates entirely to ctx.getLatest — does not read the adapter.
 */
export function getLatestSelection(
	_params: unknown,
	_adapter: EditorAdapter,
	ctx: ToolContext,
): SelectionChangedParams | null {
	return ctx.getLatest();
}
