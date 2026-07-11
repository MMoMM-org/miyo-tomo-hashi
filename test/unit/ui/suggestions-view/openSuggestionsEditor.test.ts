/**
 * openSuggestionsEditor — opener/retargeter for the Suggestions Editor view.
 *
 * Spec refs: spec-004 SDD §3 (ADR-S1); PRD F1; plan/phase-4.md T4.1.
 *
 * Behaviour under test:
 *  - No leaf of VIEW_TYPE_SUGGESTIONS_EDITOR exists → open a new vertical
 *    split leaf (`getLeaf("split", "vertical")`), setViewState with the
 *    resolved docPath, and reveal it.
 *  - One leaf already exists → retarget it via setViewState (ADR-S1 "one
 *    active doc") instead of opening a second leaf.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { App, WorkspaceLeaf } from "obsidian";

import { openSuggestionsEditor } from "../../../../src/ui/suggestions-view/openSuggestionsEditor";
import { VIEW_TYPE_SUGGESTIONS_EDITOR } from "../../../../src/ui/suggestions-view/index";

const DOC_PATH = "100 Inbox/2026-07-06_1115_suggestions.json";

describe("openSuggestionsEditor", () => {
	let app: App;

	beforeEach(() => {
		vi.clearAllMocks();
		app = new App();
	});

	it("creates a new vertical split leaf when no editor leaf exists", async () => {
		const newLeaf = new WorkspaceLeaf();
		vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
		vi.mocked(app.workspace.getLeaf).mockReturnValue(newLeaf);

		await openSuggestionsEditor(app, DOC_PATH);

		expect(app.workspace.getLeavesOfType).toHaveBeenCalledWith(
			VIEW_TYPE_SUGGESTIONS_EDITOR,
		);
		expect(app.workspace.getLeaf).toHaveBeenCalledWith("split", "vertical");
		expect(newLeaf.setViewState).toHaveBeenCalledWith({
			type: VIEW_TYPE_SUGGESTIONS_EDITOR,
			active: true,
			state: { docPath: DOC_PATH },
		});
		expect(app.workspace.revealLeaf).toHaveBeenCalledWith(newLeaf);
	});

	it("retargets an existing editor leaf instead of creating another", async () => {
		const existingLeaf = new WorkspaceLeaf();
		vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([existingLeaf]);

		await openSuggestionsEditor(app, DOC_PATH);

		expect(app.workspace.getLeaf).not.toHaveBeenCalled();
		expect(existingLeaf.setViewState).toHaveBeenCalledWith({
			type: VIEW_TYPE_SUGGESTIONS_EDITOR,
			active: true,
			state: { docPath: DOC_PATH },
		});
		expect(app.workspace.revealLeaf).toHaveBeenCalledWith(existingLeaf);
	});

	it("retargeting an existing leaf to a different docPath passes the new path", async () => {
		const existingLeaf = new WorkspaceLeaf();
		vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([existingLeaf]);

		const otherPath = "100 Inbox/2026-07-06_0949_suggestions.json";
		await openSuggestionsEditor(app, otherPath);

		expect(existingLeaf.setViewState).toHaveBeenCalledWith({
			type: VIEW_TYPE_SUGGESTIONS_EDITOR,
			active: true,
			state: { docPath: otherPath },
		});
	});
});
