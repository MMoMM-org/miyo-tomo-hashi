/**
 * Plugin-wide settings persisted via Obsidian's `loadData`/`saveData`.
 *
 * Spec: docs/XDD/specs/001-session-view — SDD "Application Data Models";
 *       docs/XDD/specs/002-instruction-executor — SDD "Plugin Settings".
 */

import type { ExecutionMode } from "../executor/state";

/**
 * Permitted xterm font-size multipliers for the chat-view "magnify" control.
 * Discrete to keep the UI a fixed-arity selector and avoid the rounding /
 * fit-loop instability of a continuous slider against xterm's cell grid.
 */
export const ZOOM_LEVELS = [0.5, 1, 1.5] as const;
export type ZoomLevel = (typeof ZOOM_LEVELS)[number];

export interface PluginSettings {
	// --- meta ---

	/**
	 * Schema version for the persisted settings shape (review L3). Bump on
	 * any rename / type change so loadSettings can run a migration block
	 * before merging defaults. Optional in storage so upgrades from v0.0.x
	 * (no field) read as version 1 by default; loadSettings normalizes.
	 */
	settings_version?: number;

	// --- 001 fields ---

	/**
	 * Tomo instance name (from the `miyo.tomo.instance-name` Docker label,
	 * set by begin-tomo.sh per Tomo install). Stable across container
	 * stop+start, unlike the container ID — that's why we persist by name.
	 * `null` if the user has never successfully connected, or if the chosen
	 * instance had no name label (rare; production Tomo always sets it).
	 */
	chosenInstanceName: string | null;
	/**
	 * Font-size multiplier for the chat view's xterm. Persisted so the user
	 * doesn't re-pick on every reload.
	 */
	zoomLevel: ZoomLevel;

	// --- 002 fields (NEW — instruction executor) ---

	/**
	 * Vault-relative path to the Tomo inbox folder watched for
	 * `_instructions.json` files. Empty string until configured by the user.
	 * Spec: docs/XDD/specs/002-instruction-executor — PRD F1, SDD "Plugin Settings".
	 */
	tomoInboxFolder: string;
	/**
	 * Controls how the executor presents a run to the user.
	 * - "confirm": preview modal, user must approve before execution.
	 * - "auto-run": preview shown then auto-proceeds after brief delay.
	 * - "silent": executes immediately with no modal.
	 * Spec: PRD F11.
	 */
	executionMode: ExecutionMode;
	/**
	 * Whether run logs are retained after every run or only after a failed run.
	 * Spec: PRD F11.
	 */
	runLogRetention: "always" | "only-after-failed";
	/**
	 * Vault-relative path to the directory scanned for user-authored hook
	 * scripts (before-X / after-X .js files). Spec: PRD F8, F11.
	 */
	hooksDir: string;
	/**
	 * Policy for executing hook scripts.
	 * - "enabled": run all hooks unconditionally.
	 * - "disabled": kill-switch — no hooks run (equivalent to disableAllHooks).
	 * - "ask": prompt the user once per hook file per session.
	 * Spec: PRD F8, F11. Note: no separate `disableAllHooks` field — "disabled"
	 * IS the kill-switch per SDD decision recorded in plan/README.md.
	 */
	hooksPolicy: "enabled" | "disabled" | "ask";
	/**
	 * When true, verbose executor logging is written to the developer console.
	 * Spec: PRD F11.
	 */
	debugLogging: boolean;

	// --- 003 fields (NEW — ide-bridge) ---

	/**
	 * Whether the IDE bridge WebSocket server is active. Persisted so the user's
	 * preference survives plugin reload. Spec: docs/XDD/specs/003-ide-bridge — SDD lines 300-308.
	 */
	ideBridgeEnabled: boolean;
	/**
	 * Port the IDE bridge WebSocket server listens on.
	 * Spec: docs/XDD/specs/003-ide-bridge — SDD lines 300-308.
	 */
	ideBridgePort: number;
	/**
	 * Bearer token used to authenticate IDE clients.
	 * Empty string until first enable; format: `hashi_<UUID>`.
	 * Spec: docs/XDD/specs/003-ide-bridge — SDD lines 300-308.
	 */
	ideBridgeAuthToken: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	settings_version: 2,
	// 001 defaults
	chosenInstanceName: null,
	zoomLevel: 1,
	// 002 defaults
	tomoInboxFolder: "",
	executionMode: "confirm",
	runLogRetention: "always",
	hooksDir: ".tomo-hashi/hooks",
	hooksPolicy: "ask",
	debugLogging: false,
	// 003 defaults
	ideBridgeEnabled: false,
	ideBridgePort: 23027,
	ideBridgeAuthToken: "",
};
