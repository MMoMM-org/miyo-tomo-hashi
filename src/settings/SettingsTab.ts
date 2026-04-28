import type TomoHashiPlugin from "main";
import { type App, PluginSettingTab, Setting } from "obsidian";

export class SettingsTab extends PluginSettingTab {
	plugin: TomoHashiPlugin;

	constructor(app: App, plugin: TomoHashiPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Chosen instance")
			.setDesc(
				"Container ID of the last Tomo instance Hashi connected to. " +
					"Managed by the connection flow — not editable here.",
			)
			.addText((text) =>
				text
					.setPlaceholder("(none)")
					.setValue(this.plugin.settings.chosenInstanceId ?? "")
					.setDisabled(true),
			);
	}
}
