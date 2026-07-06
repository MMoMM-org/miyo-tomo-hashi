/**
 * Opener for the Suggestions Editor view (spec-004 Phase 4, T4.1).
 *
 * Mirrors `src/ui/chat-view/showChatWindow.ts`'s reveal-existing-or-create
 * shape, but WITH retargeting: SDD ADR-S1 designates "one active doc" for the
 * Suggestions Editor, so re-invoking the open command while an editor leaf is
 * already open switches that leaf to the newly resolved `docPath` (via
 * `SuggestionsEditorView.setState`) instead of opening a second leaf.
 *
 * Spec refs: spec-004 SDD §3 (ADR-S1); PRD F1; plan/phase-4.md T4.1.
 */

import type { App } from "obsidian";

import { VIEW_TYPE_SUGGESTIONS_EDITOR } from "./index.js";

export async function openSuggestionsEditor(
	app: App,
	docPath: string,
): Promise<void> {
	const existing = app.workspace.getLeavesOfType(VIEW_TYPE_SUGGESTIONS_EDITOR);
	const leaf =
		existing[0] ??
		// "split"/"vertical" per SDD §3 ("dockable beside the note") — a main-
		// area split, not a sidebar utility leaf (contrast with
		// TomoChatView's `getRightLeaf`).
		app.workspace.getLeaf("split", "vertical");
	await leaf.setViewState({
		type: VIEW_TYPE_SUGGESTIONS_EDITOR,
		active: true,
		state: { docPath },
	});
	await app.workspace.revealLeaf(leaf);
}
