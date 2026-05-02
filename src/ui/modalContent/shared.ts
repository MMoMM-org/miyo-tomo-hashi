/**
 * Shared DOM helpers + glyph constants used by all three modal subviews.
 *
 * Keeps each subview small and prevents glyph drift across files.
 *
 * [ref: SDD/ADR-5; phase-5 T5.1]
 */

import type { ActionRecord } from "../../executor/state";

export const GLYPH_APPLIED = "✓"; // ✓
export const GLYPH_FAILED = "✗"; // ✗
export const GLYPH_SKIPPED = "⊘"; // ⊘
export const GLYPH_PENDING = "⏺"; // ⏺
export const GLYPH_RUNNING = "⟳"; // ⟳

export function createHeader(parent: HTMLElement, text: string): HTMLElement {
	return parent.createDiv({ cls: "hashi-execution-modal-header", text });
}

export function createFooter(parent: HTMLElement, text: string): HTMLElement {
	return parent.createDiv({ cls: "hashi-execution-modal-footer", text });
}

export function createButtonRow(parent: HTMLElement): HTMLElement {
	return parent.createDiv({ cls: "hashi-execution-modal-buttons" });
}

export function createRowGlyph(parent: HTMLElement, glyph: string): HTMLElement {
	// M11: glyph is decorative — meaning is conveyed by the row's aria-label
	// (see rowAriaLabel below). Without this, screen readers read each glyph
	// by its Unicode name ("white heavy check mark", "prohibition sign",
	// etc.) which is noise.
	return parent.createSpan({
		cls: "hashi-execution-modal-row-glyph",
		text: glyph,
		attr: { "aria-hidden": "true" },
	});
}

/**
 * Human-readable accessible name for an action row (review M11).
 * "<state>: <id> <kind> — <summary>"
 */
export function rowAriaLabel(record: ActionRecord, isCurrent = false): string {
	const state = record.outcome === null
		? (isCurrent ? "running" : "pending")
		: record.outcome.kind;
	const summary = record.summary !== "" ? ` — ${record.summary}` : "";
	return `${state}: ${record.id} ${record.kind}${summary}`;
}

export function glyphForOutcome(record: ActionRecord, isCurrent: boolean): string {
	if (record.outcome === null) {
		return isCurrent ? GLYPH_RUNNING : GLYPH_PENDING;
	}
	switch (record.outcome.kind) {
		case "applied":
			return GLYPH_APPLIED;
		case "skipped-already":
		case "skipped-dependency":
		case "skipped-cancelled":
			return GLYPH_SKIPPED;
		case "failed":
			return GLYPH_FAILED;
	}
}

/**
 * Stable group-by file preserving first-seen order. Returns a Map for
 * insertion-order iteration semantics.
 */
export function groupByFile(
	records: readonly ActionRecord[],
): Map<string, ActionRecord[]> {
	const map = new Map<string, ActionRecord[]>();
	for (const r of records) {
		const list = map.get(r.fileId);
		if (list === undefined) {
			map.set(r.fileId, [r]);
		} else {
			list.push(r);
		}
	}
	return map;
}
