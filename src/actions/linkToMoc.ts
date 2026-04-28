/**
 * linkToMoc handler — append a bullet line into a named section of a MOC file.
 *
 * Path resolution:
 *   target_moc_path (canonical, Tomo-emitted) takes priority over target_moc.
 *
 * Section lookup (with in-set fallback):
 *   1. If section_name provided → try locateSection (heading or callout match).
 *   2. If no match (or section_name absent) → fallback to first callout in metadata.
 *   3. If no callout found → failed "No section found for link_to_moc".
 *
 * Bullet prefix:
 *   - Callout section → "> ${line_to_add}" (must stay inside the callout body)
 *   - Heading section → "${line_to_add}" (plain, no prefix)
 *
 * Idempotency:
 *   Scans the section range for an exact match to the would-be inserted line
 *   before writing. If found → skipped-already (no mutation). This check has
 *   a TOCTOU window (read vs. process), which is acceptable for Hashi v0.1
 *   (single-run lock + manual trigger).
 *
 * [ref: PRD/F4; SDD/Implementation Examples; Section Locator for link_to_moc]
 */

import type { LinkToMocAction } from "../schema/types.js";
import type { ActionOutcome } from "../executor/state.js";
import type { FileMetadata } from "../vault/VaultFS.js";
import { type HandlerContext } from "./types.js";
import { locateSection, type SectionRange } from "./sectionLocator.js";

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

	const [content, metadata] = await Promise.all([
		vault.read(mocPath),
		vault.metadata(mocPath),
	]);

	const range = resolveRange(metadata, content, action.section_name ?? null);
	if (!range) {
		return { kind: "failed", reason: "No section found for link_to_moc" };
	}

	const insertLine = range.kind === "callout"
		? `> ${action.line_to_add}`
		: action.line_to_add;

	if (containsLine(content, range, insertLine)) {
		return { kind: "skipped-already" };
	}

	await vault.process(mocPath, (current) => insertAtRangeEnd(current, range, insertLine));
	return { kind: "applied" };
}

// ---------------------------------------------------------------------------
// resolveRange — named section lookup with in-set callout fallback
// ---------------------------------------------------------------------------

function resolveRange(
	metadata: FileMetadata | null,
	content: string,
	sectionName: string | null,
): SectionRange | null {
	if (!metadata) return null;

	if (sectionName !== null) {
		const located = locateSection(metadata, content, sectionName);
		if (located) return located;
	}

	// Fallback: first editable callout in sections
	const first = metadata.sections.find((s) => s.type === "callout");
	if (!first) return null;
	return { startLine: first.line + 1, endLine: first.endLine, kind: "callout" };
}

// ---------------------------------------------------------------------------
// containsLine — scan a section range for an exact line match
// ---------------------------------------------------------------------------

function containsLine(content: string, range: SectionRange, line: string): boolean {
	const lines = content.split("\n");
	const end = range.endLine === -1 ? lines.length - 1 : range.endLine;
	for (let i = range.startLine; i <= end; i++) {
		if (lines[i] === line) return true;
	}
	return false;
}

// ---------------------------------------------------------------------------
// insertAtRangeEnd — splice the line after the last line of the section
// ---------------------------------------------------------------------------

function insertAtRangeEnd(content: string, range: SectionRange, line: string): string {
	const lines = content.split("\n");

	if (range.endLine === -1) {
		// Section runs to EOF — append at end
		lines.push(line);
		return lines.join("\n");
	}

	// Insert after endLine (index is inclusive last-content-line)
	lines.splice(range.endLine + 1, 0, line);
	return lines.join("\n");
}
