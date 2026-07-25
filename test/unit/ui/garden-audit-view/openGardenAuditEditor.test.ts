/**
 * openGardenAuditEditor — opener/retargeter for the Garden-Audit Editor view
 * (spec-005 Phase 3, T3.2). Mirrors openSuggestionsEditor.ts's reveal-
 * existing-or-split shape exactly, over VIEW_TYPE_GARDEN_AUDIT_EDITOR.
 *
 * Behaviour under test:
 *  - No leaf of VIEW_TYPE_GARDEN_AUDIT_EDITOR exists → open a new vertical
 *    split leaf, setViewState with the resolved docPath, and reveal it.
 *  - One leaf already exists → retarget it via setViewState instead of
 *    opening a second leaf ("one active doc").
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { App, WorkspaceLeaf } from "obsidian";

import { openGardenAuditEditor } from "../../../../src/ui/garden-audit-view/openGardenAuditEditor";
import { VIEW_TYPE_GARDEN_AUDIT_EDITOR } from "../../../../src/ui/garden-audit-view/index";

const DOC_PATH = "100 Inbox/run-editor-001_garden-audit.json";

describe("openGardenAuditEditor", () => {
	let app: App;

	beforeEach(() => {
		vi.clearAllMocks();
		app = new App();
	});

	it("creates a new vertical split leaf when no editor leaf exists", async () => {
		const newLeaf = new WorkspaceLeaf();
		vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
		vi.mocked(app.workspace.getLeaf).mockReturnValue(newLeaf);

		await openGardenAuditEditor(app, DOC_PATH);

		expect(app.workspace.getLeavesOfType).toHaveBeenCalledWith(
			VIEW_TYPE_GARDEN_AUDIT_EDITOR,
		);
		expect(app.workspace.getLeaf).toHaveBeenCalledWith("split", "vertical");
		expect(newLeaf.setViewState).toHaveBeenCalledWith({
			type: VIEW_TYPE_GARDEN_AUDIT_EDITOR,
			active: true,
			state: { docPath: DOC_PATH },
		});
		expect(app.workspace.revealLeaf).toHaveBeenCalledWith(newLeaf);
	});

	it("retargets an existing editor leaf instead of creating another", async () => {
		const existingLeaf = new WorkspaceLeaf();
		vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([existingLeaf]);

		await openGardenAuditEditor(app, DOC_PATH);

		expect(app.workspace.getLeaf).not.toHaveBeenCalled();
		expect(existingLeaf.setViewState).toHaveBeenCalledWith({
			type: VIEW_TYPE_GARDEN_AUDIT_EDITOR,
			active: true,
			state: { docPath: DOC_PATH },
		});
		expect(app.workspace.revealLeaf).toHaveBeenCalledWith(existingLeaf);
	});

	it("retargeting an existing leaf to a different docPath passes the new path", async () => {
		const existingLeaf = new WorkspaceLeaf();
		vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([existingLeaf]);

		const otherPath = "100 Inbox/run-editor-002_garden-audit.json";
		await openGardenAuditEditor(app, otherPath);

		expect(existingLeaf.setViewState).toHaveBeenCalledWith({
			type: VIEW_TYPE_GARDEN_AUDIT_EDITOR,
			active: true,
			state: { docPath: otherPath },
		});
	});
});
