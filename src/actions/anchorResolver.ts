/**
 * anchorResolver — locate an Anchor in a vault file and report the line
 * indices the linkToMoc handler needs for both placement modes.
 *
 * Three anchor types (per Tomo's link_to_moc contract 2026-05-01):
 *   - callout: match callout opening line by `[!type] Title` (case-insensitive).
 *   - heading: match a heading by text (without leading `#`s), case-sensitive,
 *     any heading level.
 *   - line:    match the first body line whose stripped content contains the
 *     value verbatim (substring inclusion).
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
 * [ref: PRD/F4 link_to_moc; Tomo docs/instructions-json.md § Anchor Model]
 */

import type { FileMetadata } from "../vault/VaultFS.js";
import type { Anchor } from "../schema/types.js";

export interface AnchorMatch {
	readonly kind: "callout" | "heading" | "line";
	readonly anchorLine: number;
	readonly insertInside: number | null;
	readonly insertAfter: number;
}

const CALLOUT_FIRST_LINE_RE = /^>\s*\[!(\w+)\]\s*(.*)$/;
const ANCHOR_VALUE_PREFIX_RE = /^\[!(\w+)\]\s*(.*)$/;

export function resolveAnchor(
	metadata: FileMetadata,
	rawContent: string,
	anchor: Anchor,
): AnchorMatch | null {
	if (anchor.value === null) return null;

	switch (anchor.type) {
		case "callout":
			return resolveCallout(metadata, rawContent, anchor.value);
		case "heading":
			return resolveHeading(metadata, anchor.value);
		case "line":
			return resolveLine(rawContent, anchor.value);
	}
}

// ---------------------------------------------------------------------------
// callout — match by `[!type] Title` (case-insensitive)
// ---------------------------------------------------------------------------

function resolveCallout(
	metadata: FileMetadata,
	rawContent: string,
	value: string,
): AnchorMatch | null {
	const desired = ANCHOR_VALUE_PREFIX_RE.exec(value);
	if (desired === null) return null;
	const desiredType = desired[1]!.toLowerCase();
	const desiredTitle = desired[2]!.trim().toLowerCase();

	const lines = rawContent.split("\n");

	for (const sec of metadata.sections) {
		if (sec.type !== "callout") continue;
		const firstLine = lines[sec.line] ?? "";
		const m = CALLOUT_FIRST_LINE_RE.exec(firstLine);
		if (m === null) continue;
		const calloutType = m[1]!.toLowerCase();
		const calloutTitle = m[2]!.trim().toLowerCase();
		if (calloutType !== desiredType) continue;
		if (calloutTitle !== desiredTitle) continue;

		const insertionIndex = sec.endLine === -1 ? lines.length : sec.endLine + 1;
		return {
			kind: "callout",
			anchorLine: sec.line,
			insertInside: insertionIndex,
			insertAfter: insertionIndex,
		};
	}

	return null;
}

// ---------------------------------------------------------------------------
// heading — match by text (case-sensitive), any level
// ---------------------------------------------------------------------------

function resolveHeading(metadata: FileMetadata, value: string): AnchorMatch | null {
	const heading = metadata.headings.find((h) => h.heading === value);
	if (heading === undefined) return null;
	return {
		kind: "heading",
		anchorLine: heading.line,
		insertInside: null,
		insertAfter: heading.line + 1,
	};
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
