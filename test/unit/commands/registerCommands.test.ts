/**
 * Unit tests for registerCommands — Phase-5 T5.1 command registry.
 *
 * Spec refs: spec 001-session-view phase-5 T5.1; PRD F6 (Reconnect command,
 * dynamic label, never opens picker), PRD F7 (Show chat window command);
 * SDD ADR-8 (Dynamic command label = removeCommand + addCommand on state
 * change) and "Implementation Examples / Dynamic Command Label".
 *
 * Drift fix logged in this commit (solution.md line ~594):
 *   `displayInstanceName.subscribe(...)` was a stale derived-store reference
 *   from earlier ADR revisions. ADR-4 v3 (2026-04-25) made
 *   `displayInstanceName` a plain function; subscription must be on
 *   `connectionStore` with the name computed inline.
 */

// Side-effect import so the obsidian mock module loads and its HTMLElement
// prototype shim is installed before tests instantiate input elements.
import "obsidian";
import { Notice, type Plugin } from "obsidian";
// `Plugin` from `obsidian` is `abstract` per the .d.ts, so it can't be
// `new`-ed at the type level. The mock module exports a concrete class with
// the same shape — import directly from the mock to construct test instances.
// `asPlugin()` widens the structural mock to the abstract `Plugin` once at
// the seam (same pattern as test/unit/commands/fileMenu.test.ts).
import { Plugin as PluginMock } from "../../__mocks__/obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	registerCommands,
	type CommandDeps,
} from "../../../src/commands/registerCommands";
import { connectionStore } from "../../../src/connection/connectionStore";
import type { TomoInstance } from "../../../src/connection/types";

function asPlugin(stub: PluginMock): Plugin {
	return stub as unknown as Plugin;
}

const RECONNECT_ID = "reconnect-to-tomo";
const SHOW_CHAT_ID = "show-chat-window";

function inst(overrides: Partial<TomoInstance> = {}): TomoInstance {
	return {
		containerId: "abcdef0123456789".padEnd(64, "0"),
		shortId: "abcdef012345",
		name: "test-instance",
		startedAt: new Date("2026-04-28T10:00:00Z"),
		image: "miyo/tomo:0.7.0",
		...overrides,
	};
}

interface ForceReconnectOnly {
	forceReconnect: ReturnType<typeof vi.fn>;
}

interface CommandSpec {
	id: string;
	name: string;
	callback?: () => unknown;
}

function commandsForId(plugin: Plugin, id: string): CommandSpec[] {
	const calls = vi.mocked(plugin.addCommand).mock.calls;
	return calls
		.map((call) => call[0] as CommandSpec)
		.filter((spec) => spec.id === id);
}

describe("registerCommands", () => {
	let pluginMock: PluginMock;
	let plugin: Plugin;
	let connection: ForceReconnectOnly;
	let showChatWindow: ReturnType<typeof vi.fn>;
	let getChosenInstanceName: ReturnType<typeof vi.fn>;
	let deps: CommandDeps;

	beforeEach(() => {
		vi.clearAllMocks();
		// Reset the singleton store to a known state for each test.
		connectionStore.set({ kind: "disconnected" });

		pluginMock = new PluginMock();
		plugin = asPlugin(pluginMock);
		connection = { forceReconnect: vi.fn(async () => {}) };
		showChatWindow = vi.fn(async () => {});
		getChosenInstanceName = vi.fn<() => string | null>(() => null);
		deps = {
			connection,
			showChatWindow,
			getChosenInstanceName,
		};
	});

	afterEach(() => {
		// Drop subscribers between tests so the singleton store doesn't
		// accumulate listeners across cases.
		connectionStore.set({ kind: "disconnected" });
	});

	describe("initial registration", () => {
		it("registers exactly two commands on init: Reconnect + Show chat window", () => {
			registerCommands(plugin, deps);

			expect(plugin.addCommand).toHaveBeenCalledTimes(2);
			const ids = vi
				.mocked(plugin.addCommand)
				.mock.calls.map((call) => (call[0] as CommandSpec).id);
			expect(ids).toContain(RECONNECT_ID);
			expect(ids).toContain(SHOW_CHAT_ID);
		});

		it("registers Show chat window with the verbatim PRD F7 label", () => {
			registerCommands(plugin, deps);

			const showCmds = commandsForId(plugin, SHOW_CHAT_ID);
			expect(showCmds).toHaveLength(1);
			expect(showCmds[0]?.name).toBe("Show chat window");
		});
	});

	describe("Reconnect label resolution", () => {
		it("Reconnect label is 'Reconnect to Tomo' when displayInstanceName is null", () => {
			// disconnected → displayInstanceName(state) === null
			connectionStore.set({ kind: "disconnected" });
			registerCommands(plugin, deps);

			const reconnectCmds = commandsForId(plugin, RECONNECT_ID);
			expect(reconnectCmds.at(-1)?.name).toBe("Reconnect to Tomo");
		});

		it("Reconnect label is 'Reconnect to <name>' when connected with a named instance", () => {
			registerCommands(plugin, deps);

			connectionStore.set({
				kind: "connected",
				instance: inst({ name: "tomo-a" }),
			});

			const reconnectCmds = commandsForId(plugin, RECONNECT_ID);
			expect(reconnectCmds.at(-1)?.name).toBe("Reconnect to tomo-a");
		});

		it("Reconnect label uses shortId when instance.name is null", () => {
			registerCommands(plugin, deps);

			connectionStore.set({
				kind: "connected",
				instance: inst({ name: null, shortId: "abc123def456" }),
			});

			const reconnectCmds = commandsForId(plugin, RECONNECT_ID);
			expect(reconnectCmds.at(-1)?.name).toBe("Reconnect to abc123def456");
		});
	});

	describe("dynamic relabel", () => {
		it("state change with a different display name triggers removeCommand + addCommand", () => {
			registerCommands(plugin, deps);

			connectionStore.set({
				kind: "connected",
				instance: inst({ name: "first" }),
			});
			connectionStore.set({
				kind: "connected",
				instance: inst({ name: "second", containerId: "x".repeat(64) }),
			});

			expect(plugin.removeCommand).toHaveBeenCalledWith(RECONNECT_ID);
			const reconnectCmds = commandsForId(plugin, RECONNECT_ID);
			expect(reconnectCmds.at(-1)?.name).toBe("Reconnect to second");
		});

		it("5 reconnecting-attempt updates with the same display name → removeCommand called exactly once total (review-fix M9)", () => {
			// During a transient disconnect, connectionStore fires once per
			// attempt: reconnecting{attempt:1} → reconnecting{attempt:2} → … →
			// reconnecting{attempt:5}. displayInstanceName(state) is the same
			// across all five (target.name doesn't change). Without the dedup
			// guard, we'd remove+add the command 5 times — Obsidian's command
			// index rebuilds on each call, and the user's palette flickers.
			registerCommands(plugin, deps);

			// Land in a known starting label so the dedup branch can be
			// exercised. (First subscribe-fire installs the disconnected
			// "Reconnect to Tomo" label.)
			connectionStore.set({
				kind: "connected",
				instance: inst({ name: "alpha" }),
			});
			const removeBefore = vi.mocked(plugin.removeCommand).mock.calls.length;
			const addBefore = vi.mocked(plugin.addCommand).mock.calls.length;

			// Burst: 5 reconnect-attempt updates, all carrying the same
			// `target.name = "alpha"`. The `connected → reconnecting` initial
			// transition is one removeCommand+addCommand pair (label unchanged
			// — dedup catches it). Subsequent attempt-only transitions must
			// also dedup.
			for (let attempt = 1; attempt <= 5; attempt++) {
				connectionStore.set({
					kind: "reconnecting",
					target: inst({ name: "alpha" }),
					attempt,
					nextDelayMs: 500 * 2 ** (attempt - 1),
				});
			}

			// All 5 carry the same display name as the prior state — dedup
			// guard short-circuits, so neither removeCommand nor addCommand
			// fired.
			expect(vi.mocked(plugin.removeCommand).mock.calls.length).toBe(
				removeBefore,
			);
			expect(vi.mocked(plugin.addCommand).mock.calls.length).toBe(addBefore);
		});

		it("state change with the same display name does NOT re-register (dedup)", () => {
			registerCommands(plugin, deps);
			const initial = commandsForId(plugin, RECONNECT_ID).length;

			// Same `kind` and same display name (null) — Store dedupes by Object.is,
			// so the listener won't even fire. We therefore go through a different
			// state and back to a same-named one to exercise the dedup branch.
			connectionStore.set({
				kind: "connected",
				instance: inst({ name: "alpha" }),
			});
			const afterFirstName =
				commandsForId(plugin, RECONNECT_ID).length;
			expect(afterFirstName).toBeGreaterThan(initial);

			// New state object, same display name → install() should early-return.
			const removeCallsBefore = vi.mocked(plugin.removeCommand).mock.calls
				.length;
			connectionStore.set({
				kind: "reconnecting",
				target: inst({ name: "alpha" }),
				attempt: 1,
				nextDelayMs: 1000,
			});
			const afterSameName = commandsForId(plugin, RECONNECT_ID).length;

			expect(afterSameName).toBe(afterFirstName);
			expect(vi.mocked(plugin.removeCommand).mock.calls.length).toBe(
				removeCallsBefore,
			);
		});
	});

	describe("Reconnect onInvoke", () => {
		it("with getChosenInstanceName set: calls connection.forceReconnect()", async () => {
			getChosenInstanceName.mockReturnValue("some-id");
			registerCommands(plugin, deps);

			const cmd = commandsForId(plugin, RECONNECT_ID).at(-1);
			expect(cmd).toBeDefined();
			cmd?.callback?.();
			// Flush microtasks so the awaited forceReconnect resolves before assertion.
			await Promise.resolve();
			await Promise.resolve();

			expect(connection.forceReconnect).toHaveBeenCalledTimes(1);
			expect(vi.mocked(Notice)).not.toHaveBeenCalled();
		});

		it("with getChosenInstanceName set while Connected/Reconnecting: still calls forceReconnect", async () => {
			getChosenInstanceName.mockReturnValue("some-id");
			registerCommands(plugin, deps);
			connectionStore.set({
				kind: "connected",
				instance: inst({ name: "live" }),
			});

			const cmd = commandsForId(plugin, RECONNECT_ID).at(-1);
			cmd?.callback?.();
			await Promise.resolve();
			await Promise.resolve();

			expect(connection.forceReconnect).toHaveBeenCalledTimes(1);
		});

		it("with getChosenInstanceName=null: shows Notice with PRD F6/AC5 message and does NOT call forceReconnect", async () => {
			getChosenInstanceName.mockReturnValue(null);
			registerCommands(plugin, deps);

			const cmd = commandsForId(plugin, RECONNECT_ID).at(-1);
			cmd?.callback?.();
			await Promise.resolve();

			expect(connection.forceReconnect).not.toHaveBeenCalled();
			expect(vi.mocked(Notice)).toHaveBeenCalledTimes(1);
			expect(vi.mocked(Notice)).toHaveBeenCalledWith(
				"No Tomo instance chosen — open Settings → Connect.",
			);
		});
	});

	describe("Show chat window invocation", () => {
		it("invoking 'Show chat window' calls the showChatWindow callback", () => {
			registerCommands(plugin, deps);

			const cmd = commandsForId(plugin, SHOW_CHAT_ID).at(-1);
			expect(cmd).toBeDefined();
			cmd?.callback?.();

			expect(showChatWindow).toHaveBeenCalledTimes(1);
		});
	});

	describe("plugin lifecycle", () => {
		it("subscribes to the connection store via plugin.register so it tears down on unload", () => {
			registerCommands(plugin, deps);

			// Exactly one plugin.register() — the subscription cleanup. Obsidian
			// tears down addCommand registrations automatically on unload.
			expect(plugin.register).toHaveBeenCalledTimes(1);
			const arg = vi.mocked(plugin.register).mock.calls[0]?.[0];
			expect(typeof arg).toBe("function");
		});
	});
});

// ---------------------------------------------------------------------------
// 002 spec — Execute instructions document command (T6.1)
// ---------------------------------------------------------------------------
//
// Spec refs: spec 002-instruction-executor phase-6 T6.1; PRD F1 (invocation
// rules); SDD "Directory Map / src/commands/registerCommands.ts" — extends
// 001's command registry with an instruction-executor command + file-menu
// entry without disturbing the 001 surface.

import {
	registerExecutorCommands,
	type ExecutorCommandDeps,
} from "../../../src/commands/registerCommands";
import type { Invocation } from "../../../src/executor/InstructionExecutor";
import { DEFAULT_SETTINGS } from "../../../src/types/index";
import type { PluginSettings } from "../../../src/types/index";
import { TFile } from "../../__mocks__/obsidian";

const EXECUTE_ID = "execute-instructions-document";
const EXECUTE_LABEL = "Execute instructions document";

interface ExecutorOnly {
	execute: ReturnType<typeof vi.fn>;
}

interface ExistsVault {
	exists: ReturnType<typeof vi.fn>;
}

function fakeTFile(path: string): TFile {
	const f = new TFile();
	f.path = path;
	const lastSlash = path.lastIndexOf("/");
	const fname = lastSlash === -1 ? path : path.slice(lastSlash + 1);
	f.name = fname;
	const dot = fname.lastIndexOf(".");
	if (dot === -1) {
		f.basename = fname;
		f.extension = "";
	} else {
		f.basename = fname.slice(0, dot);
		f.extension = fname.slice(dot + 1);
	}
	return f;
}

describe("registerExecutorCommands (002)", () => {
	let pluginMock: PluginMock;
	let plugin: Plugin;
	let executor: ExecutorOnly;
	let vault: ExistsVault;
	let settings: PluginSettings;
	let deps: ExecutorCommandDeps;

	beforeEach(() => {
		vi.clearAllMocks();
		pluginMock = new PluginMock();
		plugin = asPlugin(pluginMock);
		executor = { execute: vi.fn(async () => ({})) };
		vault = { exists: vi.fn(async () => false) };
		settings = { ...DEFAULT_SETTINGS, tomoInboxFolder: "inbox" };
		deps = {
			executor: executor as unknown as ExecutorCommandDeps["executor"],
			vault: vault as unknown as ExecutorCommandDeps["vault"],
			settings,
		};
	});

	describe("command registration", () => {
		it("registers the 'Execute instructions document' command", () => {
			registerExecutorCommands(plugin, deps);

			const cmds = commandsForId(plugin, EXECUTE_ID);
			expect(cmds).toHaveLength(1);
			expect(cmds[0]?.name).toBe(EXECUTE_LABEL);
		});
	});

	describe("invocation resolution", () => {
		it("active .md peer (sibling .json exists) → single-file invocation with .json path", async () => {
			pluginMock.app.workspace.getActiveFile = vi.fn<() => TFile | null>(
				() => fakeTFile("inbox/2026-04-22_inbox-review_instructions.md"),
			);
			vault.exists = vi.fn(async (path: string) =>
				path === "inbox/2026-04-22_inbox-review_instructions.json",
			);

			registerExecutorCommands(plugin, deps);
			const cmd = commandsForId(plugin, EXECUTE_ID).at(-1);
			cmd?.callback?.();
			await Promise.resolve();
			await Promise.resolve();

			expect(executor.execute).toHaveBeenCalledTimes(1);
			const arg = executor.execute.mock.calls[0]?.[0] as Invocation;
			expect(arg).toEqual({
				kind: "single-file",
				sourcePath: "inbox/2026-04-22_inbox-review_instructions.json",
			});
		});

		it("active _instructions.json → single-file invocation with that .json path", async () => {
			pluginMock.app.workspace.getActiveFile = vi.fn<() => TFile | null>(
				() => fakeTFile("inbox/2026-04-22_inbox-review_instructions.json"),
			);
			vault.exists = vi.fn(async () => true);

			registerExecutorCommands(plugin, deps);
			const cmd = commandsForId(plugin, EXECUTE_ID).at(-1);
			cmd?.callback?.();
			await Promise.resolve();
			await Promise.resolve();

			expect(executor.execute).toHaveBeenCalledTimes(1);
			expect(executor.execute.mock.calls[0]?.[0]).toEqual({
				kind: "single-file",
				sourcePath: "inbox/2026-04-22_inbox-review_instructions.json",
			});
		});

		it("active .md whose sibling .json does NOT exist → batch invocation", async () => {
			pluginMock.app.workspace.getActiveFile = vi.fn<() => TFile | null>(
				() => fakeTFile("notes/random.md"),
			);
			vault.exists = vi.fn(async () => false);

			registerExecutorCommands(plugin, deps);
			const cmd = commandsForId(plugin, EXECUTE_ID).at(-1);
			cmd?.callback?.();
			await Promise.resolve();
			await Promise.resolve();

			expect(executor.execute).toHaveBeenCalledWith({ kind: "batch" });
		});

		it("active non-md, non-json file → batch invocation", async () => {
			pluginMock.app.workspace.getActiveFile = vi.fn<() => TFile | null>(
				() => fakeTFile("attachments/diagram.png"),
			);

			registerExecutorCommands(plugin, deps);
			const cmd = commandsForId(plugin, EXECUTE_ID).at(-1);
			cmd?.callback?.();
			await Promise.resolve();
			await Promise.resolve();

			expect(executor.execute).toHaveBeenCalledWith({ kind: "batch" });
		});

		it("no active file → batch invocation", async () => {
			pluginMock.app.workspace.getActiveFile = vi.fn<() => TFile | null>(
				() => null,
			);

			registerExecutorCommands(plugin, deps);
			const cmd = commandsForId(plugin, EXECUTE_ID).at(-1);
			cmd?.callback?.();
			await Promise.resolve();
			await Promise.resolve();

			expect(executor.execute).toHaveBeenCalledWith({ kind: "batch" });
		});
	});

	describe("single-run lock NOT bypassed by command", () => {
		it("two rapid invocations BOTH dispatch to executor.execute (lock lives in executor)", async () => {
			pluginMock.app.workspace.getActiveFile = vi.fn<() => TFile | null>(
				() => null,
			);

			registerExecutorCommands(plugin, deps);
			const cmd = commandsForId(plugin, EXECUTE_ID).at(-1);
			expect(cmd).toBeDefined();
			// Two rapid clicks. The command must not cache / pre-empt — it
			// always dispatches; the executor's running flag decides.
			cmd?.callback?.();
			cmd?.callback?.();
			await Promise.resolve();
			await Promise.resolve();

			expect(executor.execute).toHaveBeenCalledTimes(2);
		});
	});
});

// ---------------------------------------------------------------------------
// 002 spec — registerExecutorFileMenu: peer-only context-menu entry (T6.1)
// ---------------------------------------------------------------------------

import {
	registerExecutorFileMenu,
	type ExecutorFileMenuDeps,
} from "../../../src/commands/fileMenu";
import { Menu, type TAbstractFile } from "obsidian";

const FILE_MENU_LABEL = "Execute instructions…";

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

function recoverExecutorFileMenuHandler(
	pluginMock: PluginMock,
): FileMenuHandler {
	// `workspace.on` is overloaded — use unknown[][] then narrow on event name.
	const calls = vi.mocked(pluginMock.app.workspace.on).mock.calls as unknown[][];
	// Multiple file-menu registrations may exist; the executor handler is the
	// last registered. Take the LAST file-menu call.
	const fileMenuCalls = calls.filter((args) => args[0] === "file-menu");
	const call = fileMenuCalls.at(-1);
	if (call === undefined) {
		throw new Error("registerExecutorFileMenu did not register a 'file-menu' handler");
	}
	return call[1] as FileMenuHandler;
}

function fakeAbstract(path: string): TAbstractFile {
	const lastSlash = path.lastIndexOf("/");
	const fname = lastSlash === -1 ? path : path.slice(lastSlash + 1);
	const dot = fname.lastIndexOf(".");
	const ext = dot === -1 ? "" : fname.slice(dot + 1);
	const basename = dot === -1 ? fname : fname.slice(0, dot);
	return {
		path,
		name: fname,
		basename,
		extension: ext,
	} as unknown as TAbstractFile;
}

describe("registerExecutorFileMenu (002)", () => {
	let pluginMock: PluginMock;
	let plugin: Plugin;
	let executor: ExecutorOnly;
	let vault: ExistsVault;
	let settings: PluginSettings;
	let deps: ExecutorFileMenuDeps;

	beforeEach(() => {
		vi.clearAllMocks();
		pluginMock = new PluginMock();
		plugin = asPlugin(pluginMock);
		executor = { execute: vi.fn(async () => ({})) };
		vault = { exists: vi.fn(async () => false) };
		settings = { ...DEFAULT_SETTINGS, tomoInboxFolder: "inbox" };
		deps = {
			executor: executor as unknown as ExecutorFileMenuDeps["executor"],
			vault: vault as unknown as ExecutorFileMenuDeps["vault"],
			settings,
		};
	});

	it("registers a file-menu handler", () => {
		registerExecutorFileMenu(plugin, deps);

		const calls = vi.mocked(pluginMock.app.workspace.on).mock.calls as unknown[][];
		const fileMenuCalls = calls.filter((args) => args[0] === "file-menu");
		expect(fileMenuCalls.length).toBeGreaterThanOrEqual(1);
	});

	it("injects 'Execute instructions…' on .md peer files (sibling .json exists)", async () => {
		vault.exists = vi.fn(async (path: string) =>
			path === "inbox/foo_instructions.json",
		);

		registerExecutorFileMenu(plugin, deps);
		const handler = recoverExecutorFileMenuHandler(pluginMock);
		const menu = new Menu() as MenuWithItems;
		handler(menu, fakeAbstract("inbox/foo_instructions.md"), "src");
		// addItem may register its callback async if the handler awaits a
		// vault.exists check — wait microtasks before asserting.
		await Promise.resolve();
		await Promise.resolve();

		expect(menu.items.length).toBeGreaterThanOrEqual(1);
		const titles = menu.items.map(
			(item) => item.setTitle.mock.calls[0]?.[0] as string,
		);
		expect(titles).toContain(FILE_MENU_LABEL);
	});

	it("does NOT inject the entry on .md files whose sibling .json does NOT exist", async () => {
		vault.exists = vi.fn(async () => false);

		registerExecutorFileMenu(plugin, deps);
		const handler = recoverExecutorFileMenuHandler(pluginMock);
		const menu = new Menu() as MenuWithItems;
		handler(menu, fakeAbstract("notes/random.md"), "src");
		await Promise.resolve();
		await Promise.resolve();

		const titles = menu.items.map(
			(item) => item.setTitle.mock.calls[0]?.[0] as string,
		);
		expect(titles).not.toContain(FILE_MENU_LABEL);
	});

	it("does NOT inject the entry on .json files (PRD F1 explicit rule)", async () => {
		// Even when the .json exists, right-clicking the JSON itself must NOT
		// surface the executor entry — the user does not normally interact
		// with the JSON directly.
		vault.exists = vi.fn(async () => true);

		registerExecutorFileMenu(plugin, deps);
		const handler = recoverExecutorFileMenuHandler(pluginMock);
		const menu = new Menu() as MenuWithItems;
		handler(menu, fakeAbstract("inbox/foo_instructions.json"), "src");
		await Promise.resolve();
		await Promise.resolve();

		const titles = menu.items.map(
			(item) => item.setTitle.mock.calls[0]?.[0] as string,
		);
		expect(titles).not.toContain(FILE_MENU_LABEL);
	});

	it("clicking the entry dispatches single-file invocation to executor.execute", async () => {
		vault.exists = vi.fn(async (path: string) =>
			path === "inbox/foo_instructions.json",
		);

		registerExecutorFileMenu(plugin, deps);
		const handler = recoverExecutorFileMenuHandler(pluginMock);
		const menu = new Menu() as MenuWithItems;
		handler(menu, fakeAbstract("inbox/foo_instructions.md"), "src");
		await Promise.resolve();
		await Promise.resolve();

		const item = menu.items.find(
			(i) => i.setTitle.mock.calls[0]?.[0] === FILE_MENU_LABEL,
		);
		expect(item).toBeDefined();
		const onClick = item!.onClick.mock.calls[0]?.[0] as
			| (() => Promise<void> | void)
			| undefined;
		expect(onClick).toBeDefined();
		await onClick!();

		expect(executor.execute).toHaveBeenCalledTimes(1);
		expect(executor.execute.mock.calls[0]?.[0]).toEqual({
			kind: "single-file",
			sourcePath: "inbox/foo_instructions.json",
		});
	});
});
