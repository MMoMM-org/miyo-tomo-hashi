/**
 * Shared handler types for action handlers.
 *
 * HandlerContext is defined here so each handler imports from one place.
 * T3.6 (src/actions/index.ts) will re-export from this module.
 *
 * [ref: SDD/Handler Contract; plan/phase-3.md T3.2]
 */

import type { VaultFS } from "../vault/VaultFS.js";
import type { Clock } from "../executor/state.js";

export interface HandlerContext {
	readonly vault: VaultFS;
	readonly clock: Clock;
}

/**
 * Return the directory portion of a vault-relative path.
 * dirOf("foo/bar/baz.md") === "foo/bar"
 * dirOf("baz.md") === ""
 */
export function dirOf(path: string): string {
	const idx = path.lastIndexOf("/");
	return idx === -1 ? "" : path.slice(0, idx);
}
