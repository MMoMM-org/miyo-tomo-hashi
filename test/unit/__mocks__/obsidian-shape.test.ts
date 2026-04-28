import { describe, it, expect, vi } from "vitest";
import * as obs from "../../__mocks__/obsidian";

describe("obsidian mock shape", () => {
	it("exports ItemView class", () => {
		expect(typeof obs.ItemView).toBe("function");
		const inst = new obs.ItemView(new obs.WorkspaceLeaf());
		expect(typeof inst.onOpen).toBe("function");
		expect(typeof inst.onClose).toBe("function");
		expect(inst.contentEl).toBeInstanceOf(HTMLElement);
	});

	it("exports WorkspaceLeaf with setViewState/view/detach", () => {
		const leaf = new obs.WorkspaceLeaf();
		expect(vi.isMockFunction(leaf.setViewState)).toBe(true);
		expect(vi.isMockFunction(leaf.detach)).toBe(true);
		expect("view" in leaf).toBe(true);
	});

	it("exports Menu with addItem + showAtMouseEvent", () => {
		const menu = new obs.Menu();
		const cb = vi.fn();
		menu.addItem(cb);
		expect(cb).toHaveBeenCalled();
		const firstCall = cb.mock.calls[0];
		expect(firstCall).toBeDefined();
		const item = firstCall![0];
		expect(typeof item.setTitle).toBe("function");
		expect(typeof item.setIcon).toBe("function");
		expect(typeof item.setDisabled).toBe("function");
		expect(typeof item.onClick).toBe("function");
		expect(vi.isMockFunction(menu.showAtMouseEvent)).toBe(true);
	});

	it("exports Modal with open/close/contentEl/lifecycle", () => {
		const modal = new obs.Modal(new obs.App());
		expect(vi.isMockFunction(modal.open)).toBe(true);
		expect(vi.isMockFunction(modal.close)).toBe(true);
		expect(modal.contentEl).toBeInstanceOf(HTMLElement);
		expect(typeof modal.onOpen).toBe("function");
		expect(typeof modal.onClose).toBe("function");
	});

	it("exports EventRef type/value", () => {
		expect("EventRef" in obs).toBe(true);
	});

	it("exports setIcon as vi.fn", () => {
		expect(vi.isMockFunction(obs.setIcon)).toBe(true);
	});

	it("Plugin has registerView/registerEvent/register/removeCommand", () => {
		const plugin = new obs.Plugin();
		expect(vi.isMockFunction(plugin.registerView)).toBe(true);
		expect(vi.isMockFunction(plugin.registerEvent)).toBe(true);
		expect(vi.isMockFunction(plugin.register)).toBe(true);
		expect(vi.isMockFunction(plugin.removeCommand)).toBe(true);
	});

	it("App.workspace exposes getLeavesOfType / getRightLeaf / getLeaf / revealLeaf / setActiveLeaf / on", () => {
		const app = new obs.App();
		expect(vi.isMockFunction(app.workspace.getLeavesOfType)).toBe(true);
		expect(vi.isMockFunction(app.workspace.getRightLeaf)).toBe(true);
		expect(vi.isMockFunction(app.workspace.getLeaf)).toBe(true);
		expect(vi.isMockFunction(app.workspace.revealLeaf)).toBe(true);
		expect(vi.isMockFunction(app.workspace.setActiveLeaf)).toBe(true);
		expect(vi.isMockFunction(app.workspace.on)).toBe(true);
	});
});
