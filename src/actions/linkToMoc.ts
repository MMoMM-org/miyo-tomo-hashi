/**
 * linkToMoc handler — insert a text block into a target MOC at an
 * anchor + placement coordinate. This is Hashi's general "put this text here"
 * primitive: Tomo decides the text and the position, Hashi performs the insert.
 *
 * Action shape (per Tomo contract; `before` + multi-line added 2026-06-13):
 *   - anchor: {type: "callout"|"heading"|"line", value: string} — locator
 *     for the insertion point in the target MOC.
 *   - placement: "inside" | "before" | "after" — where to write relative to
 *     the anchor:
 *       "inside" (callout-only): each line of the block gets a `> ` prefix and
 *         lands as the last content line(s) of the callout body.
 *       "before": block is inserted verbatim immediately before the anchor's
 *         first line (callout opener / heading line / matched line).
 *       "after":  block is inserted verbatim immediately after the anchor's
 *         terminal line (callout closing `>` line / heading line / matched line).
 *   - line_to_add: the text to insert. MAY contain embedded `\n` — every line
 *     is written as a block (blank lines preserved). For "before"/"after" the
 *     lines are verbatim; for "inside" each line gets the `> ` callout prefix.
 *
 * Path resolution:
 *   target_moc_path (canonical, Tomo-emitted) takes priority over target_moc.
 *
 * Idempotency:
 *   Scans the target MOC for the would-be block as a consecutive run of lines
 *   (with `> ` prefixes applied when placement=inside). If already present →
 *   skipped-already (no mutation). TOCTOU window between read and process is
 *   acceptable for v0.1 (single-run lock + manual trigger).
 *
 * Failure cases:
 *   - MOC target file missing                    → "MOC target missing"
 *   - anchor.value is null                       → "anchor not found (null value)"
 *   - anchor cannot be resolved in the MOC       → "anchor not found: <value>"
 *   - placement=inside on non-callout anchor     → "placement: inside requires callout anchor"
 *   - metadata cache returns null for the file   → "anchor not found: …"
 *
 * [ref: PRD/F4 link_to_moc; Tomo docs/instructions-json.md § Anchor Model;
 *  Tomo integration request 2026-06-13 (insert-primitive generalization)]
 */

import type { LinkToMocAction } from "../schema/types.js";
import type { ActionOutcome } from "../executor/state.js";
import { type HandlerContext } from "./types.js";
import { resolveAnchor } from "./anchorResolver.js";

type LinkOutcome = Extract<ActionOutcome, { kind: "applied" | "skipped-already" | "failed" }>;

export async function linkToMoc(
	action: LinkToMocAction,
	ctx: HandlerContext,
): Promise<LinkOutcome> {
	const { vault } = ctx;
	const mocPath = action.target_moc_path ?? action.target_moc;

	if (!(await vault.exists(mocPath))) {
		return { kind: "failed", reason: "MOC target missing" };
	}

	if (action.anchor.value === null) {
		return { kind: "failed", reason: "anchor not found (null value)" };
	}

	if (action.placement === "inside" && action.anchor.type !== "callout") {
		return {
			kind: "failed",
			reason: "placement: inside requires callout anchor",
		};
	}

	const [content, metadata] = await Promise.all([
		vault.cachedRead(mocPath),
		vault.metadata(mocPath),
	]);

	if (metadata === null) {
		return { kind: "failed", reason: `anchor not found: ${action.anchor.value}` };
	}

	const match = resolveAnchor(metadata, content, action.anchor);
	if (match === null) {
		return { kind: "failed", reason: `anchor not found: ${action.anchor.value}` };
	}

	// Build the block to insert. `line_to_add` may be multi-line; "inside"
	// prefixes every line with `> ` (callout body), "before"/"after" verbatim.
	const rawLines = action.line_to_add.split("\n");
	const blockLines =
		action.placement === "inside" ? rawLines.map((line) => `> ${line}`) : rawLines;

	if (blockAlreadyPresent(content, blockLines)) {
		return { kind: "skipped-already" };
	}

	const insertIndex =
		action.placement === "inside"
			? match.insertInside!
			: action.placement === "before"
				? match.anchorLine
				: match.insertAfter;

	await vault.process(mocPath, (current) => spliceLines(current, insertIndex, blockLines));
	return { kind: "applied" };
}

/**
 * True iff `block` already appears in `content` as a consecutive run of lines.
 * Generalises the single-line "is this bullet already here" check to multi-line
 * blocks; reduces to exact-line-anywhere when block.length === 1.
 */
function blockAlreadyPresent(content: string, block: readonly string[]): boolean {
	if (block.length === 0) return true;
	const lines = content.split("\n");
	for (let i = 0; i + block.length <= lines.length; i++) {
		let matched = true;
		for (let j = 0; j < block.length; j++) {
			if (lines[i + j] !== block[j]) {
				matched = false;
				break;
			}
		}
		if (matched) return true;
	}
	return false;
}

/** Insert `newLines` as a block at index `at` in `content`. Preserves trailing newline. */
function spliceLines(content: string, at: number, newLines: readonly string[]): string {
	const lines = content.split("\n");
	const hasTrailingNewline = content.endsWith("\n");
	const body = hasTrailingNewline ? lines.slice(0, -1) : lines;
	const index = Math.max(0, Math.min(at, body.length));
	body.splice(index, 0, ...newLines);
	return body.join("\n") + (hasTrailingNewline ? "\n" : "");
}
