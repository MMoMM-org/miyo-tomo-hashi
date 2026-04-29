/**
 * HookContext — the invocation context passed to every hook function.
 *
 * ADR-10 v2: { action, app, logger } — no runState, no narrowed vault facade.
 *
 * [ref: PRD/F8; ADR-10 v2; T4.4]
 */

import type { App } from "obsidian";
import type { Action } from "../schema/types.js";

// ---------------------------------------------------------------------------
// HookLogger — writes into the run log; not console.*
// ---------------------------------------------------------------------------

export interface HookLogger {
	info(msg: string): void;
	warn(msg: string): void;
	error(msg: string): void;
}

// ---------------------------------------------------------------------------
// HookContext — passed to every hook function
// ---------------------------------------------------------------------------

export interface HookContext {
	readonly action: Action;
	readonly app: App;
	readonly logger: HookLogger;
}
