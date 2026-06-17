/**
 * sectionLocator — resolves a named section within a vault file.
 *
 * `desiredSectionName` accepts two shapes:
 *   - **Plain title** (e.g., `"Key Concepts"`) — matches a heading with that
 *     exact text first, falling back to a callout whose title text matches
 *     case-insensitively.
 *   - **Prefixed callout shape** (e.g., `"[!blocks] Key Concepts"`) — matches
 *     ONLY a callout whose type AND title both match (case-insensitive). Skips
 *     the heading lookup entirely; the prefix expresses callout-specific intent.
 *
 * Tomo's `link_to_moc.section_name` is emitted in the prefixed shape (per
 * `docs/instructions-json.md` § Section name resolution). The plain-title path
 * is preserved for backward compatibility with handler-internal callers.
 *
 * Resolution reads ONLY the file content — never the async metadataCache. The
 * daily-note update_* handlers run batches of actions against the same note, so
 * a cache-based lookup would race Obsidian's post-write rebuild and spuriously
 * miss a present section (the same failure mode as link_to_moc #68). See
 * markdownStructure for the shared content-parsing helpers.
 *
 * Returns null when no match exists; the caller decides the fallback.
 *
 * [ref: SDD/Implementation Examples; Section Locator for link_to_moc;
 *  metadataCache-race fix miyo-tomo-hashi#68]
 */

import { findCallout, parseHeadings } from "./markdownStructure.js";

export interface SectionRange {
	readonly startLine: number; // first content line inside the section
	readonly endLine: number; // last content line (inclusive); -1 if section runs to EOF
	readonly kind: "heading" | "callout";
}

const PREFIX_RE = /^\[!(\w+)\]\s*(.*)$/;

export function locateSection(
	rawContent: string,
	desiredSectionName: string,
): SectionRange | null {
	const prefixMatch = PREFIX_RE.exec(desiredSectionName);
	const desiredType = prefixMatch ? prefixMatch[1]! : null;
	const desiredTitle = prefixMatch ? prefixMatch[2]!.trim() : desiredSectionName;

	const lines = rawContent.split("\n");

	// Heading lookup — only when no [!type] prefix was given. A prefix expresses
	// callout-specific intent and must not silently fall back to a heading match.
	if (desiredType === null) {
		const headings = parseHeadings(lines);
		const heading = headings.find((h) => h.heading === desiredTitle);
		if (heading) {
			const next = headings.find(
				(h) => h.line > heading.line && h.level <= heading.level,
			);
			return {
				startLine: heading.line + 1,
				endLine: next ? next.line - 1 : -1,
				kind: "heading",
			};
		}
	}

	const callout = findCallout(lines, desiredType, desiredTitle);
	if (callout) {
		return { startLine: callout.openerLine + 1, endLine: callout.endLine, kind: "callout" };
	}

	return null;
}
