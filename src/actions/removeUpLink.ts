/**
 * removeUpLink handler — remove ONE link from a note's `up::` line while
 * preserving the field itself.
 *
 * Locator: reuses addRelationship's marker/callout/bullet locator (same
 * `CALLOUT_PREFIX_RE`/`LIST_BULLET_RE` shapes) with the literal marker
 * `up::` — not parameterized, since remove_up_link is up:: specific.
 *
 * Removal: every `[[stem]]` occurrence on the located line is extracted
 * in order (via a global bracket-pair scan), which is inherently
 * whitespace-tolerant around commas/separators — the separators are never
 * captured, only reconstructed canonically on write. This naturally
 * implements "remove the [[link]] occurrence INCLUDING a dangling
 * separator":
 *   - "up:: [[A]], [[X]]" → "up:: [[A]]"       (drop trailing X)
 *   - "up:: [[X]], [[A]]" → "up:: [[A]]"       (drop leading X)
 *   - "up:: [[A]], [[X]], [[B]]" → "up:: [[A]], [[B]]" (drop middle X)
 *
 * Field preservation: when the removed link was the only one, the
 * reconstructed line is `up:: ` (marker + canonical single space + empty
 * value) — the line is NEVER deleted. `up::` is a required structural
 * field; an emptied `up::` correctly resurfaces the note as unparented on
 * the next garden-audit scan, whereas deleting the line would drop the
 * note from the structure model entirely.
 *
 * Outcome convention (documented per the Tomo contract 2026-07-23): unlike
 * `addRelationship`, which treats "marker not found" as a `failed` outcome
 * (a target MOC is expected to already carry a navigable line for that
 * action), this handler treats BOTH "no up:: line" and "link not present
 * on the up:: line" as `skipped-already` — mirroring `editNoteText`'s
 * "match not found is a no-op success" convention. remove_up_link is about
 * reaching an end state (link gone from up::); if that state already
 * holds — including the idempotent re-run case — re-running the action
 * must not fail the batch. Only a missing target note is `failed`.
 *
 * [ref: tomo-to-hashi handoff 2026-07-23 remove_up_link;
 * src/actions/addRelationship.ts locator; src/actions/editNoteText.ts
 * skipped-already convention]
 */

import type { RemoveUpLinkAction } from "../schema/types.js";
import type { ActionOutcome } from "../executor/state.js";
import type { HandlerContext } from "./types.js";

type RemoveOutcome = Extract<ActionOutcome, { kind: "applied" | "skipped-already" | "failed" }>;

const UP_MARKER = "up::";
const CALLOUT_PREFIX_RE = /^>\s*/;
const LIST_BULLET_RE = /^([-*+]|\d+\.)\s+/;
const LINK_RE = /\[\[([^\]]+)\]\]/g;

interface UpLineLocation {
	readonly matchIdx: number;
	readonly prefix: string; // reconstructed callout/bullet prefix, e.g. "> - "
	readonly valuePart: string; // line content after the "up::" marker
}

export async function removeUpLink(
	action: RemoveUpLinkAction,
	ctx: HandlerContext,
): Promise<RemoveOutcome> {
	const { vault } = ctx;
	const { path, link } = action;

	if (!(await vault.exists(path))) {
		return { kind: "failed", reason: "target note missing" };
	}

	const content = await vault.cachedRead(path);
	const located = locateUpLine(content);
	if (located === null) {
		// No up:: line at all — nothing to do.
		return { kind: "skipped-already" };
	}

	const links = extractLinks(located.valuePart);
	const removeIdx = links.indexOf(link);
	if (removeIdx === -1) {
		// Link already absent (idempotent re-run, or simply never present).
		return { kind: "skipped-already" };
	}

	links.splice(removeIdx, 1);
	const newLine = `${located.prefix}${UP_MARKER} ${links.map((stem) => `[[${stem}]]`).join(", ")}`;

	await vault.process(path, (current) => {
		const currentLines = current.split("\n");
		currentLines[located.matchIdx] = newLine;
		return currentLines.join("\n");
	});
	return { kind: "applied" };
}

/** Extract every `[[stem]]` occurrence on a line, in order. */
function extractLinks(valuePart: string): string[] {
	const links: string[] = [];
	LINK_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = LINK_RE.exec(valuePart)) !== null) {
		links.push((m[1] ?? "").trim());
	}
	return links;
}

/**
 * Scan the note top-down for the first line whose stripped content (after
 * an optional `> ` callout prefix and an optional list-item bullet) starts
 * with the literal `up::` marker. Same locator shape as addRelationship.
 */
function locateUpLine(content: string): UpLineLocation | null {
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i] ?? "";
		const calloutMatch = CALLOUT_PREFIX_RE.exec(raw);
		const afterCallout = (calloutMatch !== null ? raw.slice(calloutMatch[0].length) : raw).trimStart();
		const bulletMatch = LIST_BULLET_RE.exec(afterCallout);
		const stripped = bulletMatch !== null ? afterCallout.slice(bulletMatch[0].length) : afterCallout;
		if (stripped.startsWith(UP_MARKER)) {
			const inCallout = calloutMatch !== null;
			const bullet = bulletMatch !== null ? `${bulletMatch[1]} ` : "";
			return {
				matchIdx: i,
				prefix: `${inCallout ? "> " : ""}${bullet}`,
				valuePart: stripped.slice(UP_MARKER.length),
			};
		}
	}
	return null;
}
