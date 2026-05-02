/**
 * addRelationship handler — replace a Dataview-marker line in a target MOC
 * with a verbatim `line` value.
 *
 * Locator: scan the target MOC top-down for the first line whose stripped
 * content (after optional `> ` callout prefix and surrounding whitespace)
 * starts with `marker`. Replace that whole line. If the matched line had
 * a leading `> ` callout prefix, the replacement preserves it.
 *
 * No anchor/section context — the marker IS the locator. Multi-link
 * aggregation (e.g., `related:: [[A]], [[B]], [[C]]`) is done Tomo-side
 * before emission; Hashi only writes `line` verbatim.
 *
 * Idempotency: if the located line already equals the would-be result
 * (callout prefix included when relevant) → skipped-already.
 *
 * Failure cases:
 *   - target MOC missing       → "Relationship target missing"
 *   - marker line not present  → "Marker not found: <marker>"
 *
 * [ref: PRD/F4 add_relationship; Tomo docs/instructions-json.md § add_relationship]
 */

import type { AddRelationshipAction } from "../schema/types.js";
import type { ActionOutcome } from "../executor/state.js";
import type { HandlerContext } from "./types.js";

type RelOutcome = Extract<ActionOutcome, { kind: "applied" | "skipped-already" | "failed" }>;

const CALLOUT_PREFIX_RE = /^>\s*/;

export async function addRelationship(
	action: AddRelationshipAction,
	ctx: HandlerContext,
): Promise<RelOutcome> {
	const { vault } = ctx;
	const { target_moc_path, marker, line } = action;

	if (!(await vault.exists(target_moc_path))) {
		return { kind: "failed", reason: "Relationship target missing" };
	}

	const content = await vault.cachedRead(target_moc_path);
	const lines = content.split("\n");

	let matchIdx = -1;
	let inCallout = false;
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i] ?? "";
		const calloutMatch = CALLOUT_PREFIX_RE.exec(raw);
		const stripped = (calloutMatch !== null ? raw.slice(calloutMatch[0].length) : raw).trimStart();
		if (stripped.startsWith(marker)) {
			matchIdx = i;
			inCallout = calloutMatch !== null;
			break;
		}
	}

	if (matchIdx === -1) {
		return { kind: "failed", reason: `Marker not found: ${marker}` };
	}

	// Normalize callout prefix to canonical "> " (single space). Whitespace
	// variation in the source line is treated as cosmetic — the line is
	// rewritten verbatim with a single-space callout prefix when inside a
	// callout, no prefix when outside.
	const newLine = inCallout ? `> ${line}` : line;
	if (lines[matchIdx] === newLine) {
		return { kind: "skipped-already" };
	}

	await vault.process(target_moc_path, (current) => {
		const currentLines = current.split("\n");
		currentLines[matchIdx] = newLine;
		return currentLines.join("\n");
	});
	return { kind: "applied" };
}
