/**
 * anchorResolver — locate an Anchor in a vault file and report the line
 * indices the linkToMoc handler needs for both placement modes.
 *
 * Resolution reads ONLY the freshly-read file content (`rawContent`), never the
 * async metadataCache. Obsidian rebuilds the metadataCache asynchronously after
 * each vault mutation, so a batch with ≥2 inserts into the same file would race
 * the rebuild: the second insert could read a null/stale cache and spuriously
 * fail to find an anchor that is present in the file. Parsing positions straight
 * from the current content removes that race entirely. [miyo-tomo-hashi#68]
 *
 * Three anchor types (per Tomo's link_to_moc contract 2026-05-01):
 *   - callout: match callout opening line by `[!type] Title` (case-insensitive).
 *     The callout body extends through consecutive `>`-prefixed lines.
 *   - heading: match a heading by text (without leading `#`s), case-sensitive,
 *     any heading level.
 *   - line:    match the first body line whose stripped content contains the
 *     value verbatim (substring inclusion).
 *
 * Callout and heading scans skip lines inside fenced code blocks (``` / ~~~),
 * mirroring how the metadataCache excluded fenced content. (`line` matching is
 * deliberately literal and scans all lines, unchanged from prior behaviour.)
 *
 * Returned indices:
 *   - anchorLine:   the anchor's first line (callout opener / heading line /
 *     matched line). Insert at this index → block lands immediately BEFORE the
 *     anchor (`placement: "before"`).
 *   - insertInside: insertion point for `placement: "inside"` (callout only;
 *     null otherwise). Insert with `> ` prefix at this index → new line lands
 *     as the last content line inside the callout body.
 *   - insertAfter:  insertion point for `placement: "after"`. Insert verbatim
 *     at this index → new line lands immediately after the anchor's terminal
 *     line. Per Tomo: callout → after the callout closes (last `>` line + 1);
 *     heading → after the heading line itself (heading.line + 1, NOT after
 *     the section's content range); line → after the matched body line.
 *
 * Returns null when the anchor cannot be resolved (no match, or value is null).
 *
 * [ref: PRD/F4 link_to_moc; Tomo docs/instructions-json.md § Anchor Model;
 *  metadataCache-race fix miyo-tomo-hashi#68]
 */

import type { Anchor } from "../schema/types.js";

export interface AnchorMatch {
	readonly kind: "callout" | "heading" | "line";
	readonly anchorLine: number;
	readonly insertInside: number | null;
	readonly insertAfter: number;
}

const CALLOUT_FIRST_LINE_RE = /^>\s*\[!(\w+)\]\s*(.*)$/;
const CALLOUT_CONTINUATION_RE = /^>/;
const ANCHOR_VALUE_PREFIX_RE = /^\[!(\w+)\]\s*(.*)$/;
const HEADING_RE = /^#{1,6}\s+(.*)$/;
const CODE_FENCE_RE = /^\s*(?:```|~~~)/;

export function resolveAnchor(rawContent: string, anchor: Anchor): AnchorMatch | null {
	if (anchor.value === null) return null;

	switch (anchor.type) {
		case "callout":
			return resolveCallout(rawContent, anchor.value);
		case "heading":
			return resolveHeading(rawContent, anchor.value);
		case "line":
			return resolveLine(rawContent, anchor.value);
	}
}

/**
 * Mark each line that sits inside a fenced code block. Fence delimiter lines
 * themselves are marked too — they are never valid callout/heading anchors.
 */
function fencedLineMask(lines: readonly string[]): boolean[] {
	const mask = new Array<boolean>(lines.length).fill(false);
	let inFence = false;
	for (let i = 0; i < lines.length; i++) {
		if (CODE_FENCE_RE.test(lines[i] ?? "")) {
			mask[i] = true;
			inFence = !inFence;
			continue;
		}
		mask[i] = inFence;
	}
	return mask;
}

// ---------------------------------------------------------------------------
// callout — match by `[!type] Title` (case-insensitive)
// ---------------------------------------------------------------------------

function resolveCallout(rawContent: string, value: string): AnchorMatch | null {
	const desired = ANCHOR_VALUE_PREFIX_RE.exec(value);
	if (desired === null) return null;
	const desiredType = desired[1]!.toLowerCase();
	const desiredTitle = desired[2]!.trim().toLowerCase();

	const lines = rawContent.split("\n");
	const fenced = fencedLineMask(lines);

	for (let i = 0; i < lines.length; i++) {
		if (fenced[i]) continue;
		const m = CALLOUT_FIRST_LINE_RE.exec(lines[i] ?? "");
		if (m === null) continue;
		if (m[1]!.toLowerCase() !== desiredType) continue;
		if (m[2]!.trim().toLowerCase() !== desiredTitle) continue;

		// Callout body extends through consecutive `>`-prefixed lines.
		let endLine = i;
		for (let j = i + 1; j < lines.length; j++) {
			if (!CALLOUT_CONTINUATION_RE.test(lines[j] ?? "")) break;
			endLine = j;
		}
		const insertionIndex = endLine + 1;
		return {
			kind: "callout",
			anchorLine: i,
			insertInside: insertionIndex,
			insertAfter: insertionIndex,
		};
	}

	return null;
}

// ---------------------------------------------------------------------------
// heading — match by text (case-sensitive), any level
// ---------------------------------------------------------------------------

function resolveHeading(rawContent: string, value: string): AnchorMatch | null {
	const lines = rawContent.split("\n");
	const fenced = fencedLineMask(lines);

	for (let i = 0; i < lines.length; i++) {
		if (fenced[i]) continue;
		const m = HEADING_RE.exec(lines[i] ?? "");
		if (m === null) continue;
		if (m[1]!.trim() !== value) continue;
		return {
			kind: "heading",
			anchorLine: i,
			insertInside: null,
			insertAfter: i + 1,
		};
	}

	return null;
}

// ---------------------------------------------------------------------------
// line — match by substring inclusion
// ---------------------------------------------------------------------------

function resolveLine(rawContent: string, value: string): AnchorMatch | null {
	const lines = rawContent.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (line.includes(value)) {
			return {
				kind: "line",
				anchorLine: i,
				insertInside: null,
				insertAfter: i + 1,
			};
		}
	}
	return null;
}
