/**
 * Singleton opener for the Tomo chat view.
 *
 * Reveals the existing chat leaf if one already exists in the workspace;
 * otherwise creates a new leaf in the right sidebar and reveals it. When
 * multiple leaves of the chat type exist (e.g. the user manually cloned),
 * the first is revealed and the others are left in place — per ADR-6's
 * trade-off, no auto-detach is performed.
 *
 * Spec refs: spec 001-session-view phase-5 T5.2; PRD F7; SDD ADR-6.
 */

import type { App, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_TOMO_CHAT } from "./index";

export async function showChatWindow(app: App): Promise<void> {
	const existing: WorkspaceLeaf[] =
		app.workspace.getLeavesOfType(VIEW_TYPE_TOMO_CHAT);
	if (existing.length > 0) {
		const leaf = existing[0];
		if (leaf) await app.workspace.revealLeaf(leaf);
		return;
	}
	// Defensive: Obsidian's `getRightLeaf(false)` can return null when no
	// workspace exists yet. This is a user-triggered action (ribbon /
	// command), not load-time critical, so a graceful return is acceptable.
	const leaf = app.workspace.getRightLeaf(false);
	if (!leaf) return;
	await leaf.setViewState({ type: VIEW_TYPE_TOMO_CHAT, active: true });
	await app.workspace.revealLeaf(leaf);
}
