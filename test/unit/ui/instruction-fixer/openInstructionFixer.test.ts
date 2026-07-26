/**
 * openInstructionFixer — opener/retargeter for the Instruction Fixer view
 * (spec-006 Phase 3, T3.1). Mirrors openGardenAuditEditor.ts's reveal-
 * existing-or-split shape exactly, over VIEW_TYPE_INSTRUCTION_FIXER.
 *
 * Behaviour under test:
 *  - No leaf of VIEW_TYPE_INSTRUCTION_FIXER exists → open a new vertical split
 *    leaf, setViewState with the resolved docPath, and reveal it.
 *  - One leaf already exists → retarget it via setViewState instead of opening
 *    a second one ("one active doc", PRD F1-AC5).
 */

import "obsidian";
import { App, WorkspaceLeaf } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VIEW_TYPE_INSTRUCTION_FIXER } from "../../../../src/ui/instruction-fixer/index";
import { openInstructionFixer } from "../../../../src/ui/instruction-fixer/openInstructionFixer";

const DOC_PATH = "100 Inbox/2026-07-20_1015_instructions.json";

describe("openInstructionFixer", () => {
	let app: App;

	beforeEach(() => {
		vi.clearAllMocks();
		app = new App();
	});

	it("creates a new vertical split leaf when no Fixer leaf exists", async () => {
		const newLeaf = new WorkspaceLeaf();
		vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
		vi.mocked(app.workspace.getLeaf).mockReturnValue(newLeaf);

		await openInstructionFixer(app, DOC_PATH);

		expect(app.workspace.getLeavesOfType).toHaveBeenCalledWith(VIEW_TYPE_INSTRUCTION_FIXER);
		expect(app.workspace.getLeaf).toHaveBeenCalledWith("split", "vertical");
		expect(newLeaf.setViewState).toHaveBeenCalledWith({
			type: VIEW_TYPE_INSTRUCTION_FIXER,
			active: true,
			state: { docPath: DOC_PATH },
		});
		expect(app.workspace.revealLeaf).toHaveBeenCalledWith(newLeaf);
	});

	it("retargets the existing Fixer leaf instead of creating a second one", async () => {
		const existingLeaf = new WorkspaceLeaf();
		vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([existingLeaf]);

		await openInstructionFixer(app, DOC_PATH);

		expect(app.workspace.getLeaf).not.toHaveBeenCalled();
		expect(existingLeaf.setViewState).toHaveBeenCalledWith({
			type: VIEW_TYPE_INSTRUCTION_FIXER,
			active: true,
			state: { docPath: DOC_PATH },
		});
		expect(app.workspace.revealLeaf).toHaveBeenCalledWith(existingLeaf);
	});

	it("retargeting to a different set passes the new docPath (one active doc)", async () => {
		const existingLeaf = new WorkspaceLeaf();
		vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([existingLeaf]);

		const otherPath = "100 Inbox/2026-07-21_0900_instructions.json";
		await openInstructionFixer(app, otherPath);

		expect(existingLeaf.setViewState).toHaveBeenCalledWith({
			type: VIEW_TYPE_INSTRUCTION_FIXER,
			active: true,
			state: { docPath: otherPath },
		});
	});
});
