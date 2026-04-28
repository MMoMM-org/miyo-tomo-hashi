/**
 * updateTracker handler — set a tracker field in a daily note.
 *
 * Three sub-modes determined by `action.syntax`:
 *   - inline_field: `field:: value` (Dataview-style inline field anywhere in file)
 *   - callout_body: `> field:: value` (Dataview double-colon) inside a named callout section
 *   - checkbox:     `- [x] field` / `- [ ] field` — truthy value → checked; falsy → unchecked
 *
 * Idempotency + conflict semantics (PRD F4):
 *   - Field already at target value → skipped-already (no mutation)
 *   - Field at a different value → failed "Tracker field differs from target — not overwriting"
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
// inline_field — `field:: value` anywhere in the file
// ---------------------------------------------------------------------------

async function handleInlineField(
	action: UpdateTrackerAction,
	ctx: HandlerContext,
): Promise<UpdateOutcome> {
	const { vault } = ctx;
	const { daily_note_path, field, value } = action;

	const content = await vault.read(daily_note_path);
	const prefix = `${field}::`;
	const lineIdx = content.split("\n").findIndex((l) => l.startsWith(prefix));

	if (lineIdx === -1) {
		return { kind: "failed", reason: `Tracker field not found: ${field}` };
	}

	const currentValue = extractInlineValue(content.split("\n")[lineIdx] ?? "", field);
	const targetStr = String(value);

	if (currentValue === targetStr) {
		return { kind: "skipped-already" };
	}

	// Different value → fail per PRD
	return { kind: "failed", reason: "Tracker field differs from target — not overwriting" };
}

function extractInlineValue(line: string, field: string): string {
	const prefix = `${field}::`;
	return line.startsWith(prefix) ? line.slice(prefix.length).trim() : "";
}

// ---------------------------------------------------------------------------
// callout_body — `> field:: value` or `> field: value` inside named section
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

	// Find the field line within the section. Match `> field::` or `> field:`
	let fieldLineIdx = -1;
	for (let i = range.startLine; i <= end; i++) {
		const line = lines[i] ?? "";
		if (isCalloutFieldLine(line, field)) {
			fieldLineIdx = i;
			break;
		}
	}

	if (fieldLineIdx === -1) {
		return { kind: "failed", reason: `Tracker field not found: ${field}` };
	}

	const currentValue = extractCalloutFieldValue(lines[fieldLineIdx] ?? "", field);
	const targetStr = String(value);

	if (currentValue === targetStr) {
		return { kind: "skipped-already" };
	}

	return { kind: "failed", reason: "Tracker field differs from target — not overwriting" };
}

/** Returns true if the line is a callout body line for the given field. */
function isCalloutFieldLine(line: string, field: string): boolean {
	// Match `> field::` or `> field:` (not followed by another colon for field::)
	return line.startsWith(`> ${field}::`);
}

function extractCalloutFieldValue(line: string, field: string): string {
	const prefixDouble = `> ${field}::`;
	if (line.startsWith(prefixDouble)) {
		return line.slice(prefixDouble.length).trim();
	}
	return "";
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
