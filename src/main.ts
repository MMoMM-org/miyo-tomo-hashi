import { Plugin } from "obsidian";

import { TomoConnection } from "connection/TomoConnection";
import { SettingsTab } from "settings/SettingsTab";
import { DEFAULT_SETTINGS, type PluginSettings } from "types/index";

export default class TomoHashiPlugin extends Plugin {
	settings: PluginSettings = DEFAULT_SETTINGS;
	// Connection is constructed during onload() — declared here so we can
	// dispose it during onunload(). Phase-5 wire-up adds the lifecycle
	// hooks; for now T4.1 only needs the SettingsTab to receive it.
	private connection: TomoConnection | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.connection = new TomoConnection(this.settings, async () => {
			await this.saveSettings();
		});
		this.addSettingTab(new SettingsTab(this.app, this, this.connection));
	}

	override onunload(): void {
		if (this.connection !== null) {
			void this.connection.dispose();
			this.connection = null;
		}
	}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as Partial<PluginSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...stored };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
