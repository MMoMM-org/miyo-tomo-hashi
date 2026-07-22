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
import {
	App,
	Notice,
	TFile,
	WorkspaceLeaf,
	type PluginManifest,
} from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// dockerode mock — minimal surface so listTomoInstances / inspectContainer
// in src/connection/docker.ts don't blow up if the auto-reconnect path is
// exercised. With chosenInstanceName=null (default settings) the path returns
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
import {
	GardenAuditEditorView,
	VIEW_TYPE_GARDEN_AUDIT_EDITOR,
} from "../../src/ui/garden-audit-view/index";
import {
	SuggestionsEditorView,
	VIEW_TYPE_SUGGESTIONS_EDITOR,
} from "../../src/ui/suggestions-view/index";

const OPEN_SUGGESTIONS_EDITOR_ID = "open-suggestions-editor";

interface CommandSpec {
	id: string;
	callback?: () => unknown;
}

function findCommand(plugin: TomoHashiPlugin, id: string): CommandSpec | undefined {
	return vi
		.mocked(plugin.addCommand)
		.mock.calls.map((call) => call[0] as CommandSpec)
		.find((spec) => spec.id === id);
}

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
		// Mock loadData to return null (default settings — chosenInstanceName null).
		vi.mocked(plugin.loadData).mockResolvedValue(null);
	});

	afterEach(() => {
		autoReconnectSpy.mockRestore();
		disposeSpy.mockRestore();
	});

	describe("onload registrations", () => {
		it("registers the chat view via plugin.registerView", async () => {
			await plugin.onload();
			// 004's T4.1 registers a second view type (Suggestions Editor) — this
			// 001 integration test only asserts the 001 chat-view surface is wired.
			expect(plugin.registerView).toHaveBeenCalledWith(
				VIEW_TYPE_TOMO_CHAT,
				expect.any(Function),
			);
		});

		it("registers the settings tab via plugin.addSettingTab", async () => {
			await plugin.onload();
			expect(plugin.addSettingTab).toHaveBeenCalledTimes(1);
		});

		it("creates at least one status bar item via plugin.addStatusBarItem", async () => {
			await plugin.onload();
			// 001 mounts the connection-state icon; 002's T6.2 mounts a second
			// status-bar 橋 indicator. Both are independent status-bar items —
			// the integration test only asserts the 001 surface is wired.
			expect(plugin.addStatusBarItem).toHaveBeenCalled();
		});

		it("registers at least one file-menu event listener via plugin.registerEvent", async () => {
			await plugin.onload();
			// 001 registers one file-menu listener (@file prefill); 002's T6.2
			// registers a second one (Execute instructions… peer entry). The
			// 001 integration test only asserts that the 001 listener is wired.
			expect(plugin.registerEvent).toHaveBeenCalled();
		});

		it("registers the 001 commands reconnect-to-tomo and show-chat-window", async () => {
			await plugin.onload();
			const ids = vi
				.mocked(plugin.addCommand)
				.mock.calls.map((call) => (call[0] as { id: string }).id);
			// 002 wiring adds a third command (execute-instructions-document)
			// per T6.2 — the 001 integration test only asserts the 001
			// commands are present, not the absence of others.
			const idSet = new Set(ids);
			expect(idSet.has("reconnect-to-tomo")).toBe(true);
			expect(idSet.has("show-chat-window")).toBe(true);
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

	describe("Suggestions Editor registration (spec-004 T4.1)", () => {
		it("registers VIEW_TYPE_SUGGESTIONS_EDITOR via plugin.registerView with a factory producing a SuggestionsEditorView", async () => {
			await plugin.onload();

			const call = vi
				.mocked(plugin.registerView)
				.mock.calls.find(([type]) => type === VIEW_TYPE_SUGGESTIONS_EDITOR);
			expect(call).toBeDefined();

			const factory = call?.[1] as (leaf: WorkspaceLeaf) => unknown;
			const leaf = new WorkspaceLeaf();
			const view = factory(leaf);
			expect(view).toBeInstanceOf(SuggestionsEditorView);
		});

		it("registers the 'open-suggestions-editor' command", async () => {
			await plugin.onload();
			expect(findCommand(plugin, OPEN_SUGGESTIONS_EDITOR_ID)).toBeDefined();
		});
	});

	describe("Open suggestions editor command wiring (spec-004 T4.1)", () => {
		it("active _suggestions.json → opens a new split leaf with the resolved docPath", async () => {
			await plugin.onload();
			const docPath = "100 Inbox/2026-07-06_1115_suggestions.json";
			const activeFile = new TFile();
			activeFile.path = docPath;
			vi.mocked(plugin.app.workspace.getActiveFile).mockReturnValue(
				activeFile,
			);
			vi.mocked(plugin.app.workspace.getLeavesOfType).mockReturnValue([]);
			const newLeaf = new WorkspaceLeaf();
			vi.mocked(plugin.app.workspace.getLeaf).mockReturnValue(newLeaf);

			const cmd = findCommand(plugin, OPEN_SUGGESTIONS_EDITOR_ID);
			expect(cmd).toBeDefined();
			cmd?.callback?.();
			await Promise.resolve();
			await Promise.resolve();

			expect(newLeaf.setViewState).toHaveBeenCalledWith({
				type: VIEW_TYPE_SUGGESTIONS_EDITOR,
				active: true,
				state: { docPath },
			});
		});

		it("active file unrelated to suggestions → shows a Notice and does not open a leaf", async () => {
			await plugin.onload();
			const activeFile = new TFile();
			activeFile.path = "notes/random.md";
			vi.mocked(plugin.app.workspace.getActiveFile).mockReturnValue(
				activeFile,
			);

			const cmd = findCommand(plugin, OPEN_SUGGESTIONS_EDITOR_ID);
			cmd?.callback?.();
			await Promise.resolve();

			expect(vi.mocked(Notice)).toHaveBeenCalledWith(
				"No Tomo runs found — open a _suggestions.json or _garden-audit.json (or its .md) first",
			);
			expect(plugin.app.workspace.getLeaf).not.toHaveBeenCalled();
		});
	});

	describe("Garden-Audit Editor registration (spec-005 T3.3)", () => {
		it("registers VIEW_TYPE_GARDEN_AUDIT_EDITOR via plugin.registerView with a factory producing a GardenAuditEditorView", async () => {
			await plugin.onload();

			const call = vi
				.mocked(plugin.registerView)
				.mock.calls.find(([type]) => type === VIEW_TYPE_GARDEN_AUDIT_EDITOR);
			expect(call).toBeDefined();

			const factory = call?.[1] as (leaf: WorkspaceLeaf) => unknown;
			const leaf = new WorkspaceLeaf();
			const view = factory(leaf);
			expect(view).toBeInstanceOf(GardenAuditEditorView);
		});

		it("still registers VIEW_TYPE_SUGGESTIONS_EDITOR — the 005 addition does not displace 004's view (no regression)", async () => {
			await plugin.onload();

			const call = vi
				.mocked(plugin.registerView)
				.mock.calls.find(([type]) => type === VIEW_TYPE_SUGGESTIONS_EDITOR);
			expect(call).toBeDefined();
		});

		it("still registers the unified 'open-suggestions-editor' command (no regression)", async () => {
			await plugin.onload();
			expect(findCommand(plugin, OPEN_SUGGESTIONS_EDITOR_ID)).toBeDefined();
		});
	});

	describe("Open Tomo editor command — garden-audit dispatch (spec-005 T3.2/T3.3)", () => {
		it("active _garden-audit.json → opens a new split leaf with the resolved docPath", async () => {
			await plugin.onload();
			const docPath = "100 Inbox/run-editor-001_garden-audit.json";
			const activeFile = new TFile();
			activeFile.path = docPath;
			vi.mocked(plugin.app.workspace.getActiveFile).mockReturnValue(
				activeFile,
			);
			vi.mocked(plugin.app.workspace.getLeavesOfType).mockReturnValue([]);
			const newLeaf = new WorkspaceLeaf();
			vi.mocked(plugin.app.workspace.getLeaf).mockReturnValue(newLeaf);

			const cmd = findCommand(plugin, OPEN_SUGGESTIONS_EDITOR_ID);
			expect(cmd).toBeDefined();
			cmd?.callback?.();
			await Promise.resolve();
			await Promise.resolve();

			expect(newLeaf.setViewState).toHaveBeenCalledWith({
				type: VIEW_TYPE_GARDEN_AUDIT_EDITOR,
				active: true,
				state: { docPath },
			});
		});
	});
});
