/**
 * blockInsert — shared pure helpers for inserting a multi-line block of text
 * into markdown content by line index.
 *
 * Extracted from linkToMoc so the `link_to_moc` and `insert_under_marker`
 * handlers share one implementation (DRY): both are "put this block of lines
 * at this position" primitives. Pure string/array work — no vault access, no
 * Obsidian API — so they are trivially unit-testable and reused verbatim.
 *
 * [ref: PRD/F4 link_to_moc + insert_under_marker; Tomo insert-under-marker
 *  request 2026-06-23]
 */

/**
 * True iff `block` already appears in `content` as a consecutive run of lines.
 * Generalises the single-line "is this bullet already here" check to multi-line
 * blocks; reduces to exact-line-anywhere when block.length === 1.
 */
export function blockAlreadyPresent(content: string, block: readonly string[]): boolean {
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
export function spliceLines(content: string, at: number, newLines: readonly string[]): string {
	const lines = content.split("\n");
	const hasTrailingNewline = content.endsWith("\n");
	const body = hasTrailingNewline ? lines.slice(0, -1) : lines;
	const index = Math.max(0, Math.min(at, body.length));
	body.splice(index, 0, ...newLines);
	return body.join("\n") + (hasTrailingNewline ? "\n" : "");
}
