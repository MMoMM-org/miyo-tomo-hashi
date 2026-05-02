/**
 * skip handler — no-op; always returns applied.
 *
 * The executor advances `applied: true` for this action. The handler MUST NOT
 * make any vault edits. [ref: PRD/F4]
 */

import type { SkipAction } from "../schema/types.js";
import type { ActionOutcome } from "../executor/state.js";
import type { HandlerContext } from "./types.js";

// L4: shared handler outcome union — every handler returns the same broad
// shape so the dispatch table and orchestrator don't need cast back-and-
// forth gymnastics. skip never actually returns "skipped-already" or
// "failed" today, but the broader type matches every other handler and
// gives us room to grow.
type HandlerOutcome = Extract<
	ActionOutcome,
	{ kind: "applied" | "skipped-already" | "failed" }
>;

export async function skip(
	_action: SkipAction,
	_ctx: HandlerContext,
): Promise<HandlerOutcome> {
	return { kind: "applied" };
}
