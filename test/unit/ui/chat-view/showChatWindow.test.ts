/**
 * showChatWindow — singleton opener for the Tomo chat view.
 *
 * Spec refs: spec 001-session-view phase-5 T5.2; PRD F7; SDD ADR-6.
 *
 * Behaviour under test:
 *  - No leaf of VIEW_TYPE_TOMO_CHAT exists → create one in the right sidebar
 *    (`getRightLeaf(false).setViewState({ type, active: true })`) and reveal.
 *  - One leaf already exists → reveal it; do NOT create another.
 *  - Multiple leaves exist (user manually cloned) → reveal the first; leave
 *    the others in place (per ADR-6 trade-off — no auto-detach).
 *  - `getRightLeaf(false)` returns null (workspace not ready) → return
 *    gracefully without throwing or revealing anything.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { App, WorkspaceLeaf } from "obsidian";
import { showChatWindow } from "../../../../src/ui/chat-view/showChatWindow";
import { VIEW_TYPE_TOMO_CHAT } from "../../../../src/ui/chat-view/index";

describe("showChatWindow", () => {
	let app: App;

	beforeEach(() => {
		vi.clearAllMocks();
		app = new App();
	});

	it("creates a new leaf when none exists", async () => {
		const newLeaf = new WorkspaceLeaf();
		vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
		vi.mocked(app.workspace.getRightLeaf).mockReturnValue(newLeaf);

		await showChatWindow(app);

		expect(app.workspace.getLeavesOfType).toHaveBeenCalledWith(
			VIEW_TYPE_TOMO_CHAT,
		);
		expect(app.workspace.getRightLeaf).toHaveBeenCalledWith(false);
		expect(newLeaf.setViewState).toHaveBeenCalledWith({
			type: VIEW_TYPE_TOMO_CHAT,
			active: true,
		});
		expect(app.workspace.revealLeaf).toHaveBeenCalledWith(newLeaf);
	});

	it("reveals existing leaf when one exists; does NOT create another", async () => {
		const existingLeaf = new WorkspaceLeaf();
		vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([existingLeaf]);

		await showChatWindow(app);

		expect(app.workspace.getRightLeaf).not.toHaveBeenCalled();
		expect(existingLeaf.setViewState).not.toHaveBeenCalled();
		expect(app.workspace.revealLeaf).toHaveBeenCalledWith(existingLeaf);
	});

	it("reveals only the first when multiple leaves exist; leaves others in place", async () => {
		const first = new WorkspaceLeaf();
		const second = new WorkspaceLeaf();
		const third = new WorkspaceLeaf();
		vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([
			first,
			second,
			third,
		]);

		await showChatWindow(app);

		expect(app.workspace.revealLeaf).toHaveBeenCalledTimes(1);
		expect(app.workspace.revealLeaf).toHaveBeenCalledWith(first);
		expect(second.detach).not.toHaveBeenCalled();
		expect(third.detach).not.toHaveBeenCalled();
	});

	it("returns gracefully if getRightLeaf returns null (no workspace)", async () => {
		vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
		vi.mocked(app.workspace.getRightLeaf).mockReturnValue(null);

		await expect(showChatWindow(app)).resolves.toBeUndefined();
		expect(app.workspace.revealLeaf).not.toHaveBeenCalled();
	});
});
