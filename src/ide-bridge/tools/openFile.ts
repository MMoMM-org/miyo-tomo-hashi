/**
 * openFile tool handler — opens a vault file by vault-relative path.
 *
 * Enforces the full path-safety pipeline before delegating to the adapter:
 *   1. Param narrowing — filePath must be a non-empty string.
 *   2. normalizeAndContain — rejects traversal, absolute, and Windows paths.
 *   3. fileExists — rejects safe paths that do not resolve to a vault file.
 *   4. adapter.openFile — triggers the Obsidian workspace to open the leaf.
 *
 * ERROR SHAPES (tool level — dispatch bridge in T2.5 maps these to JSON-RPC envelopes):
 *   { error: { code: -32602, message: string } }  — all rejection cases
 *   { success: true }                              — file opened
 *
 * The "unsafe path" message prefix is intentional: the SDD unit-test contract
 * asserts `stringContaining("unsafe")` for any normalizeAndContain rejection.
 * Missing-file errors do NOT contain "unsafe" — T2.5 wires the dispatch bridge
 * that converts a returned { error } into a thrown { code, message } for the
 * JSON-RPC envelope layer.
 *
 * Spec: docs/XDD/specs/003-ide-bridge — SDD "Tool registry" / T2.3.
 */

import type { EditorAdapter } from "../ObsidianEditorAdapter";
import { normalizeAndContain } from "../../util/paths";
import type { ToolContext } from "./types";

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/** Successful open — the file was found and the workspace was asked to open it. */
type OpenFileSuccess = { success: true };

/** Tool-level error — dispatch bridge (T2.5) converts this to a JSON-RPC error envelope. */
type OpenFileError = { error: { code: -32602; message: string } };

export type OpenFileResult = OpenFileSuccess | OpenFileError;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Open a vault file by vault-relative path.
 * Returns OpenFileResult — callers (T2.5 dispatch bridge) detect `{ error }`
 * and convert to a JSON-RPC error throw; `{ success: true }` becomes the result.
 */
export async function openFile(
	params: unknown,
	adapter: EditorAdapter,
	_ctx?: ToolContext,
): Promise<OpenFileResult> {
	// --- Step 1: param narrowing ---
	const raw = (params as Record<string, unknown> | null | undefined)?.filePath;
	if (typeof raw !== "string") {
		return { error: { code: -32602, message: "invalid params: filePath must be a string" } };
	}
	if (raw === "") {
		return { error: { code: -32602, message: "invalid params: filePath must not be empty" } };
	}

	// --- Step 2: path-safety (normalizeAndContain) ---
	const safety = normalizeAndContain(raw);
	if (!safety.ok) {
		return { error: { code: -32602, message: `unsafe path: ${safety.reason}` } };
	}

	const { vaultRelativePath } = safety;

	// --- Step 3: existence check ---
	if (!adapter.fileExists(vaultRelativePath)) {
		return { error: { code: -32602, message: `file not found: ${vaultRelativePath}` } };
	}

	// --- Step 4: open ---
	adapter.openFile(vaultRelativePath);
	return { success: true };
}
