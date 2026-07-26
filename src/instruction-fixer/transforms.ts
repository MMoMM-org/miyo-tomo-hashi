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
 * this transform only ever rewrites one of the whitelisted string fields (or
 * `anchor`'s nested `value`) already defined on `src/schema/types.ts`'s wire.
 *
 * Empty/whitespace values are accepted verbatim and never trimmed or coerced
 * to `null` — several whitelisted fields (`edit_note_text.match`, `anchor`'s
 * `value`) are literal-match/literal-text fields where surrounding whitespace
 * is part of the value's meaning, and `Anchor.value: null` is reserved for
 * Tomo's own "unresolved at emission" state, never a user edit.
 */

import type { Action, Anchor } from "../schema/types.js";
import type { InstructionFixerModel } from "../vault/InstructionSetDoc.js";

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
// Per-kind field application — one branch per ADR-5 kind so each field write
// stays type-narrowed against its actual interface rather than a blind cast.
// ---------------------------------------------------------------------------

function applyTargetField(action: Action, fieldKey: string, value: string): Action {
	switch (action.action) {
		case "link_to_moc":
			if (fieldKey === "target_moc") return setStringField(action, "target_moc", value);
			if (fieldKey === "target_moc_path") {
				return setStringField(action, "target_moc_path", value);
			}
			if (fieldKey === "anchor") return setAnchorValue(action, value);
			return action;

		case "insert_under_marker":
		case "replace_section":
			if (fieldKey === "target_path") return setStringField(action, "target_path", value);
			if (fieldKey === "anchor") return setAnchorValue(action, value);
			return action;

		case "add_relationship":
			if (fieldKey === "target_moc_path") {
				return setStringField(action, "target_moc_path", value);
			}
			if (fieldKey === "marker") return setStringField(action, "marker", value);
			if (fieldKey === "line") return setStringField(action, "line", value);
			return action;

		case "edit_note_text":
			if (fieldKey === "path") return setStringField(action, "path", value);
			if (fieldKey === "match") return setStringField(action, "match", value);
			if (fieldKey === "replace") return setStringField(action, "replace", value);
			return action;

		case "remove_up_link":
			if (fieldKey === "path") return setStringField(action, "path", value);
			if (fieldKey === "link") return setStringField(action, "link", value);
			return action;

		case "resolve_dead_link":
			if (fieldKey === "path") return setStringField(action, "path", value);
			if (fieldKey === "target") return setStringField(action, "target", value);
			if (fieldKey === "replace") return setStringField(action, "replace", value);
			return action;

		default:
			// View-only kind — no whitelist entry ever routes here (guarded in
			// setTargetField), but the fallback keeps this function total.
			return action;
	}
}

/**
 * Generic string-field setter for the whitelist's plain `string` fields.
 * Reads/writes via an unknown-valued record (not `any`) since the field key
 * is a runtime string, not a static keyof — every call site above is already
 * narrowed to a kind that actually declares `key` as a string. No-op
 * (same reference) when the value is unchanged.
 */
function setStringField<T extends Action>(action: T, key: string, value: string): T {
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
