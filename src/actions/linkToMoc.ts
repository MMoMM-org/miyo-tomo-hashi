/**
 * linkToMoc handler — append a bullet line into a target MOC at an
 * anchor + placement coordinate.
 *
 * Action shape (per Tomo contract 2026-05-01):
 *   - anchor: {type: "callout"|"heading"|"line", value: string} — locator
 *     for the insertion point in the target MOC.
 *   - placement: "inside" | "after" — where to write relative to the anchor.
 *     "inside" is callout-only (line gets `> ` prefix as last body line);
 *     "after" inserts verbatim immediately after the anchor's terminal line.
 *
 * Path resolution:
 *   target_moc_path (canonical, Tomo-emitted) takes priority over target_moc.
 *
 * Idempotency:
 *   Scans the entire target MOC for an exact match to the would-be inserted
 *   line (with `> ` prefix when placement=inside on callout) before writing.
 *   If found → skipped-already (no mutation). TOCTOU window between read and
 *   process is acceptable for v0.1 (single-run lock + manual trigger).
 *
 * Failure cases:
 *   - MOC target file missing                    → "MOC target missing"
 *   - anchor.value is null                       → "anchor not found (null value)"
 *   - anchor cannot be resolved in the MOC       → "anchor not found: <value>"
 *   - placement=inside on non-callout anchor     → "placement: inside requires callout anchor"
 *   - metadata cache returns null for the file   → "anchor not found: …"
 *
 * [ref: PRD/F4 link_to_moc; Tomo docs/instructions-json.md § Anchor Model]
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
		vault.read(mocPath),
		vault.metadata(mocPath),
	]);

	if (metadata === null) {
		return { kind: "failed", reason: `anchor not found: ${action.anchor.value}` };
	}

	const match = resolveAnchor(metadata, content, action.anchor);
	if (match === null) {
		return { kind: "failed", reason: `anchor not found: ${action.anchor.value}` };
	}

	const insertLine = action.placement === "inside"
		? `> ${action.line_to_add}`
		: action.line_to_add;

	if (content.split("\n").includes(insertLine)) {
		return { kind: "skipped-already" };
	}

	const insertIndex = action.placement === "inside"
		? match.insertInside!
		: match.insertAfter;

	await vault.process(mocPath, (current) => spliceLine(current, insertIndex, insertLine));
	return { kind: "applied" };
}

/** Insert `line` at index `at` in `content`. Preserves trailing newline. */
function spliceLine(content: string, at: number, line: string): string {
	const lines = content.split("\n");
	const hasTrailingNewline = content.endsWith("\n");
	const body = hasTrailingNewline ? lines.slice(0, -1) : lines;
	const index = Math.max(0, Math.min(at, body.length));
	body.splice(index, 0, line);
	return body.join("\n") + (hasTrailingNewline ? "\n" : "");
}
