/**
 * updateLogEntry handler — insert a prose line into a named section of a daily note.
 *
 * Position semantics (operated within the named section):
 *   - after_last_line:   append after the last line of the section
 *   - before_first_line: insert before the first line of the section
 *   - at_time HH:MM:     insert chronologically by time prefix using logPosition helper
 *
 * Hashi-composed line shape (per Tomo contract 2026-04-29):
 *   - after_last_line / before_first_line: `- <content>` (verbatim trigger-phrase prose)
 *   - at_time:                              `- <time>: <content>`
 * Tomo emits `content` as bare prose (no bullet, no time prefix); Hashi composes the
 * bullet and time prefix at execute time.
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

import type { UpdateLogEntryAction } from "../schema/types.js";
import { type HandlerContext } from "./types.js";
import { processResolved, type EditOutcome } from "./processResolved.js";
import { insertLogLine } from "./logPosition.js";

export async function updateLogEntry(
	action: UpdateLogEntryAction,
	ctx: HandlerContext,
): Promise<EditOutcome> {
	const { vault } = ctx;
	const { daily_note_path, section, position, content: lineContent, time } = action;

	if (!(await vault.exists(daily_note_path))) {
		return { kind: "failed", reason: `Daily note missing: ${daily_note_path}` };
	}

	// Build the line to insert (Hashi composes bullet + optional time prefix)
	const lineToInsert = position === "at_time" && time
		? `- ${time}: ${lineContent}`
		: `- ${lineContent}`;
	const atTime = position === "at_time" ? (time ?? undefined) : undefined;

	return processResolved(vault, daily_note_path, (current) =>
		insertLogLine(current, section, lineToInsert, position, atTime),
	);
}
