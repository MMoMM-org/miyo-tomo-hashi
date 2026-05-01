/**
 * updateTracker handler — set a tracker field in a daily note.
 *
 * Three sub-modes determined by `action.syntax`:
 *   - inline_field: Dataview inline field anywhere in file. Matches three positions:
 *       (1) line-anchored `<field>:: <value>` — with optional bullet/whitespace prefix
 *       (2) inline-bracketed `[<field>:: <value>]` mid-prose
 *       (3) inline-parenthesized `(<field>:: <value>)` mid-prose
 *     Match priority: line-anchored > bracketed > parenthesized; first occurrence wins
 *     within a position class. The matched form is preserved byte-for-byte on
 *     overwrite — only the value portion is rewritten. Insertion of a new field is
 *     line-anchored only (Hashi never writes new bracketed/parenthesized forms).
 *   - callout_body: `> <field>:: <value>` (double-colon only) inside a named callout
 *     section. Single-colon `> field:` is not a supported variant.
 *   - checkbox:     `- [x] field` / `- [ ] field` — truthy value → checked; falsy → unchecked
 *
 * Multi-word field names (`For Me`, `Learned Words`) are matched literally.
 *
 * Semantics (PRD F4 — revised 2026-04-29 per Tomo format-spec contract):
 *   - Field already at target value → skipped-already (no mutation)
 *   - Field at a different value → applied (overwritten — Tomo's intent wins;
 *     the upstream review step is the approval gate, not Hashi)
 *   - Field not found → failed "Tracker field not found: <field>"
 *   - Daily note missing → failed "Daily note missing: <path>"
 *
 * [ref: PRD/F4]
 */

import type { UpdateTrackerAction } from "../schema/types.js";
import type { ActionOutcome } from "../executor/state.js";
import { type HandlerContext } from "./types.js";
import { locateSection } from "./sectionLocator.js";

type UpdateOutcome = Extract<ActionOutcome, { kind: "applied" | "skipped-already" | "failed" }>;

export async function updateTracker(
	action: UpdateTrackerAction,
	ctx: HandlerContext,
): Promise<UpdateOutcome> {
	const { vault } = ctx;
	const { daily_note_path } = action;

	if (!(await vault.exists(daily_note_path))) {
		return { kind: "failed", reason: `Daily note missing: ${daily_note_path}` };
	}

	switch (action.syntax) {
		case "inline_field":
			return handleInlineField(action, ctx);
		case "callout_body":
			return handleCalloutBody(action, ctx);
		case "checkbox":
			return handleCheckbox(action, ctx);
	}
}

// ---------------------------------------------------------------------------
// inline_field — Dataview inline field, 3 positions:
//   line-anchored: `<bullet/indent?><field>:: <value>` (insertion target)
//   bracketed:     `[<field>:: <value>]` mid-prose (read-only overwrite)
//   parenthesized: `(<field>:: <value>)` mid-prose (read-only overwrite)
// Priority: line-anchored > bracketed > parenthesized; first occurrence wins.
// ---------------------------------------------------------------------------

interface InlineMatch {
	readonly lineIdx: number;
	readonly value: string;
	rewrite(line: string, newValue: string): string;
}

async function handleInlineField(
	action: UpdateTrackerAction,
	ctx: HandlerContext,
): Promise<UpdateOutcome> {
	const { vault } = ctx;
	const { daily_note_path, field, value } = action;

	const content = await vault.read(daily_note_path);
	const lines = content.split("\n");
	const match = findInlineMatch(lines, field);

	if (!match) {
		return { kind: "failed", reason: `Tracker field not found: ${field}` };
	}

	const targetStr = String(value);
	if (match.value === targetStr) {
		return { kind: "skipped-already" };
	}

	// Overwrite — Tomo's intent wins (PRD F4 revised 2026-04-29).
	await vault.process(daily_note_path, (current) => {
		const currentLines = current.split("\n");
		const replaced = match.rewrite(currentLines[match.lineIdx] ?? "", targetStr);
		currentLines[match.lineIdx] = replaced;
		return currentLines.join("\n");
	});
	return { kind: "applied" };
}

/** Find the first matching inline field across the 3 priority classes. */
function findInlineMatch(lines: readonly string[], field: string): InlineMatch | null {
	const escaped = escapeRegExp(field);
	const lineAnchored = new RegExp(`^(\\s*(?:[-*]\\s+)?(?:>\\s+)?)${escaped}::\\s*(.*)$`);
	const bracketed = new RegExp(`\\[${escaped}::\\s*([^\\]]*)\\]`);
	const parenthesized = new RegExp(`\\(${escaped}::\\s*([^)]*)\\)`);

	// Pass 1: line-anchored (highest priority)
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const m = lineAnchored.exec(line);
		if (m) {
			const prefix = m[1] ?? "";
			return {
				lineIdx: i,
				value: (m[2] ?? "").trim(),
				rewrite: (_l, v) => `${prefix}${field}:: ${v}`,
			};
		}
	}

	// Pass 2: bracketed
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const m = bracketed.exec(line);
		if (m) {
			const inner = m[0]; // full `[field:: value]`
			return {
				lineIdx: i,
				value: (m[1] ?? "").trim(),
				rewrite: (l, v) => l.replace(inner, `[${field}:: ${v}]`),
			};
		}
	}

	// Pass 3: parenthesized
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const m = parenthesized.exec(line);
		if (m) {
			const inner = m[0]; // full `(field:: value)`
			return {
				lineIdx: i,
				value: (m[1] ?? "").trim(),
				rewrite: (l, v) => l.replace(inner, `(${field}:: ${v})`),
			};
		}
	}

	return null;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// callout_body — `> <field>:: <value>` (double-colon only) inside named section
// ---------------------------------------------------------------------------

async function handleCalloutBody(
	action: UpdateTrackerAction,
	ctx: HandlerContext,
): Promise<UpdateOutcome> {
	const { vault } = ctx;
	const { daily_note_path, field, value, section } = action;

	const [content, metadata] = await Promise.all([
		vault.read(daily_note_path),
		vault.metadata(daily_note_path),
	]);

	const sectionName = section ?? field;
	const range = metadata ? locateSection(metadata, content, sectionName) : null;
	if (!range) {
		return { kind: "failed", reason: `Section not found: ${sectionName}` };
	}

	const lines = content.split("\n");
	const end = range.endLine === -1 ? lines.length - 1 : range.endLine;
	const prefix = `> ${field}::`;

	let fieldLineIdx = -1;
	for (let i = range.startLine; i <= end; i++) {
		if ((lines[i] ?? "").startsWith(prefix)) {
			fieldLineIdx = i;
			break;
		}
	}

	if (fieldLineIdx === -1) {
		return { kind: "failed", reason: `Tracker field not found: ${field}` };
	}

	const currentValue = (lines[fieldLineIdx] ?? "").slice(prefix.length).trim();
	const targetStr = String(value);

	if (currentValue === targetStr) {
		return { kind: "skipped-already" };
	}

	// Overwrite — Tomo's intent wins (PRD F4 revised 2026-04-29).
	await vault.process(daily_note_path, (current) => {
		const currentLines = current.split("\n");
		currentLines[fieldLineIdx] = `${prefix} ${targetStr}`;
		return currentLines.join("\n");
	});
	return { kind: "applied" };
}

// ---------------------------------------------------------------------------
// checkbox — `- [x] field` / `- [ ] field`
// ---------------------------------------------------------------------------

async function handleCheckbox(
	action: UpdateTrackerAction,
	ctx: HandlerContext,
): Promise<UpdateOutcome> {
	const { vault } = ctx;
	const { daily_note_path, field, value } = action;

	const content = await vault.read(daily_note_path);
	const lines = content.split("\n");

	const checkedPattern = `- [x] ${field}`;
	const uncheckedPattern = `- [ ] ${field}`;

	const isChecked = lines.some((l) => l === checkedPattern);
	const isUnchecked = lines.some((l) => l === uncheckedPattern);

	if (!isChecked && !isUnchecked) {
		return { kind: "failed", reason: `Tracker field not found: ${field}` };
	}

	const targetChecked = Boolean(value);
	const alreadyChecked = isChecked;

	if (alreadyChecked === targetChecked) {
		return { kind: "skipped-already" };
	}

	// Toggle: replace checked ↔ unchecked
	await vault.process(daily_note_path, (current) => {
		if (targetChecked) {
			return current.split(uncheckedPattern).join(checkedPattern);
		}
		return current.split(checkedPattern).join(uncheckedPattern);
	});

	return { kind: "applied" };
}
