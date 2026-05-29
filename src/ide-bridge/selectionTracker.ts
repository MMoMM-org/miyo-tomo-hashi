/**
 * selectionTracker — debounce, dedup, and broadcast editor selection events.
 *
 * This is the hot path: `onEditorActivity` fires on every CM6 transaction and
 * active-leaf change. It must be allocation-light — the expensive read happens
 * only in the trailing-edge `flush`, NOT in the activity handler.
 *
 * Responsibilities (SDD F5 / T2.6):
 *   - Trailing-edge 100ms debounce collapses rapid events into one read.
 *   - Dedup prevents broadcasting when the resolved state matches the last send.
 *   - Text > 100KB is truncated; selection range is preserved (Rule 4).
 *   - getLatest() exposes the last broadcast for the getLatestSelection tool (T2.2).
 *   - dispose() cancels any pending timer for safe plugin unload.
 *
 * All dependencies are injected so this module is testable without Obsidian:
 *   - adapter: EditorAdapter — supplies getCurrentSelection().
 *   - broadcast: (msg) => void — receives JSON-RPC 2.0 notification envelopes.
 *     Wired by the WS server in T3.1; a vi.fn() spy in tests.
 *
 * activeWindow (Obsidian global, popout-safe) resolves to globalThis in jsdom
 * via the obsidian mock shim, ensuring vi.useFakeTimers() patches the right
 * timer functions.
 *
 * Spec: docs/XDD/specs/003-ide-bridge — SDD F5, T2.6.
 */

import type { EditorAdapter } from "./ObsidianEditorAdapter";
import type { SelectionChangedParams } from "./protocol";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 100;
const MAX_TEXT = 100_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** JSON-RPC 2.0 selection_changed notification shape. */
export type SelectionChangedNotification = {
	jsonrpc: "2.0";
	method: "selection_changed";
	params: SelectionChangedParams;
};

/** Public API of a SelectionTracker instance. */
export interface SelectionTracker {
	/** Called by the orchestrator (T3.2) on every CM6 update and leaf-change. */
	onEditorActivity(): void;
	/** Returns the last-broadcast params, or null before the first broadcast. */
	getLatest(): SelectionChangedParams | null;
	/** Cancel any pending debounce timer. Call on plugin unload (T3.2). */
	dispose(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a SelectionTracker with injected adapter and broadcast function.
 * The tracker does NOT register event listeners — the orchestrator (T3.2)
 * wires CM6 updateListener and active-leaf-change to call onEditorActivity().
 */
export function createSelectionTracker(
	adapter: EditorAdapter,
	broadcast: (msg: SelectionChangedNotification) => void,
): SelectionTracker {
	let timer: number | null = null;
	let lastKey = "";
	let latest: SelectionChangedParams | null = null;

	function buildKey(params: SelectionChangedParams): string {
		const { filePath, selection: { start, end }, text } = params;
		return `${filePath}|${start.line}:${start.character}|${end.line}:${end.character}|${text}`;
	}

	function flush(): void {
		timer = null;
		const snap = adapter.getCurrentSelection();
		if (snap === null) return; // Rule 1: non-editor context → no broadcast

		// Rule 4: cap text; selection range is unchanged
		const params: SelectionChangedParams = snap.text.length > MAX_TEXT
			? { ...snap, text: snap.text.slice(0, MAX_TEXT) }
			: snap;

		const key = buildKey(params);
		if (key === lastKey) return; // Rule 3: dedup

		lastKey = key;
		latest = params;
		broadcast({ jsonrpc: "2.0", method: "selection_changed", params });
	}

	function onEditorActivity(): void {
		// Rule 2: trailing-edge debounce — reset timer on every call
		if (timer !== null) activeWindow.clearTimeout(timer);
		timer = activeWindow.setTimeout(flush, DEBOUNCE_MS);
	}

	function getLatest(): SelectionChangedParams | null {
		return latest;
	}

	function dispose(): void {
		if (timer !== null) {
			activeWindow.clearTimeout(timer);
			timer = null;
		}
	}

	return { onEditorActivity, getLatest, dispose };
}
