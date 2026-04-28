/**
 * sectionLocator — resolves a named section within a vault file.
 *
 * Priority: heading match wins over callout match when both share the same
 * name. If neither is found, returns null and the caller decides the fallback.
 *
 * [ref: SDD/Implementation Examples; Section Locator for link_to_moc]
 */

import type { FileMetadata } from "../vault/VaultFS.js";

export interface SectionRange {
	readonly startLine: number; // first content line inside the section
	readonly endLine: number; // last content line (inclusive); -1 if section runs to EOF
	readonly kind: "heading" | "callout";
}

export function locateSection(
	metadata: FileMetadata,
	rawContent: string,
	desiredSectionName: string,
): SectionRange | null {
	const heading = metadata.headings.find((h) => h.heading === desiredSectionName);
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

	const lines = rawContent.split("\n");
	for (const sec of metadata.sections) {
		if (sec.type !== "callout") continue;
		const firstLine = lines[sec.line] ?? "";
		const calloutMatch = /^>\s*\[!\w+\]\s*(.*)$/.exec(firstLine);
		if (!calloutMatch) continue;
		const calloutTitle = calloutMatch[1]!.trim();
		if (calloutTitle.toLowerCase() === desiredSectionName.toLowerCase()) {
			return { startLine: sec.line + 1, endLine: sec.endLine, kind: "callout" };
		}
	}

	return null;
}
