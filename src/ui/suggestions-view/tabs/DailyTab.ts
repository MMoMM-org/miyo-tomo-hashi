/**
 * Daily tab (T3.6, SDD §6 Daily, PRD F8). Renders one group per
 * `DailyUpdateWire` (keyed by `date`): a click-to-open link to that date's
 * daily note (or a "doesn't exist" state — Hashi never creates the note
 * itself), its trackers, log entries, and log links.
 *
 * Daily items have no stable id (SDD §6 / `transforms/daily.ts` file
 * header) — they're addressed positionally by `(date, index)` within their
 * `DailyUpdateWire`, so every control below closes over the date + the
 * item's index in its array and calls the matching transform from
 * `suggestions/transforms/daily.ts`. Force-Atomic is the one exception: it
 * goes through `setForceAtomicFromDaily` (transforms/forceAtomicSync.ts),
 * addressed by the entry's `source_stem` — that's the shared key with
 * `suggestions[].force_atomic` (PRD F7: "Force-Atomic is one decision per
 * source"). Note: an accepted daily-only source auto-deletes downstream —
 * that's a save-time consequence, not a separate control, so there is
 * deliberately no UI for it here.
 *
 * Daily-note existence check / open (v1 simplification): the wire only
 * gives us a bare date stem (e.g. "2026-07-06"), not a resolved vault path —
 * there is no per-vault "daily notes folder" setting surfaced to Hashi.
 * `findDailyNoteFile` tries the root-level `${date}.md` path first, then
 * falls back to a basename search over `vault.getMarkdownFiles()` (catches
 * daily notes living in a configured subfolder). This is approximate by
 * design: good enough to gate the click-to-open control, not a substitute
 * for reading the user's actual Daily Notes / Periodic Notes config. Opening
 * uses `workspace.openLinkText(date, "", false)` — Obsidian resolves the
 * link and creates the note if needed; Hashi itself never calls
 * `vault.create`.
 *
 * `dirty`/no-op semantics live entirely in the transforms this file calls —
 * see `transforms/daily.ts` and `transforms/forceAtomicSync.ts` file headers.
 */

import { TFile } from "obsidian";
import type { App } from "obsidian";

import { setForceAtomicFromDaily } from "../../../suggestions/transforms/forceAtomicSync.js";
import {
	setDailyLogAccepted,
	setDailyLogContent,
	setDailyLogLinkAccepted,
	setDailyLogPosition,
	setDailyLogTime,
	setDailyTrackerAccepted,
} from "../../../suggestions/transforms/daily.js";
import type {
	DailyLogEntryWire,
	DailyLogLinkWire,
	DailyTrackerWire,
	DailyUpdateWire,
	EditModel,
} from "../../../types/suggestions.js";
import type { EditorTab, TabContext } from "../tabContract.js";

type DailyLogPosition = DailyLogEntryWire["position"];

const POSITIONS: readonly DailyLogPosition[] = [
	"at_time",
	"after_last_line",
	"before_first_line",
];

const POSITION_LABELS: Record<DailyLogPosition, string> = {
	at_time: "At time",
	after_last_line: "After last line",
	before_first_line: "Before first line",
};

/**
 * Resolves `date` to an existing daily-note `TFile`, or `null` when none is
 * found. See the file header re: this being a v1 approximation, not a real
 * Daily Notes / Periodic Notes folder resolution.
 */
function findDailyNoteFile(app: App, date: string): TFile | null {
	const direct = app.vault.getAbstractFileByPath(`${date}.md`);
	if (direct instanceof TFile) return direct;

	const byBasename = app.vault
		.getMarkdownFiles()
		.find((file) => file.basename === date);
	return byBasename ?? null;
}

export class DailyTab implements EditorTab {
	readonly id = "daily";
	readonly label = "Daily";

	count(model: EditModel): number {
		return model.doc.daily_updates.length;
	}

	render(container: HTMLElement, model: EditModel, ctx: TabContext): void {
		for (const daily of model.doc.daily_updates) {
			this.renderDateGroup(container, daily, ctx);
		}
	}

	private renderDateGroup(
		container: HTMLElement,
		daily: DailyUpdateWire,
		ctx: TabContext,
	): void {
		const group = container.createDiv({ cls: "hashi-daily-group" });

		this.renderDateHeader(group, daily.date, ctx.app);

		for (const [index, tracker] of daily.trackers.entries()) {
			this.renderTracker(group, daily.date, index, tracker, ctx);
		}
		for (const [index, entry] of daily.log_entries.entries()) {
			this.renderLogEntry(group, daily.date, index, entry, ctx);
		}
		for (const [index, link] of daily.log_links.entries()) {
			this.renderLogLink(group, daily.date, index, link, ctx);
		}
	}

	private renderDateHeader(group: HTMLElement, date: string, app: App): void {
		const header = group.createDiv({ cls: "hashi-daily-header" });
		const file = findDailyNoteFile(app, date);

		if (file === null) {
			header.createDiv({
				cls: "hashi-daily-date-missing",
				text: `${date} — daily note doesn't exist — Obsidian will create it on open`,
			});
			return;
		}

		const link = header.createEl("a", {
			cls: "hashi-daily-date-link",
			text: date,
			attr: { href: "#" },
		});
		link.addEventListener("click", (evt) => {
			evt.preventDefault();
			// Hashi never creates the daily note — opening it is Obsidian's job,
			// and openLinkText will create it if it has since disappeared.
			void app.workspace.openLinkText(date, "", false);
		});
	}

	private renderTracker(
		group: HTMLElement,
		date: string,
		index: number,
		tracker: DailyTrackerWire,
		ctx: TabContext,
	): void {
		const row = group.createDiv({ cls: "hashi-daily-tracker" });
		row.createSpan({ cls: "hashi-daily-tracker-field", text: tracker.field });
		row.createSpan({ cls: "hashi-daily-tracker-value", text: tracker.value });
		row.createSpan({ cls: "hashi-daily-tracker-reason", text: tracker.reason });

		const accept = row.createEl("input", {
			cls: "hashi-daily-tracker-accept",
			attr: { type: "checkbox" },
		});
		accept.checked = tracker.accepted;
		accept.addEventListener("change", () => {
			const checked = accept.checked;
			ctx.apply((model) => setDailyTrackerAccepted(model, date, index, checked));
		});
	}

	private renderLogEntry(
		group: HTMLElement,
		date: string,
		index: number,
		entry: DailyLogEntryWire,
		ctx: TabContext,
	): void {
		const row = group.createDiv({ cls: "hashi-daily-log-entry" });
		row.createDiv({ cls: "hashi-daily-log-entry-reason", text: entry.reason });

		const content = row.createEl("textarea", {
			cls: "hashi-daily-log-entry-content",
		});
		content.value = entry.content;
		content.addEventListener("input", () => {
			const value = content.value;
			ctx.apply((model) => setDailyLogContent(model, date, index, value));
		});

		const position = row.createEl("select", {
			cls: "hashi-daily-log-entry-position",
		});
		for (const value of POSITIONS) {
			const option = position.createEl("option", {
				text: POSITION_LABELS[value],
				attr: { value },
			});
			option.selected = value === entry.position;
		}

		const time = row.createEl("input", {
			cls: "hashi-daily-log-entry-time",
			attr: { type: "time" },
		});
		time.value = entry.time ?? "";
		time.disabled = entry.position !== "at_time";

		position.addEventListener("change", () => {
			const next = position.value as DailyLogPosition;
			ctx.apply((model) => setDailyLogPosition(model, date, index, next));
			time.disabled = next !== "at_time";
		});
		time.addEventListener("change", () => {
			const value = time.value === "" ? null : time.value;
			ctx.apply((model) => setDailyLogTime(model, date, index, value));
		});

		const accept = row.createEl("input", {
			cls: "hashi-daily-log-entry-accept",
			attr: { type: "checkbox" },
		});
		accept.checked = entry.accepted;
		accept.addEventListener("change", () => {
			const checked = accept.checked;
			ctx.apply((model) => setDailyLogAccepted(model, date, index, checked));
		});

		const forceAtomic = row.createEl("input", {
			cls: "hashi-daily-log-entry-force-atomic",
			attr: { type: "checkbox" },
		});
		forceAtomic.checked = entry.force_atomic_note;
		forceAtomic.addEventListener("change", () => {
			const checked = forceAtomic.checked;
			ctx.apply((model) => setForceAtomicFromDaily(model, entry.source_stem, checked));
		});
	}

	private renderLogLink(
		group: HTMLElement,
		date: string,
		index: number,
		link: DailyLogLinkWire,
		ctx: TabContext,
	): void {
		const row = group.createDiv({ cls: "hashi-daily-log-link" });
		row.createSpan({ cls: "hashi-daily-log-link-target", text: link.target_stem });
		row.createSpan({ cls: "hashi-daily-log-link-reason", text: link.reason });

		const accept = row.createEl("input", {
			cls: "hashi-daily-log-link-accept",
			attr: { type: "checkbox" },
		});
		accept.checked = link.accepted;
		accept.addEventListener("change", () => {
			const checked = accept.checked;
			ctx.apply((model) => setDailyLogLinkAccepted(model, date, index, checked));
		});
	}
}
