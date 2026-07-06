/**
 * Unit tests for DailyTab — Phase-3 T3.6 per-date log entry / tracker /
 * log-link editing UI (SDD §6 Daily, PRD F8).
 *
 * Two families of fixtures, per the task brief:
 *  - The REAL 1115 Tomo emission (via FakeSuggestionsDoc) drives the
 *    date-group / existence-check tests — it has exactly the shape this
 *    task calls out: 2 daily dates, 1 log entry each, no trackers, no
 *    log links. Good for proving the "doesn't exist" / "exists" states and
 *    the one-entry-per-date render shape against something Tomo actually
 *    emits (spec-002 lesson — avoid a synthetic fixture silently drifting).
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

// ---------------------------------------------------------------------------

describe("DailyTab", () => {
	describe("date group — existence check", () => {
		it("shows a \"doesn't exist\" state for both dates against a bare mock vault", async () => {
			const model = await loadFixtureModel();
			const app = new App();
			const ctx = makeCtx(app);
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);

			const groups = container.querySelectorAll(".hashi-daily-group");
			expect(groups).toHaveLength(2);
			expect(
				container.querySelectorAll(".hashi-daily-date-missing"),
			).toHaveLength(2);
			expect(container.querySelectorAll(".hashi-daily-date-link")).toHaveLength(0);
			expect(container.textContent).toContain("2026-07-05");
			expect(container.textContent).toContain("2026-07-06");
			expect(container.textContent).toContain("doesn't exist");
		});

		it("shows a plain click-to-open link when the daily note file exists", async () => {
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

			const links = container.querySelectorAll(".hashi-daily-date-link");
			expect(links).toHaveLength(1);
			expect(links[0]?.textContent).toContain("2026-07-05");
			// The other date is still missing.
			expect(
				container.querySelectorAll(".hashi-daily-date-missing"),
			).toHaveLength(1);
		});

		it("clicking the link opens the daily note via workspace.openLinkText, never creates it", async () => {
			const model = await loadFixtureModel();
			const app = new App();
			const existingFile = new TFile();
			existingFile.path = "2026-07-05.md";
			app.vault.getAbstractFileByPath = vi.fn((path: string) =>
				path === "2026-07-05.md" ? existingFile : null,
			);
			const openLinkText = vi.spyOn(app.workspace, "openLinkText");
			const ctx = makeCtx(app);
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);
			const link = container.querySelector(
				".hashi-daily-date-link",
			) as HTMLElement;
			link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

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
				".hashi-daily-log-entry-content",
			) as HTMLTextAreaElement;
			textarea.value = "Edited log content.";
			textarea.dispatchEvent(new Event("input", { bubbles: true }));

			const next = runCaptured(ctx.apply, model);
			expect(next.doc.daily_updates[0]?.log_entries[0]?.content).toBe(
				"Edited log content.",
			);
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
				".hashi-daily-log-entry-time",
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
				".hashi-daily-log-entry-time",
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
				".hashi-daily-log-entry-time",
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
				".hashi-daily-log-entry-position",
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
				".hashi-daily-log-entry-position",
			) as HTMLSelectElement;
			const timeInput = container.querySelector(
				".hashi-daily-log-entry-time",
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
				".hashi-daily-log-entry-time",
			) as HTMLInputElement;
			timeInput.value = "14:45";
			timeInput.dispatchEvent(new Event("change", { bubbles: true }));

			const next = runCaptured(ctx.apply, model);
			expect(next.doc.daily_updates[0]?.log_entries[0]?.time).toBe("14:45");
		});
	});

	describe("log entry — accept + force atomic", () => {
		it("toggling accept dispatches setDailyLogAccepted", () => {
			const model = getMockModel([
				getMockDailyUpdate({ log_entries: [getMockLogEntry({ accepted: false })] }),
			]);
			const ctx = makeCtx(new App());
			const container = document.createElement("div");

			new DailyTab().render(container, model, ctx);
			const accept = container.querySelector(
				".hashi-daily-log-entry-accept",
			) as HTMLInputElement;
			accept.checked = true;
			accept.dispatchEvent(new Event("change", { bubbles: true }));

			const next = runCaptured(ctx.apply, model);
			expect(next.doc.daily_updates[0]?.log_entries[0]?.accepted).toBe(true);
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
			const forceAtomic = container.querySelector(
				".hashi-daily-log-entry-force-atomic",
			) as HTMLInputElement;
			forceAtomic.checked = true;
			forceAtomic.dispatchEvent(new Event("change", { bubbles: true }));

			const next = runCaptured(ctx.apply, model);
			expect(next.doc.daily_updates[0]?.log_entries[0]?.force_atomic_note).toBe(
				true,
			);
		});
	});

	describe("tracker — accept", () => {
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
				".hashi-daily-tracker-accept",
			) as HTMLInputElement;
			expect(accept).not.toBeNull();
			accept.checked = true;
			accept.dispatchEvent(new Event("change", { bubbles: true }));

			const next = runCaptured(ctx.apply, model);
			expect(next.doc.daily_updates[0]?.trackers[0]?.accepted).toBe(true);
		});
	});

	describe("log link — accept", () => {
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

			expect(container.textContent).toContain("atomic-target");
			expect(container.textContent).toContain("linked from log");

			const accept = container.querySelector(
				".hashi-daily-log-link-accept",
			) as HTMLInputElement;
			expect(accept).not.toBeNull();
			accept.checked = true;
			accept.dispatchEvent(new Event("change", { bubbles: true }));

			const next = runCaptured(ctx.apply, model);
			expect(next.doc.daily_updates[0]?.log_links[0]?.accepted).toBe(true);
		});
	});
});
