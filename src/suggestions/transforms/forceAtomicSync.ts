/**
 * Force-Atomic identity-sync (spec-004 SDD §6 "Force-Atomic is one decision per
 * source", PRD F7).
 *
 * `suggestions[].force_atomic` and `daily_updates[].log_entries[].force_atomic_note`
 * are separate wire fields that represent the SAME logical decision for a
 * given source note. Hashi keeps them equal by matching a suggestion's
 * `item_key` against a daily log entry's `source_item_key` — both are the
 * note's vault-relative path, verbatim, and both are required by the wire.
 *
 * This join used to be keyed on `stem` / `source_stem`. Those are DISPLAY
 * text: two notes of the same name in different inbox subfolders share a stem,
 * so the sync reached across them and flipped one note's decision from the
 * other's card. Tomo's spec-035 F9 added `source_item_key` to all three daily
 * buckets precisely to give this join a unique key; before it, the stem really
 * was the only link the wire offered. `test/fixtures/suggestions/three-bucket-run.json`
 * carries the collision ("Test" in `Images/` and in `assets/`).
 *
 * Pure `EditModel -> EditModel`: no `obsidian` import, no I/O. Every
 * mutating path returns a new model with `dirty:true`; a call that changes
 * nothing (unknown id/item_key, or the value already matches everywhere)
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
	itemKey: string,
	value: boolean,
): { suggestions: readonly SuggestionWire[]; changed: boolean } {
	let changed = false;
	const next = suggestions.map((suggestion) => {
		if (suggestion.item_key === itemKey && suggestion.force_atomic !== value) {
			changed = true;
			return { ...suggestion, force_atomic: value };
		}
		return suggestion;
	});
	return { suggestions: changed ? next : suggestions, changed };
}

function syncLogEntries(
	logEntries: readonly DailyLogEntryWire[],
	itemKey: string,
	value: boolean,
): { logEntries: readonly DailyLogEntryWire[]; changed: boolean } {
	let changed = false;
	const next = logEntries.map((entry) => {
		if (entry.source_item_key === itemKey && entry.force_atomic_note !== value) {
			changed = true;
			return { ...entry, force_atomic_note: value };
		}
		return entry;
	});
	return { logEntries: changed ? next : logEntries, changed };
}

function syncDailyUpdates(
	dailyUpdates: readonly DailyUpdateWire[],
	itemKey: string,
	value: boolean,
): { dailyUpdates: readonly DailyUpdateWire[]; changed: boolean } {
	let changed = false;
	const next = dailyUpdates.map((dailyUpdate) => {
		const result = syncLogEntries(dailyUpdate.log_entries, itemKey, value);
		if (result.changed) {
			changed = true;
			return { ...dailyUpdate, log_entries: result.logEntries };
		}
		return dailyUpdate;
	});
	return { dailyUpdates: changed ? next : dailyUpdates, changed };
}

/** Shared core: sync every suggestion and daily log entry matching `itemKey` to `value`. */
function syncByItemKey(model: EditModel, itemKey: string, value: boolean): EditModel {
	const suggestionsResult = syncSuggestions(model.doc.suggestions, itemKey, value);
	const dailyUpdatesResult = syncDailyUpdates(model.doc.daily_updates, itemKey, value);

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
 * on every daily log entry whose `source_item_key` matches that suggestion's
 * `item_key`. No-op (unchanged, `dirty:false`) when `suggestionId` is unknown
 * or the value already matches everywhere.
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
	return syncByItemKey(model, suggestion.item_key, value);
}

/**
 * Set `force_atomic_note` on every daily log entry whose `source_item_key`
 * equals `itemKey`, and `force_atomic` on every suggestion whose `item_key`
 * matches. No-op (unchanged, `dirty:false`) when `itemKey` has no matches
 * anywhere or the value already matches everywhere.
 */
export function setForceAtomicFromDaily(model: EditModel, itemKey: string, value: boolean): EditModel {
	return syncByItemKey(model, itemKey, value);
}
