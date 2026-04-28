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
 * Spec refs: spec 001-session-view phase-5 T5.3; PRD all features wired;
 * SDD "Building Block View / Components", ADR-6 (chat view singleton),
 * ADR-10 (plugin unload best-effort).
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
 */

import { Plugin, type WorkspaceLeaf } from "obsidian";

import { registerCommands } from "./commands/registerCommands";
import { registerFileMenu } from "./commands/fileMenu";
import { TomoConnection } from "./connection/TomoConnection";
import { loadSettings, saveSettings } from "./connection/settingsPersistence";
import { SettingsTab } from "./settings/SettingsTab";
import {
	DEFAULT_SETTINGS,
	type PluginSettings,
	type ZoomLevel,
} from "./types/index";
import { TomoChatView, VIEW_TYPE_TOMO_CHAT } from "./ui/chat-view/index";
import { showChatWindow } from "./ui/chat-view/showChatWindow";
import { StatusBarIcon } from "./ui/status-bar/StatusBarIcon";

interface SettingApi {
	open?: () => void;
	openTabById?: (id: string) => void;
}

interface AppWithSetting {
	setting?: SettingApi;
}

export default class TomoHashiPlugin extends Plugin {
	settings: PluginSettings = DEFAULT_SETTINGS;
	private connection: TomoConnection | null = null;
	private statusBarIcon: StatusBarIcon | null = null;
	private loaded = false;

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

		const chosenInstanceId = (): string | null => this.settings.chosenInstanceId;

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
	}

	override onunload(): void {
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
