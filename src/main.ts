/**
 * Plugin entry point — wires every Phase 1-4 surface into Obsidian's plugin
 * lifecycle:
 *   1. Settings tab (T2.x, T3.x — Tomo connection picker / disconnect)
 *   2. Chat view (T4.3 — `VIEW_TYPE_TOMO_CHAT`)
 *   3. Status bar icon (T4.2 — connection-state icon + popover)
 *   4. File menu (T4.4 — @file prefill into chat input)
 *   5. Commands (T5.1 — Reconnect, Show chat window)
 *   6. FS2 auto-reconnect on load (T3.x — `autoReconnectIfRemembered`)
 *
 * 002 surfaces (T6.2) wired AFTER 001:
 *   7. ObsidianVaultFS (production VaultFS adapter — v0.1)
 *   8. SchemaValidator (the `validate` function from src/schema/validator.ts —
 *      ajv compiles at module load per ADR-1 v2)
 *   9. HookRunner with askCallback bridging to HookDisclosureModal
 *  10. InstructionExecutor (singleton per plugin load)
 *  11. Status bar 橋 indicator (mountStatusBar — color states only)
 *  12. ExecutionModal glue (subscribes to executionStore; opens an
 *      ExecutionModal instance when a run leaves `idle` in confirm /
 *      auto-run mode — silent mode never opens the modal per PRD F11)
 *  13. Executor command + file-menu entry (T6.1)
 *
 * Spec refs: spec 001-session-view phase-5 T5.3; spec 002-instruction-executor
 *   phase-6 T6.2; PRD all features wired; SDD "Building Block View /
 *   Components", ADR-6 (chat view singleton), ADR-10 (plugin unload best-
 *   effort).
 *
 * --- Decisions ---
 *
 * 1. Defensive double-onload guard. `onload()` throws if invoked while the
 *    plugin is already loaded — Obsidian's lifecycle is single-shot per
 *    plugin instance, but a buggy reload (or test) calling onload twice
 *    would silently double-register every surface. Throwing surfaces the
 *    bug instead of accumulating ghost handlers.
 *
 * 2. `app.setting.open()` + `openTabById(this.manifest.id)` is a real
 *    Obsidian runtime API but not part of the published `obsidian.d.ts`.
 *    The `as unknown as { setting?: ... }` cast is the only way to reach
 *    it without `any` / `@ts-ignore`. We guard every call with a typeof
 *    check so older Obsidian builds (where the API is missing) become
 *    no-ops rather than crashes.
 *
 * 3. `TomoChatView` exposes `getInputElement()` and `setInputAndFocus()`
 *    accessors so the file-menu wiring can prefill the input without
 *    reaching into the view's private state. Narrow surface — the rest of
 *    the view's internals stay encapsulated.
 *
 * 4. `onunload` detaches every chat-view leaf via `getLeavesOfType()`. This
 *    cleans up multi-leaf scenarios (user manually cloned the view) — a
 *    plugin reload should not leave dangling leaves trying to talk to a
 *    disposed connection.
 *
 * 5. (002 / T6.2) `cleanups: Array<() => void>` is a LIFO drain on unload.
 *    Anything 002 needs torn down — the status-bar teardown closure, the
 *    executionStore modal-glue subscription — pushes here. 001 keeps its
 *    own field-scoped teardowns (`statusBarIcon`, `connection`); they
 *    don't share the same lifecycle and merging them would obscure
 *    ownership.
 *
 * 6. (002 / T6.2) The ExecutionModal is NOT pre-instantiated on load. main
 *    subscribes to `executionStore` and constructs a fresh modal on every
 *    idle→preparing/previewing transition (in confirm / auto-run mode).
 *    Each invocation gets a new modal instance per ADR-5 (modal lifecycle
 *    matches one run). Silent mode never opens a modal.
 *
 * 7. (002 / T6.2-fix) `HookLoader` is implemented as `FsHookLoader` — a
 *    synchronous filesystem-backed loader that scans the configured hooks
 *    directory on every `resolve()` call via `fs.readdirSync`. Obsidian
 *    desktop runs in Electron with full Node access; the directory listing
 *    is microseconds for a small hooks dir, so no caching is needed. SDD
 *    ADR-3 mandates sync `createRequire` + cache evict (HookRunner owns
 *    that); the loader contract is sync to match, which `vault.adapter.list`
 *    (async) cannot satisfy without a pre-warmed cache. The original T6.2
 *    inline stub returned null unconditionally — replaced here so hooks
 *    actually load in production.
 */

import { createRequire } from "node:module";

import { Plugin, type WorkspaceLeaf } from "obsidian";

import { registerCommands, registerExecutorCommands } from "./commands/registerCommands";
import { registerFileMenu, registerExecutorFileMenu } from "./commands/fileMenu";
import { TomoConnection } from "./connection/TomoConnection";
import { loadSettings, saveSettings } from "./connection/settingsPersistence";
import { executionStore } from "./executor/executionStore";
import { InstructionExecutor } from "./executor/InstructionExecutor";
import { FsHookLoader } from "./hooks/FsHookLoader";
import { HookDisclosureModal } from "./hooks/HookDisclosureModal";
import { HookRunner, type RequireFn } from "./hooks/HookRunner";
import type { HookLogger } from "./hooks/HookContext";
import { validate } from "./schema/validator";
import { SettingsTab } from "./settings/SettingsTab";
import {
	DEFAULT_SETTINGS,
	type PluginSettings,
	type ZoomLevel,
} from "./types/index";
import { TomoChatView, VIEW_TYPE_TOMO_CHAT } from "./ui/chat-view/index";
import { showChatWindow } from "./ui/chat-view/showChatWindow";
import { StatusBarIcon } from "./ui/status-bar/StatusBarIcon";
import { ExecutionModal } from "./ui/ExecutionModal";
import { mountStatusBar } from "./ui/statusBar";
import { ObsidianVaultFS } from "./vault/ObsidianVaultFS";

interface SettingApi {
	open?: () => void;
	openTabById?: (id: string) => void;
}

interface AppWithSetting {
	setting?: SettingApi;
}

interface AdapterStat {
	type: "file" | "folder";
	size: number;
	ctime: number;
	mtime: number;
}

interface VaultAdapterShape {
	stat(path: string): Promise<AdapterStat | null>;
	getBasePath?(): string;
}

export default class TomoHashiPlugin extends Plugin {
	settings: PluginSettings = DEFAULT_SETTINGS;
	private connection: TomoConnection | null = null;
	private statusBarIcon: StatusBarIcon | null = null;
	private executor: InstructionExecutor | null = null;
	private cleanups: Array<() => void> = [];
	private loaded = false;

	/**
	 * Persist the current `this.settings` to Obsidian's data store.
	 * Used by SettingsTab controls — keeps the settings-tab wiring simple
	 * (no closure juggling, mirrors the Kado plugin pattern).
	 */
	async saveSettings(): Promise<void> {
		await saveSettings(this, this.settings);
	}

	async onload(): Promise<void> {
		if (this.loaded) {
			// See header decision (1) — fail loud rather than silently
			// double-register every surface.
			throw new Error(
				"TomoHashiPlugin.onload called twice — plugin already loaded",
			);
		}
		this.loaded = true;

		this.settings = await loadSettings(this);

		const persist = async (settings: PluginSettings): Promise<void> => {
			await saveSettings(this, settings);
			this.settings = settings;
		};
		this.connection = new TomoConnection(this.settings, persist);
		const conn = this.connection;

		const chosenInstanceId = (): string | null =>
			this.settings.chosenInstanceName;

		// 1. Chat view registration (T4.3).
		const onZoomChange = async (level: ZoomLevel): Promise<void> => {
			await persist({ ...this.settings, zoomLevel: level });
		};
		this.registerView(
			VIEW_TYPE_TOMO_CHAT,
			(leaf: WorkspaceLeaf) =>
				new TomoChatView(
					leaf,
					conn,
					chosenInstanceId,
					this.settings.zoomLevel,
					onZoomChange,
				),
		);

		// 2. Settings tab (T4.1 — already wired; kept here for SDD ordering).
		this.addSettingTab(new SettingsTab(this.app, this, conn));

		// 3. Status bar icon (T4.2).
		this.statusBarIcon = new StatusBarIcon(
			this,
			{
				onForceReconnect: (): void => {
					void conn.forceReconnect();
				},
				onOpenChat: (): void => {
					void showChatWindow(this.app);
				},
				onOpenSettings: (): void => {
					// See header decision (2) — `app.setting` is real but not in
					// obsidian.d.ts. Guarded so older builds become a no-op.
					const setting = (this.app as unknown as AppWithSetting).setting;
					if (setting === undefined) return;
					if (typeof setting.open === "function") setting.open();
					if (typeof setting.openTabById === "function") {
						setting.openTabById(this.manifest.id);
					}
				},
			},
			chosenInstanceId,
		);
		this.statusBarIcon.mount();

		// 4. File menu @file prefill (T4.4).
		registerFileMenu(this, {
			getOpenChatInput: (): HTMLInputElement | null => {
				const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TOMO_CHAT);
				const first = leaves[0];
				if (first === undefined) return null;
				const view = first.view;
				if (!(view instanceof TomoChatView)) return null;
				return view.getInputElement();
			},
			openChatViewAndPrefill: async (text: string): Promise<void> => {
				await showChatWindow(this.app);
				const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TOMO_CHAT);
				const first = leaves[0];
				if (first === undefined) return;
				const view = first.view;
				if (!(view instanceof TomoChatView)) return;
				view.setInputAndFocus(text);
			},
		});

		// 5. Commands (T5.1 — Reconnect dynamic label + Show chat window).
		registerCommands(this, {
			connection: conn,
			showChatWindow: () => showChatWindow(this.app),
			chosenInstanceId,
		});

		// 6. FS2 auto-reconnect on load. Fire-and-forget — onload must not
		//    block on a Docker round-trip; the connection store carries any
		//    failure to the UI surfaces.
		void conn.autoReconnectIfRemembered();

		// =========================================================================
		// 002 wiring (T6.2) — instruction executor surfaces
		// =========================================================================

		// 7. ObsidianVaultFS — production VaultFS adapter for v0.1.
		const vault = new ObsidianVaultFS(this.app);

		// 8. Schema validator — validate function backed by ajv (ADR-1 v2).
		const validator = { validate };

		// 9. HookRunner with askCallback bridging absolutePath → vault-relative
		//    + size → HookDisclosureModal.present().
		const adapter = this.app.vault.adapter as unknown as VaultAdapterShape;
		const askCallback = async (absolutePath: string): Promise<
			"enable-session" | "enable-once" | "disable"
		> => {
			const vaultRelativePath = toVaultRelative(
				absolutePath,
				this.settings.hooksDir,
			);
			const stat = await adapter.stat(vaultRelativePath).catch(() => null);
			const fileSizeBytes = stat?.size ?? 0;
			const modal = new HookDisclosureModal(this.app, {
				vaultRelativePath,
				fileSizeBytes,
			});
			return await modal.present();
		};

		const hookLogger: HookLogger = {
			info: (msg) => {
				if (this.settings.debugLogging) console.debug(`[hashi/hook] ${msg}`);
			},
			warn: (msg) => {
				console.warn(`[hashi/hook] ${msg}`);
			},
			error: (msg) => {
				console.error(`[hashi/hook] ${msg}`);
			},
		};

		// Per header decision (7) — sync filesystem-backed loader. Obsidian
		// desktop's `FileSystemAdapter.getBasePath()` gives us the absolute
		// vault root (manifest is `isDesktopOnly: true`, so the call is safe);
		// we fall back to `""` for the unrealistic case where the API is
		// missing (older Obsidian builds), in which case the loader's
		// `readdirSync` will resolve a relative path against `process.cwd()`
		// and almost certainly return null — which is the safe failure mode.
		const vaultBasePath =
			typeof adapter.getBasePath === "function" ? adapter.getBasePath() : "";
		const hookLoader = new FsHookLoader(
			vaultBasePath,
			() => this.settings.hooksDir,
		);

		// `import.meta.url` is empty in the CJS bundle (esbuild target=es2018,
		// format=cjs). Anchor at `__filename` (CJS global) — at runtime this
		// is the bundled main.js path; createRequire uses it as resolution
		// origin for `require()` calls into the hooks directory.
		// eslint-disable-next-line no-undef -- `__filename` is a CJS global; valid at runtime in our esbuild CJS bundle.
		const cjsRequire = createRequire(__filename);
		const hookRunner = new HookRunner(this.app, hookLoader, hookLogger, {
			askCallback,
			policy: this.settings.hooksPolicy,
			requireFn: cjsRequire as unknown as RequireFn,
		});

		// 10. InstructionExecutor — singleton per plugin load.
		this.executor = new InstructionExecutor({
			vault,
			validator,
			hookRunner,
			settings: this.settings,
			clock: { now: () => new Date() },
		});

		// 11. Status bar 橋 indicator (color states only per ADR-6 v2).
		const teardownStatusBar = mountStatusBar(this, {
			onActiveModalFocus: () => {
				// Reveal-the-modal click: Obsidian re-focuses the open modal
				// when a fresh `Modal.open()` is invoked, but we don't keep a
				// modal reference here. The modal-glue subscription below owns
				// the active instance — the click is a best-effort no-op when
				// the modal is already open (Obsidian z-orders it on top).
				// PRD F10 only requires the click registers; it does not require
				// us to track the modal instance from the status bar callback.
			},
		});
		this.cleanups.push(teardownStatusBar);

		// 12. ExecutionModal glue — open a fresh modal on idle→preparing/previewing
		//     transition in confirm / auto-run mode. Silent mode never opens.
		let activeModal: ExecutionModal | null = null;
		let lastKind: import("./executor/state").RunState["kind"] = "idle";
		const unsubModalGlue = executionStore.subscribe((state) => {
			const prev = lastKind;
			lastKind = state.kind;
			// Open on the first non-idle transition.
			if (prev === "idle" && state.kind !== "idle" && activeModal === null) {
				const mode = "mode" in state ? state.mode : "confirm";
				if (mode === "silent") return;
				if (this.executor === null) return;
				const exec = this.executor;
				const app = this.app;
				const modal = new ExecutionModal(app, exec, {
					onExecute: () => exec.proceed(),
					onCancel: () => exec.cancel(),
					// User clicked Close on summary / validation-failed → drive the
					// idle transition (the executor no longer auto-idles in
					// confirm/auto-run modes; otherwise the modal would re-render
					// blank — empty-modal regression of 2026-04-30).
					onClose: () => {
						exec.state.set({ kind: "idle" });
						modal.close();
					},
					// User clicked View errors on the summary → open the run log
					// file in the active leaf. Modal stays open so the user can
					// compare counts vs. log content; they Close manually.
					onViewErrors: (logFilePath: string | null) => {
						if (logFilePath !== null) {
							void app.workspace.openLinkText(logFilePath, "", false);
						}
					},
				});
				activeModal = modal;
				modal.open();
			}
			// Drop the reference once the run is done.
			if (state.kind === "idle" && activeModal !== null) {
				activeModal = null;
			}
		});
		this.cleanups.push(unsubModalGlue);

		// 13. 002 commands + file-menu (T6.1).
		const executorCmdDeps = {
			executor: this.executor,
			vault,
			settings: this.settings,
		} as const;
		registerExecutorCommands(this, executorCmdDeps);
		registerExecutorFileMenu(this, executorCmdDeps);
	}

	override onunload(): void {
		// Drain 002 cleanups in LIFO order — see header decision (5).
		while (this.cleanups.length > 0) {
			const fn = this.cleanups.pop();
			if (fn !== undefined) {
				try {
					fn();
				} catch (err) {
					console.error("[hashi] cleanup threw during onunload:", err);
				}
			}
		}
		this.executor = null;

		if (this.statusBarIcon !== null) {
			this.statusBarIcon.unmount();
			this.statusBarIcon = null;
		}
		if (this.connection !== null) {
			// Per ADR-10 — best-effort dispose. Obsidian's `Plugin.onunload`
			// signature is `(): void` (no awaiting at the host), so we
			// fire-and-forget. `TomoConnection.dispose` is designed to never
			// throw and tears down internal state synchronously enough to
			// release the `loaded` flag below.
			void this.connection.dispose();
			this.connection = null;
		}
		// Detach any remaining chat leaves so a reload doesn't leave them
		// pointing at a disposed connection.
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TOMO_CHAT);
		for (const leaf of leaves) leaf.detach();

		this.loaded = false;
	}
}

function toVaultRelative(absolutePath: string, hooksDir: string): string {
	// If the path already looks vault-relative (matches the hooksDir prefix),
	// return as-is. Otherwise strip everything up to and including the
	// hooksDir segment. This mirrors what HookDisclosureModal expects per
	// T5.3 deviations.
	if (absolutePath.startsWith(hooksDir)) return absolutePath;
	const idx = absolutePath.indexOf(`/${hooksDir}/`);
	if (idx >= 0) return absolutePath.slice(idx + 1);
	const lastSlash = absolutePath.lastIndexOf("/");
	return lastSlash === -1 ? absolutePath : absolutePath.slice(lastSlash + 1);
}
