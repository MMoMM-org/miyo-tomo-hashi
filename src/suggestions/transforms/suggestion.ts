/**
 * Suggestion field transforms (T1.3) — pure `EditModel → EditModel` edits for
 * op 1 (candidate-MOC re-point / ＋Add MOC), op 4 (approve/skip decision),
 * and the plain note-editable fields (SDD §5-§6). No Obsidian import, no I/O
 * — the store (T1.9) and view call these directly against in-memory state.
 *
 * Immutability contract: `SuggestionsWire` is deeply `readonly`, so every
 * transform here spreads/maps into NEW objects/arrays rather than mutating
 * the input. A transform returns the SAME `model` reference (not merely an
 * equal one) on a rejection or no-op, so callers can cheaply detect "nothing
 * changed" with `===` and `dirty` is only ever set on a real change.
 *
 * Single-select re-point (SDD §6): `candidate_mocs[].selected` models a
 * single active MOC per suggestion — `selectCandidateMoc` clears every other
 * candidate's selection when it sets the named one, matching the "re-point"
 * framing (one link target, not a multi-select) rather than a toggle.
 */

import type {
	CandidateMocWire,
	EditModel,
	SuggestionWire,
} from "../../types/suggestions.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Locates the suggestion by id and applies `update` to produce its
 * replacement. Returns the model unchanged (same reference, dirty
 * untouched) when the id is unknown or `update` reports no real change.
 */
function updateSuggestion(
	model: EditModel,
	suggestionId: string,
	update: (suggestion: SuggestionWire) => SuggestionWire | null,
): EditModel {
	const current = model.doc.suggestions.find((s) => s.id === suggestionId);
	if (current === undefined) return model;

	const next = update(current);
	if (next === null) return model;

	const suggestions = model.doc.suggestions.map((s) => (s.id === suggestionId ? next : s));
	return { doc: { ...model.doc, suggestions }, dirty: true };
}

// ---------------------------------------------------------------------------
// op 1 — candidate MOC re-point / add
// ---------------------------------------------------------------------------

/**
 * Selects `mocPath` as the suggestion's single active candidate MOC,
 * clearing every other candidate's selection (op 1 re-point). Rejects
 * (returns the model unchanged) when the suggestion is suppressed —
 * suppressed notes render no MOC UI (SDD §6), so this action is unreachable
 * for them and must not silently apply.
 */
export function selectCandidateMoc(
	model: EditModel,
	suggestionId: string,
	mocPath: string,
): EditModel {
	return updateSuggestion(model, suggestionId, (suggestion) => {
		if (suggestion.suppressed) return null;
		// No-op guard: mirrors the equality-gate pattern on every sibling
		// setter below. `mocPath` is already the sole selection when every
		// candidate's current `selected` already matches what the map below
		// would set it to — i.e. re-selecting the already-sole-selected
		// candidate must not spuriously flip `dirty` (dirty gates save).
		const alreadySole = suggestion.candidate_mocs.every(
			(c) => c.selected === (c.path === mocPath),
		);
		if (alreadySole) return null;
		const candidate_mocs = suggestion.candidate_mocs.map((c) => ({
			...c,
			selected: c.path === mocPath,
		}));
		return { ...suggestion, candidate_mocs };
	});
}

/**
 * Appends a new user-authored candidate MOC (op 1 ＋Add MOC), selected by
 * default, without altering any existing candidate's selection state — kept
 * additive per the plan (the picker adds a new option; `selectCandidateMoc`
 * is the single-select re-point). Rejects on a suppressed suggestion for the
 * same reason as `selectCandidateMoc`.
 */
export function addMoc(model: EditModel, suggestionId: string, path: string): EditModel {
	return updateSuggestion(model, suggestionId, (suggestion) => {
		if (suggestion.suppressed) return null;
		const newCandidate: CandidateMocWire = {
			path,
			selected: true,
			source: "user",
			anchor: null,
		};
		return { ...suggestion, candidate_mocs: [...suggestion.candidate_mocs, newCandidate] };
	});
}

// ---------------------------------------------------------------------------
// op 4 — approve/skip decision
// ---------------------------------------------------------------------------

/** Sets the suggestion's approve/skip decision (op 4). No-op if unchanged. */
export function setDecision(
	model: EditModel,
	suggestionId: string,
	decision: "approve" | "skip",
): EditModel {
	return updateSuggestion(model, suggestionId, (suggestion) => {
		if (suggestion.decision === decision) return null;
		return { ...suggestion, decision };
	});
}

// ---------------------------------------------------------------------------
// Note-editable fields
// ---------------------------------------------------------------------------

/** Sets the suggestion's title. No-op if unchanged. */
export function setTitle(model: EditModel, suggestionId: string, title: string): EditModel {
	return updateSuggestion(model, suggestionId, (suggestion) => {
		if (suggestion.title === title) return null;
		return { ...suggestion, title };
	});
}

/** Sets the suggestion's template wikilink target. No-op if unchanged. */
export function setTemplate(model: EditModel, suggestionId: string, template: string): EditModel {
	return updateSuggestion(model, suggestionId, (suggestion) => {
		if (suggestion.template === template) return null;
		return { ...suggestion, template };
	});
}

/** Sets the suggestion's destination folder. No-op if unchanged. */
export function setLocation(model: EditModel, suggestionId: string, location: string): EditModel {
	return updateSuggestion(model, suggestionId, (suggestion) => {
		if (suggestion.location === location) return null;
		return { ...suggestion, location };
	});
}

/** Sets the suggestion's tags. No-op if the tag list is unchanged by content. */
export function setTags(
	model: EditModel,
	suggestionId: string,
	tags: readonly string[],
): EditModel {
	return updateSuggestion(model, suggestionId, (suggestion) => {
		const unchanged =
			suggestion.tags.length === tags.length &&
			suggestion.tags.every((tag, i) => tag === tags[i]);
		if (unchanged) return null;
		return { ...suggestion, tags: [...tags] };
	});
}

/** Sets the suggestion's keep-source flag. No-op if unchanged. */
export function setKeepSource(
	model: EditModel,
	suggestionId: string,
	keepSource: boolean,
): EditModel {
	return updateSuggestion(model, suggestionId, (suggestion) => {
		if (suggestion.keep_source === keepSource) return null;
		return { ...suggestion, keep_source: keepSource };
	});
}

/** Sets the suggestion's delete-source flag. No-op if unchanged. */
export function setDeleteSource(
	model: EditModel,
	suggestionId: string,
	deleteSource: boolean,
): EditModel {
	return updateSuggestion(model, suggestionId, (suggestion) => {
		if (suggestion.delete_source === deleteSource) return null;
		return { ...suggestion, delete_source: deleteSource };
	});
}
