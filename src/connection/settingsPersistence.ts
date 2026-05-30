/**
 * settingsPersistence — thin wrappers around Obsidian's `plugin.loadData()`
 * and `plugin.saveData()`. Applies `DEFAULT_SETTINGS` merge semantics so
 * callers can rely on a fully-populated `PluginSettings` even when the
 * stored payload is missing, partial, or `null`.
 *
 * Spec: docs/XDD/specs/001-session-view —
 *   - SDD "Data Storage Changes" (PluginSettings shape)
 *   - PRD FS2 (remember last connected; survives plugin reload)
 *
 * Decision: only the type from `obsidian` is referenced — the runtime is
 * supplied by the host. Tests substitute the mock at
 * `test/__mocks__/obsidian.ts`.
 */

import type { Plugin } from "obsidian";

import { DEFAULT_SETTINGS, type PluginSettings } from "../types/index";

/**
 * Minimal structural surface needed for settings persistence — the two
 * Obsidian `Plugin` data hooks. Declared explicitly so unit tests can pass
 * the mock from `test/__mocks__/obsidian.ts` without satisfying the full
 * `Plugin` abstract surface (which carries dozens of unrelated members and
 * is non-instantiable for the real module).
 *
 * The real `Plugin` class structurally satisfies this — verified by the
 * production wire-up in `src/main.ts`.
 */
export type PluginDataHost = Pick<Plugin, "loadData" | "saveData">;

export async function loadSettings(
	plugin: PluginDataHost,
): Promise<PluginSettings> {
	const stored = (await plugin.loadData()) as Partial<PluginSettings> | null;
	// v1 → v2 migration (T4.1): stored v1 blobs carry settings_version: 1
	// explicitly, so a bare spread would keep version at 1. Force it to 2 and
	// ensure the 3 new IDE fields are present at their defaults when absent.
	// All other stored fields are preserved via the spread below.
	const patched: Partial<PluginSettings> =
		(stored?.settings_version ?? 1) < 2
			? { ...stored, settings_version: 2 }
			: (stored ?? {});
	return { ...DEFAULT_SETTINGS, ...patched };
}

export async function saveSettings(
	plugin: PluginDataHost,
	settings: PluginSettings,
): Promise<void> {
	await plugin.saveData(settings);
}
