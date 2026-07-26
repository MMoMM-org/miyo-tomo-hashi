/**
 * Opener for the Instruction Fixer view (spec-006 Phase 3, T3.1).
 *
 * Mirrors `src/ui/garden-audit-view/openGardenAuditEditor.ts`'s reveal-
 * existing-or-create shape exactly, over `VIEW_TYPE_INSTRUCTION_FIXER`:
 * re-invoking the opener while a Fixer leaf is already open retargets that leaf
 * to the newly resolved `docPath` instead of opening a second one ("one active
 * doc" — PRD F1-AC5, the same convention as the other Tomo editor surfaces).
 *
 * The command entry point that calls this is Phase 4 (T4.1); this module is
 * only the opener itself, so the apply-modal option and the command can share
 * it (SDD ADR-3).
 */

import type { App } from "obsidian";

import { VIEW_TYPE_INSTRUCTION_FIXER } from "./index.js";

export async function openInstructionFixer(app: App, docPath: string): Promise<void> {
	const existing = app.workspace.getLeavesOfType(VIEW_TYPE_INSTRUCTION_FIXER);
	const leaf =
		existing[0] ??
		// "split"/"vertical" mirrors the other Tomo editors — dockable beside
		// the note, not a sidebar utility leaf.
		app.workspace.getLeaf("split", "vertical");
	await leaf.setViewState({
		type: VIEW_TYPE_INSTRUCTION_FIXER,
		active: true,
		state: { docPath },
	});
	await app.workspace.revealLeaf(leaf);
}
