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
	let chosenInstanceId: ReturnType<typeof vi.fn>;
	let deps: CommandDeps;

	beforeEach(() => {
		vi.clearAllMocks();
		// Reset the singleton store to a known state for each test.
		connectionStore.set({ kind: "disconnected" });

		pluginMock = new PluginMock();
		plugin = asPlugin(pluginMock);
		connection = { forceReconnect: vi.fn(async () => {}) };
		showChatWindow = vi.fn(async () => {});
		chosenInstanceId = vi.fn<() => string | null>(() => null);
		deps = {
			connection,
			showChatWindow,
			chosenInstanceId,
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
		it("with chosenInstanceId set: calls connection.forceReconnect()", async () => {
			chosenInstanceId.mockReturnValue("some-id");
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

		it("with chosenInstanceId set while Connected/Reconnecting: still calls forceReconnect", async () => {
			chosenInstanceId.mockReturnValue("some-id");
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

		it("with chosenInstanceId=null: shows Notice with PRD F6/AC5 message and does NOT call forceReconnect", async () => {
			chosenInstanceId.mockReturnValue(null);
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
