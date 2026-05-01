/**
 * Singleton connection store + inline derived helpers.
 *
 * Per SDD "State Store — typed Store<T> helper" (spec 001-session-view) and
 * ADR-4 v3 (2026-04-25): TomoConnection is the only writer; UI surfaces
 * subscribe and compute derived values inline. No `Readable<T>` split, no
 * `derived<T,U>` helper, no `connectionStoreWrite` capability — the
 * "only TomoConnection writes" rule is enforced by code review.
 */

import { Store } from "../util/store";

import type { ConnectionState } from "./state";

export const connectionStore = new Store<ConnectionState>({
	kind: "disconnected",
});

/**
 * The label to show for the currently-targeted Tomo instance, or `null` when
 * there is nothing to display (disconnected).
 *
 * - `connected` → `instance.name ?? instance.shortId`
 * - `attaching` / `reconnecting` → `target.name ?? target.shortId`
 * - `disconnected` → `null`
 */
export function displayInstanceName(state: ConnectionState): string | null {
	if (state.kind === "connected") {
		return state.instance.name ?? state.instance.shortId;
	}
	if (state.kind === "reconnecting" || state.kind === "attaching") {
		return state.target.name ?? state.target.shortId;
	}
	return null;
}
