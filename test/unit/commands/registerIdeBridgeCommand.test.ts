/**
 * Unit tests for registerIdeBridgeCommand — Phase-4 T4.5 toggle command.
 *
 * Spec refs: spec 003-ide-bridge phase-4 T4.5; PRD F13 (AC: "IDE Bridge
 * started on :23027", "IDE Bridge stopped"). The Notice strings are verbatim —
 * tests assert string equality, so a paraphrase is a regression.
 *
 * The command is a pure toggle around a narrow `Pick<IdeBridge,…>` surface
 * plus a `getPort` fallback. The port for the "started" Notice is sourced from
 * `ideBridgeStore.get()` after start (listening/connected carry it); when the
 * post-start state has no port (stopped — shouldn't happen, but defensive) the
 * command falls back to `getPort()`.
 */

// Side-effect import so the obsidian mock module loads its HTMLElement shim
// before any test instantiates DOM elements.
import "obsidian";
import { Notice, type Plugin } from "obsidian";
import { Plugin as PluginMock } from "../../__mocks__/obsidian";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	registerIdeBridgeCommand,
	type IdeBridgeCommandDeps,
} from "../../../src/commands/registerCommands";
import { ideBridgeStore } from "../../../src/ide-bridge/ideBridgeStore";

function asPlugin(stub: PluginMock): Plugin {
	return stub as unknown as Plugin;
}

const TOGGLE_ID = "toggle-ide-bridge";
const TOGGLE_LABEL = "Toggle IDE bridge";

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

interface IdeBridgeStub {
	isRunning: ReturnType<typeof vi.fn>;
	start: ReturnType<typeof vi.fn>;
	stop: ReturnType<typeof vi.fn>;
}

describe("registerIdeBridgeCommand (003 / T4.5)", () => {
	let pluginMock: PluginMock;
	let plugin: Plugin;
	let ideBridge: IdeBridgeStub;
	let getPort: Mock<() => number>;
	let deps: IdeBridgeCommandDeps;

	beforeEach(() => {
		vi.clearAllMocks();
		ideBridgeStore.set({ kind: "stopped" });

		pluginMock = new PluginMock();
		plugin = asPlugin(pluginMock);
		ideBridge = {
			isRunning: vi.fn<() => boolean>(() => false),
			start: vi.fn(async () => {}),
			stop: vi.fn(async () => {}),
		};
		getPort = vi.fn<() => number>(() => 23027);
		deps = {
			ideBridge: ideBridge as unknown as IdeBridgeCommandDeps["ideBridge"],
			getPort,
		};
	});

	afterEach(() => {
		ideBridgeStore.set({ kind: "stopped" });
	});

	describe("command registration", () => {
		it("registers the toggle command with the verbatim id and sentence-case label", () => {
			registerIdeBridgeCommand(plugin, deps);

			const cmds = commandsForId(plugin, TOGGLE_ID);
			expect(cmds).toHaveLength(1);
			expect(cmds[0]?.name).toBe(TOGGLE_LABEL);
		});
	});

	describe("toggle: not running → start", () => {
		it("calls start() and shows the started Notice with the post-start listening port", async () => {
			ideBridge.isRunning.mockReturnValue(false);
			// start() transitions the store to listening{port}.
			ideBridge.start.mockImplementation(async () => {
				ideBridgeStore.set({ kind: "listening", port: 23027 });
			});
			registerIdeBridgeCommand(plugin, deps);

			const cmd = commandsForId(plugin, TOGGLE_ID).at(-1);
			expect(cmd).toBeDefined();
			cmd?.callback?.();
			await Promise.resolve();
			await Promise.resolve();

			expect(ideBridge.start).toHaveBeenCalledTimes(1);
			expect(ideBridge.stop).not.toHaveBeenCalled();
			expect(vi.mocked(Notice)).toHaveBeenCalledWith(
				"IDE Bridge started on :23027",
			);
		});

		it("sources the port from a connected post-start state", async () => {
			ideBridge.isRunning.mockReturnValue(false);
			ideBridge.start.mockImplementation(async () => {
				ideBridgeStore.set({ kind: "connected", port: 23055, clientCount: 1 });
			});
			registerIdeBridgeCommand(plugin, deps);

			const cmd = commandsForId(plugin, TOGGLE_ID).at(-1);
			cmd?.callback?.();
			await Promise.resolve();
			await Promise.resolve();

			expect(vi.mocked(Notice)).toHaveBeenCalledWith(
				"IDE Bridge started on :23055",
			);
		});

		it("falls back to getPort() when the post-start state carries no port", async () => {
			ideBridge.isRunning.mockReturnValue(false);
			getPort.mockReturnValue(23099);
			// start() leaves the store in stopped (no port available).
			ideBridge.start.mockImplementation(async () => {
				ideBridgeStore.set({ kind: "stopped" });
			});
			registerIdeBridgeCommand(plugin, deps);

			const cmd = commandsForId(plugin, TOGGLE_ID).at(-1);
			cmd?.callback?.();
			await Promise.resolve();
			await Promise.resolve();

			expect(getPort).toHaveBeenCalled();
			expect(vi.mocked(Notice)).toHaveBeenCalledWith(
				"IDE Bridge started on :23099",
			);
		});

		it("shows the error Notice when the post-start state is error", async () => {
			ideBridge.isRunning.mockReturnValue(false);
			ideBridge.start.mockImplementation(async () => {
				ideBridgeStore.set({ kind: "error", reason: "port 23027 in use" });
			});
			registerIdeBridgeCommand(plugin, deps);

			const cmd = commandsForId(plugin, TOGGLE_ID).at(-1);
			cmd?.callback?.();
			await Promise.resolve();
			await Promise.resolve();

			expect(vi.mocked(Notice)).toHaveBeenCalledWith(
				"IDE Bridge error: port 23027 in use",
			);
			expect(vi.mocked(Notice)).not.toHaveBeenCalledWith(
				expect.stringContaining("started"),
			);
		});
	});

	describe("toggle: running → stop", () => {
		it("calls stop() and shows the stopped Notice", async () => {
			ideBridge.isRunning.mockReturnValue(true);
			registerIdeBridgeCommand(plugin, deps);

			const cmd = commandsForId(plugin, TOGGLE_ID).at(-1);
			cmd?.callback?.();
			await Promise.resolve();
			await Promise.resolve();

			expect(ideBridge.stop).toHaveBeenCalledTimes(1);
			expect(ideBridge.start).not.toHaveBeenCalled();
			expect(vi.mocked(Notice)).toHaveBeenCalledWith("IDE Bridge stopped");
		});
	});
});
