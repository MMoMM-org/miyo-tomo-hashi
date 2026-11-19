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
 *   skipped-already (no mutation).
 *
 * Failure cases:
 *   - MOC target file missing                    → "MOC target missing"
 *   - anchor.value is null                       → "anchor not found (null value)"
 *   - anchor cannot be resolved in the MOC       → "anchor not found: <value>"
 *   - placement=inside on non-callout anchor     → "placement: inside requires callout anchor"
 *
 * Anchor resolution and the duplicate check run on the content vault.process
 * hands over, NOT the async metadataCache — see anchorResolver. This keeps
 * batches with ≥2 inserts into the same MOC correct: Obsidian rebuilds the
 * metadataCache asynchronously after each write, so a cache-based read would
 * race the rebuild and spuriously miss a present anchor [miyo-tomo-hashi#68].
 * Resolving inside process() also means lines added to the MOC after an
 * earlier read cannot shift the insert [miyo-tomo-hashi#183].
 *
 * [ref: PRD/F4 link_to_moc; Tomo docs/instructions-json.md § Anchor Model;
 *  Tomo integration request 2026-06-13 (insert-primitive generalization);
 *  metadataCache-race fix miyo-tomo-hashi#68; resolve-inside-process #183]
 */

import type { LinkToMocAction } from "../schema/types.js";
import { type HandlerContext } from "./types.js";
import { processResolved, type EditOutcome, type ResolvedEdit } from "./processResolved.js";
import { resolveAnchor } from "./anchorResolver.js";
import { blockAlreadyPresent, spliceLines } from "./blockInsert.js";

export async function linkToMoc(
	action: LinkToMocAction,
	ctx: HandlerContext,
): Promise<EditOutcome> {
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

	return processResolved(vault, mocPath, (current) => insertLine(current, action));
}

/** `content` with the block inserted, or the outcome to report without writing. */
function insertLine(content: string, action: LinkToMocAction): ResolvedEdit {
	const match = resolveAnchor(content, action.anchor);
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

	return spliceLines(content, insertIndex, blockLines);
}
