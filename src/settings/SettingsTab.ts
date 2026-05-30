/**
 * Settings tab — exposes the Tomo connection lifecycle (Connect /
 * Disconnect + open picker), the IDE bridge section, and instruction-executor
 * settings.
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
 *
 * Spec: docs/XDD/specs/003-ide-bridge — SDD lines 361-377 (settings UI).
 *   T4.3: IDE bridge section with status, enable toggle, port control-swap,
 *   and auth token display/copy/regenerate.
 */

import type TomoHashiPlugin from "../main";
import { type App, Notice, PluginSettingTab, Setting } from "obsidian";

import { connectionStore, displayInstanceName } from "../connection/connectionStore";
import type { ConnectionState } from "../connection/state";
import type { TomoConnection } from "../connection/TomoConnection";
import type { ExecutionMode } from "../executor/state";
import { ideBridgeStore } from "../ide-bridge/ideBridgeStore";
import type { IdeBridgeState } from "../ide-bridge/state";
import type { PluginSettings } from "../types/index";
import { ConfirmModal } from "../ui/ConfirmModal";
import { HeaderSection } from "./HeaderSection";
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
	// `seg === ""` catches `a//b`-style double-separators; `s !== ""` carves
	// out the empty-string default (split("") === [""]) which is valid.
	if (s.split(/[/\\]/).some(seg => seg === ".." || (seg === "" && s !== ""))) {
		return { ok: false, reason: "traversal or empty segment" };
	}
	return { ok: true };
}

// ---------------------------------------------------------------------------
// Settings handlers — pure factory (review M19)
//
// Pre-fix: SettingsTab carried a private `_handlers` map populated during
// display() and exposed via a `_getHandlersForTest()` accessor — test-only
// state living on a production class. Now the handler logic is a module-
// level pure function that both the class and tests construct on demand.
// ---------------------------------------------------------------------------

/** Map of onChange handlers, keyed by PluginSettings field. */
export type HandlerMap = {
	tomoInboxFolder: (v: string) => Promise<void>;
	hooksDir: (v: string) => Promise<void>;
	executionMode: (v: string) => Promise<void>;
	runLogRetention: (v: string) => Promise<void>;
	hooksPolicy: (v: string) => Promise<void>;
	debugLogging: (v: boolean) => Promise<void>;
};

export interface SettingsPersistence {
	readonly settings: PluginSettings;
	saveSettings(): Promise<void>;
}

/**
 * Build the onChange handlers for the SettingsTab controls.
 *
 * Pure function — no DOM, no Notice, no `this`. Returns one handler per
 * settings field. Path handlers reject unsafe input (notify + no save);
 * dropdown and boolean handlers persist without validation.
 *
 * The optional `notice` injection is used in production for the unsafe-
 * path Notice. Tests pass a vi.fn() (or omit and rely on the default
 * which constructs an Obsidian Notice).
 */
export function buildSettingsHandlers(
	persistence: SettingsPersistence,
	notice: (msg: string) => void = (msg) => {
		new Notice(msg);
	},
): HandlerMap {
	const pathHandler =
		(key: "tomoInboxFolder" | "hooksDir") => async (v: string): Promise<void> => {
			const check = isUnsafeVaultRelative(v);
			if (!check.ok) {
				notice(`Invalid path (${check.reason}): "${v}"`);
				return;
			}
			persistence.settings[key] = v;
			await persistence.saveSettings();
		};

	// review round 2 / L45: per-key whitelist of valid enum values.
	// Pre-fix dropdownHandler accepted any string and wrote it through
	// to data.json without validation. The UI <select> options are the
	// only production source today, but buildSettingsHandlers is exported
	// and HandlerMap is now public — a caller could invoke a handler with
	// an out-of-range string and corrupt persisted settings. Mirrors the
	// pathHandler guard pattern.
	const dropdownAllowed: Record<
		"executionMode" | "runLogRetention" | "hooksPolicy",
		readonly string[]
	> = {
		executionMode: ["confirm", "auto-run", "silent"],
		runLogRetention: ["always", "only-after-failed"],
		hooksPolicy: ["enabled", "disabled", "ask"],
	};

	const dropdownHandler =
		(key: "executionMode" | "runLogRetention" | "hooksPolicy") =>
		async (v: string): Promise<void> => {
			if (!dropdownAllowed[key].includes(v)) {
				notice(`Invalid ${key} value: "${v}"`);
				return;
			}
			(persistence.settings as unknown as Record<string, unknown>)[key] = v;
			await persistence.saveSettings();
		};

	const booleanHandler =
		(key: "debugLogging") => async (v: boolean): Promise<void> => {
			persistence.settings[key] = v;
			await persistence.saveSettings();
		};

	return {
		tomoInboxFolder: pathHandler("tomoInboxFolder"),
		hooksDir: pathHandler("hooksDir"),
		executionMode: dropdownHandler("executionMode"),
		runLogRetention: dropdownHandler("runLogRetention"),
		hooksPolicy: dropdownHandler("hooksPolicy"),
		debugLogging: booleanHandler("debugLogging"),
	};
}


// ---------------------------------------------------------------------------
// IDE bridge settings handlers — pure factory (T4.3)
//
// The IdeBridgeController interface declares exactly the methods the settings
// UI needs. IdeBridge satisfies it structurally — no import cycle.
// ---------------------------------------------------------------------------

/**
 * Structural interface for the IdeBridge controller as seen by the settings
 * section. IdeBridge (src/ide-bridge/IdeBridge.ts) satisfies this interface
 * without importing it; tests inject a fake.
 */
export interface IdeBridgeController {
	start(): Promise<void>;
	stop(): Promise<void>;
	isRunning(): boolean;
	regenerateToken(): Promise<void>;
	getToken(): string;
}

/** Handlers returned by buildIdeBridgeHandlers. */
export interface IdeBridgeHandlerMap {
	port: (v: string) => Promise<void>;
	enable: (v: boolean) => Promise<void>;
	regenerate: () => Promise<void>;
}

/**
 * Pure factory for IDE bridge settings handlers.
 *
 * port: validates integer in [1024, 65535] and not 23026 (Kado collision);
 *       persists on valid, no-ops on invalid (preserves prior value).
 * enable: persists ideBridgeEnabled, calls start() or stop(), then re-renders.
 * regenerate: calls regenerateToken(), then re-renders.
 *
 * @param controller  The IdeBridge controller (or a test fake).
 * @param persistence Provides the live settings object + a save function.
 * @param rerender    Optional callback invoked after state-changing operations
 *                    so the tab re-renders (production passes `this.display`).
 */
export function buildIdeBridgeHandlers(
	controller: IdeBridgeController,
	persistence: SettingsPersistence,
	rerender: () => void = () => { /* no-op */ },
): IdeBridgeHandlerMap {
	const portHandler = async (v: string): Promise<void> => {
		const n = Number(v);
		if (!Number.isInteger(n) || n < 1024 || n > 65535 || n === 23026) return;
		persistence.settings.ideBridgePort = n;
		await persistence.saveSettings();
	};

	const enableHandler = async (v: boolean): Promise<void> => {
		persistence.settings.ideBridgeEnabled = v;
		await persistence.saveSettings();
		if (v) {
			await controller.start();
		} else {
			await controller.stop();
		}
		rerender();
	};

	const regenerateHandler = async (): Promise<void> => {
		await controller.regenerateToken();
		rerender();
	};

	return {
		port: portHandler,
		enable: enableHandler,
		regenerate: regenerateHandler,
	};
}

export class SettingsTab extends PluginSettingTab {
	plugin: TomoHashiPlugin;
	private unsubscribe: (() => void) | null = null;
	private readonly headerSection: HeaderSection;
	private readonly ideBridge: IdeBridgeController;

	/**
	 * Test seam (review M19): rebuilds handlers on demand via the pure
	 * `buildSettingsHandlers` factory rather than caching them on the
	 * class. Production code never reads this; tests use it to drive
	 * onChange behavior without DOM event simulation.
	 */
	_getHandlersForTest(): Readonly<HandlerMap> {
		return buildSettingsHandlers(this.persistence());
	}

	/**
	 * Test seam for IDE bridge handlers — mirrors _getHandlersForTest().
	 * Returns handlers built from the live persistence object; tests drive
	 * onChange behavior without DOM event simulation.
	 */
	_getIdeBridgeHandlersForTest(): Readonly<IdeBridgeHandlerMap> {
		return buildIdeBridgeHandlers(this.ideBridge, this.persistence());
	}

	private persistence(): SettingsPersistence {
		return {
			settings: this.plugin.settings,
			saveSettings: () => this.plugin.saveSettings(),
		};
	}

	constructor(
		app: App,
		plugin: TomoHashiPlugin,
		private readonly connection: TomoConnection,
		ideBridge?: IdeBridgeController,
	) {
		super(app, plugin);
		this.plugin = plugin;
		this.headerSection = new HeaderSection({ plugin });
		// Defensive/test-convenience fallback when no controller is provided.
		// Production always passes the real IdeBridge from main.ts onload.
		this.ideBridge = ideBridge ?? {
			start: async () => { /* no-op */ },
			stop: async () => { /* no-op */ },
			isRunning: () => false,
			regenerateToken: async () => { /* no-op */ },
			getToken: () => "",
		};
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Manifest-driven identity strip (handoff
		// `2026-05-08_kado-to-hashi_unified-obsidian-settings-header.md`):
		// rendered once per display() call, above the existing sections.
		const headerContainer = containerEl.createDiv({
			cls: "hashi-settings-header",
		});
		this.headerSection.render(headerContainer);

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

		this.renderIdeBridgeSection(containerEl);
		this.renderExecutorSection(containerEl);
	}

	/**
	 * Renders the "IDE bridge" section between "Tomo connection" and
	 * "Instruction executor" (SDD lines 361-377, T4.3).
	 */
	private renderIdeBridgeSection(containerEl: HTMLElement): void {
		const handlers = buildIdeBridgeHandlers(
			this.ideBridge,
			this.persistence(),
			() => this.display(),
		);

		new Setting(containerEl).setName("IDE bridge").setHeading();

		// Status (desc-only) — reads current store state at render time.
		const state: IdeBridgeState = ideBridgeStore.get();
		const statusText = this.ideBridgeStatusText(state);
		new Setting(containerEl)
			.setName("Status")
			.setDesc(statusText);

		// Enable toggle
		new Setting(containerEl)
			.setName("Enable")
			.setDesc("Run the bridge server.")
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.ideBridgeEnabled);
				toggle.onChange(handlers.enable);
			});

		// Port — control-swap: locked desc when running, text input when stopped
		const portSetting = new Setting(containerEl).setName("Port");
		if (this.ideBridge.isRunning()) {
			portSetting.setDesc(`${this.plugin.settings.ideBridgePort} (locked while running)`);
		} else {
			portSetting.addText(text => {
				text.setValue(String(this.plugin.settings.ideBridgePort));
				text.onChange(async (v) => {
					const prev = this.plugin.settings.ideBridgePort;
					await handlers.port(v);
					// Revert if the value was rejected (no-persist guard).
					if (this.plugin.settings.ideBridgePort === prev && Number(v) !== prev) {
						text.setValue(String(prev));
					}
				});
			});
		}

		// Auth token — cleartext display, Copy + Regenerate buttons
		const tokenSetting = new Setting(containerEl)
			.setName("Auth token");

		const token = this.ideBridge.getToken();
		const descSpan = tokenSetting.settingEl.createSpan({
			cls: "hashi-ide-bridge-token",
			text: token,
		});
		// Suppress unused-variable lint — the span is appended for DOM display.
		void descSpan;

		tokenSetting.addButton(btn => {
			btn.setButtonText("Copy");
			btn.buttonEl.setAttribute("aria-live", "polite");
			btn.onClick(() => {
				void navigator.clipboard.writeText(token).then(
					() => {
						btn.setButtonText("Copied!");
						activeWindow.setTimeout(() => { btn.setButtonText("Copy"); }, 1500);
					},
					() => { new Notice("Failed to copy to clipboard"); },
				);
			});
		});

		tokenSetting.addButton(btn => {
			btn.setButtonText("Regenerate");
			btn.onClick(() => {
				new ConfirmModal(
					this.app,
					"Regenerate token?",
					"Connected clients will be disconnected and must use the new token.",
					async () => {
						await handlers.regenerate();
						new Notice("IDE bridge token regenerated");
					},
				).open();
			});
		});
	}

	/** Map IdeBridgeState to the human-facing status string for the settings UI. */
	private ideBridgeStatusText(state: IdeBridgeState): string {
		switch (state.kind) {
			case "stopped":
				return "Stopped";
			case "listening":
				return `Running on 127.0.0.1:${state.port} — 0 client(s)`;
			case "connected":
				return `Running on 127.0.0.1:${state.port} — ${state.clientCount} client(s)`;
			case "error":
				return `Error: ${state.reason}`;
			default: {
				const _exhaustive: never = state;
				return _exhaustive;
			}
		}
	}

	private renderExecutorSection(containerEl: HTMLElement): void {
		const handlers = buildSettingsHandlers(this.persistence());

		new Setting(containerEl).setName("Instruction executor").setHeading();

		this.addPathSetting(containerEl, "Tomo inbox folder",
			"Vault-relative path to the folder watched for _instructions.json files.",
			"tomoInboxFolder", handlers.tomoInboxFolder);

		this.addDropdownSetting<ExecutionMode>(containerEl, "Execution mode",
			"How the executor presents a run before executing.",
			"executionMode",
			[
				["confirm", "Confirm before run"],
				["auto-run", "Auto-run with preview"],
				["silent", "Silent"],
			], handlers.executionMode);

		this.addDropdownSetting<"always" | "only-after-failed">(containerEl,
			"Run log retention",
			"Whether to keep run logs after every run or only after failures.",
			"runLogRetention",
			[
				["always", "Always keep"],
				["only-after-failed", "Only after failed runs"],
			], handlers.runLogRetention);

		this.addPathSetting(containerEl, "Hooks directory",
			"Vault-relative path to the directory scanned for hook scripts.",
			"hooksDir", handlers.hooksDir);

		this.addDropdownSetting<"enabled" | "disabled" | "ask">(containerEl, "Hooks",
			"Policy for executing user-authored hook scripts.",
			"hooksPolicy",
			[
				["enabled", "Enabled"],
				["disabled", "Disabled"],
				["ask", "Ask"],
			], handlers.hooksPolicy);

		new Setting(containerEl)
			.setName("Debug logging")
			.setDesc("Write verbose executor output to the developer console.")
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.debugLogging);
				toggle.onChange(handlers.debugLogging);
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
		handler: (v: string) => Promise<void>,
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addText(text => {
				text.setPlaceholder(this.plugin.settings[key] || "");
				text.setValue(this.plugin.settings[key]);
				// Wrap the pure handler with UI-revert on rejection: the pure
				// handler doesn't update plugin.settings[key] when invalid, so
				// re-stamping the input from the (unchanged) settings restores
				// the prior safe value.
				text.onChange(async (v) => {
					await handler(v);
					if (this.plugin.settings[key] !== v) {
						text.setValue(this.plugin.settings[key]);
					}
				});
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
		key: "executionMode" | "runLogRetention" | "hooksPolicy",
		options: Array<[T, string]>,
		handler: (v: string) => Promise<void>,
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addDropdown(dropdown => {
				for (const [value, label] of options) {
					dropdown.addOption(value, label);
				}
				dropdown.setValue(this.plugin.settings[key] as string);
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
