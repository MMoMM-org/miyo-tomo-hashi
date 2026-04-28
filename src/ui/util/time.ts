/**
 * Human-readable elapsed-time helper for UI surfaces.
 *
 * Spec: docs/XDD/specs/001-session-view — SDD "Directory Map" entry for
 * `src/ui/util/time.ts # NEW: formatUptime(startedAt) → "3 min ago"`. Used
 * by the InstancePickerModal to label each Tomo container row in the
 * Settings pane.
 *
 * Boundary policy: < 60 sec → "N sec ago"; < 60 min → "N min ago";
 * < 24 hr → "N hr ago"; otherwise "N d ago". Future timestamps clamp to
 * "0 sec ago" — the discovery list is local and any apparent skew should
 * present as "just now", not a negative number.
 */

export function formatUptime(startedAt: Date, now: Date = new Date()): string {
	const sec = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));
	if (sec < 60) return `${sec} sec ago`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min} min ago`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr} hr ago`;
	const days = Math.floor(hr / 24);
	return `${days} d ago`;
}
