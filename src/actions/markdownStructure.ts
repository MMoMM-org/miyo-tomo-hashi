/**
 * markdownStructure — content-only structural parsing for Markdown notes.
 *
 * Shared by anchorResolver (link_to_moc) and sectionLocator (the daily-note
 * update_* handlers). Both must locate callouts and headings by parsing the
 * freshly-read file content rather than Obsidian's async metadataCache: the
 * cache rebuilds asynchronously after each vault write, so a batch with ≥2
 * actions into the same file races the rebuild and can read a null/stale cache
 * — spuriously missing a structure that is present in the file. Parsing from
 * the current content is the only race-free source of truth. [miyo-tomo-hashi#68]
 *
 * Callout/heading scans skip lines inside fenced code blocks (``` / ~~~), which
 * is what the metadataCache did implicitly.
 */

export interface CalloutSpan {
	readonly openerLine: number; // line index of `> [!type] Title`
	readonly endLine: number; // last consecutive `>`-prefixed line (inclusive)
}

export interface HeadingInfo {
	readonly heading: string; // text after the `#`s, trimmed
	readonly level: number; // 1..6
	readonly line: number; // line index of the heading
}

const CODE_FENCE_RE = /^\s*(?:```|~~~)/;
const CALLOUT_FIRST_LINE_RE = /^>\s*\[!(\w+)\]\s*(.*)$/;
const CALLOUT_CONTINUATION_RE = /^>/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/**
 * Mark each line that sits inside a fenced code block. Fence delimiter lines
 * themselves are marked too — they are never valid callout/heading anchors.
 */
export function fencedLineMask(lines: readonly string[]): boolean[] {
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

/** All ATX headings outside fenced code blocks, in document order. */
export function parseHeadings(lines: readonly string[]): HeadingInfo[] {
	const fenced = fencedLineMask(lines);
	const headings: HeadingInfo[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (fenced[i]) continue;
		const m = HEADING_RE.exec(lines[i] ?? "");
		if (m === null) continue;
		headings.push({ heading: m[2]!.trim(), level: m[1]!.length, line: i });
	}
	return headings;
}

/**
 * First callout (outside code fences) whose type and title match. `type` is
 * compared case-insensitively when given; null matches any callout type. `title`
 * is always compared case-insensitively. The body extends through consecutive
 * `>`-prefixed lines. Returns the span or null when no callout matches.
 */
export function findCallout(
	lines: readonly string[],
	type: string | null,
	title: string,
): CalloutSpan | null {
	const wantType = type === null ? null : type.toLowerCase();
	const wantTitle = title.trim().toLowerCase();
	const fenced = fencedLineMask(lines);

	for (let i = 0; i < lines.length; i++) {
		if (fenced[i]) continue;
		const m = CALLOUT_FIRST_LINE_RE.exec(lines[i] ?? "");
		if (m === null) continue;
		if (wantType !== null && m[1]!.toLowerCase() !== wantType) continue;
		if (m[2]!.trim().toLowerCase() !== wantTitle) continue;

		let endLine = i;
		for (let j = i + 1; j < lines.length; j++) {
			if (!CALLOUT_CONTINUATION_RE.test(lines[j] ?? "")) break;
			endLine = j;
		}
		return { openerLine: i, endLine };
	}

	return null;
}
