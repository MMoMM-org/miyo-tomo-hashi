/**
 * Integration test for src/main.ts — Phase-5 T5.3 plugin entry point.
 *
 * Spec refs: spec 001-session-view phase-5 T5.3; PRD all features wired;
 * SDD "Building Block View / Components", ADR-6 (chat view singleton),
 * ADR-10 (plugin unload best-effort), FS2 (auto-reconnect on load).
 *
 * Approach: per ADR-5 v2, dockerode is mocked at the module boundary so the
 * autoReconnectIfRemembered path can short-circuit (no remembered id → no
 * Docker call). The TomoConnection prototype is spy-patched for the
 * `autoReconnectIfRemembered` and `dispose` methods so we can assert main.ts
 * invokes them at the right lifecycle points without driving a real Docker
 * round-trip. The obsidian mock is used as-is; `Plugin` is constructed with
 * `app?` only (the mock signature) — `this.manifest` is supplied by the mock
 * default.
 */

// Side-effect import so the obsidian mock loads its HTMLElement prototype
// shim before the plugin's onload exercises createDiv / createEl etc. via
// the StatusBarIcon mount.
import "obsidian";
import { App, WorkspaceLeaf, type PluginManifest } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// dockerode mock — minimal surface so listTomoInstances / inspectContainer
// in src/connection/docker.ts don't blow up if the auto-reconnect path is
// exercised. With chosenInstanceId=null (default settings) the path returns
// early before any docker call, but the constructor of Dockerode is invoked
// once the singleton client is created, so we still need the class.
interface DockerodeHandles {
	listContainers: Mock;
	inspect: Mock;
	attach: Mock;
	demuxStream: Mock;
	getContainer: Mock;
}

const dockerHandles: DockerodeHandles = {
	listContainers: vi.fn(async () => []),
	inspect: vi.fn(async () => null),
	attach: vi.fn(),
	demuxStream: vi.fn(),
	getContainer: vi.fn(),
};

vi.mock("dockerode", () => {
	class Dockerode {
		public modem = { demuxStream: dockerHandles.demuxStream };
		public listContainers = dockerHandles.listContainers;
		public getContainer = dockerHandles.getContainer;
		constructor(_options?: unknown) {
			// no-op
		}
	}
	return { default: Dockerode };
});

// Lazy-imports under test (after mocks are in place). main.ts pulls in
// TomoConnection which pulls in docker.ts which pulls in dockerode.
import { TomoConnection } from "../../src/connection/TomoConnection";
import TomoHashiPlugin from "../../src/main";
import { VIEW_TYPE_TOMO_CHAT } from "../../src/ui/chat-view/index";

describe("TomoHashiPlugin integration (T5.3)", () => {
	let plugin: TomoHashiPlugin;
	let autoReconnectSpy: ReturnType<typeof vi.spyOn>;
	let disposeSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		dockerHandles.getContainer.mockImplementation(() => ({
			inspect: dockerHandles.inspect,
			attach: dockerHandles.attach,
		}));
		// Spy on TomoConnection prototype so we don't actually touch dockerode.
		autoReconnectSpy = vi
			.spyOn(TomoConnection.prototype, "autoReconnectIfRemembered")
			.mockResolvedValue();
		disposeSpy = vi
			.spyOn(TomoConnection.prototype, "dispose")
			.mockResolvedValue();

		const app = new App();
		// Real obsidian.d.ts declares `Plugin` with a 2-arg constructor
		// `(app, manifest)`. The mock at `test/__mocks__/obsidian.ts` accepts
		// `(app?)` and ignores extra args, so passing the manifest at the
		// type-checking seam keeps tsc happy without changing the mock shape.
		const manifest: PluginManifest = {
			id: "miyo-tomo-hashi",
			name: "MiYo Tomo Hashi",
			version: "0.1.0",
			minAppVersion: "1.5.0",
			description: "",
			author: "",
		};
		plugin = new TomoHashiPlugin(app, manifest);
		// Mock loadData to return null (default settings — chosenInstanceId null).
		vi.mocked(plugin.loadData).mockResolvedValue(null);
	});

	afterEach(() => {
		autoReconnectSpy.mockRestore();
		disposeSpy.mockRestore();
	});

	describe("onload registrations", () => {
		it("registers the chat view via plugin.registerView", async () => {
			await plugin.onload();
			expect(plugin.registerView).toHaveBeenCalledTimes(1);
			expect(plugin.registerView).toHaveBeenCalledWith(
				VIEW_TYPE_TOMO_CHAT,
				expect.any(Function),
			);
		});

		it("registers the settings tab via plugin.addSettingTab", async () => {
			await plugin.onload();
			expect(plugin.addSettingTab).toHaveBeenCalledTimes(1);
		});

		it("creates a status bar item via plugin.addStatusBarItem", async () => {
			await plugin.onload();
			expect(plugin.addStatusBarItem).toHaveBeenCalledTimes(1);
		});

		it("registers a file-menu event listener via plugin.registerEvent", async () => {
			await plugin.onload();
			// registerEvent is called once by registerFileMenu — file-menu wiring.
			expect(plugin.registerEvent).toHaveBeenCalledTimes(1);
		});

		it("registers exactly two commands: reconnect-to-tomo and show-chat-window", async () => {
			await plugin.onload();
			const ids = vi
				.mocked(plugin.addCommand)
				.mock.calls.map((call) => (call[0] as { id: string }).id);
			// Reconnect may register multiple times if the store transitions before
			// the asserts run; collapse to a Set for semantic comparison.
			expect(new Set(ids)).toEqual(
				new Set(["reconnect-to-tomo", "show-chat-window"]),
			);
		});
	});

	describe("FS2 auto-reconnect on load", () => {
		it("calls TomoConnection.autoReconnectIfRemembered() during onload", async () => {
			await plugin.onload();
			// Flush any microtasks so the void-fired promise has a chance.
			await Promise.resolve();
			expect(autoReconnectSpy).toHaveBeenCalledTimes(1);
		});
	});

	describe("onunload teardown", () => {
		it("disposes the TomoConnection", async () => {
			await plugin.onload();
			plugin.onunload();
			expect(disposeSpy).toHaveBeenCalledTimes(1);
		});

		it("detaches every existing chat-view leaf", async () => {
			await plugin.onload();
			const leaf1 = new WorkspaceLeaf();
			const leaf2 = new WorkspaceLeaf();
			vi.mocked(plugin.app.workspace.getLeavesOfType).mockReturnValue([
				leaf1,
				leaf2,
			]);
			plugin.onunload();
			expect(plugin.app.workspace.getLeavesOfType).toHaveBeenCalledWith(
				VIEW_TYPE_TOMO_CHAT,
			);
			expect(leaf1.detach).toHaveBeenCalledTimes(1);
			expect(leaf2.detach).toHaveBeenCalledTimes(1);
		});

		it("returns gracefully when no chat-view leaves are open", async () => {
			await plugin.onload();
			vi.mocked(plugin.app.workspace.getLeavesOfType).mockReturnValue([]);
			expect(() => plugin.onunload()).not.toThrow();
		});
	});

	describe("double-onload guard", () => {
		it("throws a clear error when onload is invoked twice", async () => {
			await plugin.onload();
			await expect(plugin.onload()).rejects.toThrow(/already loaded/);
		});

		it("after onunload, a fresh onload is allowed again", async () => {
			await plugin.onload();
			plugin.onunload();
			await expect(plugin.onload()).resolves.toBeUndefined();
		});
	});
});
