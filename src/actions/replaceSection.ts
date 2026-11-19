/**
 * replaceSection handler — OVERWRITE the body of a heading section in an
 * arbitrary vault note. The deliberate counterpart to `insert_under_marker`:
 * where insert appends and never replaces, `replace_section` writes over the
 * section body. Breaking the "append, never replace" invariant is the whole
 * point of the action, so it is explicit and opt-in (its own action kind)
 * rather than a mode on an insert. (Tomo handoff 2026-06-25.)
 *
 * Heading-scoped for v1: the `anchor` must be `heading`. The replaced range is
 * the section body — the line after the heading down to the next heading of
 * same-or-higher level, or EOF — exactly the range `insert_under_marker`'s
 * `inside`-on-heading computes (reuses sectionLocator). The heading line itself
 * is preserved.
 *
 * Behaviour guarantees:
 *   - Modify-only, never create — missing `target_path` fails gracefully.
 *   - Null value / non-heading anchor / anchor-not-found → fail gracefully,
 *     never a blind write.
 *   - Body already byte-identical to `content` → skipped-already (no rewrite).
 *
 * Anchor resolution reads file content, NOT the async metadataCache — same
 * race discipline as link_to_moc. [miyo-tomo-hashi#68] The section resolves
 * INSIDE the `vault.process` callback on the content it hands over
 * (processResolved), so a range from an earlier read never overwrites lines of
 * a note that changed since; a heading that no longer resolves fails without a
 * write. [#180]
 *
 * [ref: Tomo handoff 2026-06-25 block-anchor-and-replace-section; Tomo spec
 *  024-tag-handler-framework]
 */

import type { ReplaceSectionAction } from "../schema/types.js";
import { type HandlerContext } from "./types.js";
import { processResolved, type EditOutcome, type ResolvedEdit } from "./processResolved.js";
import { locateSection } from "./sectionLocator.js";
import { replaceLines } from "./blockInsert.js";

type ReplaceOutcome = EditOutcome;

export async function replaceSection(
	action: ReplaceSectionAction,
	ctx: HandlerContext,
): Promise<ReplaceOutcome> {
	const { vault } = ctx;
	const path = action.target_path;

	if (!(await vault.exists(path))) {
		return { kind: "failed", reason: "target note missing" };
	}

	const value = action.anchor.value;
	if (value === null) {
		return { kind: "failed", reason: "anchor not found (null value)" };
	}

	if (action.anchor.type !== "heading") {
		return { kind: "failed", reason: "replace_section v1 supports heading anchors only" };
	}

	return processResolved(vault, path, (current) => replaceBody(current, action, value));
}

/** `content` with the section body replaced, or the outcome to report without writing. */
function replaceBody(
	content: string,
	action: ReplaceSectionAction,
	value: string,
): ResolvedEdit {
	const section = locateSection(content, value);
	if (section === null || section.kind !== "heading") {
		return { kind: "failed", reason: `anchor not found: ${value}` };
	}

	const hasTrailingNewline = content.endsWith("\n");
	const lines = content.split("\n");
	const body = hasTrailingNewline ? lines.slice(0, -1) : lines;
	const start = section.startLine;
	const endInclusive = section.endLine === -1 ? body.length - 1 : section.endLine;
	const newLines = action.content.split("\n");

	// Byte-identical body → no-op. Consistent with insert_under_marker's
	// duplicate guard; harmless and avoids a redundant rewrite.
	const existing = body.slice(start, endInclusive + 1);
	if (existing.length === newLines.length && existing.every((l, i) => l === newLines[i])) {
		return { kind: "skipped-already" };
	}

	return replaceLines(content, start, section.endLine, newLines);
}
