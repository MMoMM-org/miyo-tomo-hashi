/**
 * Plugin-wide settings persisted via Obsidian's `loadData`/`saveData`.
 *
 * Spec: docs/XDD/specs/001-session-view — SDD "Application Data Models".
 */

export interface PluginSettings {
	/**
	 * Full Docker container ID of the Tomo instance the user last connected to.
	 * `null` if the user has never successfully connected.
	 */
	chosenInstanceId: string | null;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	chosenInstanceId: null,
};
