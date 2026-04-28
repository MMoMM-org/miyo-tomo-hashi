/**
 * Settings tab — exposes the Tomo connection lifecycle (Connect /
 * Disconnect + open picker). The tab subscribes to `connectionStore` while
 * visible so the button + label reflect live state transitions, and
 * unsubscribes on `hide()` to avoid listener leaks across re-renders.
 *
 * Spec: docs/XDD/specs/001-session-view —
 *   - PRD F1 (discover), F2 (connect/disconnect), F9 (instance label)
 *   - SDD "Directory Map" entry for `src/settings/SettingsTab.ts`
 *   - ADR-4 v3: UI surfaces compute derived values inline; the only
 *     writer to `connectionStore` is `TomoConnection`.
 */

import type TomoHashiPlugin from "../main";
import { type App, PluginSettingTab, Setting } from "obsidian";

import { connectionStore, displayInstanceName } from "../connection/connectionStore";
import type { ConnectionState } from "../connection/state";
import type { TomoConnection } from "../connection/TomoConnection";
import { InstancePickerModal } from "./InstancePickerModal";

export class SettingsTab extends PluginSettingTab {
	plugin: TomoHashiPlugin;
	private unsubscribe: (() => void) | null = null;

	constructor(
		app: App,
		plugin: TomoHashiPlugin,
		private readonly connection: TomoConnection,
	) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Tomo connection").setHeading();
		const wrapper = containerEl.createDiv({
			cls: "hashi-settings-connection",
		});

		const render = (state: ConnectionState): void => {
			wrapper.empty();
			if (state.kind === "connected") {
				const label = displayInstanceName(state) ?? "Tomo";
				wrapper.createDiv({
					cls: "hashi-settings-status",
					text: `Connected to ${label}`,
				});
				const btn = wrapper.createEl("button", {
					cls: "hashi-settings-disconnect",
					text: "Disconnect",
				});
				btn.addEventListener("click", () => {
					void this.connection.disconnect();
				});
				return;
			}

			// All non-connected kinds (disconnected / attaching / reconnecting /
			// error) render a Connect button. While attaching/reconnecting the
			// store will continue to update the label as transitions occur.
			const label = displayInstanceName(state);
			const statusText =
				state.kind === "disconnected"
					? "Disconnected"
					: state.kind === "attaching"
						? `Attaching to ${label ?? "Tomo"}…`
						: state.kind === "reconnecting"
							? `Reconnecting to ${label ?? "Tomo"} (attempt ${state.attempt})…`
							: "Connection error";
			wrapper.createDiv({
				cls: "hashi-settings-status",
				text: statusText,
			});
			const btn = wrapper.createEl("button", {
				cls: "hashi-settings-connect",
				text: "Connect",
			});
			btn.addEventListener("click", () => {
				new InstancePickerModal(this.app, this.connection).open();
			});
		};

		// Paranoia: clean up any prior subscription before re-binding so a
		// hot-reload re-render of display() can't leak listeners.
		if (this.unsubscribe !== null) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
		this.unsubscribe = connectionStore.subscribe(render);
	}

	override hide(): void {
		if (this.unsubscribe !== null) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
		super.hide();
	}
}
