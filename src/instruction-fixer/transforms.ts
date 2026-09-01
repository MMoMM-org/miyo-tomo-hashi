/**
 * Instruction Fixer target-field transform (spec-006 Phase 1, T1.3;
 * SDD "Interface Specifications", ADR-5/ADR-6).
 *
 * Pure `InstructionFixerModel → InstructionFixerModel` setter for the single
 * "repair a failed action's target field" edit the Fixer UI offers. Mirrors
 * `src/garden-audit/transforms.ts`'s idiom: locate by id, apply only through
 * an explicit whitelist, and return the SAME model reference (not merely an
 * equal one) on any rejection or no-op — the `Store` uses `===` for change
 * detection, so a spurious new object would cause needless re-renders.
 *
 * ADR-5 — only these 7 action kinds carry a user-repairable target field;
 * every other kind (`move_note`, `update_tracker`, `update_log_*`,
 * `create_moc`, `delete_source`, `skip`, …) is view-only in the Fixer and has
 * no entry in `TARGET_FIELD_WHITELIST` at all, so any field on those kinds is
 * rejected. `TARGET_FIELD_WHITELIST` is exported (not just used internally)
 * because Phase 3's `ui/instruction-fixer/cards/targetFields.ts` needs to
 * enumerate the same roster to render the right fields per card.
 *
 * ADR-6 — no skip/disable field, no schema change, no new persisted field:
 * this module only ever rewrites fields already defined on
 * `src/schema/types.ts`'s wire. Still true after the amendment below: `type`
 * and `placement` are existing enum fields, not new ones.
 *
 * ADR-5 amendment (2026-07-27, user request b + c) — `setAnchorSpot` widens the
 * write surface from `anchor.value` alone to the triple `anchor.type` +
 * `anchor.value` + `placement`, for the three anchor-bearing kinds only. The
 * reason is in that function's own docblock; the short form is that a picker
 * choosing a real spot out of the target note cannot honestly write one third
 * of it. `TARGET_FIELD_WHITELIST` is unchanged and still governs every
 * free-text field, including `anchor.value` when typed by hand.
 *
 * Empty/whitespace values are accepted verbatim and never trimmed or coerced
 * to `null` — several whitelisted fields (`edit_note_text.match`, `anchor`'s
 * `value`) are literal-match/literal-text fields where surrounding whitespace
 * is part of the value's meaning, and `Anchor.value: null` is reserved for
 * Tomo's own "unresolved at emission" state, never a user edit.
 */

import type { Action, Anchor } from "../schema/types.js";
import type { InstructionFixerModel } from "../vault/InstructionSetDoc.js";

import { anchorSpotKindOf, type AnchorSpot } from "./noteSpots.js";

// ---------------------------------------------------------------------------
// TARGET_FIELD_WHITELIST — ADR-5's roster, verbatim
// ---------------------------------------------------------------------------

export const TARGET_FIELD_WHITELIST = {
	link_to_moc: ["target_moc", "target_moc_path", "anchor"],
	insert_under_marker: ["target_path", "anchor"],
	replace_section: ["target_path", "anchor"],
	add_relationship: ["target_moc_path", "marker", "line"],
	edit_note_text: ["path", "match", "replace"],
	// The optimistic-locking guard on edit_frontmatter only helps if a failed
	// expectation is repairable — otherwise it manufactures dead ends. `value`
	// and `expected` are JSON-parsed (see setJsonField); `operation` is
	// deliberately absent, since flipping set↔remove authors a different action
	// rather than fixing a mechanical failure.
	edit_frontmatter: ["path", "property", "value", "expected"],
	remove_up_link: ["path", "link"],
	resolve_dead_link: ["path", "target", "replace"],
} as const satisfies Partial<Record<Action["action"], readonly string[]>>;

// ---------------------------------------------------------------------------
// setTargetField — the public setter
// ---------------------------------------------------------------------------

/**
 * Sets a whitelisted target field on the action identified by `actionId`.
 * Returns the SAME `model` reference (dirty untouched) when: the id is
 * unknown, the action's kind has no whitelist entry (view-only kind), the
 * field isn't in that kind's whitelist, or `value` already matches the
 * current field value.
 */
export function setTargetField(
	model: InstructionFixerModel,
	actionId: string,
	fieldKey: string,
	value: string,
): InstructionFixerModel {
	const current = model.doc.actions.find((a) => a.id === actionId);
	if (current === undefined) return model;

	const allowedFields: readonly string[] | undefined = (
		TARGET_FIELD_WHITELIST as Partial<Record<Action["action"], readonly string[]>>
	)[current.action];
	if (allowedFields === undefined || !allowedFields.includes(fieldKey)) return model;

	const next = applyTargetField(current, fieldKey, value);
	if (next === current) return model;

	const actions = model.doc.actions.map((a) => (a === current ? next : a));
	return { doc: { ...model.doc, actions }, dirty: true };
}

// ---------------------------------------------------------------------------
// Field application — single dispatch. `setTargetField` has already checked
// `fieldKey` against `TARGET_FIELD_WHITELIST[action.action]`, so there is
// deliberately no second, hand-maintained (kind, field) listing here — one
// authoritative copy of the ADR-5 roster is what actually protects the
// writes. `anchor` is the one whitelisted field that isn't a plain string
// (it nests inside `Anchor`), so it gets its own branch; the `"anchor" in
// action` check is what gives `setAnchorValue` real compile-time narrowing
// (Action → the 3 anchor-bearing kinds), not a re-statement of the whitelist.
// ---------------------------------------------------------------------------

function applyTargetField(action: Action, fieldKey: string, value: string): Action {
	if (fieldKey === "anchor" && "anchor" in action) return setAnchorValue(action, value);
	if (
		action.action === "edit_frontmatter" &&
		(fieldKey === "value" || fieldKey === "expected")
	) {
		return setJsonField(action, fieldKey, value);
	}
	return setStringField(action, fieldKey, value);
}

/**
 * JSON-valued setter for `edit_frontmatter`'s `value` / `expected`. Those carry
 * whole YAML values — scalars, lists, maps — so the Fixer's text control edits
 * their JSON rendering.
 *
 * Malformed JSON returns the SAME action reference, which the caller turns into
 * "no change" exactly as it does for every other rejection in this module. That
 * is deliberate: a half-typed `["[[A]]",` must leave the model untouched rather
 * than commit garbage or throw into the render path.
 */
function setJsonField(action: Action, key: string, value: string): Action {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return action;
	}
	const record = action as unknown as Record<string, unknown>;
	if (JSON.stringify(record[key]) === JSON.stringify(parsed)) return action;
	return { ...action, [key]: parsed };
}

/**
 * String-field setter for the whitelist's plain `string` fields. `key` is a
 * runtime string validated by the caller's whitelist check, not a static
 * `keyof Action` — a generic constrained to `keyof T` would only create the
 * appearance of safety here, since `T` is the unnarrowed `Action` union at
 * every call site. Reads/writes via an unknown-valued record (not `any`).
 * No-op (same reference) when the value is unchanged.
 */
function setStringField(action: Action, key: string, value: string): Action {
	const record = action as unknown as Record<string, unknown>;
	if (record[key] === value) return action;
	return { ...action, [key]: value };
}

/**
 * Sets `anchor.value`, preserving `anchor.type`. Only reachable for the 3
 * kinds whose interfaces declare `anchor: Anchor`, so this stays fully
 * type-narrowed with no cast. No-op (same reference) when the value is
 * unchanged; never coerces an empty string to `null`.
 */
function setAnchorValue<T extends Action & { anchor: Anchor }>(action: T, value: string): T {
	if (action.anchor.value === value) return action;
	return { ...action, anchor: { ...action.anchor, value } };
}

// ---------------------------------------------------------------------------
// setAnchorSpot — the picker's write path (ADR-5 amendment, 2026-07-27)
// ---------------------------------------------------------------------------

/**
 * Commits a picked anchor spot: `anchor.type`, `anchor.value` and — for the two
 * kinds that have one — `placement`, in ONE transform.
 *
 * This is the ADR-5 amendment. The original roster made only `anchor.value`
 * writable, on the reasoning that the type and placement came from Tomo's
 * analysis and the user was correcting a stale VALUE. Picking a spot out of the
 * live note invalidates that split: the user repairing a renamed heading by
 * choosing a callout instead is changing the type as a direct consequence, and
 * a picker that wrote the value while leaving `type: "heading"` behind would
 * emit a triple the resolver cannot resolve — a repair that fails closed for a
 * reason the user did nothing to cause.
 *
 * The three fields therefore move together or not at all, and the legality of
 * the combination is decided in `noteSpots.placementsFor` (which mirrors each
 * handler) BEFORE a row is ever offered. This function re-checks the enum
 * membership of both values anyway: it is a write path into the wire, and a
 * caller that hand-built a spot must not be able to widen what lands on disk
 * beyond what the schema's enums allow.
 *
 * Rejections return the SAME model (unknown id, a kind with no anchor, a value
 * outside the schema enums, or a spot that changes nothing) — same convention
 * as `setTargetField`, for the same store `===` reason.
 */
export function setAnchorSpot(
	model: InstructionFixerModel,
	actionId: string,
	spot: Pick<AnchorSpot, "anchorType" | "value" | "placement">,
): InstructionFixerModel {
	const current = model.doc.actions.find((a) => a.id === actionId);
	if (current === undefined) return model;

	const kind = anchorSpotKindOf(current);
	if (kind === null || !("anchor" in current)) return model;
	if (!ANCHOR_TYPES.includes(spot.anchorType)) return model;
	if (spot.placement !== null && !PLACEMENTS.includes(spot.placement)) return model;

	const next = applyAnchorSpot(current, spot);
	if (next === current) return model;

	const actions = model.doc.actions.map((a) => (a === current ? next : a));
	return { doc: { ...model.doc, actions }, dirty: true };
}

const ANCHOR_TYPES: readonly string[] = ["callout", "heading", "line", "block"];
const PLACEMENTS: readonly string[] = ["inside", "before", "after"];

/**
 * Writes the triple onto an anchor-bearing action. `placement` is written only
 * when the spot carries one AND the action already has the field — the second
 * check is what keeps `replace_section` (which has no `placement` on its wire)
 * from growing an unknown property that `additionalProperties: false` would
 * reject at save.
 */
function applyAnchorSpot<T extends Action & { anchor: Anchor }>(
	action: T,
	spot: Pick<AnchorSpot, "anchorType" | "value" | "placement">,
): T {
	const writesPlacement = spot.placement !== null && "placement" in action;
	const sameAnchor = action.anchor.type === spot.anchorType && action.anchor.value === spot.value;
	const samePlacement =
		!writesPlacement ||
		(action as unknown as Record<string, unknown>)["placement"] === spot.placement;
	if (sameAnchor && samePlacement) return action;

	const next: T = { ...action, anchor: { type: spot.anchorType, value: spot.value } };
	// `placement` is not on `T` (only two of the three anchor kinds declare it),
	// so the write is guarded by the `in` check above.
	return writesPlacement ? { ...next, placement: spot.placement } : next;
}

// ---------------------------------------------------------------------------
// setMarkerSpot — add_relationship's marker picker (ADR-5 amendment,
// 2026-07-27, second correction — see this function's docblock)
// ---------------------------------------------------------------------------

/**
 * Commits a picked `add_relationship.marker`, and rewrites `line`'s PREFIX to
 * match while preserving whatever follows it.
 *
 * The concrete case this answers: `marker: "up::"` doesn't match anything in
 * the target note (no `up::` field there yet), and `line: "up:: [[@]]"` is
 * the relationship Tomo wants established. Picking a different marker from
 * the note's real structure is a repointing of WHERE to write, not a change
 * to WHAT gets written — the link (`[[@]]`) must survive the pick unchanged;
 * only the field name in front of it should track the new marker. So `line`
 * goes from `up:: [[@]]` to `<picked marker> [[@]]` — the OLD marker's text
 * is swapped out of `line`'s front, and everything after it carries over
 * verbatim, whatever that is.
 *
 * This is a CORRECTION of a same-day amendment that instead seeded `line`
 * from the picked spot's own current note content — which was wrong on the
 * merits (it made every fresh placement a no-op, see that commit's message)
 * — and of the revert that followed it, which left `line` untouched
 * entirely and so couldn't fix I08's actual complaint: the marker text
 * embedded at the front of `line` never changed with it.
 *
 * The swap only fires when `line` CURRENTLY starts with the CURRENT
 * `marker` — the shape `add_relationship`'s simple field-marker case always
 * has, and the one case where "everything after the marker" is a
 * well-defined thing to preserve. When it doesn't hold (`line` already
 * diverged from `marker`, e.g. Tomo's own multi-link aggregation replaced
 * the whole line with unrelated content), there is no reliable split point,
 * and only `marker` is written — the same safe fallback the revert used
 * unconditionally.
 */
export function setMarkerSpot(
	model: InstructionFixerModel,
	actionId: string,
	marker: string,
): InstructionFixerModel {
	const current = model.doc.actions.find((a) => a.id === actionId);
	if (current === undefined || current.action !== "add_relationship") return model;

	const rewrittenLine = current.line.startsWith(current.marker)
		? marker + current.line.slice(current.marker.length)
		: current.line;

	const withMarker = setTargetField(model, actionId, "marker", marker);
	return setTargetField(withMarker, actionId, "line", rewrittenLine);
}

// ---------------------------------------------------------------------------
// Frontmatter pickers — ADR-5 amendment #2 (2026-09-01)
// ---------------------------------------------------------------------------

/**
 * What a frontmatter pick carries back from the target note: the value found
 * at a key, and whether the key was there at all. `present: false` is not the
 * same as a value of `null` — `expected: null` is the wire's sentinel for
 * "the property must not exist", so the two must stay distinguishable all the
 * way from the note to the field.
 */
export interface FrontmatterPick {
	readonly current: unknown;
	readonly present: boolean;
}

/**
 * Render a picked value as the JSON string the `expected` control edits.
 * Returns `null` when the value has no JSON representation (an `undefined`
 * from `JSON.stringify`), in which case the caller leaves the model alone
 * rather than committing something lossy.
 */
function pickedAsJson(pick: FrontmatterPick): string | null {
	// An absent key IS the null sentinel — that is the whole reason a refresh
	// against a note someone deleted the key from produces a correct
	// instruction with no special-casing.
	if (!pick.present) return "null";
	const json = JSON.stringify(pick.current);
	return json === undefined ? null : json;
}

/**
 * Commits a property picked out of the target note's frontmatter: writes
 * `property` AND `expected` in one transform.
 *
 * Writing only `property` would be the dishonest half of the job. `expected`
 * is compared deep-equal against the note at apply time, so a pick that
 * changed the key while leaving the old key's expectation behind hands the
 * user an action GUARANTEED to fail — the picker would be manufacturing the
 * very breakage it exists to repair. Same reasoning as `setAnchorSpot`'s
 * amendment: a picker choosing a real thing out of the target note cannot
 * honestly write one half of it.
 *
 * Returns the SAME model reference when the id is unknown, the kind is wrong,
 * the value has no JSON form, or nothing actually changed.
 */
export function setFrontmatterProperty(
	model: InstructionFixerModel,
	actionId: string,
	property: string,
	pick: FrontmatterPick,
): InstructionFixerModel {
	const current = model.doc.actions.find((a) => a.id === actionId);
	if (current === undefined || current.action !== "edit_frontmatter") return model;

	const json = pickedAsJson(pick);
	if (json === null) return model;

	// Both writes go through setTargetField so the ADR-5 whitelist stays the
	// single authority on what may be written — the pick is the affordance,
	// not the guard.
	const withProperty = setTargetField(model, actionId, "property", property);
	return setTargetField(withProperty, actionId, "expected", json);
}

/**
 * Refreshes `expected` alone from the target note, for the property the action
 * already names. Unlike the property pick there is no second field to be
 * honest about: the key is fixed, so the value is fully determined.
 *
 * This is the repair loop's shortest path — an action fails BECAUSE the note
 * holds something else, and this puts that something else in the field.
 */
export function setFrontmatterExpected(
	model: InstructionFixerModel,
	actionId: string,
	pick: FrontmatterPick,
): InstructionFixerModel {
	const current = model.doc.actions.find((a) => a.id === actionId);
	if (current === undefined || current.action !== "edit_frontmatter") return model;

	const json = pickedAsJson(pick);
	if (json === null) return model;

	return setTargetField(model, actionId, "expected", json);
}

