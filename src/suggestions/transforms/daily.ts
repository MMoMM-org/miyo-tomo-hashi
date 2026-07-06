/**
 * Daily-update edit transforms (T1.7, SDD §6 Daily, PRD F8).
 *
 * Daily items (trackers / log_entries / log_links) have no stable id — the
 * wire schema addresses them positionally within a `DailyUpdateWire`, itself
 * keyed by `date`. Every transform here is a pure `EditModel -> EditModel`
 * function: it never mutates `model.doc` (all fields are deeply readonly —
 * see src/types/suggestions.ts), and it sets `dirty: true` only when it
 * actually changed something. An unknown `date` or an out-of-range index is
 * a no-op that returns the model unchanged with `dirty: false`, so callers
 * can rely on "nothing happened" being indistinguishable from "did not
 * apply" without throwing.
 *
 * `force_atomic_note` sync (DailyLogEntryWire) is intentionally NOT touched
 * here — that field is kept in sync with `suggestions[].force_atomic` by
 * T1.4, in a different file. These transforms only ever set content,
 * position, time, and accepted toggles.
 *
 * Every setter also gates on "value(s) actually changed": a call that
 * requests the same value the field already holds is a no-op, same as an
 * unknown date or out-of-range index — it returns the model unchanged with
 * `dirty: false`. This matters beyond tidiness: `dirty` gates `save` (ADR-S4),
 * and a spurious `dirty: true` on a same-value call would write out an
 * otherwise-untouched doc, defeating Tomo's unchanged-doc digest short-circuit.
 */

import type {
	DailyLogEntryWire,
	DailyLogLinkWire,
	DailyTrackerWire,
	DailyUpdateWire,
	EditModel,
} from "../../types/suggestions.js";

type DailyLogPosition = DailyLogEntryWire["position"];

/** Rejection / no-op result: same doc reference, dirty explicitly false. */
function unchanged(model: EditModel): EditModel {
	return { doc: model.doc, dirty: false };
}

/** Returns a new array with the item at `index` replaced by `value`. */
function replaceAt<T>(items: readonly T[], index: number, value: T): readonly T[] {
	return items.map((item, i) => (i === index ? value : item));
}

/**
 * Locates the `DailyUpdateWire` for `date` and applies `patch` to it.
 * `patch` returns `null` to signal "reject / no-op" (unknown index, or a
 * transform-specific gating rule) — in which case the whole call resolves
 * to `unchanged(model)`. Otherwise the patched daily update replaces the
 * original in a freshly-spread `doc`/`daily_updates`, and `dirty` is set.
 */
function withDailyUpdate(
	model: EditModel,
	date: string,
	patch: (daily: DailyUpdateWire) => DailyUpdateWire | null,
): EditModel {
	const dailyIndex = model.doc.daily_updates.findIndex((d) => d.date === date);
	const daily = dailyIndex === -1 ? undefined : model.doc.daily_updates[dailyIndex];
	if (daily === undefined) return unchanged(model);

	const patched = patch(daily);
	if (patched === null) return unchanged(model);

	const daily_updates = replaceAt(model.doc.daily_updates, dailyIndex, patched);
	return { doc: { ...model.doc, daily_updates }, dirty: true };
}

/** Sets a daily log entry's `content`. */
export function setDailyLogContent(
	model: EditModel,
	date: string,
	entryIndex: number,
	content: string,
): EditModel {
	return withDailyUpdate(model, date, (daily) => {
		const entry = daily.log_entries[entryIndex];
		if (entry === undefined) return null;
		if (entry.content === content) return null;
		const log_entries = replaceAt(daily.log_entries, entryIndex, { ...entry, content });
		return { ...daily, log_entries };
	});
}

/**
 * Sets a daily log entry's `position`. `time` is only meaningful when
 * `position === "at_time"`, so switching to `after_last_line` or
 * `before_first_line` clears `time` to `null`.
 */
export function setDailyLogPosition(
	model: EditModel,
	date: string,
	entryIndex: number,
	position: DailyLogPosition,
): EditModel {
	return withDailyUpdate(model, date, (daily) => {
		const entry = daily.log_entries[entryIndex];
		if (entry === undefined) return null;
		if (entry.position === position) return null;
		const time = position === "at_time" ? entry.time : null;
		const log_entries = replaceAt(daily.log_entries, entryIndex, { ...entry, position, time });
		return { ...daily, log_entries };
	});
}

/**
 * Sets a daily log entry's `time`, but only when the entry's `position` is
 * `"at_time"` — a time is meaningless for `after_last_line`/`before_first_line`
 * entries, so any such attempt is rejected (unchanged model, `dirty: false`).
 */
export function setDailyLogTime(
	model: EditModel,
	date: string,
	entryIndex: number,
	time: string | null,
): EditModel {
	return withDailyUpdate(model, date, (daily) => {
		const entry = daily.log_entries[entryIndex];
		if (entry === undefined) return null;
		if (entry.position !== "at_time") return null;
		if (entry.time === time) return null;
		const log_entries = replaceAt(daily.log_entries, entryIndex, { ...entry, time });
		return { ...daily, log_entries };
	});
}

/** Toggles a daily tracker's `accepted` flag. */
export function setDailyTrackerAccepted(
	model: EditModel,
	date: string,
	trackerIndex: number,
	accepted: boolean,
): EditModel {
	return withDailyUpdate(model, date, (daily) => {
		const tracker: DailyTrackerWire | undefined = daily.trackers[trackerIndex];
		if (tracker === undefined) return null;
		if (tracker.accepted === accepted) return null;
		const trackers = replaceAt(daily.trackers, trackerIndex, { ...tracker, accepted });
		return { ...daily, trackers };
	});
}

/** Toggles a daily log entry's `accepted` flag. */
export function setDailyLogAccepted(
	model: EditModel,
	date: string,
	entryIndex: number,
	accepted: boolean,
): EditModel {
	return withDailyUpdate(model, date, (daily) => {
		const entry = daily.log_entries[entryIndex];
		if (entry === undefined) return null;
		if (entry.accepted === accepted) return null;
		const log_entries = replaceAt(daily.log_entries, entryIndex, { ...entry, accepted });
		return { ...daily, log_entries };
	});
}

/** Toggles a daily log link's `accepted` flag. */
export function setDailyLogLinkAccepted(
	model: EditModel,
	date: string,
	linkIndex: number,
	accepted: boolean,
): EditModel {
	return withDailyUpdate(model, date, (daily) => {
		const link: DailyLogLinkWire | undefined = daily.log_links[linkIndex];
		if (link === undefined) return null;
		if (link.accepted === accepted) return null;
		const log_links = replaceAt(daily.log_links, linkIndex, { ...link, accepted });
		return { ...daily, log_links };
	});
}
