/**
 * `noteSpots` — what the Instruction Fixer can offer to PICK out of a target
 * note, derived purely from that note's current content (spec-006 follow-up:
 * "anchor/marker pickers", user request 2026-07-27 b + c).
 *
 * Why this exists: the anchor is the single most common mechanical failure a
 * repair has to fix — a heading was renamed, a callout retitled — and until now
 * the only way to repair it was to retype the value by hand into a free-text
 * field. Typing is exactly what produced the broken value in the first place,
 * so the fix loop could fail the same way twice. A picker built from the note's
 * REAL structure closes that: every offered value is one the executor's
 * resolver will find, because it was read out of the file the resolver reads.
 *
 * Two rosters, because the wire has two different mechanisms that both look
 * like "some text to match":
 *
 *   - `computeAnchorSpots` → `Anchor` (`{type, value}`) plus the sibling
 *     `placement`, for the three anchor-bearing kinds. Mirrors
 *     `actions/anchorResolver.ts`.
 *   - `computeMarkerSpots` → `add_relationship.marker`, a plain string matched
 *     as a line PREFIX after the locator strips a callout `> ` and a list
 *     bullet. Mirrors `actions/addRelationship.ts`. It is NOT an anchor and
 *     shares none of its resolution, which is why it gets its own roster
 *     rather than a fourth anchor type.
 *
 * Content-only, never the metadataCache — same #68 rule the resolvers follow
 * (the cache rebuilds asynchronously after every write, so a picker opened just
 * after a repair could enumerate a stale structure). This module is pure: the
 * caller reads the file and hands the content in.
 *
 * DOM-free and Obsidian-free by construction, so the placement rules below are
 * unit-testable against the handler behaviour they mirror.
 */

import { enumerateCallouts, parseHeadings } from "../actions/markdownStructure.js";
import type { Action } from "../schema/types.js";

// ---------------------------------------------------------------------------
// Anchor spots
// ---------------------------------------------------------------------------

/** The three kinds whose anchor a spot pick may rewrite. */
export type AnchorSpotKind = "link_to_moc" | "insert_under_marker" | "replace_section";

export type SpotPlacement = "inside" | "before" | "after";

/** The anchor types a picker can enumerate. `block` is deliberately absent —
 * see `computeAnchorSpots`. */
export type SpotAnchorType = "heading" | "callout" | "line";

/**
 * One choosable row: a concrete anchor plus ONE legal placement for it.
 *
 * Type, value and placement travel together because they are only valid
 * together — `inside` on a `line` anchor is a hard executor failure, and
 * offering the three as independent dropdowns would let the user build exactly
 * that combination. A row is a pre-validated triple instead.
 */
export interface AnchorSpot {
	readonly anchorType: SpotAnchorType;
	/** `Anchor.value` as the resolver will match it. */
	readonly value: string;
	/** `null` for a kind with no `placement` field on the wire (replace_section). */
	readonly placement: SpotPlacement | null;
	/** Primary row text, e.g. `Heading: Maintenance`. */
	readonly label: string;
	/** Secondary row text — the placement, or what the pick does. */
	readonly detail: string;
}

/**
 * The placements `kind` will actually honour for `anchorType`, per the
 * handlers — NOT a single shared table, because the two insert kinds genuinely
 * disagree and a shared one would have to be wrong for one of them:
 *
 *   - `link_to_moc` rejects `inside` on anything but a callout
 *     (`linkToMoc.ts:70` — "placement: inside requires callout anchor").
 *   - `insert_under_marker` additionally supports `inside` on a HEADING, where
 *     it appends at the end of that heading's section (`insertUnderMarker.ts:78`).
 *   - `replace_section` has no `placement` field at all; it always overwrites
 *     the section body. Represented as an empty list, and callers render its
 *     single row with `placement: null`.
 *
 * `suggestions/validPlacements.ts` encodes only the first of those three, since
 * spec-004 emits `link_to_moc` exclusively; reusing it here would silently drop
 * `insert_under_marker`'s heading-inside support.
 */
export function placementsFor(
	kind: AnchorSpotKind,
	anchorType: SpotAnchorType,
): readonly SpotPlacement[] {
	if (kind === "replace_section") return [];
	if (anchorType === "callout") return ["inside", "before", "after"];
	if (anchorType === "heading" && kind === "insert_under_marker") {
		return ["inside", "before", "after"];
	}
	return ["before", "after"];
}

/** Rows for one anchor: one per legal placement, or a single placement-less row. */
function spotRows(
	kind: AnchorSpotKind,
	anchorType: SpotAnchorType,
	value: string,
	label: string,
): AnchorSpot[] {
	const placements = placementsFor(kind, anchorType);
	if (placements.length === 0) {
		return [{ anchorType, value, placement: null, label, detail: "replaces this section" }];
	}
	return placements.map((placement) => ({
		anchorType,
		value,
		placement,
		label,
		detail: placement,
	}));
}

/**
 * Every anchor `kind` could legally use in `content`, each paired with its own
 * legal placements, in the order a user scans for one: headings, then callouts,
 * then body lines — each in document order.
 *
 * `replace_section` offers HEADINGS ONLY: the handler is heading-scoped by
 * design (it computes the section body range from the heading), so a callout or
 * line anchor is not a narrower choice there, it is an invalid one.
 *
 * `block` anchors are never offered. A block anchor is N consecutive lines
 * matched exactly — the escape hatch for markers no single line can express
 * (`schema/types.ts:53`) — and there is no principled way to enumerate the
 * combinations. The field stays free text, so an existing block anchor remains
 * editable by hand; the picker simply does not construct new ones.
 *
 * Fenced code blocks are excluded from the heading and callout rosters (both
 * parsers mask them, as the resolvers do) but NOT from the line roster, because
 * `resolveLine` scans every line without a fence mask. Faithfulness to the
 * resolver is the rule in both directions: hiding a line the resolver would
 * match is as wrong as offering a heading it would not.
 *
 * Line candidates are the note's own body lines, trimmed and de-duplicated,
 * minus the heading and callout-opener lines already offered under their own
 * types. Trimming is safe because `resolveLine` matches by substring inclusion
 * against the RAW line (`anchorResolver.ts:118`), and a trimmed line is always
 * contained in the raw one; it also keeps a value from carrying indentation
 * that is invisible in the picker. Duplicates collapse to their first
 * occurrence, which is the one the resolver would match anyway.
 */
export function computeAnchorSpots(content: string, kind: AnchorSpotKind): readonly AnchorSpot[] {
	const lines = content.split("\n");
	const spots: AnchorSpot[] = [];

	const headings = parseHeadings(lines);
	for (const heading of headings) {
		spots.push(...spotRows(kind, "heading", heading.heading, `Heading: ${heading.heading}`));
	}

	if (kind === "replace_section") return spots;

	const callouts = enumerateCallouts(lines);
	for (const callout of callouts) {
		// `[!type] Title` is the shape `resolveCallout` parses back out.
		const value = `[!${callout.type}] ${callout.title}`;
		spots.push(...spotRows(kind, "callout", value, `Callout: ${value}`));
	}

	const claimed = new Set<number>([
		...headings.map((h) => h.line),
		...callouts.map((c) => c.line),
	]);
	const seen = new Set<string>();
	for (let i = 0; i < lines.length; i++) {
		if (claimed.has(i)) continue;
		const value = (lines[i] ?? "").trim();
		if (value === "" || seen.has(value)) continue;
		seen.add(value);
		spots.push(...spotRows(kind, "line", value, `Line: ${value}`));
	}

	return spots;
}

// ---------------------------------------------------------------------------
// Marker spots (add_relationship)
// ---------------------------------------------------------------------------

/**
 * One choosable `add_relationship.marker`.
 *
 * Deliberately carries no `line` field, despite an earlier version of this
 * picker seeding one (reverted 2026-07-27, wrong on the merits — see the user
 * correction on that change). `marker` answers WHERE to write; `line` is the
 * relationship being established there, e.g. `up:: [[@]]` — and the two are
 * chosen independently ON PURPOSE: repositioning to a different anchor (the
 * usual reason to pick a new marker at all — a template placeholder like "No
 * parent map yet — this note is floating." rather than an existing `up::`
 * field) must NOT touch what gets written, or the action stops establishing
 * any relationship at all. Auto-filling `line` from the picked spot's own
 * current content made every fresh placement a no-op: the handler would find
 * the line and "replace" it with the text already there.
 */
export interface MarkerSpot {
	/** The value written to the wire's `marker` field. */
	readonly value: string;
	readonly label: string;
	/**
	 * The full current line, prefix-stripped, shown as the picker row's
	 * secondary text — what a pick is ABOUT TO MATCH (and, once saved and
	 * re-run, overwrite). Display-only: never written to the wire. Seeing the
	 * current content before picking is the actual safeguard against picking
	 * the wrong line, not a silent auto-fill.
	 */
	readonly detail: string;
}

// Both mirror `actions/addRelationship.ts`'s locator, which strips an optional
// callout prefix and an optional list bullet before testing `startsWith`.
const CALLOUT_PREFIX_RE = /^>\s*/;
const LIST_BULLET_RE = /^([-*+]|\d+\.)\s+/;
/** A Dataview inline field opener, e.g. `up::` — the robust marker shape. */
const FIELD_PREFIX_RE = /^([A-Za-z0-9_-]+::)/;

/**
 * Every marker `add_relationship`'s locator could match in `content`, with the
 * Dataview field openers first.
 *
 * Two candidates per line, because the locator matches a PREFIX of the stripped
 * line and the two useful prefixes are different lengths: `up::` (the field,
 * which keeps matching after its links change) and `up:: [[@]]` (the whole line
 * as it stands today). The field form is listed first and separately because it
 * is the one that survives the rewrite the action is about to perform — a
 * marker equal to the full current line stops matching the moment the line is
 * replaced, which turns a repeatable action into a one-shot.
 *
 * Fenced code blocks are NOT excluded: the locator itself scans every line
 * (`addRelationship.ts:55`), so a candidate hidden by a fence here would be a
 * marker the picker refused to show but the executor would still match.
 */
export function computeMarkerSpots(content: string): readonly MarkerSpot[] {
	const fields: MarkerSpot[] = [];
	const wholeLines: MarkerSpot[] = [];
	const seen = new Set<string>();

	for (const raw of content.split("\n")) {
		const calloutMatch = CALLOUT_PREFIX_RE.exec(raw);
		const afterCallout = (
			calloutMatch !== null ? raw.slice(calloutMatch[0].length) : raw
		).trimStart();
		const bulletMatch = LIST_BULLET_RE.exec(afterCallout);
		const stripped = (
			bulletMatch !== null ? afterCallout.slice(bulletMatch[0].length) : afterCallout
		).trim();
		if (stripped === "") continue;

		const field = FIELD_PREFIX_RE.exec(stripped);
		if (field !== null && !seen.has(field[1]!)) {
			seen.add(field[1]!);
			fields.push({ value: field[1]!, label: field[1]!, detail: stripped });
		}
		if (!seen.has(stripped)) {
			seen.add(stripped);
			wholeLines.push({ value: stripped, label: stripped, detail: raw.trim() });
		}
	}

	return [...fields, ...wholeLines];
}

// ---------------------------------------------------------------------------
// Kind dispatch
// ---------------------------------------------------------------------------

const ANCHOR_SPOT_KINDS: readonly AnchorSpotKind[] = [
	"link_to_moc",
	"insert_under_marker",
	"replace_section",
];

/** `action`'s kind as an `AnchorSpotKind`, or null when it carries no anchor. */
export function anchorSpotKindOf(action: Action): AnchorSpotKind | null {
	const kind = action.action;
	return (ANCHOR_SPOT_KINDS as readonly string[]).includes(kind) ? (kind as AnchorSpotKind) : null;
}

/**
 * The note whose structure a spot pick for `action` should enumerate.
 *
 * Deliberately NOT `affectedNotePath` (the card's note-link resolver): that one
 * answers "which note does this action touch" for every kind and returns a path
 * for kinds with no anchor at all. This answers the narrower question the
 * picker asks, and returns null for anything it cannot pick in — so a caller
 * cannot accidentally open a heading picker over an unrelated note.
 *
 * `link_to_moc` prefers `target_moc_path` over `target_moc` for the same reason
 * the executor does, and falls back to the bare stem, which resolves as a
 * linktext just as well.
 */
export function spotSourcePath(action: Action): string | null {
	switch (action.action) {
		case "link_to_moc":
			return action.target_moc_path ?? action.target_moc;
		case "insert_under_marker":
		case "replace_section":
			return action.target_path;
		case "add_relationship":
			return action.target_moc_path;
		case "edit_frontmatter":
			// Not a "spot" in the anchor sense — but the frontmatter pickers
			// need the same resolve-and-read preamble, and this is the one
			// function that maps an action to the note it works on.
			return action.path;
		default:
			return null;
	}
}

// ---------------------------------------------------------------------------
// Frontmatter properties — the edit_frontmatter pickers' row source
// ---------------------------------------------------------------------------

/** One offerable frontmatter key, with a preview of what it currently holds. */
export interface FrontmatterProperty {
	readonly key: string;
	/** The parsed value, handed through untouched for the transform to commit. */
	readonly value: unknown;
	/** Short human preview for the picker row — never the full value. */
	readonly preview: string;
}

/**
 * Preview a parsed YAML value in one short line. Long strings and long lists
 * are truncated: this is a chooser row, not a viewer, and a wall of text makes
 * the list unscannable.
 */
function previewValue(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) {
		if (value.length === 0) return "(empty list)";
		const head = value.slice(0, 2).map((v) => previewValue(v)).join(", ");
		return value.length > 2 ? `[${head}, +${String(value.length - 2)} more]` : `[${head}]`;
	}
	if (typeof value === "object") return "{…}";
	// Everything reaching here is a primitive — object, array and null were
	// handled above — but `unknown` does not narrow that far, and a blind
	// String() on an object would print "[object Object]" into a chooser row.
	if (typeof value === "string") {
		return value.length > 60 ? `${value.slice(0, 57)}…` : value;
	}
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return String(value);
	}
	return typeof value;
}

/**
 * Turn a note's parsed frontmatter into picker rows, sorted by key.
 *
 * Pure, and takes the already-parsed record rather than reading anything —
 * same contract as the other spot computations, so the pickers stay testable
 * without a vault. An empty or absent block yields an empty array, which the
 * CALLER turns into a notice: opening an empty picker would imply the note is
 * merely featureless rather than missing the block entirely.
 */
export function computeFrontmatterProperties(
	frontmatter: Record<string, unknown> | undefined,
): FrontmatterProperty[] {
	if (frontmatter === undefined) return [];
	return Object.keys(frontmatter)
		.sort((a, b) => a.localeCompare(b))
		.map((key) => ({ key, value: frontmatter[key], preview: previewValue(frontmatter[key]) }));
}

