/**
 * Opener for the Garden-Audit Editor view (spec-005 Phase 3, T3.2).
 *
 * Mirrors `src/ui/suggestions-view/openSuggestionsEditor.ts`'s reveal-
 * existing-or-create shape exactly, over `VIEW_TYPE_GARDEN_AUDIT_EDITOR`:
 * re-invoking the open command while an editor leaf is already open
 * retargets that leaf to the newly resolved `docPath` instead of opening a
 * second one ("one active doc", same convention as the Suggestions Editor).
 */

import type { App } from "obsidian";

import { VIEW_TYPE_GARDEN_AUDIT_EDITOR } from "./index.js";

export async function openGardenAuditEditor(
	app: App,
	docPath: string,
): Promise<void> {
	const existing = app.workspace.getLeavesOfType(VIEW_TYPE_GARDEN_AUDIT_EDITOR);
	const leaf =
		existing[0] ??
		// "split"/"vertical" mirrors the Suggestions Editor — dockable beside
		// the note, not a sidebar utility leaf.
		app.workspace.getLeaf("split", "vertical");
	await leaf.setViewState({
		type: VIEW_TYPE_GARDEN_AUDIT_EDITOR,
		active: true,
		state: { docPath },
	});
	await app.workspace.revealLeaf(leaf);
}
