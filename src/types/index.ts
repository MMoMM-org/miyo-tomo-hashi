/**
 * Plugin-wide settings persisted via Obsidian's `loadData`/`saveData`.
 *
 * Spec: docs/XDD/specs/001-session-view — SDD "Application Data Models".
 */

/**
 * Permitted xterm font-size multipliers for the chat-view "magnify" control.
 * Discrete to keep the UI a fixed-arity selector and avoid the rounding /
 * fit-loop instability of a continuous slider against xterm's cell grid.
 */
export const ZOOM_LEVELS = [0.5, 1, 1.5] as const;
export type ZoomLevel = (typeof ZOOM_LEVELS)[number];

export interface PluginSettings {
	/**
	 * Full Docker container ID of the Tomo instance the user last connected to.
	 * `null` if the user has never successfully connected.
	 */
	chosenInstanceId: string | null;
	/**
	 * Font-size multiplier for the chat view's xterm. Persisted so the user
	 * doesn't re-pick on every reload.
	 */
	zoomLevel: ZoomLevel;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	chosenInstanceId: null,
	zoomLevel: 1,
};
