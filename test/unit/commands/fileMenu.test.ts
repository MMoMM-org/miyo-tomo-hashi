/**
 * Unit tests for registerFileMenu — Phase-4 T4.4 file-menu @file prefill.
 *
 * Spec refs: spec 001-session-view phase-4 T4.4; PRD FS1 (all ACs);
 * SDD "Directory Map / src/commands/fileMenu.ts".
 *
 * The Menu mock from `test/__mocks__/obsidian.ts` (T1.5, extended in T4.2)
 * captures every item-builder it created in a per-instance `items` array so
 * tests can introspect the calls to setTitle / setIcon / onClick after the
 * file-menu handler has run.
 *
 * The handler signature follows Obsidian's workspace `file-menu` event:
 *   (menu: Menu, file: TAbstractFile, source: string) => void
 * — recovered from the `plugin.app.workspace.on` mock spy.
 */

// Side-effect import so the obsidian mock module loads and its HTMLElement
// prototype shim is installed before tests instantiate input elements.
import "obsidian";
import { Menu, type Plugin, type TAbstractFile } from "obsidian";
// `Plugin` from `obsidian` is `abstract` per the .d.ts, so it can't be
// `new`-ed at the type level. The mock module exports a concrete class with
// the same shape — import directly from the mock to construct test instances.
// `asPlugin()` widens the structural mock to the abstract `Plugin` once at
// the seam (same pattern as test/unit/ui/status-bar/StatusBarIcon.test.ts).
import { Plugin as PluginMock } from "../../__mocks__/obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	registerFileMenu,
	type FileMenuDeps,
} from "../../../src/commands/fileMenu";

function asPlugin(stub: PluginMock): Plugin {
	return stub as unknown as Plugin;
}

// The Obsidian file-menu event's third argument is `source: string`.
type FileMenuHandler = (
	menu: Menu,
	file: TAbstractFile,
	source: string,
) => void;

interface MenuItemSpy {
	setTitle: ReturnType<typeof vi.fn>;
	setIcon: ReturnType<typeof vi.fn>;
	setDisabled: ReturnType<typeof vi.fn>;
	onClick: ReturnType<typeof vi.fn>;
}

interface MenuWithItems extends Menu {
	items: MenuItemSpy[];
}

const ENTRY_LABEL = "Open Tomo chat with @file reference";

function fakeFile(path: string): TAbstractFile {
	return { path, name: path.split("/").pop() ?? path } as TAbstractFile;
}

function recoverHandler(plugin: PluginMock): FileMenuHandler {
	// `workspace.on` is an overloaded function in obsidian.d.ts (21 overloads).
	// `vi.mocked()` types `mock.calls` as the LAST overload's tuple, which
	// makes destructuring `[event]` collapse to the literal `'quit'`. Recover
	// the raw call list as `unknown[][]` and narrow ourselves once the event
	// name matches "file-menu" — at that point the second tuple slot is
	// statically the file-menu handler per Obsidian's typing.
	const calls = vi.mocked(plugin.app.workspace.on).mock.calls as unknown[][];
	const call = calls.find((args) => args[0] === "file-menu");
	if (call === undefined) {
		throw new Error("registerFileMenu did not register a 'file-menu' handler");
	}
	return call[1] as FileMenuHandler;
}

function driveMenu(
	plugin: PluginMock,
	file: TAbstractFile,
	source = "file-explorer-context-menu",
): MenuWithItems {
	const handler = recoverHandler(plugin);
	const menu = new Menu() as MenuWithItems;
	handler(menu, file, source);
	return menu;
}

function recoverOnClick(menu: MenuWithItems): () => Promise<void> | void {
	const item = menu.items[0];
	if (item === undefined) {
		throw new Error("expected menu to have at least one item");
	}
	const cb = item.onClick.mock.calls[0]?.[0] as
		| (() => Promise<void> | void)
		| undefined;
	if (cb === undefined) {
		throw new Error("expected onClick to have been registered");
	}
	return cb;
}

describe("registerFileMenu", () => {
	let plugin: PluginMock;
	let deps: FileMenuDeps;

	beforeEach(() => {
		vi.clearAllMocks();
		plugin = new PluginMock();
		deps = {
			getOpenChatInput: vi.fn<() => HTMLInputElement | null>(() => null),
			openChatViewAndPrefill: vi.fn<(text: string) => Promise<void>>(
				async () => {},
			),
		};
	});

	it("registers a 'file-menu' handler via plugin.registerEvent", () => {
		registerFileMenu(asPlugin(plugin), deps);

		expect(plugin.registerEvent).toHaveBeenCalledTimes(1);
		expect(plugin.app.workspace.on).toHaveBeenCalledTimes(1);
		const onMock = vi.mocked(plugin.app.workspace.on);
		const [event] = onMock.mock.calls[0] ?? [];
		expect(event).toBe("file-menu");
	});

	it("the registered handler accepts (menu, file, source) — Obsidian's signature", () => {
		registerFileMenu(asPlugin(plugin), deps);
		const handler = recoverHandler(plugin);
		// Function arity: handler may collapse unused params, but it must accept
		// at least the menu + file pair without throwing.
		expect(() => handler(new Menu(), fakeFile("a.md"), "src")).not.toThrow();
	});

	it("appends exactly one entry to the Menu", () => {
		registerFileMenu(asPlugin(plugin), deps);
		const menu = driveMenu(plugin, fakeFile("note.md"));
		expect(menu.addItem).toHaveBeenCalledTimes(1);
		expect(menu.items).toHaveLength(1);
	});

	it("entry uses the exact PRD label", () => {
		registerFileMenu(asPlugin(plugin), deps);
		const menu = driveMenu(plugin, fakeFile("note.md"));
		const item = menu.items[0];
		expect(item).toBeDefined();
		expect(item!.setTitle).toHaveBeenCalledWith(ENTRY_LABEL);
	});

	it("entry uses the 'message-square' icon", () => {
		registerFileMenu(asPlugin(plugin), deps);
		const menu = driveMenu(plugin, fakeFile("note.md"));
		const item = menu.items[0];
		expect(item).toBeDefined();
		expect(item!.setIcon).toHaveBeenCalledWith("message-square");
	});

	it("does not invoke deps during registration or menu construction", () => {
		registerFileMenu(asPlugin(plugin), deps);
		driveMenu(plugin, fakeFile("note.md"));
		expect(deps.getOpenChatInput).not.toHaveBeenCalled();
		expect(deps.openChatViewAndPrefill).not.toHaveBeenCalled();
	});

	it("clicking entry when chat input is open inserts '@<path> ' at caret", async () => {
		const input = document.createElement("input");
		input.value = "hello world";
		input.setSelectionRange(6, 6); // caret between "hello " and "world"
		document.body.appendChild(input);
		deps.getOpenChatInput = vi.fn<() => HTMLInputElement | null>(() => input);

		registerFileMenu(asPlugin(plugin), deps);
		const menu = driveMenu(plugin, fakeFile("path/to/file.md"));
		const onClick = recoverOnClick(menu);
		await onClick();

		expect(input.value).toBe("hello @path/to/file.md world");
		expect(document.activeElement).toBe(input);
		expect(deps.openChatViewAndPrefill).not.toHaveBeenCalled();

		input.remove();
	});

	it("clicking entry replaces the current selection with '@<path> '", async () => {
		const input = document.createElement("input");
		input.value = "abc XYZ def";
		input.setSelectionRange(4, 7); // selects "XYZ"
		document.body.appendChild(input);
		deps.getOpenChatInput = vi.fn<() => HTMLInputElement | null>(() => input);

		registerFileMenu(asPlugin(plugin), deps);
		const menu = driveMenu(plugin, fakeFile("path/to/file.md"));
		const onClick = recoverOnClick(menu);
		await onClick();

		expect(input.value).toBe("abc @path/to/file.md  def");

		input.remove();
	});

	it("caret moves to end of inserted text after insert", async () => {
		const input = document.createElement("input");
		input.value = "";
		input.setSelectionRange(0, 0);
		document.body.appendChild(input);
		deps.getOpenChatInput = vi.fn<() => HTMLInputElement | null>(() => input);

		registerFileMenu(asPlugin(plugin), deps);
		const menu = driveMenu(plugin, fakeFile("a.md"));
		const onClick = recoverOnClick(menu);
		await onClick();

		const expected = "@a.md ".length;
		expect(input.value).toBe("@a.md ");
		expect(input.selectionStart).toBe(expected);
		expect(input.selectionEnd).toBe(expected);

		input.remove();
	});

	it("clicking entry when chat view is closed calls openChatViewAndPrefill with prefill text", async () => {
		deps.getOpenChatInput = vi.fn<() => HTMLInputElement | null>(() => null);

		registerFileMenu(asPlugin(plugin), deps);
		const menu = driveMenu(plugin, fakeFile("path/to/file.md"));
		const onClick = recoverOnClick(menu);
		await onClick();

		expect(deps.openChatViewAndPrefill).toHaveBeenCalledTimes(1);
		expect(deps.openChatViewAndPrefill).toHaveBeenCalledWith(
			"@path/to/file.md ",
		);
	});

	it("disconnected state: openChatViewAndPrefill still receives the prefill text (caller decides connect-state UX)", async () => {
		// "Disconnected" is represented by the chat view being closed AND a
		// not-connected screen rendering on open. The fileMenu doesn't gate on
		// connection state — it only routes the prefill — so the test asserts
		// the contract: prefill always reaches openChatViewAndPrefill verbatim.
		deps.getOpenChatInput = vi.fn<() => HTMLInputElement | null>(() => null);

		registerFileMenu(asPlugin(plugin), deps);
		const menu = driveMenu(plugin, fakeFile("inbox/draft.md"));
		const onClick = recoverOnClick(menu);
		await onClick();

		expect(deps.openChatViewAndPrefill).toHaveBeenCalledWith(
			"@inbox/draft.md ",
		);
	});

	it("works for .md files", async () => {
		registerFileMenu(asPlugin(plugin), deps);
		const menu = driveMenu(plugin, fakeFile("notes/foo.md"));
		await recoverOnClick(menu)();
		expect(deps.openChatViewAndPrefill).toHaveBeenCalledWith("@notes/foo.md ");
	});

	it("works for .pdf files", async () => {
		registerFileMenu(asPlugin(plugin), deps);
		const menu = driveMenu(plugin, fakeFile("attachments/report.pdf"));
		await recoverOnClick(menu)();
		expect(deps.openChatViewAndPrefill).toHaveBeenCalledWith(
			"@attachments/report.pdf ",
		);
	});

	it("works for .png files", async () => {
		registerFileMenu(asPlugin(plugin), deps);
		const menu = driveMenu(plugin, fakeFile("assets/diagram.png"));
		await recoverOnClick(menu)();
		expect(deps.openChatViewAndPrefill).toHaveBeenCalledWith(
			"@assets/diagram.png ",
		);
	});

	it("works for files with spaces in the path", async () => {
		registerFileMenu(asPlugin(plugin), deps);
		const menu = driveMenu(plugin, fakeFile("Some Folder/My Note.md"));
		await recoverOnClick(menu)();
		expect(deps.openChatViewAndPrefill).toHaveBeenCalledWith(
			"@Some Folder/My Note.md ",
		);
	});

	it("works for files in deeply nested folders", async () => {
		registerFileMenu(asPlugin(plugin), deps);
		const menu = driveMenu(plugin, fakeFile("a/b/c/d/e/file.md"));
		await recoverOnClick(menu)();
		expect(deps.openChatViewAndPrefill).toHaveBeenCalledWith(
			"@a/b/c/d/e/file.md ",
		);
	});

	it("handles input with null selectionStart/End (treats as end-of-value)", async () => {
		const input = document.createElement("input");
		input.value = "tail";
		// Force selection accessors to return null — mirrors browsers when the
		// input has never been focused and has no caret. We can't actually set
		// them to null on jsdom HTMLInputElement, so we wrap them.
		Object.defineProperty(input, "selectionStart", {
			configurable: true,
			get: () => null,
		});
		Object.defineProperty(input, "selectionEnd", {
			configurable: true,
			get: () => null,
		});
		document.body.appendChild(input);
		deps.getOpenChatInput = vi.fn<() => HTMLInputElement | null>(() => input);

		registerFileMenu(asPlugin(plugin), deps);
		const menu = driveMenu(plugin, fakeFile("a.md"));
		const onClick = recoverOnClick(menu);
		await onClick();

		// With null selection, code falls back to value.length (end of value),
		// so insertion appends.
		expect(input.value).toBe("tail@a.md ");

		input.remove();
	});
});
