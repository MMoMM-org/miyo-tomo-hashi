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

	const content = await vault.cachedRead(daily_note_path);
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

// Per-field RegExp cache (review M7). Pre-fix the three patterns were
// reconstructed on every call. Field cardinality in real instruction
// sets is small, so a Map keyed by field name is the right shape.
//
// review round 2 / L48: this Map is intentionally unbounded. Field names
// in real instruction sets come from the renderer's small, fixed
// vocabulary (energy, mood, weight, etc.) and the practical ceiling per
// vault is ~50 distinct fields across years of use. Module-scope means
// the cache survives plugin disable/enable through Obsidian's CJS module
// cache; that survivorship is also intentional (the regexes are pure
// functions of the field name and never change). If a future
// instruction-set version introduces user-supplied free-text field
// names, swap to a bounded LRU.
//
// review round 2 / L49: the bracketed/parenthesized patterns use
// `[^\]]*` / `[^)]*` which silently truncate values containing the
// matching closer (e.g. `[score:: a)b]` matches "a)b]" wrongly because
// `)` is allowed inside the bracketed value class). Real Tomo-emitted
// values do not carry these characters today; documenting the
// limitation rather than introducing a more permissive grammar that
// might capture across legitimate field boundaries.
interface InlineMatchers {
	readonly lineAnchored: RegExp;
	readonly bracketed: RegExp;
	readonly parenthesized: RegExp;
}
const inlineMatcherCache = new Map<string, InlineMatchers>();

function getInlineMatchers(field: string): InlineMatchers {
	const cached = inlineMatcherCache.get(field);
	if (cached !== undefined) return cached;
	const escaped = escapeRegExp(field);
	const matchers: InlineMatchers = {
		lineAnchored: new RegExp(`^(\\s*(?:[-*]\\s+)?(?:>\\s+)?)${escaped}::\\s*(.*)$`),
		bracketed: new RegExp(`\\[${escaped}::\\s*([^\\]]*)\\]`),
		parenthesized: new RegExp(`\\(${escaped}::\\s*([^)]*)\\)`),
	};
	inlineMatcherCache.set(field, matchers);
	return matchers;
}

/**
 * Find the first matching inline field across the 3 priority classes.
 *
 * Priority is line-anchored > bracketed > parenthesized. The walk is a
 * single pass (review M7); we eagerly return on line-anchored (highest
 * priority — no later line can outrank it) and otherwise track the
 * earliest bracketed and parenthesized hits, returning the
 * highest-priority survivor at the end.
 */
function findInlineMatch(lines: readonly string[], field: string): InlineMatch | null {
	const { lineAnchored, bracketed, parenthesized } = getInlineMatchers(field);

	let bracketedMatch: InlineMatch | null = null;
	let parenthesizedMatch: InlineMatch | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";

		const la = lineAnchored.exec(line);
		if (la) {
			const prefix = la[1] ?? "";
			return {
				lineIdx: i,
				value: (la[2] ?? "").trim(),
				rewrite: (_l, v) => `${prefix}${field}:: ${v}`,
			};
		}

		if (bracketedMatch === null) {
			const b = bracketed.exec(line);
			if (b) {
				const inner = b[0];
				bracketedMatch = {
					lineIdx: i,
					value: (b[1] ?? "").trim(),
					rewrite: (l, v) => l.replace(inner, `[${field}:: ${v}]`),
				};
			}
		}

		if (parenthesizedMatch === null) {
			const p = parenthesized.exec(line);
			if (p) {
				const inner = p[0];
				parenthesizedMatch = {
					lineIdx: i,
					value: (p[1] ?? "").trim(),
					rewrite: (l, v) => l.replace(inner, `(${field}:: ${v})`),
				};
			}
		}
	}

	return bracketedMatch ?? parenthesizedMatch;
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

	const content = await vault.cachedRead(daily_note_path);

	const sectionName = section ?? field;
	const range = locateSection(content, sectionName);
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

	const content = await vault.cachedRead(daily_note_path);
	const lines = content.split("\n");

	const checkedPattern = `- [x] ${field}`;
	const uncheckedPattern = `- [ ] ${field}`;

	// L9: single pass over `lines` rather than two `lines.some()` scans.
	let isChecked = false;
	let isUnchecked = false;
	for (const l of lines) {
		if (l === checkedPattern) {
			isChecked = true;
		} else if (l === uncheckedPattern) {
			isUnchecked = true;
		}
		if (isChecked && isUnchecked) break;
	}

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
