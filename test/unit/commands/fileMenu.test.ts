/**
 * Unit tests for registerFileMenu — Phase-4 T4.4 file-menu @file injection.
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
	registerExecutorFileMenu,
	registerFileMenu,
	type ExecutorFileMenuDeps,
	type FileMenuDeps,
} from "../../../src/commands/fileMenu";
import { DEFAULT_SETTINGS } from "../../../src/types/index";
import type { Invocation } from "../../../src/executor/InstructionExecutor";

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
			openChatAndInject: vi.fn<(text: string) => Promise<void>>(
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
		expect(deps.openChatAndInject).not.toHaveBeenCalled();
	});

	it("clicking entry calls openChatAndInject with '@<path> '", async () => {
		registerFileMenu(asPlugin(plugin), deps);
		const menu = driveMenu(plugin, fakeFile("path/to/file.md"));
		const onClick = recoverOnClick(menu);
		await onClick();

		expect(deps.openChatAndInject).toHaveBeenCalledTimes(1);
		expect(deps.openChatAndInject).toHaveBeenCalledWith(
			"@path/to/file.md ",
		);
	});

	it("works for .md files", async () => {
		registerFileMenu(asPlugin(plugin), deps);
		const menu = driveMenu(plugin, fakeFile("notes/foo.md"));
		await recoverOnClick(menu)();
		expect(deps.openChatAndInject).toHaveBeenCalledWith("@notes/foo.md ");
	});

	it("works for .pdf files", async () => {
		registerFileMenu(asPlugin(plugin), deps);
		const menu = driveMenu(plugin, fakeFile("attachments/report.pdf"));
		await recoverOnClick(menu)();
		expect(deps.openChatAndInject).toHaveBeenCalledWith(
			"@attachments/report.pdf ",
		);
	});

	it("works for .png files", async () => {
		registerFileMenu(asPlugin(plugin), deps);
		const menu = driveMenu(plugin, fakeFile("assets/diagram.png"));
		await recoverOnClick(menu)();
		expect(deps.openChatAndInject).toHaveBeenCalledWith(
			"@assets/diagram.png ",
		);
	});

	it("works for files with spaces in the path", async () => {
		registerFileMenu(asPlugin(plugin), deps);
		const menu = driveMenu(plugin, fakeFile("Some Folder/My Note.md"));
		await recoverOnClick(menu)();
		expect(deps.openChatAndInject).toHaveBeenCalledWith(
			"@Some Folder/My Note.md ",
		);
	});

	it("works for files in deeply nested folders", async () => {
		registerFileMenu(asPlugin(plugin), deps);
		const menu = driveMenu(plugin, fakeFile("a/b/c/d/e/file.md"));
		await recoverOnClick(menu)();
		expect(deps.openChatAndInject).toHaveBeenCalledWith(
			"@a/b/c/d/e/file.md ",
		);
	});

	it("strips newline/carriage-return/NUL from file.path before injection (review-fix M3)", async () => {
		registerFileMenu(asPlugin(plugin), deps);
		const menu = driveMenu(
			plugin,
			fakeFile("foo\nrm -rf /\rcat\0eviction.md"),
		);
		await recoverOnClick(menu)();
		expect(deps.openChatAndInject).toHaveBeenCalledWith(
			"@foorm -rf /cateviction.md ",
		);
	});

	it("strip is targeted — does NOT touch tabs, ordinary punctuation, or spaces", async () => {
		registerFileMenu(asPlugin(plugin), deps);
		const menu = driveMenu(plugin, fakeFile("a/b\twith\ttabs.md"));
		await recoverOnClick(menu)();
		expect(deps.openChatAndInject).toHaveBeenCalledWith(
			"@a/b\twith\ttabs.md ",
		);
	});
});

// ---------------------------------------------------------------------------
// registerExecutorFileMenu — H6 (review/spec-002)
//
// Pre-fix: this entry was the only untested vault-mutation trigger in the
// codebase. Existing main.test.ts only asserted that registerEvent was
// called twice — never exercised the async sibling-lookup gating, the
// menu-item shape, or the executor.execute dispatch.
//
// Covers PRD F1 ACs:
//   - `.md` peer with sibling `<stem>.json`     → entry present
//   - `.md` with no sibling                     → entry absent
//   - `.json` file                              → entry absent
//   - any other extension                       → entry absent
//   - clicking entry → executor.execute({ kind: "single-file", sourcePath })
// ---------------------------------------------------------------------------

const EXEC_ENTRY_LABEL = "Execute instructions…";

type ExecutorFileMenuHandler = (
	menu: Menu,
	file: TAbstractFile,
	source: string,
) => void;

function recoverExecutorHandler(plugin: PluginMock): ExecutorFileMenuHandler {
	const calls = vi.mocked(plugin.app.workspace.on).mock.calls as unknown[][];
	const call = calls.find((args) => args[0] === "file-menu");
	if (call === undefined) {
		throw new Error(
			"registerExecutorFileMenu did not register a 'file-menu' handler",
		);
	}
	return call[1] as ExecutorFileMenuHandler;
}

async function driveExecutorMenu(
	plugin: PluginMock,
	file: TAbstractFile,
	source = "file-explorer-context-menu",
): Promise<MenuWithItems> {
	const handler = recoverExecutorHandler(plugin);
	const menu = new Menu() as MenuWithItems;
	handler(menu, file, source);
	// The executor handler does an async vault.exists check before
	// addItem — flush the microtask queue so the addItem call (if any)
	// has completed by the time the test asserts.
	await Promise.resolve();
	await Promise.resolve();
	return menu;
}

interface FakeExistsVault {
	exists: ReturnType<typeof vi.fn<(path: string) => Promise<boolean>>>;
}

function makeVault(present: ReadonlySet<string> = new Set()): FakeExistsVault {
	return {
		exists: vi.fn(async (path: string) => present.has(path)),
	};
}

function makeExecutorDeps(
	executeImpl: (inv: Invocation) => Promise<unknown> = async () => undefined,
	vaultPresent: ReadonlySet<string> = new Set(),
): { deps: ExecutorFileMenuDeps; execute: ReturnType<typeof vi.fn>; vault: FakeExistsVault } {
	const execute = vi.fn(executeImpl);
	const vault = makeVault(vaultPresent);
	return {
		execute,
		vault,
		deps: {
			executor: { execute } as ExecutorFileMenuDeps["executor"],
			vault: vault as ExecutorFileMenuDeps["vault"],
			settings: DEFAULT_SETTINGS,
		},
	};
}

describe("registerExecutorFileMenu (H6)", () => {
	let plugin: PluginMock;

	beforeEach(() => {
		vi.clearAllMocks();
		plugin = new PluginMock();
	});

	it("registers a 'file-menu' handler via plugin.registerEvent", () => {
		const { deps } = makeExecutorDeps();
		registerExecutorFileMenu(asPlugin(plugin), deps);
		expect(plugin.registerEvent).toHaveBeenCalledTimes(1);
		expect(plugin.app.workspace.on).toHaveBeenCalledWith(
			"file-menu",
			expect.any(Function),
		);
	});

	it(".md peer with existing .json sibling → entry added", async () => {
		const present = new Set(["folder/run_instructions.json"]);
		const { deps } = makeExecutorDeps(undefined, present);
		registerExecutorFileMenu(asPlugin(plugin), deps);

		const menu = await driveExecutorMenu(
			plugin,
			fakeFile("folder/run_instructions.md"),
		);

		expect(menu.items.length).toBe(1);
		expect(menu.items[0]?.setTitle).toHaveBeenCalledWith(EXEC_ENTRY_LABEL);
	});

	it(".md without a .json sibling → no entry", async () => {
		const { deps } = makeExecutorDeps(); // empty vault
		registerExecutorFileMenu(asPlugin(plugin), deps);

		const menu = await driveExecutorMenu(
			plugin,
			fakeFile("notes/just-a-note.md"),
		);

		expect(menu.items.length).toBe(0);
	});

	it(".json file → no entry (user does not interact with the JSON directly)", async () => {
		// Even if the .json exists, opening the file menu on the .json
		// itself must not surface the entry.
		const present = new Set(["folder/run_instructions.json"]);
		const { deps } = makeExecutorDeps(undefined, present);
		registerExecutorFileMenu(asPlugin(plugin), deps);

		const menu = await driveExecutorMenu(
			plugin,
			fakeFile("folder/run_instructions.json"),
		);

		expect(menu.items.length).toBe(0);
	});

	it("non-.md / non-.json extension → no entry", async () => {
		const { deps } = makeExecutorDeps();
		registerExecutorFileMenu(asPlugin(plugin), deps);

		const menu = await driveExecutorMenu(
			plugin,
			fakeFile("folder/notes.pdf"),
		);

		expect(menu.items.length).toBe(0);
	});

	it("clicking the entry calls executor.execute({kind:'single-file', sourcePath})", async () => {
		const present = new Set(["folder/run_instructions.json"]);
		const { deps, execute } = makeExecutorDeps(undefined, present);
		registerExecutorFileMenu(asPlugin(plugin), deps);

		const menu = await driveExecutorMenu(
			plugin,
			fakeFile("folder/run_instructions.md"),
		);
		expect(menu.items.length).toBe(1);

		const onClick = recoverOnClick(menu);
		await onClick();

		expect(execute).toHaveBeenCalledTimes(1);
		expect(execute).toHaveBeenCalledWith({
			kind: "single-file",
			sourcePath: "folder/run_instructions.json",
		});
	});

	it("does not invoke executor.execute during registration or menu construction", async () => {
		const present = new Set(["folder/run_instructions.json"]);
		const { deps, execute } = makeExecutorDeps(undefined, present);
		registerExecutorFileMenu(asPlugin(plugin), deps);

		await driveExecutorMenu(plugin, fakeFile("folder/run_instructions.md"));

		// Entry exists but no click yet — execute must not have been called.
		expect(execute).not.toHaveBeenCalled();
	});
});
