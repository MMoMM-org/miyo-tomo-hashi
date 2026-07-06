/**
 * Force-Atomic stem-sync (spec-004 SDD §6 "Force-Atomic is one decision per
 * source", PRD F7).
 *
 * `suggestions[].force_atomic` and `daily_updates[].log_entries[].force_atomic_note`
 * are separate wire fields that represent the SAME logical decision for a
 * given source note. Hashi keeps them equal by matching a suggestion's
 * `stem` against a daily log entry's `source_stem` — the wire has no other
 * stable link between the two (a daily log entry carries no id of its own).
 *
 * Pure `EditModel -> EditModel`: no `obsidian` import, no I/O. Every
 * mutating path returns a new model with `dirty:true`; a call that changes
 * nothing (unknown id/stem, or the value already matches everywhere)
 * returns the original model unchanged.
 */

import type {
	DailyLogEntryWire,
	DailyUpdateWire,
	EditModel,
	SuggestionWire,
} from "../../types/suggestions.js";

function syncSuggestions(
	suggestions: readonly SuggestionWire[],
	stem: string,
	value: boolean,
): { suggestions: readonly SuggestionWire[]; changed: boolean } {
	let changed = false;
	const next = suggestions.map((suggestion) => {
		if (suggestion.stem === stem && suggestion.force_atomic !== value) {
			changed = true;
			return { ...suggestion, force_atomic: value };
		}
		return suggestion;
	});
	return { suggestions: changed ? next : suggestions, changed };
}

function syncLogEntries(
	logEntries: readonly DailyLogEntryWire[],
	stem: string,
	value: boolean,
): { logEntries: readonly DailyLogEntryWire[]; changed: boolean } {
	let changed = false;
	const next = logEntries.map((entry) => {
		if (entry.source_stem === stem && entry.force_atomic_note !== value) {
			changed = true;
			return { ...entry, force_atomic_note: value };
		}
		return entry;
	});
	return { logEntries: changed ? next : logEntries, changed };
}

function syncDailyUpdates(
	dailyUpdates: readonly DailyUpdateWire[],
	stem: string,
	value: boolean,
): { dailyUpdates: readonly DailyUpdateWire[]; changed: boolean } {
	let changed = false;
	const next = dailyUpdates.map((dailyUpdate) => {
		const result = syncLogEntries(dailyUpdate.log_entries, stem, value);
		if (result.changed) {
			changed = true;
			return { ...dailyUpdate, log_entries: result.logEntries };
		}
		return dailyUpdate;
	});
	return { dailyUpdates: changed ? next : dailyUpdates, changed };
}

/** Shared core: sync every suggestion and daily log entry matching `stem` to `value`. */
function syncByStem(model: EditModel, stem: string, value: boolean): EditModel {
	const suggestionsResult = syncSuggestions(model.doc.suggestions, stem, value);
	const dailyUpdatesResult = syncDailyUpdates(model.doc.daily_updates, stem, value);

	if (!suggestionsResult.changed && !dailyUpdatesResult.changed) {
		return model;
	}

	return {
		doc: {
			...model.doc,
			suggestions: suggestionsResult.suggestions,
			daily_updates: dailyUpdatesResult.dailyUpdates,
		},
		dirty: true,
	};
}

/**
 * Set `force_atomic` on the suggestion `suggestionId`, and `force_atomic_note`
 * on every daily log entry whose `source_stem` matches that suggestion's
 * `stem`. No-op (unchanged, `dirty:false`) when `suggestionId` is unknown or
 * the value already matches everywhere.
 */
export function setForceAtomicFromSuggestion(
	model: EditModel,
	suggestionId: string,
	value: boolean,
): EditModel {
	const suggestion = model.doc.suggestions.find((s) => s.id === suggestionId);
	if (!suggestion) {
		return model;
	}
	return syncByStem(model, suggestion.stem, value);
}

/**
 * Set `force_atomic_note` on every daily log entry whose `source_stem`
 * equals `stem`, and `force_atomic` on every suggestion whose `stem`
 * matches. No-op (unchanged, `dirty:false`) when `stem` has no matches
 * anywhere or the value already matches everywhere.
 */
export function setForceAtomicFromDaily(model: EditModel, stem: string, value: boolean): EditModel {
	return syncByStem(model, stem, value);
}
