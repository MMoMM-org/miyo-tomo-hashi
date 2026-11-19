/**
 * addRelationship handler — replace a Dataview-marker line in a target MOC
 * with a verbatim `line` value.
 *
 * Locator: scan the target MOC top-down for the first line whose stripped
 * content (after an optional `> ` callout prefix, an optional list-item
 * bullet `- `/`* `/`+ `/`1. `, and surrounding whitespace) starts with
 * `marker`. Replace that whole line, preserving any callout prefix AND the
 * list-item bullet — so a `> - up::` Dataview-in-callout list item stays a
 * list item after rewrite.
 *
 * No anchor/section context — the marker IS the locator. Multi-link
 * aggregation (e.g., `related:: [[A]], [[B]], [[C]]`) is done Tomo-side
 * before emission; Hashi only writes `line` verbatim.
 *
 * Idempotency: if the located line already equals the would-be result
 * (callout prefix included when relevant) → skipped-already.
 *
 * The marker line is located on the content vault.process hands over, so
 * lines added to the MOC after an earlier read cannot shift the rewrite onto
 * the wrong line (#183).
 *
 * Failure cases:
 *   - target MOC missing       → "Relationship target missing"
 *   - marker line not present  → "Marker not found: <marker>"
 *
 * [ref: PRD/F4 add_relationship; Tomo docs/instructions-json.md § add_relationship;
 *  resolve-inside-process miyo-tomo-hashi#183]
 */

import type { AddRelationshipAction } from "../schema/types.js";
import type { HandlerContext } from "./types.js";
import { processResolved, type EditOutcome, type ResolvedEdit } from "./processResolved.js";

const CALLOUT_PREFIX_RE = /^>\s*/;
// Optional Markdown list-item bullet: `-`, `*`, `+`, or an ordered `N.`,
// followed by whitespace. Capture group 1 is the bullet token, re-emitted
// with a single trailing space so list formatting survives the rewrite.
const LIST_BULLET_RE = /^([-*+]|\d+\.)\s+/;

export async function addRelationship(
	action: AddRelationshipAction,
	ctx: HandlerContext,
): Promise<EditOutcome> {
	const { vault } = ctx;
	const { target_moc_path } = action;

	if (!(await vault.exists(target_moc_path))) {
		return { kind: "failed", reason: "Relationship target missing" };
	}

	return processResolved(vault, target_moc_path, (current) => rewriteMarkerLine(current, action));
}

/** `content` with the marker line rewritten, or the outcome to report without writing. */
function rewriteMarkerLine(content: string, action: AddRelationshipAction): ResolvedEdit {
	const { marker, line } = action;
	const lines = content.split("\n");

	let matchIdx = -1;
	let inCallout = false;
	let bullet = ""; // normalized list bullet incl. trailing space (e.g. "- "), or "" if none
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i] ?? "";
		const calloutMatch = CALLOUT_PREFIX_RE.exec(raw);
		const afterCallout = (calloutMatch !== null ? raw.slice(calloutMatch[0].length) : raw).trimStart();
		const bulletMatch = LIST_BULLET_RE.exec(afterCallout);
		const stripped = bulletMatch !== null ? afterCallout.slice(bulletMatch[0].length) : afterCallout;
		if (stripped.startsWith(marker)) {
			matchIdx = i;
			inCallout = calloutMatch !== null;
			bullet = bulletMatch !== null ? `${bulletMatch[1]} ` : "";
			break;
		}
	}

	if (matchIdx === -1) {
		return { kind: "failed", reason: `Marker not found: ${marker}` };
	}

	// Reconstruct the structural prefix, normalizing whitespace to canonical
	// form: callout prefix → "> " (single space), list bullet → token + single
	// space. Whitespace variation in the source line is treated as cosmetic;
	// the bullet token itself (`-`/`*`/`+`/`1.`) is preserved so list items
	// stay list items.
	const newLine = `${inCallout ? "> " : ""}${bullet}${line}`;
	if (lines[matchIdx] === newLine) {
		return { kind: "skipped-already" };
	}

	lines[matchIdx] = newLine;
	return lines.join("\n");
}
