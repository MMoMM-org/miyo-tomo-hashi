/**
 * Minimal `@codemirror/view` stub for unit testing.
 *
 * Production code (main.ts, T4.5) imports `{ EditorView }` only to call
 * `EditorView.updateListener.of(fn)` when registering a CM6 update listener for
 * IDE Bridge selection tracking. The real `@codemirror/view` is an
 * Obsidian-provided external (see esbuild.config.mjs externals) and pulling its
 * full browser-oriented module into jsdom is heavy and unnecessary — tests only
 * need `updateListener.of` to return a placeholder extension and capture the
 * listener function so the selection-set/doc-changed branch can be exercised.
 *
 * Aliased to `@codemirror/view` via vitest.config.ts.
 */

import { vi } from "vitest";

/** Shape of the update object CM6 hands the listener. Only the fields T4.5 reads. */
export interface ViewUpdateLike {
	selectionSet: boolean;
	docChanged: boolean;
}

/** Captures the registered update listener so tests can drive it directly. */
export const lastUpdateListener: { fn: ((update: ViewUpdateLike) => void) | null } = {
	fn: null,
};

export const EditorView = {
	updateListener: {
		of: vi.fn((fn: (update: ViewUpdateLike) => void) => {
			lastUpdateListener.fn = fn;
			// Real CM6 returns an Extension; tests only assert registration, so a
			// plain opaque object is sufficient.
			return { __mockEditorExtension: true } as const;
		}),
	},
};
