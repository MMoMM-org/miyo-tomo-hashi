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
 * Failure cases:
 *   - Daily note missing → failed "Daily note missing: <path>"
 *   - Section not found → failed "Section not found: <section>"
 *
 * [ref: PRD/F4]
 */

import type { UpdateLogLinkAction } from "../schema/types.js";
import type { ActionOutcome } from "../executor/state.js";
import { type HandlerContext } from "./types.js";
import { locateSection } from "./sectionLocator.js";
import { insertAtPosition } from "./logPosition.js";

type UpdateOutcome = Extract<ActionOutcome, { kind: "applied" | "skipped-already" | "failed" }>;

export async function updateLogLink(
	action: UpdateLogLinkAction,
	ctx: HandlerContext,
): Promise<UpdateOutcome> {
	const { vault } = ctx;
	const { daily_note_path, section, position, target_stem, time } = action;

	if (!(await vault.exists(daily_note_path))) {
		return { kind: "failed", reason: `Daily note missing: ${daily_note_path}` };
	}

	const [fileContent, metadata] = await Promise.all([
		vault.cachedRead(daily_note_path),
		vault.metadata(daily_note_path),
	]);

	const range = metadata ? locateSection(metadata, fileContent, section) : null;
	if (!range) {
		return { kind: "failed", reason: `Section not found: ${section}` };
	}

	// Build the wikilink line (at_time aligns with update_log_entry: `- HH:MM: <payload>`)
	const lineToInsert = position === "at_time" && time
		? `- ${time}: [[${target_stem}]]`
		: `- [[${target_stem}]]`;

	// Idempotency check: scan section for exact match
	const fileLines = fileContent.split("\n");
	const end = range.endLine === -1 ? fileLines.length - 1 : range.endLine;
	for (let i = range.startLine; i <= end; i++) {
		if (fileLines[i] === lineToInsert) {
			return { kind: "skipped-already" };
		}
	}

	// Slice section content and insert
	const sectionLines = range.endLine === -1
		? fileLines.slice(range.startLine)
		: fileLines.slice(range.startLine, range.endLine + 1);
	const sectionContent = sectionLines.join("\n");

	const newSectionContent = insertAtPosition(
		sectionContent,
		lineToInsert,
		position,
		position === "at_time" ? (time ?? undefined) : undefined,
	);

	await vault.process(daily_note_path, (current) =>
		spliceSectionContent(current, range.startLine, range.endLine, newSectionContent),
	);

	return { kind: "applied" };
}

/**
 * Replace the lines in [startLine, endLine] (inclusive) with newSectionContent.
 * When endLine === -1, replaces from startLine to EOF.
 */
function spliceSectionContent(
	fileContent: string,
	startLine: number,
	endLine: number,
	newSectionContent: string,
): string {
	const lines = fileContent.split("\n");

	const hasTrailingNewline = fileContent.endsWith("\n");
	const body = hasTrailingNewline ? lines.slice(0, -1) : lines;

	const before = body.slice(0, startLine);
	const after = endLine === -1 ? [] : body.slice(endLine + 1);

	const newLines = newSectionContent.endsWith("\n")
		? newSectionContent.slice(0, -1).split("\n")
		: newSectionContent.split("\n");

	const result = [...before, ...newLines, ...after];
	return result.join("\n") + "\n";
}
