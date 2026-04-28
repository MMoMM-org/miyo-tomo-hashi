/**
 * Settings tab — exposes the Tomo connection lifecycle (Connect /
 * Disconnect + open picker) and instruction-executor settings.
 *
 * The tab subscribes to `connectionStore` while visible so the button +
 * label reflect live state transitions, and unsubscribes on `hide()` to
 * avoid listener leaks across re-renders.
 *
 * Spec: docs/XDD/specs/001-session-view —
 *   - PRD F1 (discover), F2 (connect/disconnect), F9 (instance label)
 *   - SDD "Directory Map" entry for `src/settings/SettingsTab.ts`
 *   - ADR-4 v3: UI surfaces compute derived values inline; the only
 *     writer to `connectionStore` is `TomoConnection`.
 *
 * Spec: docs/XDD/specs/002-instruction-executor —
 *   - PRD F11: 6 new settings fields + "Instruction executor" section.
 *   - Deviation: radio control → addDropdown (radio not native in Obsidian
 *     Setting API). Logged in plan/README.md.
 */

import type TomoHashiPlugin from "../main";
import { type App, Notice, PluginSettingTab, Setting } from "obsidian";

import { connectionStore, displayInstanceName } from "../connection/connectionStore";
import type { ConnectionState } from "../connection/state";
import type { TomoConnection } from "../connection/TomoConnection";
import type { ExecutionMode } from "../executor/state";
import type { PluginSettings } from "../types/index";
import { InstancePickerModal } from "./InstancePickerModal";

// ---------------------------------------------------------------------------
// Path-safety guard (settings layer)
//
// Rejects values that would escape the vault or reference absolute paths.
// This is a SIMPLE UI-layer guard — not the full `normalizeAndContain`
// utility (T1.4 builds that for the executor runtime).
// Co-located here because it is purely a UI-layer concern.
// ---------------------------------------------------------------------------

type SafetyResult =
	| { ok: true }
	| { ok: false; reason: string };

function isUnsafeVaultRelative(s: string): SafetyResult {
	if (s.startsWith("/") || s.startsWith("\\")) {
		return { ok: false, reason: "absolute path" };
	}
	if (/^[A-Za-z]:/.test(s)) {
		return { ok: false, reason: "Windows drive letter" };
	}
	if (s.split(/[/\\]/).some(seg => seg === ".." || (seg === "" && s !== ""))) {
		return { ok: false, reason: "traversal or empty segment" };
	}
	return { ok: true };
}

// ---------------------------------------------------------------------------
// Handler map — exposes onChange callbacks for test introspection.
// Keys are PluginSettings field names; values are the async handlers
// registered during display(). Tests can call these directly to simulate
// user input without needing DOM click simulation on input/select elements.
// Production callers never use this map — it is a narrow test seam.
// ---------------------------------------------------------------------------

type HandlerValue = string | boolean;
type HandlerMap = Partial<Record<keyof PluginSettings, (v: HandlerValue) => Promise<void>>>;

export class SettingsTab extends PluginSettingTab {
	plugin: TomoHashiPlugin;
	private unsubscribe: (() => void) | null = null;

	/**
	 * onChange handler map populated during display(). Tests fire these to
	 * simulate user edits without DOM interaction. Not used in production.
	 */
	_handlers: HandlerMap = {};

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
		this._handlers = {};

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

		this.renderExecutorSection(containerEl);
	}

	private renderExecutorSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Instruction executor").setHeading();

		this.addPathSetting(containerEl, "Tomo inbox folder",
			"Vault-relative path to the folder watched for _instructions.json files.",
			"tomoInboxFolder");

		this.addDropdownSetting<ExecutionMode>(containerEl, "Execution mode",
			"How the executor presents a run before executing.",
			"executionMode",
			[
				["confirm", "Confirm before run"],
				["auto-run", "Auto-run with preview"],
				["silent", "Silent"],
			]);

		this.addDropdownSetting<"always" | "only-after-failed">(containerEl,
			"Run log retention",
			"Whether to keep run logs after every run or only after failures.",
			"runLogRetention",
			[
				["always", "Always keep"],
				["only-after-failed", "Only after failed runs"],
			]);

		this.addPathSetting(containerEl, "Hooks directory",
			"Vault-relative path to the directory scanned for hook scripts.",
			"hooksDir");

		this.addDropdownSetting<"enabled" | "disabled" | "ask">(containerEl, "Hooks",
			"Policy for executing user-authored hook scripts.",
			"hooksPolicy",
			[
				["enabled", "Enabled"],
				["disabled", "Disabled"],
				["ask", "Ask"],
			]);

		new Setting(containerEl)
			.setName("Debug logging")
			.setDesc("Write verbose executor output to the developer console.")
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.debugLogging);
				const handler = async (v: boolean): Promise<void> => {
					this.plugin.settings.debugLogging = v;
					await this.plugin.saveSettings();
				};
				this._handlers.debugLogging = handler as unknown as (v: HandlerValue) => Promise<void>;
				toggle.onChange(handler);
			});
	}

	/**
	 * Adds a text input setting with vault-relative path safety validation.
	 * On unsafe input the value reverts to the previous safe value and a
	 * Notice is shown. On safe input the setting is saved immediately.
	 */
	private addPathSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		key: "tomoInboxFolder" | "hooksDir",
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addText(text => {
				text.setPlaceholder(this.plugin.settings[key] || "");
				text.setValue(this.plugin.settings[key]);
				const handler = async (v: string): Promise<void> => {
					const check = isUnsafeVaultRelative(v);
					if (!check.ok) {
						new Notice(`Invalid path (${check.reason}): "${v}"`);
						text.setValue(this.plugin.settings[key]);
						return;
					}
					this.plugin.settings[key] = v;
					await this.plugin.saveSettings();
				};
				this._handlers[key] = handler as unknown as (v: HandlerValue) => Promise<void>;
				text.onChange(handler);
			});
	}

	/**
	 * Adds a dropdown setting. Generic over the value type so the compiler
	 * can enforce that options match the field type.
	 */
	private addDropdownSetting<T extends string>(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		key: keyof PluginSettings,
		options: Array<[T, string]>,
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addDropdown(dropdown => {
				for (const [value, label] of options) {
					dropdown.addOption(value, label);
				}
				dropdown.setValue(this.plugin.settings[key] as string);
				const handler = async (v: string): Promise<void> => {
					(this.plugin.settings as unknown as Record<string, unknown>)[key as string] = v as T;
					await this.plugin.saveSettings();
				};
				this._handlers[key] = handler as unknown as (v: HandlerValue) => Promise<void>;
				dropdown.onChange(handler);
			});
	}

	override hide(): void {
		if (this.unsubscribe !== null) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
		super.hide();
	}
}
