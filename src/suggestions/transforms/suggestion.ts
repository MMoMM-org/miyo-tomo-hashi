/**
 * Suggestion field transforms (T1.3) — pure `EditModel → EditModel` edits for
 * op 1 (candidate-MOC re-point / ＋Add MOC), op 4 (the approve / skip /
 * delete-source disposition), and the plain note-editable fields (SDD §5-§6).
 * No Obsidian import, no I/O — the store (T1.9) and view call these directly
 * against in-memory state.
 *
 * One writer per decision (2026-09-29): op 4 is exposed ONLY as
 * `setDisposition`, never as independent `decision` / `delete_source` setters.
 * Those two fields are not independent — Tomo's Pass 2 reads `delete_source`
 * solely under `skip`, so a separate boolean setter can produce a Skip that
 * deletes or a keep that does not keep. Encoding the measured mapping once,
 * here, is what makes those states unreachable from the UI.
 *
 * Immutability contract: `SuggestionsWire` is deeply `readonly`, so every
 * transform here spreads/maps into NEW objects/arrays rather than mutating
 * the input. A transform returns the SAME `model` reference (not merely an
 * equal one) on a rejection or no-op, so callers can cheaply detect "nothing
 * changed" with `===` and `dirty` is only ever set on a real change.
 *
 * Multi-select links (owner pre-live refinement): `candidate_mocs[].selected`
 * is an INDEPENDENT per-candidate checkbox — `toggleCandidateMoc` flips only
 * the named candidate, leaving the others untouched. A note may therefore
 * link into several MOCs, Tomo's auto-approved candidates arrive pre-selected,
 * and an approved link can be cleared by toggling it off (the earlier
 * single-select re-point could neither multi-link nor deselect).
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
 * Toggles `mocPath`'s `selected` flag on the suggestion — the "Link to a MOC"
 * checkbox is an independent multi-select: checking marks the candidate
 * linked, unchecking clears it, and no OTHER candidate is touched. Rejects
 * (returns the model unchanged) when the suggestion is suppressed — suppressed
 * notes render no MOC UI (SDD §6), so this action is unreachable for them and
 * must not silently apply — or when `mocPath` names no candidate.
 */
export function toggleCandidateMoc(
	model: EditModel,
	suggestionId: string,
	mocPath: string,
): EditModel {
	return updateSuggestion(model, suggestionId, (suggestion) => {
		if (suggestion.suppressed) return null;
		const target = suggestion.candidate_mocs.find((c) => c.path === mocPath);
		if (target === undefined) return null;
		const candidate_mocs = suggestion.candidate_mocs.map((c) =>
			c.path === mocPath ? { ...c, selected: !c.selected } : c,
		);
		return { ...suggestion, candidate_mocs };
	});
}

/**
 * Appends a new user-authored candidate MOC (op 1 ＋Add MOC), selected by
 * default, without altering any existing candidate's selection state (each
 * link is independent — see `toggleCandidateMoc`). Rejects on a suppressed
 * suggestion for the same reason as `toggleCandidateMoc`.
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
// op 4 — the disposition tri-state (approve / skip / delete-source)
// ---------------------------------------------------------------------------

/**
 * The three legs Tomo's suggestions markdown offers per note. NOT a wire
 * value — `decision` on the wire is only `approve | skip`, and the third leg
 * is `(skip, delete_source: true)`. See `setDisposition`.
 */
export type SuggestionDisposition = "approve" | "skip" | "delete-source";

/**
 * Reads the leg a suggestion is currently in — the render-side inverse of
 * `setDisposition`.
 *
 * `approve` wins outright: Tomo's builder never reads `delete_source` under
 * an approved item, so `(approve, delete_source: true)` is an inert state and
 * reads as plain `approve`. We do NOT normalise that away on load — writing
 * to the model would set `dirty` on an untouched document and break the
 * byte-stability that keeps Tomo on the markdown path.
 */
export function dispositionOf(suggestion: SuggestionWire): SuggestionDisposition {
	if (suggestion.decision === "approve") return "approve";
	return suggestion.delete_source ? "delete-source" : "skip";
}

/**
 * Sets the suggestion's disposition (op 4) — the SINGLE writer for the
 * `decision` / `delete_source` / `keep_source` triple. No-op if unchanged.
 *
 * The mapping is Tomo's MEASURED Pass-2 behaviour, not our choice
 * (`tests/test_delete_source_flag_triple.py`, handoff 2026-09-29):
 *
 * | leg             | `decision` | `delete_source` | origin inbox note        |
 * |-----------------|------------|-----------------|--------------------------|
 * | `approve`       | approve    | false           | per `keep_source`        |
 * | `skip`          | skip       | false           | kept, no action emitted  |
 * | `delete-source` | skip       | true            | deleted                  |
 *
 * Three things this function exists to make unreachable:
 *
 *  1. **A Skip that deletes.** `delete_source` is the skip leg, so moving to
 *     plain `skip` MUST clear it — leaving an armed flag would delete the
 *     origin the user just chose to keep.
 *  2. **A meaningless flag under approve.** Tomo accepts
 *     `(approve, delete_source: true)` and ignores it, but told us to write
 *     `false` there rather than rely on the inertness.
 *  3. **A "keep" that does not keep.** `build_from_wire` builds a skipped
 *     entry from `id`/`source_path`/`item_key`/`disposition` — `keep_source`
 *     never reaches it, so under `skip` the origin is deleted regardless. The
 *     delete leg therefore clears `keep_source` too, so the saved document
 *     never carries a contradiction the owner cannot see.
 */
export function setDisposition(
	model: EditModel,
	suggestionId: string,
	disposition: SuggestionDisposition,
): EditModel {
	const decision = disposition === "approve" ? "approve" : "skip";
	const deleteSource = disposition === "delete-source";

	return updateSuggestion(model, suggestionId, (suggestion) => {
		const keepSource = deleteSource ? false : suggestion.keep_source;
		const unchanged =
			suggestion.decision === decision &&
			suggestion.delete_source === deleteSource &&
			suggestion.keep_source === keepSource;
		if (unchanged) return null;
		return {
			...suggestion,
			decision,
			delete_source: deleteSource,
			keep_source: keepSource,
		};
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

/**
 * Sets the suggestion's keep-source flag. No-op if unchanged.
 *
 * Only meaningful under the `approve` disposition — Tomo's Pass 2 never reads
 * this field for a skipped item. The card disables the checkbox on the two
 * skip legs for that reason; see `setDisposition`.
 */
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
