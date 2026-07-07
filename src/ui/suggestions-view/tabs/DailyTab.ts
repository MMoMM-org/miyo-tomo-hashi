/**
 * Daily tab (T3.6, SDD §6 Daily, PRD F8; rebuilt to the approved mockup —
 * docs/XDD/specs/004-suggestions-editor/mockups/suggestions-editor.html —
 * fixing 3 confirmed bugs, see below). Renders one `hashi-se-card
 * hashi-se-daily` card per `DailyUpdateWire` (keyed by `date`): a
 * click-to-open control for that date's daily note, its trackers, log
 * entries, and log links.
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
 * Bug fixes in this rebuild (see spec-004 validation drift findings):
 *  1. The date is now ALWAYS a clickable control — `openDailyNote` runs on
 *     click whether or not the note currently exists. Previously a missing
 *     note rendered a dead `<div>`, which meant the (common) missing-note
 *     case had no way to open/create the note at all. The existence check
 *     (`findDailyNoteFile`) now only gates whether the `hashi-se-warn-pill`
 *     is ALSO shown next to the date — it never gates the date control
 *     itself. Hashi still never calls `vault.create` directly; opening goes
 *     through `workspace.openLinkText`, which Obsidian resolves (creating
 *     the note if needed).
 *  2. The missing-note wording changed from the clunkier "daily note
 *     doesn't exist — Obsidian will create it on open" to the mockup's
 *     "⚠ note doesn't exist — click to create" pill text.
 *  3. Every checkbox (tracker accept, log-entry accept, log-entry
 *     force-atomic, log-link accept) is now wrapped in a `hashi-se-cbx` /
 *     `hashi-se-ctl` `<label>` with visible text — previously these
 *     rendered as bare `<input type=checkbox>` with no label at all.
 *  4. The log entry's meta line renders its `source_stem` as a clickable
 *     `.hashi-se-wlink` (via `renderNoteLink`) so the user can open the
 *     origin note — the approved mockup had this and the first rebuild
 *     dropped it to plain text (owner QA finding).
 *
 * Daily-note existence check / open (v1 simplification): the wire only
 * gives us a bare date stem (e.g. "2026-07-06"), not a resolved vault path —
 * there is no per-vault "daily notes folder" setting surfaced to Hashi.
 * `findDailyNoteFile` tries the root-level `${date}.md` path first, then
 * falls back to a basename search over `vault.getMarkdownFiles()` (catches
 * daily notes living in a configured subfolder). This is approximate by
 * design: good enough to gate the warn pill, not a substitute for reading
 * the user's actual Daily Notes / Periodic Notes config. Opening uses
 * `workspace.openLinkText(date, "", false)` — Obsidian resolves the link
 * and creates the note if needed; Hashi itself never calls `vault.create`.
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
import { openNoteByStem, renderNoteLink } from "../openNote.js";
import type { EditorTab, TabContext } from "../tabContract.js";

type DailyLogPosition = DailyLogEntryWire["position"];

const POSITIONS: readonly DailyLogPosition[] = [
	"after_last_line",
	"before_first_line",
	"at_time",
];

const POSITION_LABELS: Record<DailyLogPosition, string> = {
	at_time: "At time",
	after_last_line: "After last line",
	before_first_line: "Before first line",
};

const MISSING_NOTE_TEXT = "⚠ note doesn't exist — click to create";

/**
 * Resolves `date` to an existing daily-note `TFile`, or `null` when none is
 * found. See the file header re: this being a v1 approximation, not a real
 * Daily Notes / Periodic Notes folder resolution. Gates the warn pill only —
 * never gates whether the date itself is clickable (bug fix #1).
 */
function findDailyNoteFile(app: App, date: string): TFile | null {
	const direct = app.vault.getAbstractFileByPath(`${date}.md`);
	if (direct instanceof TFile) return direct;

	const byBasename = app.vault
		.getMarkdownFiles()
		.find((file) => file.basename === date);
	return byBasename ?? null;
}

/**
 * Opens (or, per Obsidian's own resolution behavior, creates) the daily
 * note for `date`. Hashi never calls `vault.create` itself — this is the
 * only vault-touching operation the date control and warn pill trigger.
 * Delegates to the shared `openNoteByStem` so the date control and the
 * per-entry source links open notes the same way.
 */
function openDailyNote(app: App, date: string): void {
	openNoteByStem(app, date);
}

export class DailyTab implements EditorTab {
	readonly id = "daily";
	readonly label = "Daily";

	count(model: EditModel): number {
		return model.doc.daily_updates.length;
	}

	render(container: HTMLElement, model: EditModel, ctx: TabContext): void {
		for (const daily of model.doc.daily_updates) {
			this.renderCard(container, daily, ctx);
		}
	}

	private renderCard(container: HTMLElement, daily: DailyUpdateWire, ctx: TabContext): void {
		const card = container.createDiv({ cls: ["hashi-se-card", "hashi-se-daily"] });

		this.renderHead(card, daily.date, ctx.app);

		for (const [index, tracker] of daily.trackers.entries()) {
			this.renderTracker(card, daily.date, index, tracker, ctx);
		}
		for (const [index, entry] of daily.log_entries.entries()) {
			this.renderLogEntry(card, daily.date, index, entry, ctx);
		}
		for (const [index, link] of daily.log_links.entries()) {
			this.renderLogLink(card, daily.date, index, link, ctx);
		}
	}

	// -- head: always-clickable date + conditional "doesn't exist" pill ----

	private renderHead(card: HTMLElement, date: string, app: App): void {
		const head = card.createDiv({ cls: "hashi-se-daily-head" });

		const dateButton = head.createEl("button", {
			cls: "hashi-se-daily-date",
			text: date,
			attr: { type: "button", "data-open": "" },
		});
		dateButton.addEventListener("click", () => openDailyNote(app, date));

		const file = findDailyNoteFile(app, date);
		if (file !== null) return;

		const pill = head.createEl("button", {
			cls: "hashi-se-warn-pill",
			text: MISSING_NOTE_TEXT,
			attr: { type: "button", "data-open": "" },
		});
		pill.addEventListener("click", () => openDailyNote(app, date));
	}

	// -- trackers: read-only field/value/reason + a labeled Accept checkbox --

	private renderTracker(
		card: HTMLElement,
		date: string,
		index: number,
		tracker: DailyTrackerWire,
		ctx: TabContext,
	): void {
		const row = card.createDiv({ cls: "hashi-se-tracker" });
		row.createSpan({ cls: "hashi-se-tracker-field", text: tracker.field });
		row.createSpan({ cls: "hashi-se-tracker-value", text: tracker.value });
		row.createSpan({ cls: "hashi-se-tracker-reason", text: tracker.reason });

		const label = row.createEl("label", { cls: "hashi-se-ctl" });
		const accept = label.createEl("input", { attr: { type: "checkbox" } });
		accept.checked = tracker.accepted;
		label.createSpan({ text: "Accept" });
		accept.addEventListener("change", () => {
			const checked = accept.checked;
			ctx.apply((model) => setDailyTrackerAccepted(model, date, index, checked));
		});
	}

	// -- log entries: editable text, position/time, Accept + Force Atomic --

	private renderLogEntry(
		card: HTMLElement,
		date: string,
		index: number,
		entry: DailyLogEntryWire,
		ctx: TabContext,
	): void {
		const row = card.createDiv({ cls: "hashi-se-log-entry" });

		const content = row.createEl("textarea", {
			cls: "hashi-se-le-text",
			attr: { "aria-label": "Log entry text" },
		});
		content.value = entry.content;
		content.addEventListener("input", () => {
			const value = content.value;
			ctx.apply((model) => setDailyLogContent(model, date, index, value));
		});

		const meta = row.createDiv({ cls: "hashi-se-le-meta" });
		meta.createSpan({ text: `${entry.reason} · from ` });
		renderNoteLink(meta, ctx.app, entry.source_stem);

		const controls = row.createDiv({ cls: "hashi-se-le-controls" });
		this.renderPositionAndTime(controls, date, index, entry, ctx);
		this.renderLogAccept(controls, date, index, entry, ctx);
		this.renderForceAtomic(controls, date, index, entry, ctx);
	}

	/**
	 * Renders the Position select + Time input together — the select's
	 * `change` handler needs to live-toggle the time input's `disabled`
	 * state (bug-free re-enable per PRD F8), so both elements are built in
	 * one method and closed over directly rather than re-queried from the
	 * DOM.
	 */
	private renderPositionAndTime(
		controls: HTMLElement,
		date: string,
		index: number,
		entry: DailyLogEntryWire,
		ctx: TabContext,
	): void {
		const label = controls.createEl("label", { cls: "hashi-se-ctl" });
		label.createSpan({ text: "Position" });
		const select = label.createEl("select", {
			cls: "hashi-se-le-pos",
			attr: { "aria-label": "Log entry position" },
		});
		for (const value of POSITIONS) {
			const option = select.createEl("option", {
				text: POSITION_LABELS[value],
				attr: { value },
			});
			option.selected = value === entry.position;
		}

		const time = controls.createEl("input", {
			cls: "hashi-se-le-time",
			attr: { type: "time", "aria-label": "Time" },
		});
		time.value = entry.time ?? "";
		time.disabled = entry.position !== "at_time";

		select.addEventListener("change", () => {
			const next = select.value as DailyLogPosition;
			ctx.apply((model) => setDailyLogPosition(model, date, index, next));
			time.disabled = next !== "at_time";
		});
		time.addEventListener("change", () => {
			const value = time.value === "" ? null : time.value;
			ctx.apply((model) => setDailyLogTime(model, date, index, value));
		});
	}

	private renderLogAccept(
		controls: HTMLElement,
		date: string,
		index: number,
		entry: DailyLogEntryWire,
		ctx: TabContext,
	): void {
		const label = controls.createEl("label", { cls: "hashi-se-cbx" });
		const accept = label.createEl("input", { attr: { type: "checkbox" } });
		accept.checked = entry.accepted;
		label.createSpan({ text: "Accept" });
		accept.addEventListener("change", () => {
			const checked = accept.checked;
			ctx.apply((model) => setDailyLogAccepted(model, date, index, checked));
		});
	}

	private renderForceAtomic(
		controls: HTMLElement,
		date: string,
		index: number,
		entry: DailyLogEntryWire,
		ctx: TabContext,
	): void {
		const label = controls.createEl("label", { cls: "hashi-se-cbx" });
		const forceAtomic = label.createEl("input", { attr: { type: "checkbox" } });
		forceAtomic.checked = entry.force_atomic_note;
		label.createSpan({ text: "Force Atomic Note" });
		forceAtomic.addEventListener("change", () => {
			const checked = forceAtomic.checked;
			ctx.apply((model) => setForceAtomicFromDaily(model, entry.source_stem, checked));
		});
	}

	// -- log links: read-only target/reason + a labeled Accept checkbox ----

	private renderLogLink(
		card: HTMLElement,
		date: string,
		index: number,
		link: DailyLogLinkWire,
		ctx: TabContext,
	): void {
		const row = card.createDiv({ cls: "hashi-se-log-link" });
		row.createSpan({ cls: "hashi-se-log-link-target", text: link.target_stem });
		row.createSpan({ cls: "hashi-se-log-link-reason", text: link.reason });

		const label = row.createEl("label", { cls: "hashi-se-cbx" });
		const accept = label.createEl("input", { attr: { type: "checkbox" } });
		accept.checked = link.accepted;
		label.createSpan({ text: "Accept" });
		accept.addEventListener("change", () => {
			const checked = accept.checked;
			ctx.apply((model) => setDailyLogLinkAccepted(model, date, index, checked));
		});
	}
}
