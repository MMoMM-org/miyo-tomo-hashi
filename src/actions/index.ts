/**
 * Public façade for the actions package.
 *
 * Exports:
 *   - Handler<A>       — generic handler type alias (SDD/Action Handler Contract)
 *   - HandlerContext   — re-exported from ./types
 *   - HANDLERS         — dispatch registry keyed by ActionKind
 *   - 8 handler functions — re-exported for direct import convenience
 *
 * Note: Action discriminant is `action`, not `kind` (see plan/README.md T1.2 deviation).
 * HANDLERS is therefore typed as { [K in ActionKind]: Handler<Extract<Action, { action: K }>> }.
 *
 * [ref: PRD/F4; SDD/Action Handler Contract; SDD/ADR-4]
 */

import type { Action, ActionKind } from "../schema/types.js";
import type { ActionOutcome } from "../executor/state.js";
import type { HandlerContext } from "./types.js";

import { createMoc } from "./createMoc.js";
import { moveNote } from "./moveNote.js";
import { linkToMoc } from "./linkToMoc.js";
import { insertUnderMarker } from "./insertUnderMarker.js";
import { addRelationship } from "./addRelationship.js";
import { updateTracker } from "./updateTracker.js";
import { updateLogEntry } from "./updateLogEntry.js";
import { updateLogLink } from "./updateLogLink.js";
import { deleteSource } from "./deleteSource.js";
import { skip } from "./skip.js";

// ---------------------------------------------------------------------------
// Handler<A> — generic handler type alias
// ---------------------------------------------------------------------------

export type Handler<A extends Action> = (
	action: A,
	ctx: HandlerContext,
) => Promise<Extract<ActionOutcome, { kind: "applied" | "skipped-already" | "failed" }>>;

// ---------------------------------------------------------------------------
// Re-export HandlerContext so callers can import from one place
// ---------------------------------------------------------------------------

export type { HandlerContext } from "./types.js";

// ---------------------------------------------------------------------------
// HANDLERS — dispatch registry
// ---------------------------------------------------------------------------

export const HANDLERS: {
	readonly [K in ActionKind]: Handler<Extract<Action, { action: K }>>;
} = {
	create_moc: createMoc,
	move_note: moveNote,
	link_to_moc: linkToMoc,
	insert_under_marker: insertUnderMarker,
	add_relationship: addRelationship,
	update_tracker: updateTracker,
	update_log_entry: updateLogEntry,
	update_log_link: updateLogLink,
	delete_source: deleteSource,
	skip: skip,
};

// ---------------------------------------------------------------------------
// Re-export handler functions for direct import
// ---------------------------------------------------------------------------

export { createMoc } from "./createMoc.js";
export { moveNote } from "./moveNote.js";
export { linkToMoc } from "./linkToMoc.js";
export { insertUnderMarker } from "./insertUnderMarker.js";
export { addRelationship } from "./addRelationship.js";
export { updateTracker } from "./updateTracker.js";
export { updateLogEntry } from "./updateLogEntry.js";
export { updateLogLink } from "./updateLogLink.js";
export { deleteSource } from "./deleteSource.js";
export { skip } from "./skip.js";
