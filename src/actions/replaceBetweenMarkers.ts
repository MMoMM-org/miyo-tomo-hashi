/**
 * replaceBetweenMarkers handler — replace ONLY the lines strictly between a
 * start-marker line and its end-marker line in an existing note (#179).
 *
 * Why it exists: Tomo's `/review` (Tomo spec 046) writes one block per section
 * of the user's own weekly/monthly/quarterly note, fenced by two invisible
 * marker lines (`%% tomo:s1 2026-W13 %%` … `%% /tomo:s1 2026-W13 %%`). The
 * first delivery is an `insert_under_marker`; a re-run must refresh just that
 * block. `replace_section` would discard the user's text in the same section,
 * so this is its own kind, with the marker lines and every line outside them
 * kept byte-identical.
 *
 * Marker lines (Tomo handoff 2026-11-14 §2): unfenced, starting at column 0,
 * `line.trimEnd() === marker` (trailing whitespace and `\r` tolerated). The
 * start marker must be unique in the whole note; the end is the first end
 * marker after it, and any other end-marker line is an error. The optional
 * `scope` is a level-aware heading lookup (no callout fallback) that can only
 * turn an apply into a failure.
 *
 * Race discipline: unlike `insert_under_marker` / `replace_section` (#180),
 * the markers are resolved INSIDE the `vault.process` callback on the content
 * it hands over — line indexes from an earlier read are never spliced into a
 * note that may have changed since. When the markers do not resolve, or the
 * block already equals `content`, the callback throws a sentinel so process()
 * writes nothing.
 *
 * Line endings: new lines take the start-marker line's ending, so a CRLF note
 * stays CRLF.
 *
 * [ref: Tomo handoff 2026-11-14 replace-between-markers; Tomo spec 046]
 */

import type { ReplaceBetweenMarkersAction } from "../schema/types.js";
import type { ActionOutcome } from "../executor/state.js";
import { type HandlerContext } from "./types.js";
import { fencedLineMask, parseHeadings } from "./markdownStructure.js";

type ReplaceOutcome = Extract<ActionOutcome, { kind: "applied" | "skipped-already" | "failed" }>;

/** Thrown inside the process() callback to abort the write with an outcome. */
class Abort extends Error {
	constructor(readonly outcome: ReplaceOutcome) {
		super(outcome.kind);
	}
}

export async function replaceBetweenMarkers(
	action: ReplaceBetweenMarkersAction,
	ctx: HandlerContext,
): Promise<ReplaceOutcome> {
	const { vault } = ctx;
	const path = action.target_path;

	if (!(await vault.exists(path))) {
		return { kind: "failed", reason: "target note missing" };
	}
	if (action.start_marker === action.end_marker) {
		return { kind: "failed", reason: "markers equal" };
	}

	try {
		await vault.process(path, (current) => {
			const result = replaceBlock(current, action);
			if (typeof result !== "string") throw new Abort(result);
			return result;
		});
	} catch (err) {
		if (err instanceof Abort) return err.outcome;
		throw err;
	}
	return { kind: "applied" };
}

/** The rewritten content, or the outcome to report without writing. */
function replaceBlock(
	content: string,
	action: ReplaceBetweenMarkersAction,
): string | ReplaceOutcome {
	const lines = content.split("\n");
	const fenced = fencedLineMask(lines);
	const markerLines = (marker: string): number[] =>
		lines.flatMap((line, i) => (!fenced[i] && line.trimEnd() === marker ? [i] : []));

	const starts = markerLines(action.start_marker);
	if (starts.length === 0) return { kind: "failed", reason: "start marker not found" };
	if (starts.length > 1) return { kind: "failed", reason: "start marker duplicated" };
	const start = starts[0]!;

	const ends = markerLines(action.end_marker);
	const end = ends.find((i) => i > start);
	if (end === undefined) return { kind: "failed", reason: "end marker missing" };
	if (ends.length > 1) {
		return { kind: "failed", reason: "end marker duplicated or out of order" };
	}

	if (action.scope !== undefined) {
		const range = scopeRange(lines, action.scope);
		if (range === null) return { kind: "failed", reason: "scope heading not found" };
		if (start <= range.heading || end >= range.endExclusive) {
			return { kind: "failed", reason: "markers outside scope" };
		}
	}

	const eol = lines[start]!.endsWith("\r") ? "\r" : "";
	const wanted = action.content === "" ? [] : action.content.split("\n");
	const existing = lines.slice(start + 1, end);
	const unchanged =
		existing.length === wanted.length &&
		existing.every((line, i) => stripCr(line) === wanted[i]);
	if (unchanged) return { kind: "skipped-already" };

	lines.splice(start + 1, end - start - 1, ...wanted.map((line) => line + eol));
	return lines.join("\n");
}

/** The scoped heading's line and the index where its section ends. */
function scopeRange(
	lines: readonly string[],
	scope: { readonly heading: string; readonly level: number },
): { heading: number; endExclusive: number } | null {
	const headings = parseHeadings(lines);
	const at = headings.findIndex((h) => h.heading === scope.heading && h.level === scope.level);
	if (at === -1) return null;
	const next = headings.slice(at + 1).find((h) => h.level <= scope.level);
	return { heading: headings[at]!.line, endExclusive: next?.line ?? lines.length };
}

function stripCr(line: string): string {
	return line.endsWith("\r") ? line.slice(0, -1) : line;
}
