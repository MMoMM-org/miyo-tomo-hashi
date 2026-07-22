/**
 * Garden-audit apply-decision transforms (spec-005 Phase 2, T2.2) — pure
 * `GardenAuditModel → GardenAuditModel` edits for the fixable-finding
 * decision fields (SDD §Application Data Models). No Obsidian import, no I/O
 * — the store and view call these directly against in-memory state.
 *
 * Immutability contract: `GardenAuditWire` is deeply `readonly`, so every
 * transform here spreads/maps into NEW objects/arrays rather than mutating
 * the input. A transform returns the SAME `model` reference (not merely an
 * equal one) on a rejection or no-op, so callers can cheaply detect "nothing
 * changed" with `===` (mirrors src/suggestions/transforms/suggestion.ts and
 * the `Store<T>` no-op-on-same-ref idiom).
 *
 * `decision` is present ONLY on fixable findings — every setter here is a
 * no-op (same reference) on an unknown finding id or an advisory finding
 * with no `decision` block. Setters never fabricate a `decision`.
 *
 * ADR-5 — `setRepoint` is the one setter with a side effect beyond its own
 * field: Tomo's `build_from_wire` dispatches a selected `broken_up` finding
 * on `decision.action` alone (add_relationship reads repoint; edit_note_text
 * removes the up:: line; anything else silently skips the finding). The
 * editor closes that gap deterministically — a non-empty repoint always
 * means "point at this MOC" (add_relationship), an empty one always means
 * "remove the line" (edit_note_text) — so a selected broken_up finding is
 * never left with `action:null`.
 */

import type { DecisionWire, GardenAuditModel } from "../types/garden-audit.js";

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------

/**
 * Locates the finding by id and applies `update` to its `decision`. Returns
 * the model unchanged (same reference, dirty untouched) when the id is
 * unknown, the finding has no `decision` (advisory), or `update` reports no
 * real change (returns null).
 */
function updateDecision(
	model: GardenAuditModel,
	findingId: string,
	update: (decision: DecisionWire) => DecisionWire | null,
): GardenAuditModel {
	const current = model.doc.findings.find((f) => f.id === findingId);
	if (current === undefined || current.decision === undefined) return model;

	const nextDecision = update(current.decision);
	if (nextDecision === null) return model;

	const findings = model.doc.findings.map((f) =>
		f.id === findingId ? { ...f, decision: nextDecision } : f,
	);
	return { doc: { ...model.doc, findings }, dirty: true };
}

// ---------------------------------------------------------------------------
// selected — the apply/skip toggle common to every fixable check
// ---------------------------------------------------------------------------

/** Sets the finding's apply toggle. No-op if unchanged. */
export function setSelected(
	model: GardenAuditModel,
	findingId: string,
	selected: boolean,
): GardenAuditModel {
	return updateDecision(model, findingId, (decision) => {
		if (decision.selected === selected) return null;
		return { ...decision, selected };
	});
}

// ---------------------------------------------------------------------------
// repoint (broken_up) — ADR-5 action-gating
// ---------------------------------------------------------------------------

/**
 * Sets the broken_up finding's repoint target and derives `decision.action`
 * from it (ADR-5): non-empty → `add_relationship`, empty (= remove the up::
 * line) → `edit_note_text`. No-op if both the value and the derived action
 * are already correct.
 */
export function setRepoint(
	model: GardenAuditModel,
	findingId: string,
	repoint: string,
): GardenAuditModel {
	return updateDecision(model, findingId, (decision) => {
		const action = repoint === "" ? "edit_note_text" : "add_relationship";
		if (decision.repoint === repoint && decision.action === action) return null;
		return { ...decision, repoint, action };
	});
}

// ---------------------------------------------------------------------------
// replace (dead_link) — plain field setter, no action side effect
// ---------------------------------------------------------------------------

/** Sets the dead_link finding's replacement target. No-op if unchanged. */
export function setReplace(
	model: GardenAuditModel,
	findingId: string,
	replace: string,
): GardenAuditModel {
	return updateDecision(model, findingId, (decision) => {
		if (decision.replace === replace) return null;
		return { ...decision, replace };
	});
}

// ---------------------------------------------------------------------------
// file_under (orphan/unparented) — plain field setter
// ---------------------------------------------------------------------------

/** Sets the orphan/unparented finding's filing target MOC. No-op if unchanged. */
export function setFileUnder(
	model: GardenAuditModel,
	findingId: string,
	fileUnder: string,
): GardenAuditModel {
	return updateDecision(model, findingId, (decision) => {
		if (decision.file_under === fileUnder) return null;
		return { ...decision, file_under: fileUnder };
	});
}

// ---------------------------------------------------------------------------
// suggest_requested — editor signal, excluded from Tomo's digest but NOT
// excluded from Hashi's own dirty gate (PRD F5): Hashi never computes a
// digest at all, so a suggest-only edit sets dirty:true like any other.
// ---------------------------------------------------------------------------

/** Marks the finding as wanting LLM candidates from `--suggest`. No-op if unchanged. */
export function setSuggestRequested(
	model: GardenAuditModel,
	findingId: string,
	suggestRequested: boolean,
): GardenAuditModel {
	return updateDecision(model, findingId, (decision) => {
		if (decision.suggest_requested === suggestRequested) return null;
		return { ...decision, suggest_requested: suggestRequested };
	});
}
