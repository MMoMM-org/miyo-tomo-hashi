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
	// Forward migration to the CURRENT schema version: an older stored blob
	// carries a lower (or absent → treated as v1) settings_version, so a bare
	// spread would keep it stale. Bump it to the current version and let the
	// DEFAULT_SETTINGS merge below fill any fields the older shape lacked at
	// their defaults (v1→v2 added the IDE fields; v2→v3 the suggestions-editor
	// picker scopes). All other stored fields are preserved by the spread.
	const currentVersion = DEFAULT_SETTINGS.settings_version ?? 1;
	const patched: Partial<PluginSettings> =
		(stored?.settings_version ?? 1) < currentVersion
			? { ...stored, settings_version: currentVersion }
			: (stored ?? {});
	return { ...DEFAULT_SETTINGS, ...patched };
}

export async function saveSettings(
	plugin: PluginDataHost,
	settings: PluginSettings,
): Promise<void> {
	await plugin.saveData(settings);
}
