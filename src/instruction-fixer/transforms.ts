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
	return setStringField(action, fieldKey, value);
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
	return { ...action, [key]: value } as Action;
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
	// so the write is guarded by the `in` check above and cast once here.
	return writesPlacement ? ({ ...next, placement: spot.placement } as T) : next;
}
