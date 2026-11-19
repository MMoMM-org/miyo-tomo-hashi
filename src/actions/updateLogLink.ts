/**
 * updateLogLink handler — insert a wikilink line into a named section of a daily note.
 *
 * Hashi-composed line shape (per Tomo contract 2026-04-29):
 *   - after_last_line / before_first_line: `- [[target_stem]]`
 *   - at_time:                              `- <time>: [[target_stem]]`
 * The two log-targeting kinds (update_log_entry + update_log_link) share the same
 * time-prefix shape since they coexist in the same Daily Log section.
 *
 * Idempotency: if an identical composed line already exists in the section → skipped-already (no mutation).
 *
 * The section is located on the content vault.process hands over, so lines
 * added to the note after an earlier read cannot shift the insert (#183).
 *
 * Failure cases:
 *   - Daily note missing → failed "Daily note missing: <path>"
 *   - Section not found → failed "Section not found: <section>"
 *
 * [ref: PRD/F4]
 */

import type { UpdateLogLinkAction } from "../schema/types.js";
import { type HandlerContext } from "./types.js";
import { processResolved, type EditOutcome } from "./processResolved.js";
import { insertLogLine } from "./logPosition.js";

export async function updateLogLink(
	action: UpdateLogLinkAction,
	ctx: HandlerContext,
): Promise<EditOutcome> {
	const { vault } = ctx;
	const { daily_note_path, section, position, target_stem, time } = action;

	if (!(await vault.exists(daily_note_path))) {
		return { kind: "failed", reason: `Daily note missing: ${daily_note_path}` };
	}

	// Build the wikilink line (at_time aligns with update_log_entry: `- HH:MM: <payload>`)
	const lineToInsert = position === "at_time" && time
		? `- ${time}: [[${target_stem}]]`
		: `- [[${target_stem}]]`;
	const atTime = position === "at_time" ? (time ?? undefined) : undefined;

	return processResolved(vault, daily_note_path, (current) =>
		insertLogLine(current, section, lineToInsert, position, atTime),
	);
}
