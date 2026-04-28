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

type DeleteOutcome = Extract<ActionOutcome, { kind: "applied" | "skipped-already" }>;

export async function deleteSource(
	action: DeleteSourceAction,
	ctx: HandlerContext,
): Promise<DeleteOutcome> {
	const { vault } = ctx;

	if (!(await vault.exists(action.source_path))) {
		return { kind: "skipped-already" };
	}

	await vault.trash(action.source_path);
	return { kind: "applied" };
}
