/**
 * Unit tests for DailyTab — rebuilt to the approved mockup
 * (docs/XDD/specs/004-suggestions-editor/mockups/suggestions-editor.html),
 * covering the `hashi-se-*` card structure and 3 confirmed bug fixes:
 *
 *  1. The date is ALWAYS a clickable control (both when the daily note
 *     exists and when it doesn't) — a missing note must never render a dead
 *     element. Clicking it opens the note via `workspace.openLinkText` and
 *     Hashi never calls `vault.create`. The `hashi-se-warn-pill` appears
 *     ONLY when the note is missing, and is itself also clickable via the
 *     same open path.
 *  2. The missing-note wording is the mockup's
 *     "⚠ note doesn't exist — click to create".
 *  3. Every checkbox (tracker accept, log-entry accept, log-entry
 *     force-atomic, log-link accept) renders inside a `<label>` with
 *     visible text ("Accept" / "Force Atomic Note").
 *
 * Two families of fixtures, per the task brief:
 *  - The REAL 1115 Tomo emission (via FakeSuggestionsDoc) drives the
 *    date-group / existence-check tests — it has exactly the shape called
 *    out: 2 daily dates, 1 log entry each, no trackers, no log links. Good
 *    for proving the "doesn't exist" / "exists" states and the
 *    one-entry-per-date render shape against something Tomo actually emits
 *    (spec-002 lesson — avoid a synthetic fixture silently drifting).
 *  - Local factories (mirrors test/unit/suggestions/transforms/daily.test.ts)
 *    build custom EditModels with trackers/log_links populated, since the
 *    1115 fixture has none — needed to exercise those two controls.
 */

import "obsidian";
import { App, TFile } from "obsidian";
import { describe, expect, it, vi, type Mock } from "vitest";

import {
	DEFAULT_SEED,
	FakeSuggestionsDoc,
} from "../../../../__mocks__/FakeSuggestionsDoc";
import type {
	DailyLogEntryWire,
	DailyLogLinkWire,
	DailyTrackerWire,
	DailyUpdateWire,
	EditModel,
} from "../../../../../src/types/suggestions";
import type { TabContext } from "../../../../../src/ui/suggestions-view/tabContract";
import { DailyTab } from "../../../../../src/ui/suggestions-view/tabs/DailyTab";

const DOC_PATH = "100 Inbox/2026-07-06_1115_suggestions.json";

// --- factories (mirrors test/unit/suggestions/transforms/daily.test.ts) -----

function getMockTracker(overrides?: Partial<DailyTrackerWire>): DailyTrackerWire {
	return {
		field: "mood",
		value: "good",
		reason: "mentioned in log",
		source_stem: "2026-07-06-note",
		accepted: false,
		...overrides,
	};
}

function getMockLogEntry(overrides?: Partial<DailyLogEntryWire>): DailyLogEntryWire {
	return {
		time: null,
		position: "after_last_line",
		content: "Had coffee",
		reason: "mentioned in log",
		source_stem: "2026-07-06-note",
		accepted: false,
		force_atomic_note: false,
		...overrides,
	};
}

function getMockLogLink(overrides?: Partial<DailyLogLinkWire>): DailyLogLinkWire {
	return {
		target_stem: "some-atomic-note",
		time: "10:00",
		position: "at_time",
		reason: "mentioned in log",
		accepted: false,
		...overrides,
	};
}

function getMockDailyUpdate(overrides?: Partial<DailyUpdateWire>): DailyUpdateWire {
	return {
		date: "2026-07-06",
		trackers: [],
		log_entries: [getMockLogEntry()],
		log_links: [],
		...overrides,
	};
}

function getMockModel(dailyUpdates: readonly DailyUpdateWire[]): EditModel {
	return {
		doc: { ...DEFAULT_SEED, daily_updates: dailyUpdates },
		dirty: false,
	};
}

function makeCtx(app: App): TabContext & {
	apply: Mock<(transform: (model: EditModel) => EditModel) => void>;
} {
	return { app, apply: vi.fn<(transform: (model: EditModel) => EditModel) => void>() };
}

/** Runs the single transform captured by a `ctx.apply` mock against `model`. */
function runCaptured(
	applyMock: Mock<(transform: (model: EditModel) => EditModel) => void>,
	model: EditModel,
): EditModel {
	expect(applyMock).toHaveBeenCalledTimes(1);
	const transform = applyMock.mock.calls[0]?.[0] as (m: EditModel) => EditModel;
	return transform(model);
}

async function loadFixtureModel(): Promise<EditModel> {
	const adapter = new FakeSuggestionsDoc();
	return adapter.load(DOC_PATH);
}

/** Finds a `<label>` ancestor's visible text for a given checkbox. */
function labelTextFor(checkbox: HTMLInputElement): string | null {
	return checkbox.closest("label")?.textContent ?? null;
}

// ---------------------------------------------------------------------------

describe("DailyTab", () => {
	describe("date control — bug fix #1 (always clickable) + #2 (wording)", () => {
		it("renders a clickable date control for both dates when neither note exists", async () => {
			const model = await loadFixtureModel();
			const app = new App();
			const ctx = makeCtx(app);
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);

			const cards = container.querySelectorAll(".hashi-se-card.hashi-se-daily");
			expect(cards).toHaveLength(2);

			const dateButtons = container.querySelectorAll(".hashi-se-daily-date");
			expect(dateButtons).toHaveLength(2);
			for (const button of Array.from(dateButtons)) {
				expect(button.tagName).toBe("BUTTON");
			}
			expect(container.textContent).toContain("2026-07-05");
			expect(container.textContent).toContain("2026-07-06");
		});

		it("shows the warn pill with the exact mockup wording only when the note is missing", async () => {
			const model = await loadFixtureModel();
			const app = new App();
			const ctx = makeCtx(app);
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);

			const pills = container.querySelectorAll(".hashi-se-warn-pill");
			expect(pills).toHaveLength(2);
			for (const pill of Array.from(pills)) {
				expect(pill.textContent).toBe("⚠ note doesn't exist — click to create");
			}
		});

		it("hides the warn pill and keeps the date clickable when the daily note exists", async () => {
			const model = await loadFixtureModel();
			const app = new App();
			const existingFile = new TFile();
			existingFile.path = "2026-07-05.md";
			existingFile.basename = "2026-07-05";
			app.vault.getAbstractFileByPath = vi.fn((path: string) =>
				path === "2026-07-05.md" ? existingFile : null,
			);
			const ctx = makeCtx(app);
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);

			const dateButtons = container.querySelectorAll(".hashi-se-daily-date");
			expect(dateButtons).toHaveLength(2);
			// Only the still-missing 2026-07-06 note keeps its warn pill.
			expect(container.querySelectorAll(".hashi-se-warn-pill")).toHaveLength(1);
		});

		it("clicking the date opens the daily note via workspace.openLinkText and never creates it — note missing", async () => {
			const model = await loadFixtureModel();
			const app = new App();
			const openLinkText = vi.spyOn(app.workspace, "openLinkText");
			const ctx = makeCtx(app);
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);
			const dateButton = container.querySelector(".hashi-se-daily-date") as HTMLElement;
			dateButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

			expect(openLinkText).toHaveBeenCalledWith("2026-07-05", "", false);
			expect(app.vault.create).not.toHaveBeenCalled();
		});

		it("clicking the date opens the daily note via workspace.openLinkText and never creates it — note exists", async () => {
			const model = await loadFixtureModel();
			const app = new App();
			const existingFile = new TFile();
			existingFile.path = "2026-07-05.md";
			existingFile.basename = "2026-07-05";
			app.vault.getAbstractFileByPath = vi.fn((path: string) =>
				path === "2026-07-05.md" ? existingFile : null,
			);
			const openLinkText = vi.spyOn(app.workspace, "openLinkText");
			const ctx = makeCtx(app);
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);
			const dateButton = container.querySelector(".hashi-se-daily-date") as HTMLElement;
			dateButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

			expect(openLinkText).toHaveBeenCalledWith("2026-07-05", "", false);
			expect(app.vault.create).not.toHaveBeenCalled();
		});

		it("clicking the warn pill also opens the daily note via workspace.openLinkText and never creates it", async () => {
			const model = await loadFixtureModel();
			const app = new App();
			const openLinkText = vi.spyOn(app.workspace, "openLinkText");
			const ctx = makeCtx(app);
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);
			const pill = container.querySelector(".hashi-se-warn-pill") as HTMLElement;
			pill.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

			expect(openLinkText).toHaveBeenCalledWith("2026-07-05", "", false);
			expect(app.vault.create).not.toHaveBeenCalled();
		});
	});

	describe("log entry — content", () => {
		it("editing the content textarea dispatches setDailyLogContent", () => {
			const model = getMockModel([getMockDailyUpdate({ date: "2026-07-06" })]);
			const app = new App();
			const ctx = makeCtx(app);
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);
			const textarea = container.querySelector(
				".hashi-se-le-text",
			) as HTMLTextAreaElement;
			textarea.value = "Edited log content.";
			textarea.dispatchEvent(new Event("input", { bubbles: true }));

			const next = runCaptured(ctx.apply, model);
			expect(next.doc.daily_updates[0]?.log_entries[0]?.content).toBe(
				"Edited log content.",
			);
		});

		it("renders the reason and source_stem in the entry meta line", () => {
			const model = getMockModel([
				getMockDailyUpdate({
					log_entries: [
						getMockLogEntry({ reason: "short call log", source_stem: "call-mueller" }),
					],
				}),
			]);
			const ctx = makeCtx(new App());
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);

			const meta = container.querySelector(".hashi-se-le-meta");
			expect(meta?.textContent).toBe("short call log · from call-mueller");
		});

		it("renders the source_stem as a clickable link that opens the origin note", () => {
			const model = getMockModel([
				getMockDailyUpdate({
					log_entries: [getMockLogEntry({ reason: "short call log", source_stem: "call-mueller" })],
				}),
			]);
			const app = new App();
			const openLinkText = vi.spyOn(app.workspace, "openLinkText");
			const ctx = makeCtx(app);
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);

			const link = container.querySelector<HTMLElement>(".hashi-se-le-meta .hashi-se-wlink");
			expect(link?.textContent).toBe("call-mueller");
			link!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

			expect(openLinkText).toHaveBeenCalledWith("call-mueller", "", false);
		});
	});

	describe("log entry — position + time", () => {
		it("the time field is disabled when position is after_last_line", () => {
			const model = getMockModel([
				getMockDailyUpdate({
					log_entries: [getMockLogEntry({ position: "after_last_line", time: null })],
				}),
			]);
			const ctx = makeCtx(new App());
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);

			const timeInput = container.querySelector(
				".hashi-se-le-time",
			) as HTMLInputElement;
			expect(timeInput.disabled).toBe(true);
		});

		it("the time field is disabled when position is before_first_line", () => {
			const model = getMockModel([
				getMockDailyUpdate({
					log_entries: [
						getMockLogEntry({ position: "before_first_line", time: null }),
					],
				}),
			]);
			const ctx = makeCtx(new App());
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);

			const timeInput = container.querySelector(
				".hashi-se-le-time",
			) as HTMLInputElement;
			expect(timeInput.disabled).toBe(true);
		});

		it("the time field is enabled and editable when position is at_time", () => {
			const model = getMockModel([
				getMockDailyUpdate({
					log_entries: [getMockLogEntry({ position: "at_time", time: "09:30" })],
				}),
			]);
			const ctx = makeCtx(new App());
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);

			const timeInput = container.querySelector(
				".hashi-se-le-time",
			) as HTMLInputElement;
			expect(timeInput.disabled).toBe(false);
			expect(timeInput.value).toBe("09:30");
		});

		it("changing position dispatches setDailyLogPosition", () => {
			const model = getMockModel([
				getMockDailyUpdate({
					log_entries: [getMockLogEntry({ position: "after_last_line" })],
				}),
			]);
			const ctx = makeCtx(new App());
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);
			const select = container.querySelector(
				".hashi-se-le-pos",
			) as HTMLSelectElement;
			select.value = "before_first_line";
			select.dispatchEvent(new Event("change", { bubbles: true }));

			const next = runCaptured(ctx.apply, model);
			expect(next.doc.daily_updates[0]?.log_entries[0]?.position).toBe(
				"before_first_line",
			);
		});

		it("changing position to at_time re-enables the time field in the DOM", () => {
			const model = getMockModel([
				getMockDailyUpdate({
					log_entries: [getMockLogEntry({ position: "after_last_line", time: null })],
				}),
			]);
			const ctx = makeCtx(new App());
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);
			const select = container.querySelector(
				".hashi-se-le-pos",
			) as HTMLSelectElement;
			const timeInput = container.querySelector(
				".hashi-se-le-time",
			) as HTMLInputElement;
			expect(timeInput.disabled).toBe(true);

			select.value = "at_time";
			select.dispatchEvent(new Event("change", { bubbles: true }));

			expect(timeInput.disabled).toBe(false);
		});

		it("editing the time field dispatches setDailyLogTime", () => {
			const model = getMockModel([
				getMockDailyUpdate({
					log_entries: [getMockLogEntry({ position: "at_time", time: "09:00" })],
				}),
			]);
			const ctx = makeCtx(new App());
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);
			const timeInput = container.querySelector(
				".hashi-se-le-time",
			) as HTMLInputElement;
			timeInput.value = "14:45";
			timeInput.dispatchEvent(new Event("change", { bubbles: true }));

			const next = runCaptured(ctx.apply, model);
			expect(next.doc.daily_updates[0]?.log_entries[0]?.time).toBe("14:45");
		});
	});

	describe("log entry — accept + force atomic — bug fix #3 (labeled checkboxes)", () => {
		it("the Accept checkbox is wrapped in a label with visible 'Accept' text", () => {
			const model = getMockModel([
				getMockDailyUpdate({ log_entries: [getMockLogEntry({ accepted: false })] }),
			]);
			const ctx = makeCtx(new App());
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);
			const accept = container.querySelector(
				".hashi-se-le-controls .hashi-se-cbx input[type=checkbox]",
			) as HTMLInputElement;

			expect(labelTextFor(accept)).toContain("Accept");
		});

		it("toggling accept dispatches setDailyLogAccepted", () => {
			const model = getMockModel([
				getMockDailyUpdate({ log_entries: [getMockLogEntry({ accepted: false })] }),
			]);
			const ctx = makeCtx(new App());
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);
			const accept = container.querySelectorAll(
				".hashi-se-le-controls .hashi-se-cbx input[type=checkbox]",
			)[0] as HTMLInputElement;
			accept.checked = true;
			accept.dispatchEvent(new Event("change", { bubbles: true }));

			const next = runCaptured(ctx.apply, model);
			expect(next.doc.daily_updates[0]?.log_entries[0]?.accepted).toBe(true);
		});

		it("the Force Atomic Note checkbox is wrapped in a label with visible text", () => {
			const model = getMockModel([
				getMockDailyUpdate({
					log_entries: [getMockLogEntry({ force_atomic_note: false })],
				}),
			]);
			const ctx = makeCtx(new App());
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);
			const checkboxes = container.querySelectorAll(
				".hashi-se-le-controls .hashi-se-cbx input[type=checkbox]",
			);
			const forceAtomic = checkboxes[1] as HTMLInputElement;

			expect(labelTextFor(forceAtomic)).toContain("Force Atomic Note");
		});

		it("toggling Force Atomic dispatches setForceAtomicFromDaily using the entry's source_stem", () => {
			const model = getMockModel([
				getMockDailyUpdate({
					log_entries: [
						getMockLogEntry({ source_stem: "coffee-note", force_atomic_note: false }),
					],
				}),
			]);
			const ctx = makeCtx(new App());
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);
			const checkboxes = container.querySelectorAll(
				".hashi-se-le-controls .hashi-se-cbx input[type=checkbox]",
			);
			const forceAtomic = checkboxes[1] as HTMLInputElement;
			forceAtomic.checked = true;
			forceAtomic.dispatchEvent(new Event("change", { bubbles: true }));

			const next = runCaptured(ctx.apply, model);
			expect(next.doc.daily_updates[0]?.log_entries[0]?.force_atomic_note).toBe(
				true,
			);
		});
	});

	describe("tracker — bug fix #3 (labeled checkbox) + accept", () => {
		it("the tracker's Accept checkbox has visible label text and renders field/value/reason", () => {
			const model = getMockModel([
				getMockDailyUpdate({
					trackers: [
						getMockTracker({ field: "mood", value: "good", reason: "mentioned in log" }),
					],
					log_entries: [],
				}),
			]);
			const ctx = makeCtx(new App());
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);

			expect(container.textContent).toContain("mood");
			expect(container.textContent).toContain("good");
			expect(container.textContent).toContain("mentioned in log");

			const accept = container.querySelector(
				".hashi-se-tracker input[type=checkbox]",
			) as HTMLInputElement;
			expect(labelTextFor(accept)).toContain("Accept");
		});

		it("toggling a tracker's accept dispatches setDailyTrackerAccepted", () => {
			const model = getMockModel([
				getMockDailyUpdate({
					trackers: [getMockTracker({ accepted: false })],
					log_entries: [],
				}),
			]);
			const ctx = makeCtx(new App());
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);
			const accept = container.querySelector(
				".hashi-se-tracker input[type=checkbox]",
			) as HTMLInputElement;
			expect(accept).not.toBeNull();
			accept.checked = true;
			accept.dispatchEvent(new Event("change", { bubbles: true }));

			const next = runCaptured(ctx.apply, model);
			expect(next.doc.daily_updates[0]?.trackers[0]?.accepted).toBe(true);
		});
	});

	describe("log link — bug fix #3 (labeled checkbox) + accept", () => {
		it("the log link's Accept checkbox has visible label text and renders target_stem/reason", () => {
			const model = getMockModel([
				getMockDailyUpdate({
					log_entries: [],
					log_links: [
						getMockLogLink({
							accepted: false,
							target_stem: "atomic-target",
							reason: "linked from log",
						}),
					],
				}),
			]);
			const ctx = makeCtx(new App());
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);

			expect(container.textContent).toContain("atomic-target");
			expect(container.textContent).toContain("linked from log");

			const accept = container.querySelector(
				".hashi-se-log-link input[type=checkbox]",
			) as HTMLInputElement;
			expect(labelTextFor(accept)).toContain("Accept");
		});

		it("toggling a log link's accept dispatches setDailyLogLinkAccepted", () => {
			const model = getMockModel([
				getMockDailyUpdate({
					log_entries: [],
					log_links: [
						getMockLogLink({
							accepted: false,
							target_stem: "atomic-target",
							reason: "linked from log",
						}),
					],
				}),
			]);
			const ctx = makeCtx(new App());
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);

			const accept = container.querySelector(
				".hashi-se-log-link input[type=checkbox]",
			) as HTMLInputElement;
			expect(accept).not.toBeNull();
			accept.checked = true;
			accept.dispatchEvent(new Event("change", { bubbles: true }));

			const next = runCaptured(ctx.apply, model);
			expect(next.doc.daily_updates[0]?.log_links[0]?.accepted).toBe(true);
		});

		it("renders the target_stem as a clickable link that opens the atomic note", () => {
			const model = getMockModel([
				getMockDailyUpdate({
					log_entries: [],
					log_links: [getMockLogLink({ target_stem: "atomic-target" })],
				}),
			]);
			const app = new App();
			const openLinkText = vi.spyOn(app.workspace, "openLinkText");
			const ctx = makeCtx(app);
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);

			const link = container.querySelector<HTMLElement>(
				".hashi-se-log-link-target .hashi-se-wlink",
			);
			expect(link?.textContent).toBe("atomic-target");
			link!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

			expect(openLinkText).toHaveBeenCalledWith("atomic-target", "", false);
		});
	});
});
