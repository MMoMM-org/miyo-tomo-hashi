/**
 * logPosition — pure string helper for inserting a line at a named position.
 *
 * Returns the full new file content as a string. Does not touch the vault.
 *
 * [ref: PRD/F4; SDD/Implementation Examples]
 */

import type { ResolvedEdit } from "./processResolved.js";
import { locateSection } from "./sectionLocator.js";

export type LogPositionKind = "after_last_line" | "before_first_line" | "at_time";

// Matches Hashi-composed time-prefix lines: `- HH:MM: …`
// (Old `HH:MM …` shape retired by 2026-04-29 Tomo contract update.)
const TIME_PREFIX = /^-\s+(\d{2}:\d{2}):/;

/**
 * Insert `line` into `content` at the specified `position`.
 *
 * When `position === "at_time"`, `atTime` must be provided as "HH:MM".
 * The new line is placed after the last existing line whose HH:MM prefix is
 * <= atTime (lex order). Ties insert after the LAST equal-time line — defensive
 * choice so repeated same-time entries stay in insertion order.
 * Falls back to append when no time-prefixed lines exist.
 */
export function insertAtPosition(
	content: string,
	line: string,
	position: LogPositionKind,
	atTime?: string,
): string {
	if (position === "before_first_line") {
		return `${line}\n${content}`;
	}

	if (position === "after_last_line") {
		const body = content === "" || content.endsWith("\n") ? content : `${content}\n`;
		return `${body}${line}\n`;
	}

	// at_time
	return insertAtTime(content, line, atTime ?? "00:00");
}

function insertAtTime(content: string, line: string, atTime: string): string {
	const lines = content.split("\n");
	// Remove the trailing empty string produced by a final "\n"
	const hasTrailingNewline = content.endsWith("\n");
	const body = hasTrailingNewline ? lines.slice(0, -1) : lines;

	let insertAfter = -1;
	let hasTimeLine = false;
	for (let i = 0; i < body.length; i++) {
		const m = TIME_PREFIX.exec(body[i] ?? "");
		if (!m) continue;
		hasTimeLine = true;
		if (m[1]! <= atTime) insertAfter = i;
	}

	// Fallback: no time-prefixed lines → append at end (per Tomo contract)
	const spliceAt = hasTimeLine ? insertAfter + 1 : body.length;
	const out = [...body];
	out.splice(spliceAt, 0, line);
	return out.join("\n") + "\n";
}

/**
 * `content` with `line` inserted at `position` inside the named section, or
 * the outcome to report without writing. Shared by update_log_entry and
 * update_log_link, which run it on the content vault.process hands over
 * (#183).
 */
export function insertLogLine(
	content: string,
	section: string,
	line: string,
	position: LogPositionKind,
	atTime?: string,
): ResolvedEdit {
	const range = locateSection(content, section);
	if (!range) {
		return { kind: "failed", reason: `Section not found: ${section}` };
	}

	const fileLines = content.split("\n");
	const end = range.endLine === -1 ? fileLines.length - 1 : range.endLine;
	for (let i = range.startLine; i <= end; i++) {
		if (fileLines[i] === line) {
			return { kind: "skipped-already" };
		}
	}

	const sectionLines = range.endLine === -1
		? fileLines.slice(range.startLine)
		: fileLines.slice(range.startLine, range.endLine + 1);
	const newSectionContent = insertAtPosition(sectionLines.join("\n"), line, position, atTime);

	return spliceSectionContent(content, range.startLine, range.endLine, newSectionContent);
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

	// Remove trailing newline artifact from split if file ends with \n
	const hasTrailingNewline = fileContent.endsWith("\n");
	const body = hasTrailingNewline ? lines.slice(0, -1) : lines;

	const before = body.slice(0, startLine);
	const after = endLine === -1 ? [] : body.slice(endLine + 1);

	// newSectionContent from insertAtPosition ends with "\n"; split it back
	const newLines = newSectionContent.endsWith("\n")
		? newSectionContent.slice(0, -1).split("\n")
		: newSectionContent.split("\n");

	const result = [...before, ...newLines, ...after];
	return result.join("\n") + "\n";
}
