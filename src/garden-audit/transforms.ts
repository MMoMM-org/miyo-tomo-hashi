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
 * never left with `action:null`. `setRepoint` only fires when the user
 * actually edits the repoint field, though — `normalizeBrokenUpActions`
 * below is the save-time backstop for the two paths that never touch it
 * (bare Apply, and an already-selected wire saved with no edits at all).
 */

import type { DecisionWire, FindingWire, GardenAuditModel } from "../types/garden-audit.js";

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
// normalizeBrokenUpActions — ADR-5 save-time backstop
// ---------------------------------------------------------------------------

/**
 * Closes the two ADR-5 gaps `setRepoint` alone can't: (1) a user clicks
 * Apply (`setSelected(…, true)`) without ever touching the repoint field,
 * and (2) a wire arrives already `selected:true, action:null` (schema-legal
 * — "not yet determined") and gets approve-only-saved with no transform in
 * between. Both leave `decision.action` null, which Tomo's `build_from_wire`
 * silently treats as "skip this finding" — exactly the trap ADR-5 exists to
 * close. This is a whole-doc pass rather than a per-finding-id setter (there
 * is no single target id — every finding is a candidate), so it stands
 * alone instead of routing through `updateDecision`, but mirrors that
 * helper's immutability idiom: map+spread into new objects, same-reference
 * no-op when nothing needs normalizing.
 *
 * `dirty:true` on change, matching every other transform's convention, even
 * though the intended caller (`GardenAuditEditorView.handleSave`) runs this
 * immediately before a save that's about to clear `dirty` — that's safe
 * because the view re-reads its reference-identity guard's baseline model
 * AFTER calling this, so the flag never leaks past the save it's running
 * for. A transform that instead tried to preserve the incoming `dirty`
 * would have to thread the caller's pre-normalize flag through as an extra
 * parameter for no observable behavior difference.
 */
export function normalizeBrokenUpActions(model: GardenAuditModel): GardenAuditModel {
	let changed = false;
	const findings = model.doc.findings.map((finding) => {
		if (finding.check !== "broken_up" || finding.decision === undefined) return finding;
		const decision = finding.decision;
		if (decision.selected !== true || decision.action !== null) return finding;

		changed = true;
		const action = decision.repoint === undefined || decision.repoint === ""
			? "edit_note_text"
			: "add_relationship";
		return { ...finding, decision: { ...decision, action } };
	});

	if (!changed) return model;
	return { doc: { ...model.doc, findings }, dirty: true };
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

// ---------------------------------------------------------------------------
// suggest_pending gate (2026-07-24) — a finding is "pending" when the user
// requested `--suggest` but Tomo hasn't enriched it yet; "fresh" when Tomo
// enriched it AND left display-only candidates behind. Both predicates are
// pure lookups over `DecisionWire`/`FindingWire` — shared by the save-time
// gate below, the header banner, and the fixable-card highlight (no DOM
// dependency, so both the view and the render-only UI modules import from
// here rather than re-deriving the same two booleans).
// ---------------------------------------------------------------------------

/** True when ≥1 fixable finding has a requested-but-not-yet-enriched suggest. */
export function hasPendingSuggest(model: GardenAuditModel): boolean {
	return model.doc.findings.some(
		(f) => f.decision?.suggest_requested === true && f.decision.suggested !== true,
	);
}

/** True when `--suggest` ran for this finding AND left ≥1 display-only candidate. */
export function isFreshFinding(finding: FindingWire): boolean {
	return (
		finding.decision?.suggested === true &&
		(finding.decision.candidates?.length ?? 0) > 0
	);
}

/** Count of findings currently "fresh" (see `isFreshFinding`). */
export function countFreshFindings(model: GardenAuditModel): number {
	return model.doc.findings.filter(isFreshFinding).length;
}

/**
 * Save-time approval gate (2026-07-24, suggest_pending gate) — ADR-2: the
 * adapter writes `model.doc` verbatim now, so the view is the sole owner of
 * `approved`/`suggest_pending`. A pending suggest PARKS the run
 * (`approved:false, suggest_pending:true`) so Tomo's triage never processes a
 * half-finished review; otherwise it approves normally
 * (`approved:true, suggest_pending:false`). Same-reference no-op when both
 * gate fields are already correct (mirrors `normalizeBrokenUpActions`'s
 * idiom) — `dirty:true` on change even though the intended caller
 * (`GardenAuditEditorView.handleSave`) is about to clear it immediately after,
 * for the same reason `normalizeBrokenUpActions` documents: the view re-reads
 * its reference-identity guard's baseline model AFTER calling this, so the
 * flag never leaks past the save it's running for.
 */
export function applyApprovalGate(model: GardenAuditModel): GardenAuditModel {
	const pending = hasPendingSuggest(model);
	const approved = !pending;
	const suggestPending = pending;
	if (model.doc.approved === approved && model.doc.suggest_pending === suggestPending) {
		return model;
	}
	return {
		doc: { ...model.doc, approved, suggest_pending: suggestPending },
		dirty: true,
	};
}
