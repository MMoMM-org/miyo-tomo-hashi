/**
 * editNoteText handler — literal find-and-replace inside a note's BODY.
 *
 * Introduced by Tomo spec 030 (garden-audit) / ADR-3 to repoint or remove dead
 * `[[wikilinks]]` and strip broken inline `up::` lines — operations the
 * placement-oriented actions cannot express.
 *
 * Contract (tomo-to-hashi 2026-07-21 garden-audit-edit-note-text):
 *   - `match` is a LITERAL substring, never a regex/glob — matched byte-for-byte.
 *   - Matching is restricted to the note BODY; the YAML frontmatter block
 *     (`--- … ---`) is frozen verbatim.
 *   - `replace: ""` deletes the match. When the match is a whole line, the
 *     now-empty line is collapsed so repeated runs never accumulate blanks; an
 *     inline match just loses the substring.
 *   - `occurrence`: "first" (default) replaces the first literal hit; "all"
 *     replaces every hit.
 *   - Match not found ANYWHERE → no-op success (`skipped-already`): the vault
 *     may have been fixed by hand between report and apply, so a stale single
 *     match must not fail the batch.
 *   - Match found ONLY in the frozen frontmatter → `failed`. This action can
 *     never edit it, so reporting success would graduate the action to
 *     `applied: true` and hide a permanently unrepaired note. See the guard in
 *     the handler body for the full reasoning.
 *
 * Single-line-match assumption: garden-audit only ever emits single-line
 * `match` strings. Matching is done line-by-line, which yields clean
 * whole-line-collapse semantics; a hypothetical newline-spanning `match` simply
 * finds nothing and no-ops (skipped-already) rather than corrupting the note.
 *
 * [ref: Tomo handoff 2026-07-21 garden-audit-edit-note-text; spec 030 ADR-3]
 */

import type { EditNoteTextAction } from "../schema/types.js";
import type { ActionOutcome } from "../executor/state.js";
import type { HandlerContext } from "./types.js";

type EditOutcome = Extract<ActionOutcome, { kind: "applied" | "skipped-already" | "failed" }>;

/**
 * Split a note into its frozen frontmatter head (including the closing `---`
 * fence and its trailing newline) and the editable body. When there is no
 * well-formed leading frontmatter block, the whole content is body.
 */
function splitFrontmatter(content: string): { head: string; body: string } {
	if (!content.startsWith("---\n")) return { head: "", body: content };
	const close = content.indexOf("\n---", 4);
	if (close === -1) return { head: "", body: content };
	const afterFence = content.indexOf("\n", close + 1);
	if (afterFence === -1) return { head: content, body: "" };
	return { head: content.slice(0, afterFence + 1), body: content.slice(afterFence + 1) };
}

/** Replace up to `budget` literal occurrences of `match` in a single line. */
function replaceInLine(
	line: string,
	match: string,
	replace: string,
	budget: number,
): { replaced: string; count: number } {
	let result = "";
	let idx = 0;
	let count = 0;
	while (count < budget) {
		const found = line.indexOf(match, idx);
		if (found === -1) break;
		result += line.slice(idx, found) + replace;
		idx = found + match.length;
		count++;
	}
	result += line.slice(idx);
	return { replaced: result, count };
}

/**
 * Apply the literal find-and-replace to the body only. Returns the rewritten
 * full content and whether anything changed. Pure — called both pre-flight
 * (idempotency gate) and inside `vault.process` (race-safe fresh transform).
 */
function applyEdit(
	content: string,
	match: string,
	replace: string,
	occurrence: "first" | "all",
): { content: string; changed: boolean } {
	const { head, body } = splitFrontmatter(content);
	const lines = body.split("\n");
	let budget = occurrence === "all" ? Infinity : 1;
	let total = 0;
	const out: string[] = [];

	for (const line of lines) {
		if (budget <= 0 || !line.includes(match)) {
			out.push(line);
			continue;
		}
		const { replaced, count } = replaceInLine(line, match, replace, budget);
		budget -= count;
		total += count;
		// Whole-line deletion → collapse the now-empty line (drop it entirely)
		// so repeated applies don't accumulate blank lines. An inline deletion
		// (replaced still has other content) keeps the line.
		if (replace === "" && replaced === "" && line !== "") continue;
		out.push(replaced);
	}

	const newContent = head + out.join("\n");
	return { content: newContent, changed: total > 0 && newContent !== content };
}

export async function editNoteText(
	action: EditNoteTextAction,
	ctx: HandlerContext,
): Promise<EditOutcome> {
	const { vault } = ctx;
	const { path, match, replace } = action;
	const occurrence = action.occurrence ?? "first";

	if (!(await vault.exists(path))) {
		return { kind: "failed", reason: "target note missing" };
	}

	// Degenerate empty match: nothing sensible to find — non-destructive no-op.
	if (match === "") {
		return { kind: "skipped-already" };
	}

	const content = await vault.cachedRead(path);
	if (!applyEdit(content, match, replace, occurrence).changed) {
		// No body hit. Two very different situations hide behind that, and
		// conflating them is how a dead link silently marks itself done:
		//
		//   - genuinely absent  → the vault may have been fixed by hand between
		//     report and apply, so a stale match must not fail the batch.
		//     `skipped-already` is right, and it graduates to `applied: true`.
		//   - present, but in the frozen frontmatter → this action CANNOT ever
		//     touch it, in this run or any future one. Reporting success would
		//     graduate the action (InstructionExecutor: applied and
		//     skipped-already both mark `applied: true`), filtering it out of
		//     every subsequent run and leaving the note wrong forever, silently.
		//
		// The second case is a structural blind spot, not a race, so it fails
		// loudly and names the way out.
		const { head } = splitFrontmatter(content);
		if (head !== "" && head.includes(match)) {
			return {
				kind: "failed",
				reason: `match found only in the YAML frontmatter, which edit_note_text never edits (it is a note-body action) — ${path}. Frontmatter properties need a frontmatter-aware action; edit_note_text cannot repair this and must not report it as done`,
			};
		}
		return { kind: "skipped-already" };
	}

	await vault.process(path, (current) => applyEdit(current, match, replace, occurrence).content);
	return { kind: "applied" };
}
