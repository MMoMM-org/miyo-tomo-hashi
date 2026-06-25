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
 * Anchor resolution reads the freshly-read file content (`cachedRead`), NOT the
 * async metadataCache — same race discipline as link_to_moc. [miyo-tomo-hashi#68]
 *
 * [ref: Tomo handoff 2026-06-25 block-anchor-and-replace-section; Tomo spec
 *  024-tag-handler-framework]
 */

import type { ReplaceSectionAction } from "../schema/types.js";
import type { ActionOutcome } from "../executor/state.js";
import { type HandlerContext } from "./types.js";
import { locateSection } from "./sectionLocator.js";
import { replaceLines } from "./blockInsert.js";

type ReplaceOutcome = Extract<ActionOutcome, { kind: "applied" | "skipped-already" | "failed" }>;

export async function replaceSection(
	action: ReplaceSectionAction,
	ctx: HandlerContext,
): Promise<ReplaceOutcome> {
	const { vault } = ctx;
	const path = action.target_path;

	if (!(await vault.exists(path))) {
		return { kind: "failed", reason: "target note missing" };
	}

	if (action.anchor.value === null) {
		return { kind: "failed", reason: "anchor not found (null value)" };
	}

	if (action.anchor.type !== "heading") {
		return { kind: "failed", reason: "replace_section v1 supports heading anchors only" };
	}

	const content = await vault.cachedRead(path);
	const section = locateSection(content, action.anchor.value);
	if (section === null || section.kind !== "heading") {
		return { kind: "failed", reason: `anchor not found: ${action.anchor.value}` };
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

	await vault.process(path, (current) =>
		replaceLines(current, start, section.endLine, newLines),
	);
	return { kind: "applied" };
}
