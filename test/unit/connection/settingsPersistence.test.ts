/**
 * Unit tests for settingsPersistence — thin wrappers around
 * Obsidian's `plugin.loadData()` / `plugin.saveData()` that apply
 * `DEFAULT_SETTINGS` merge semantics.
 *
 * Spec: docs/XDD/specs/001-session-view —
 *   - SDD "Data Storage Changes"
 *   - PRD FS2 (remember last connected; survives plugin reload)
 *
 * Per ADR-5 v2 — module-level Obsidian mock provides Plugin with
 * vi.fn-backed loadData / saveData; no port indirection needed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Vitest aliases "obsidian" to the mock at runtime, but tsc still resolves
// the real type — and the real `Plugin` is abstract / not constructible.
// Import the concrete mock class for instantiation; the helpers under test
// accept `PluginDataHost` (structural Pick of `loadData`/`saveData`), so the
// mock is type-compatible without ceremony.
import { Plugin as PluginMock } from "../../__mocks__/obsidian";

import {
	loadSettings,
	saveSettings,
} from "../../../src/connection/settingsPersistence";
import {
	DEFAULT_SETTINGS,
	type PluginSettings,
} from "../../../src/types/index";

describe("settingsPersistence", () => {
	let plugin: PluginMock;

	beforeEach(() => {
		plugin = new PluginMock();
	});

	it("loadSettings returns DEFAULT_SETTINGS when plugin.loadData returns null", async () => {
		vi.mocked(plugin.loadData).mockResolvedValue(null);
		const result = await loadSettings(plugin);
		expect(result).toEqual(DEFAULT_SETTINGS);
	});

	it("loadSettings returns DEFAULT_SETTINGS when plugin.loadData returns empty object", async () => {
		vi.mocked(plugin.loadData).mockResolvedValue({});
		const result = await loadSettings(plugin);
		expect(result).toEqual(DEFAULT_SETTINGS);
	});

	it("loadSettings merges persisted data over defaults", async () => {
		vi.mocked(plugin.loadData).mockResolvedValue({
			chosenInstanceName: "abc123",
		});
		const result = await loadSettings(plugin);
		expect(result).toEqual({ chosenInstanceName: "abc123", zoomLevel: 1 });
	});

	it("saveSettings calls plugin.saveData with the provided settings", async () => {
		const settings: PluginSettings = {
			chosenInstanceName: "def456",
			zoomLevel: 1.5,
		};
		await saveSettings(plugin, settings);
		expect(plugin.saveData).toHaveBeenCalledWith(settings);
	});
});
