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
 * Returns null when no match exists; the caller decides the fallback.
 *
 * [ref: SDD/Implementation Examples; Section Locator for link_to_moc]
 */

import type { FileMetadata } from "../vault/VaultFS.js";

export interface SectionRange {
	readonly startLine: number; // first content line inside the section
	readonly endLine: number; // last content line (inclusive); -1 if section runs to EOF
	readonly kind: "heading" | "callout";
}

const PREFIX_RE = /^\[!(\w+)\]\s*(.*)$/;
const CALLOUT_FIRST_LINE_RE = /^>\s*\[!(\w+)\]\s*(.*)$/;

export function locateSection(
	metadata: FileMetadata,
	rawContent: string,
	desiredSectionName: string,
): SectionRange | null {
	const prefixMatch = PREFIX_RE.exec(desiredSectionName);
	const desiredType = prefixMatch ? prefixMatch[1]!.toLowerCase() : null;
	const desiredTitle = prefixMatch ? prefixMatch[2]!.trim() : desiredSectionName;

	// Heading lookup — only when no [!type] prefix was given. A prefix expresses
	// callout-specific intent and must not silently fall back to a heading match.
	if (desiredType === null) {
		const heading = metadata.headings.find((h) => h.heading === desiredTitle);
		if (heading) {
			const next = metadata.headings.find(
				(h) => h.line > heading.line && h.level <= heading.level,
			);
			return {
				startLine: heading.line + 1,
				endLine: next ? next.line - 1 : -1,
				kind: "heading",
			};
		}
	}

	const lines = rawContent.split("\n");
	for (const sec of metadata.sections) {
		if (sec.type !== "callout") continue;
		const firstLine = lines[sec.line] ?? "";
		const calloutMatch = CALLOUT_FIRST_LINE_RE.exec(firstLine);
		if (!calloutMatch) continue;
		const calloutType = calloutMatch[1]!.toLowerCase();
		const calloutTitle = calloutMatch[2]!.trim();

		if (desiredType !== null && calloutType !== desiredType) continue;
		if (calloutTitle.toLowerCase() !== desiredTitle.toLowerCase()) continue;

		return { startLine: sec.line + 1, endLine: sec.endLine, kind: "callout" };
	}

	return null;
}
