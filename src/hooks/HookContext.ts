/**
 * HookContext — the invocation context passed to every hook function.
 *
 * ADR-10 v2: { action, app, logger } — no runState, no narrowed vault facade.
 *
 * **Public API.** This shape is documented in README.md ("Hook function
 * signature") as the stable v0.1 hook contract that user-authored hook
 * scripts depend on. Changes are governed by review/spec-002 H8:
 *   - additive (new fields): non-breaking, no version bump required
 *   - removal / rename of any field: breaking, requires major version
 *     bump and a migration note in the README + a Kokoro ADR
 * If you're tempted to change this shape, check README.md and ADR-10
 * first.
 *
 * [ref: PRD/F8; ADR-10 v2; T4.4; review/spec-002 H8]
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
