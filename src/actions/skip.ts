/**
 * skip handler — no-op; always returns applied.
 *
 * The executor advances `applied: true` for this action. The handler MUST NOT
 * make any vault edits. [ref: PRD/F4]
 */

import type { SkipAction } from "../schema/types.js";
import type { ActionOutcome } from "../executor/state.js";
import type { HandlerContext } from "./types.js";

type SkipOutcome = Extract<ActionOutcome, { kind: "applied" }>;

export async function skip(
	_action: SkipAction,
	_ctx: HandlerContext,
): Promise<SkipOutcome> {
	return { kind: "applied" };
}
