import { describe, it, expect, vi } from "vitest";
import * as obs from "../../__mocks__/obsidian";
import type { TFile } from "../../__mocks__/obsidian";

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

	it("Menu captures every item-builder in items[] for test introspection", () => {
		// T4.2 extension — lets popover tests assert on setTitle/onClick
		// calls without re-running the builder callback.
		const menu = new obs.Menu();
		menu.addItem(() => {});
		menu.addItem(() => {});
		expect(menu.items).toHaveLength(2);
		expect(typeof menu.items[0]?.setTitle).toBe("function");
	});

	it("Plugin.addStatusBarItem returns an HTMLElement", () => {
		// T4.2 extension — the real Obsidian API returns a status-bar
		// HTMLElement that supports the createSpan / addClass / setAttr
		// prototype helpers.
		const plugin = new obs.Plugin();
		const root = plugin.addStatusBarItem();
		expect(root).toBeInstanceOf(HTMLElement);
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

describe("002 surface (T1.5 mock extensions)", () => {
	// Modal shape is already covered by `exports Modal with open/close/contentEl/lifecycle`
	// in the parent describe; not duplicated here.

	it("vault.process is vi.fn returning Promise<void>", async () => {
		const app = new obs.App();
		const result = app.vault.process({} as TFile, (x: string) => x);
		expect(result).toBeInstanceOf(Promise);
		await expect(result).resolves.toBeUndefined();
		expect(vi.isMockFunction(app.vault.process)).toBe(true);
	});

	it("vault.trash is vi.fn returning Promise<void>", async () => {
		const app = new obs.App();
		const result = app.vault.trash({} as TFile, true);
		expect(result).toBeInstanceOf(Promise);
		await expect(result).resolves.toBeUndefined();
		expect(vi.isMockFunction(app.vault.trash)).toBe(true);
	});

	it("vault.createFolder is vi.fn returning Promise<void> (swallows already-exists)", async () => {
		const app = new obs.App();
		const result = app.vault.createFolder("some/path");
		expect(result).toBeInstanceOf(Promise);
		await expect(result).resolves.toBeUndefined();
		expect(vi.isMockFunction(app.vault.createFolder)).toBe(true);
	});

	it("fileManager.renameFile is vi.fn returning Promise<void>", async () => {
		const app = new obs.App();
		const result = app.fileManager.renameFile({} as TFile, "new/path.md");
		expect(result).toBeInstanceOf(Promise);
		await expect(result).resolves.toBeUndefined();
		expect(vi.isMockFunction(app.fileManager.renameFile)).toBe(true);
	});

	it("metadataCache.getFileCache returns { headings: [], sections: [] } by default", () => {
		const app = new obs.App();
		const cache = app.metadataCache.getFileCache({} as TFile);
		expect(cache).not.toBeNull();
		expect(cache).toMatchObject({ headings: [], sections: [] });
		expect(vi.isMockFunction(app.metadataCache.getFileCache)).toBe(true);
	});

	it("Plugin has registerEvent and addStatusBarItem as vi.fn", () => {
		const plugin = new obs.Plugin();
		expect(vi.isMockFunction(plugin.registerEvent)).toBe(true);
		expect(vi.isMockFunction(plugin.addStatusBarItem)).toBe(true);
	});
});
