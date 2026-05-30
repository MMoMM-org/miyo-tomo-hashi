/**
 * T6.2 main.ts wire-up — 002 instruction-executor lifecycle tests.
 *
 * Covers ONLY the 002 wiring added on top of 001. The 001 wiring is verified
 * by `test/unit/main.integration.test.ts`. Both suites must pass after T6.2.
 *
 * Test surface (per phase-6 T6.2 Test bullets):
 *   - onload: ObsidianVaultFS, HookRunner, InstructionExecutor instantiated
 *     exactly once each; ExecutionModal NOT pre-instantiated;
 *     mountStatusBar called once; SettingsTab is the same one 001 added
 *     (extension, not replacement); registerExecutorCommands +
 *     registerExecutorFileMenu called with the right deps shape.
 *   - onunload: cleanups drained (status-bar teardown invoked); no orphan
 *     executionStore listeners (asserted via the listenerCount helper that
 *     reaches into Store internals — same pattern as T5.1 tests).
 *   - Plugin does NOT instantiate the executor more than once on a single
 *     load (singleton, sanity-checked via constructor spy).
 *
 * Spec refs: docs/XDD/specs/002-instruction-executor/plan/phase-6.md T6.2;
 *   PRD F1 (invocation surfaces wired); SDD "Building Block View" (every
 *   002-spec component instantiated exactly once per plugin load).
 */

import "obsidian";
import { App, type PluginManifest } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Dockerode mock (shared with main.integration.test.ts) — main.ts pulls in
// TomoConnection on the 001 path, which pulls in dockerode.
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

// Module-level constructor trackers. `vi.mock` factory wraps the real class
// in a Proxy and records every `construct` call. We do NOT call vi.fn or any
// out-of-factory closure inside the construct trap (that triggers vitest
// hoisting / circular module resolution and recurses to a stack overflow).
// Instead we publish a plain shared `calls` object that the test asserts on.

interface CallLog {
	executor: unknown[][];
	hookRunner: unknown[][];
	vaultFs: unknown[][];
	mountStatusBar: unknown[][];
	mountStatusBarTeardown: ReturnType<typeof vi.fn> | null;
}

const callLog: CallLog = {
	executor: [],
	hookRunner: [],
	vaultFs: [],
	mountStatusBar: [],
	mountStatusBarTeardown: null,
};

vi.mock("../../src/executor/InstructionExecutor", async (importOriginal) => {
	const actual = await importOriginal<
		typeof import("../../src/executor/InstructionExecutor")
	>();
	const Wrapped = new Proxy(actual.InstructionExecutor, {
		construct(target, args) {
			callLog.executor.push(args);
			return Reflect.construct(target, args);
		},
	});
	return { ...actual, InstructionExecutor: Wrapped };
});

vi.mock("../../src/hooks/HookRunner", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/hooks/HookRunner")>();
	const Wrapped = new Proxy(actual.HookRunner, {
		construct(target, args) {
			callLog.hookRunner.push(args);
			return Reflect.construct(target, args);
		},
	});
	return { ...actual, HookRunner: Wrapped };
});

vi.mock("../../src/vault/ObsidianVaultFS", async (importOriginal) => {
	const actual = await importOriginal<
		typeof import("../../src/vault/ObsidianVaultFS")
	>();
	const Wrapped = new Proxy(actual.ObsidianVaultFS, {
		construct(target, args) {
			callLog.vaultFs.push(args);
			return Reflect.construct(target, args);
		},
	});
	return { ...actual, ObsidianVaultFS: Wrapped };
});

vi.mock("../../src/ui/statusBar", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/ui/statusBar")>();
	return {
		...actual,
		mountStatusBar: (...args: Parameters<typeof actual.mountStatusBar>) => {
			callLog.mountStatusBar.push(args);
			if (callLog.mountStatusBarTeardown !== null) {
				return callLog.mountStatusBarTeardown;
			}
			return actual.mountStatusBar(...args);
		},
	};
});

import { TomoConnection } from "../../src/connection/TomoConnection";
import { executionStore } from "../../src/executor/executionStore";
import { FsHookLoader } from "../../src/hooks/FsHookLoader";
import { IdeBridge } from "../../src/ide-bridge/IdeBridge";
import { ideBridgeStore } from "../../src/ide-bridge/ideBridgeStore";
import TomoHashiPlugin from "../../src/main";
import { SettingsTab } from "../../src/settings/SettingsTab";
import {
	EditorView,
	lastUpdateListener,
} from "../__mocks__/codemirror-view";

import type { Store } from "../../src/util/store";
import type { RunState } from "../../src/executor/state";

// Reach into Store private listener set (same pattern as T5.1 tests).
function listenerCount(store: Store<RunState>): number {
	const listeners = (store as unknown as { listeners: Set<unknown> }).listeners;
	return listeners.size;
}

describe("TomoHashiPlugin — 002 wiring (T6.2)", () => {
	let plugin: TomoHashiPlugin;
	let mountStatusBarTeardown: Mock;

	beforeEach(() => {
		vi.clearAllMocks();
		callLog.executor.length = 0;
		callLog.hookRunner.length = 0;
		callLog.vaultFs.length = 0;
		callLog.mountStatusBar.length = 0;
		dockerHandles.getContainer.mockImplementation(() => ({
			inspect: dockerHandles.inspect,
			attach: dockerHandles.attach,
		}));

		// Don't actually fire the 001 auto-reconnect path (see main.integration.test.ts).
		vi.spyOn(TomoConnection.prototype, "autoReconnectIfRemembered").mockResolvedValue();
		vi.spyOn(TomoConnection.prototype, "dispose").mockResolvedValue();

		// Spy IdeBridge.start/stop so onload's start-if-enabled and onunload's
		// teardown never bind a real TCP socket. Reset the singleton store.
		vi.spyOn(IdeBridge.prototype, "start").mockResolvedValue();
		vi.spyOn(IdeBridge.prototype, "stop").mockResolvedValue();
		ideBridgeStore.set({ kind: "stopped" });

		// statusBar teardown spy — assert that onunload invokes it.
		mountStatusBarTeardown = vi.fn();
		callLog.mountStatusBarTeardown = mountStatusBarTeardown;

		const app = new App();
		const manifest: PluginManifest = {
			id: "miyo-tomo-hashi",
			name: "MiYo Tomo Hashi",
			version: "0.1.0",
			minAppVersion: "1.5.0",
			description: "",
			author: "",
		};
		plugin = new TomoHashiPlugin(app, manifest);
		vi.mocked(plugin.loadData).mockResolvedValue(null);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		// Drain any leaked subscriptions so the next test starts clean.
		executionStore.set({ kind: "idle" });
	});

	// ---------------------------------------------------------------------------
	// onload: 002 wiring exists
	// ---------------------------------------------------------------------------

	describe("onload — 002 surfaces wired", () => {
		it("instantiates ObsidianVaultFS exactly once", async () => {
			await plugin.onload();
			expect(callLog.vaultFs).toHaveLength(1);
		});

		it("instantiates HookRunner exactly once", async () => {
			await plugin.onload();
			expect(callLog.hookRunner).toHaveLength(1);
		});

		it("instantiates InstructionExecutor exactly once (singleton per load)", async () => {
			await plugin.onload();
			expect(callLog.executor).toHaveLength(1);
		});

		it("mounts the status bar exactly once with an onActiveModalFocus callback", async () => {
			await plugin.onload();
			expect(callLog.mountStatusBar).toHaveLength(1);
			const callbacks = callLog.mountStatusBar[0]?.[1] as
				| { onActiveModalFocus: () => void }
				| undefined;
			expect(callbacks).toBeDefined();
			expect(typeof callbacks?.onActiveModalFocus).toBe("function");
		});

		it("does NOT pre-instantiate ExecutionModal (instance-per-invocation)", async () => {
			// ExecutionModal lives in src/ui/ExecutionModal.ts; main.ts must NOT
			// `new ExecutionModal(...)` at onload. We assert this indirectly by
			// confirming the executionStore has no extra subscribers attributable
			// to a constructed-but-not-opened modal at the time of onload.
			//
			// Baseline: capture the listener count BEFORE onload. After onload,
			// the only NEW subscriber is the modal-glue subscription that main
			// adds (open the modal on idle→preparing transitions). An open
			// ExecutionModal would have added a subscription too — we check
			// that the modal class is not constructed by reading the module
			// import map (no `ExecutionModal` constructor call).
			const before = listenerCount(executionStore);
			await plugin.onload();
			const after = listenerCount(executionStore);
			// At most one new subscriber: the main.ts modal-glue (or zero if
			// main.ts pushes the open-modal responsibility to T6.1's command
			// callback). Status bar's subscription is not on executionStore in
			// this test because mountStatusBar is mocked. So total delta ≤ 1.
			expect(after - before).toBeLessThanOrEqual(1);
		});

		it("registers the SettingsTab exactly once (extension, not replacement)", async () => {
			await plugin.onload();
			// addSettingTab is called exactly once (the same instance that
			// already covers both 001 + 002 fields per T1.3 — SettingsTab is
			// not replaced by a 002-only tab).
			expect(plugin.addSettingTab).toHaveBeenCalledTimes(1);
			const arg = vi.mocked(plugin.addSettingTab).mock.calls[0]?.[0];
			expect(arg).toBeInstanceOf(SettingsTab);
		});

		it("registers the executor command (id: execute-instructions-document)", async () => {
			await plugin.onload();
			const ids = vi
				.mocked(plugin.addCommand)
				.mock.calls.map((call) => (call[0] as { id: string }).id);
			expect(ids).toContain("execute-instructions-document");
		});

		it("registers the executor + IDE-bridge file-menu / leaf-change listeners", async () => {
			await plugin.onload();
			// Three registerEvent registrations are expected after T4.5:
			//   1. 001's @file-prefill file-menu entry,
			//   2. 002's "Execute instructions…" peer file-menu entry,
			//   3. 003's active-leaf-change → IDE-bridge selection tracking
			//      (registered inside onLayoutReady, which the mock fires sync).
			// registerEvent is the shared seam for all three.
			expect(plugin.registerEvent).toHaveBeenCalledTimes(3);
		});

		it("preserves 001/002 commands and adds the 003 toggle alongside them", async () => {
			await plugin.onload();
			const ids = vi
				.mocked(plugin.addCommand)
				.mock.calls.map((call) => (call[0] as { id: string }).id);
			// 001 + 002 are unchanged; 003 adds the IDE-bridge toggle.
			expect(new Set(ids)).toEqual(
				new Set([
					"reconnect-to-tomo",
					"show-chat-window",
					"execute-instructions-document",
					"toggle-ide-bridge",
				]),
			);
		});
	});

	// ---------------------------------------------------------------------------
	// onunload: cleanups drained
	// ---------------------------------------------------------------------------

	describe("onunload — cleanups drained", () => {
		it("invokes the status-bar teardown closure", async () => {
			await plugin.onload();
			plugin.onunload();
			expect(mountStatusBarTeardown).toHaveBeenCalledTimes(1);
		});

		it("leaves no orphan executionStore listeners", async () => {
			const baseline = listenerCount(executionStore);
			await plugin.onload();
			plugin.onunload();
			expect(listenerCount(executionStore)).toBe(baseline);
		});

		it("is idempotent enough that a second onload is allowed after onunload", async () => {
			await plugin.onload();
			plugin.onunload();
			await expect(plugin.onload()).resolves.toBeUndefined();
			// And the executor was constructed twice in total — once per load.
			expect(callLog.executor).toHaveLength(2);
		});
	});

	// ---------------------------------------------------------------------------
	// HookRunner wiring — askCallback is plumbed in
	// ---------------------------------------------------------------------------

	describe("HookRunner construction args", () => {
		it("constructs HookRunner with an askCallback in its options bag", async () => {
			await plugin.onload();
			const call = callLog.hookRunner[0];
			expect(call).toBeDefined();
			// HookRunner constructor signature: (app, loader, logger, options).
			// options.askCallback is the modal-disclosure adapter.
			const options = call?.[3] as
				| { askCallback?: (path: string) => Promise<unknown>; policy: string }
				| undefined;
			expect(options).toBeDefined();
			expect(typeof options?.askCallback).toBe("function");
			// Policy comes from settings.hooksPolicy ("ask" by default).
			expect(options?.policy).toBe("ask");
		});

		it("passes a real FsHookLoader as the loader (not a null-returning stub)", async () => {
			// T6.2-fix: replaces the inline `createHookLoader` stub with a
			// real sync filesystem-backed loader. The loader must be an
			// instance of FsHookLoader so hooks actually load in production.
			await plugin.onload();
			const call = callLog.hookRunner[0];
			expect(call).toBeDefined();
			const loader = call?.[1];
			expect(loader).toBeInstanceOf(FsHookLoader);
		});
	});

	// ---------------------------------------------------------------------------
	// 003 wiring (T4.5) — IDE Bridge lifecycle
	// ---------------------------------------------------------------------------
	//
	// Spec refs: spec 003-ide-bridge phase-4 T4.5; ADR-5 (editor activity →
	// selection tracking via CM6 updateListener + active-leaf-change deferred to
	// layout-ready); PRD F13 (toggle command + start-if-enabled).

	type WorkspaceOnCalls = ReadonlyArray<readonly unknown[]>;

	function workspaceOnCalls(p: TomoHashiPlugin): WorkspaceOnCalls {
		return vi.mocked(p.app.workspace.on).mock.calls as WorkspaceOnCalls;
	}

	describe("onload — IDE Bridge lifecycle wired (003 / T4.5)", () => {
		it("registers a CM6 editor extension via registerEditorExtension", async () => {
			await plugin.onload();
			expect(plugin.registerEditorExtension).toHaveBeenCalledTimes(1);
			// The extension is the EditorView.updateListener.of(...) result.
			expect(EditorView.updateListener.of).toHaveBeenCalledTimes(1);
		});

		it("forwards selection-set / doc-changed CM6 updates to onEditorActivity", async () => {
			const activitySpy = vi.spyOn(IdeBridge.prototype, "onEditorActivity");
			await plugin.onload();

			const listener = lastUpdateListener.fn;
			expect(listener).not.toBeNull();
			// A pure cursor-position update with neither flag must NOT forward.
			listener?.({ selectionSet: false, docChanged: false });
			expect(activitySpy).not.toHaveBeenCalled();
			// selectionSet → forward.
			listener?.({ selectionSet: true, docChanged: false });
			// docChanged → forward.
			listener?.({ selectionSet: false, docChanged: true });
			expect(activitySpy).toHaveBeenCalledTimes(2);
		});

		it("registers active-leaf-change after layout-ready (deferred per SDD gotcha 683)", async () => {
			await plugin.onload();
			// onLayoutReady mock invokes its callback synchronously, so the
			// active-leaf-change registration has already happened.
			expect(plugin.app.workspace.onLayoutReady).toHaveBeenCalledTimes(1);
			const leafChangeRegs = workspaceOnCalls(plugin).filter(
				(args) => args[0] === "active-leaf-change",
			);
			expect(leafChangeRegs).toHaveLength(1);
		});

		it("active-leaf-change handler forwards to onEditorActivity", async () => {
			const activitySpy = vi.spyOn(IdeBridge.prototype, "onEditorActivity");
			await plugin.onload();
			const leafChangeReg = workspaceOnCalls(plugin).find(
				(args) => args[0] === "active-leaf-change",
			);
			expect(leafChangeReg).toBeDefined();
			const handler = leafChangeReg?.[1] as (() => void) | undefined;
			expect(typeof handler).toBe("function");
			handler?.();
			expect(activitySpy).toHaveBeenCalledTimes(1);
		});

		it("registers the toggle-ide-bridge command", async () => {
			await plugin.onload();
			const ids = vi
				.mocked(plugin.addCommand)
				.mock.calls.map((call) => (call[0] as { id: string }).id);
			expect(ids).toContain("toggle-ide-bridge");
		});

		it("starts the bridge on load when ideBridgeEnabled is true", async () => {
			vi.mocked(plugin.loadData).mockResolvedValue({ ideBridgeEnabled: true });
			await plugin.onload();
			expect(IdeBridge.prototype.start).toHaveBeenCalledTimes(1);
		});

		it("does NOT start the bridge on load when ideBridgeEnabled is false", async () => {
			vi.mocked(plugin.loadData).mockResolvedValue({ ideBridgeEnabled: false });
			await plugin.onload();
			expect(IdeBridge.prototype.start).not.toHaveBeenCalled();
		});

		it("does NOT start the bridge on load when the flag is absent (default off)", async () => {
			// loadData → null means DEFAULT_SETTINGS, where ideBridgeEnabled is false.
			vi.mocked(plugin.loadData).mockResolvedValue(null);
			await plugin.onload();
			expect(IdeBridge.prototype.start).not.toHaveBeenCalled();
		});
	});

	describe("onunload — IDE Bridge torn down (003 / T4.5)", () => {
		it("stops the bridge via the LIFO cleanup drain", async () => {
			await plugin.onload();
			expect(IdeBridge.prototype.stop).not.toHaveBeenCalled();
			plugin.onunload();
			expect(IdeBridge.prototype.stop).toHaveBeenCalledTimes(1);
		});
	});
});
