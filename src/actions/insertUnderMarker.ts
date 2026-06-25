/**
 * insertUnderMarker handler — insert a multi-line block beneath a marker in an
 * ARBITRARY vault note. This is `link_to_moc`'s insert primitive generalised to
 * any note: Tomo decides the text (`content`) and the position (`anchor` +
 * `placement`), Hashi performs the insert. (Tomo spec 024 / miyo-tomo#47.)
 *
 * Deltas vs link_to_moc:
 *   - `target_path` is a full vault-relative path to any note, not a MOC stem.
 *   - `content` is a multi-line markdown block, not a single bullet.
 *
 * Placement × marker type:
 *   - `inside` + callout → each line `> `-prefixed, appended to the callout body
 *     (reuses anchorResolver's `insertInside`).
 *   - `inside` + heading → appended at the END of the heading's section —
 *     immediately above the next heading of same-or-higher level, or EOF —
 *     verbatim (reuses sectionLocator's heading section range). This matches
 *     Tomo's "append, never replace" guarantee.
 *   - `inside` + line / block → unsupported; fails gracefully (reported).
 *   - `before`/`after`  → verbatim, relative to the marker, for any marker type
 *     (reuses anchorResolver's `anchorLine` / `insertAfter`). A `block` anchor
 *     (header+separator rows) + `after` lands the new row as the first table
 *     data row — the newest-first table-insert case (Tomo handoff 2026-06-25).
 *
 * Behaviour guarantees (per Tomo contract):
 *   - Modify-only, never create — a missing `target_path` fails (Tomo guarantees
 *     existence before emitting; we still fail gracefully if it's gone).
 *   - Marker not resolvable at apply time → fail gracefully (no blind append).
 *   - Append, never replace.
 *
 * Anchor resolution reads the freshly-read file content (`cachedRead`), NOT the
 * async metadataCache — same race discipline as link_to_moc. [miyo-tomo-hashi#68]
 *
 * [ref: PRD/F4 insert_under_marker; Tomo handoff 2026-06-23
 *  (insert-under-marker-action); Tomo spec 024-tag-handler-framework]
 */

import type { InsertUnderMarkerAction } from "../schema/types.js";
import type { ActionOutcome } from "../executor/state.js";
import { type HandlerContext } from "./types.js";
import { resolveAnchor } from "./anchorResolver.js";
import { locateSection } from "./sectionLocator.js";
import { blockAlreadyPresent, spliceLines } from "./blockInsert.js";

type InsertOutcome = Extract<ActionOutcome, { kind: "applied" | "skipped-already" | "failed" }>;

export async function insertUnderMarker(
	action: InsertUnderMarkerAction,
	ctx: HandlerContext,
): Promise<InsertOutcome> {
	const { vault } = ctx;
	const path = action.target_path;

	if (!(await vault.exists(path))) {
		return { kind: "failed", reason: "target note missing" };
	}

	if (action.anchor.value === null) {
		return { kind: "failed", reason: "anchor not found (null value)" };
	}

	if (
		action.placement === "inside" &&
		(action.anchor.type === "line" || action.anchor.type === "block")
	) {
		return {
			kind: "failed",
			reason: `placement: inside not supported for ${action.anchor.type} anchor`,
		};
	}

	const content = await vault.cachedRead(path);
	const rawLines = action.content.split("\n");

	// Resolve (insertIndex, blockLines) per the placement × marker-type matrix.
	let insertIndex: number;
	let blockLines: readonly string[];

	if (action.placement === "inside" && action.anchor.type === "heading") {
		// Heading-inside: append at the end of the heading's section. locateSection
		// returns endLine = -1 when the section runs to EOF.
		const section = locateSection(content, action.anchor.value);
		if (section === null || section.kind !== "heading") {
			return { kind: "failed", reason: `anchor not found: ${action.anchor.value}` };
		}
		const lineCount = content.split("\n").length;
		insertIndex = section.endLine === -1 ? lineCount : section.endLine + 1;
		blockLines = rawLines;
	} else {
		const match = resolveAnchor(content, action.anchor);
		if (match === null) {
			return { kind: "failed", reason: `anchor not found: ${action.anchor.value}` };
		}
		if (action.placement === "inside") {
			// callout-only here (heading handled above, line rejected earlier).
			insertIndex = match.insertInside!;
			blockLines = rawLines.map((line) => `> ${line}`);
		} else {
			insertIndex = action.placement === "before" ? match.anchorLine : match.insertAfter;
			blockLines = rawLines;
		}
	}

	// Exact-duplicate guard: Tomo does not require idempotency (each dated block
	// differs and the user reviews it), but skipping a byte-identical block is
	// harmless and consistent with link_to_moc.
	if (blockAlreadyPresent(content, blockLines)) {
		return { kind: "skipped-already" };
	}

	await vault.process(path, (current) => spliceLines(current, insertIndex, blockLines));
	return { kind: "applied" };
}
