import type MyPlugin from "main";
import { type App, PluginSettingTab, Setting } from "obsidian";

export class SettingsTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Example setting")
			.setDesc("A placeholder setting to demonstrate the pattern.")
			.addText((text) =>
				text
					.setPlaceholder("Enter a value")
					.setValue(this.plugin.settings.exampleSetting)
					.onChange(async (value) => {
						this.plugin.settings.exampleSetting = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
