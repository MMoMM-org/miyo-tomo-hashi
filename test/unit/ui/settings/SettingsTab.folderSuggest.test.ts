/**
 * Integration: the path settings (Tomo inbox folder, Hooks directory) wire a
 * FolderSuggest to their text input, and a folder picked from the suggest runs
 * the same path-safety guard as a typed value.
 *
 * FolderSuggest is mocked to capture its constructor args (the input element +
 * the onSelect callback) so we can assert wiring and drive a selection without
 * a real Obsidian popover. Kept in a dedicated file so the module mock does not
 * affect the main SettingsTab suite.
 */

import "obsidian";

import { App, Notice } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectionStore } from "../../../../src/connection/connectionStore";
import type { TomoConnection } from "../../../../src/connection/TomoConnection";
import type TomoHashiPlugin from "../../../../src/main";
import { SettingsTab } from "../../../../src/settings/SettingsTab";
import { DEFAULT_SETTINGS } from "../../../../src/types/index";
import type { PluginSettings } from "../../../../src/types/index";

const { suggestCalls } = vi.hoisted(() => ({
	suggestCalls: [] as Array<{
		inputEl: HTMLInputElement;
		onSelect: (path: string) => void;
	}>,
}));

vi.mock("../../../../src/settings/FolderSuggest", () => ({
	FolderSuggest: class {
		constructor(
			_app: unknown,
			inputEl: HTMLInputElement,
			onSelect: (path: string) => void,
		) {
			suggestCalls.push({ inputEl, onSelect });
		}
	},
}));

const conn = { state: { kind: "disconnected" } } as unknown as TomoConnection;

function makePlugin(overrides: Partial<PluginSettings> = {}) {
	return {
		settings: { ...DEFAULT_SETTINGS, ...overrides },
		saveSettings: vi.fn<() => Promise<void>>(async () => {}),
		manifest: {
			id: "miyo-tomo-hashi",
			name: "MiYo Tomo Hashi",
			version: "0.0.0-test",
		},
	};
}

beforeEach(() => {
	suggestCalls.length = 0;
	connectionStore.set({ kind: "disconnected" });
});

afterEach(() => {
	connectionStore.set({ kind: "disconnected" });
	vi.clearAllMocks();
});

describe("SettingsTab — folder autocomplete wiring", () => {
	it("attaches a FolderSuggest to both path inputs", () => {
		const plugin = makePlugin();
		const tab = new SettingsTab(new App(), plugin as unknown as TomoHashiPlugin, conn);

		tab.display();

		// One per path field: Tomo inbox folder, then Hooks directory.
		expect(suggestCalls).toHaveLength(2);
		expect(suggestCalls[0]?.inputEl).toBeInstanceOf(HTMLInputElement);
		expect(suggestCalls[1]?.inputEl).toBeInstanceOf(HTMLInputElement);
	});

	it("picking a valid folder persists it through the path guard", async () => {
		const plugin = makePlugin({ tomoInboxFolder: "old/inbox" });
		const tab = new SettingsTab(new App(), plugin as unknown as TomoHashiPlugin, conn);
		tab.display();

		suggestCalls[0]?.onSelect("inbox/tomo");

		await vi.waitFor(() => expect(plugin.saveSettings).toHaveBeenCalledTimes(1));
		expect(plugin.settings.tomoInboxFolder).toBe("inbox/tomo");
	});

	it("picking an unsafe folder is rejected and reverted", async () => {
		const noticeSpy = vi.mocked(Notice);
		noticeSpy.mockClear();
		const plugin = makePlugin({ hooksDir: ".tomo-hashi/hooks" });
		const tab = new SettingsTab(new App(), plugin as unknown as TomoHashiPlugin, conn);
		tab.display();

		// suggestCalls[1] is the Hooks directory field.
		suggestCalls[1]?.onSelect("/etc/passwd");

		await vi.waitFor(() => expect(noticeSpy).toHaveBeenCalled());
		expect(plugin.saveSettings).not.toHaveBeenCalled();
		expect(plugin.settings.hooksDir).toBe(".tomo-hashi/hooks");
	});
});
