/**
 * IDE Bridge state machine — the single source of truth for whether Hashi's
 * localhost WebSocket server is running, accepting clients, or has failed.
 *
 * Mirrors the ConnectionState discriminated-union style (src/connection/state.ts)
 * but, per ADR-6, is the ONE place that carries the error tier: unlike
 * ConnectionState, it has a dedicated `error` kind.
 *
 * Spec: docs/XDD/specs/003-ide-bridge — SDD "Application Data Models".
 */

export type IdeBridgeState =
	| { kind: "stopped" }
	| { kind: "listening"; port: number }
	| { kind: "connected"; port: number; clientCount: number } // clientCount >= 1
	| { kind: "error"; reason: string }; // e.g. "port 23027 in use"

/** A human-facing label and a status color for an IdeBridgeState variant. */
export type IdeBridgeStateDescription = { label: string; color: string };

/**
 * Map each IdeBridgeState variant to a label/color for status surfaces.
 *
 * The `default: const _exhaustive: never = state` branch makes adding a new
 * variant a compile error until this switch handles it.
 */
export function describeIdeBridgeState(
	state: IdeBridgeState,
): IdeBridgeStateDescription {
	switch (state.kind) {
		case "stopped":
			return { label: "Stopped", color: "var(--text-muted)" };
		case "listening":
			return { label: "Listening", color: "var(--text-accent)" };
		case "connected":
			return { label: "Connected", color: "var(--text-success)" };
		case "error":
			return { label: "Error", color: "var(--text-error)" };
		default: {
			const _exhaustive: never = state;
			return _exhaustive;
		}
	}
}
