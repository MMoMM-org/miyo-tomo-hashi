/**
 * Unit tests for settingsPersistence — thin wrappers around
 * Obsidian's `plugin.loadData()` / `plugin.saveData()` that apply
 * `DEFAULT_SETTINGS` merge semantics.
 *
 * Spec: docs/XDD/specs/001-session-view —
 *   - SDD "Data Storage Changes"
 *   - PRD FS2 (remember last connected; survives plugin reload)
 * Spec: docs/XDD/specs/003-ide-bridge —
 *   - SDD lines 300-308 (IDE settings fields + v1→v2 migration)
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
		// Merge: persisted field wins; all other fields take DEFAULT_SETTINGS values.
		expect(result).toEqual({ ...DEFAULT_SETTINGS, chosenInstanceName: "abc123" });
	});

	it("saveSettings calls plugin.saveData with the provided settings", async () => {
		const settings: PluginSettings = {
			...DEFAULT_SETTINGS,
			chosenInstanceName: "def456",
			zoomLevel: 1.5,
		};
		await saveSettings(plugin, settings);
		expect(plugin.saveData).toHaveBeenCalledWith(settings);
	});

	// --- v1 → v2 migration (T4.1 — IDE settings fields) ---

	it("loadSettings migrates a v1 blob: bumps settings_version to current and adds IDE + suggestions fields at defaults", async () => {
		// v1 blob: explicitly carries settings_version 1, no IDE fields
		const v1Blob: Partial<PluginSettings> = {
			settings_version: 1,
			chosenInstanceName: "my-tomo",
			zoomLevel: 1.5,
			tomoInboxFolder: "inbox",
			executionMode: "auto-run",
			runLogRetention: "only-after-failed",
			hooksDir: ".hooks",
			hooksPolicy: "enabled",
			debugLogging: true,
		};
		vi.mocked(plugin.loadData).mockResolvedValue(v1Blob);
		const result = await loadSettings(plugin);

		// Version must be bumped to the current schema version (3)
		expect(result.settings_version).toBe(3);

		// IDE fields defaulted (absent in v1 blob)
		expect(result.ideBridgeEnabled).toBe(false);
		expect(result.ideBridgePort).toBe(23027);
		expect(result.ideBridgeAuthToken).toBe("");

		// suggestions-editor picker scopes defaulted (absent in v1 blob)
		expect(result.suggestionsTemplateFolder).toBe("");
		expect(result.suggestionsLocationFolders).toEqual([]);
		expect(result.suggestionsTagFilters).toEqual([]);

		// All prior fields preserved as stored (not overwritten by defaults)
		expect(result.chosenInstanceName).toBe("my-tomo");
		expect(result.zoomLevel).toBe(1.5);
		expect(result.tomoInboxFolder).toBe("inbox");
		expect(result.executionMode).toBe("auto-run");
		expect(result.runLogRetention).toBe("only-after-failed");
		expect(result.hooksDir).toBe(".hooks");
		expect(result.hooksPolicy).toBe("enabled");
		expect(result.debugLogging).toBe(true);
	});

	it("loadSettings does not overwrite an existing ideBridgeAuthToken during migration", async () => {
		// Scenario: a partially-migrated v1 blob that already has a token
		// (e.g. written by a pre-release build) must keep the token intact.
		const blobWithToken: Partial<PluginSettings> = {
			settings_version: 1,
			chosenInstanceName: null,
			ideBridgeAuthToken: "hashi_existing-token",
		};
		vi.mocked(plugin.loadData).mockResolvedValue(blobWithToken);
		const result = await loadSettings(plugin);

		expect(result.settings_version).toBe(3);
		expect(result.ideBridgeAuthToken).toBe("hashi_existing-token");
	});

	it("loadSettings migrates a v2 blob to the current version, preserving its fields", async () => {
		const v2Blob: PluginSettings = {
			...DEFAULT_SETTINGS,
			settings_version: 2,
			chosenInstanceName: "prod-tomo",
			ideBridgeEnabled: true,
			ideBridgePort: 23027,
			ideBridgeAuthToken: "hashi_abc-123",
		};
		vi.mocked(plugin.loadData).mockResolvedValue(v2Blob);
		const result = await loadSettings(plugin);

		// Only the version bumps (v2→v3); the suggestions fields were already
		// present here via the DEFAULT_SETTINGS spread, so nothing else changes.
		expect(result).toEqual({ ...v2Blob, settings_version: 3 });
	});

	it("loadSettings treats null payload as current-version defaults", async () => {
		vi.mocked(plugin.loadData).mockResolvedValue(null);
		const result = await loadSettings(plugin);

		expect(result.settings_version).toBe(3);
		expect(result.ideBridgeEnabled).toBe(false);
		expect(result.ideBridgePort).toBe(23027);
		expect(result.ideBridgeAuthToken).toBe("");
	});
});
