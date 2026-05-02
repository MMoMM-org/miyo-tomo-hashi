/**
 * deleteSource handler — trash the source file via Obsidian's trash facility.
 *
 * Idempotency:
 *   source present → trashed via vault.trash (link-preserving); returns applied
 *   source absent  → no-op; returns skipped-already
 *
 * MUST use vault.trash, never hard-delete. [ref: PRD/F4]
 */

import type { DeleteSourceAction } from "../schema/types.js";
import type { ActionOutcome } from "../executor/state.js";
import type { HandlerContext } from "./types.js";

// L4: shared handler outcome union — see skip.ts. deleteSource doesn't
// emit "failed" today (vault.trash() failures bubble as exceptions, not
// outcomes), but the broader return type matches the shared Handler<A>
// alias and removes the dispatch-cast asymmetry the reviewer flagged.
type HandlerOutcome = Extract<
	ActionOutcome,
	{ kind: "applied" | "skipped-already" | "failed" }
>;

export async function deleteSource(
	action: DeleteSourceAction,
	ctx: HandlerContext,
): Promise<HandlerOutcome> {
	const { vault } = ctx;

	if (!(await vault.exists(action.source_path))) {
		return { kind: "skipped-already" };
	}

	await vault.trash(action.source_path);
	return { kind: "applied" };
}
