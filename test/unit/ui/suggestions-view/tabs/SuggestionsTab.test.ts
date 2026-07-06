/**
 * Unit tests for SuggestionsTab (T3.2) — worthy vs suppressed suggestion
 * cards (SDD §6 Suggestions; PRD F2/F6/F7).
 *
 * Built against the real vendored `1115` Tomo emission via
 * `FakeSuggestionsDoc` (spec-002 lesson: real Tomo output over a synthetic
 * fixture). In that run: S01/S02/S03/S04/S05/S06 are suppressed, S07
 * ("zettelkasten-method") is the sole worthy suggestion, with 3 candidate
 * MOCs, all unselected.
 *
 * Pickers are spied via `vi.mock` (mirrors SuggestionsEditorView.test.ts's
 * `ConfirmModal` mock) rather than driven through their real popover — this
 * file only asserts THAT the tab constructs the right picker with the right
 * inputs and wires its callback to the right transform, not the picker's own
 * behavior (that's each picker's own test file).
 *
 * `ctx.apply` is captured rather than executed live: each test applies the
 * captured transform to the loaded model itself and asserts the resulting
 * `EditModel` — proving the actual behavior of the dispatched transform
 * without importing/duplicating it from the transforms modules.
 */

import "obsidian";
import { App, TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeSuggestionsDoc } from "../../../../__mocks__/FakeSuggestionsDoc";
import type { AnchorWire, EditModel } from "../../../../../src/types/suggestions";
import type { TabContext } from "../../../../../src/ui/suggestions-view/tabContract";
import { SuggestionsTab } from "../../../../../src/ui/suggestions-view/tabs/SuggestionsTab";

// --- picker spies -------------------------------------------------------
//
// Each fuzzy field picker has the same (app, onChoose) constructor shape;
// SpotPicker takes (app, options). Capturing instances (rather than just
// asserting `vi.mocked(X)` call args) lets tests fire `onChoose`/`onPick`
// directly to drive the tab's wiring, exactly as a real picker selection
// would.

interface FieldPickerInstance {
	app: unknown;
	onChoose: (value: string) => void;
	open: ReturnType<typeof vi.fn>;
}

interface SpotPickerInstance {
	app: unknown;
	content: string;
	kind: string;
	onPick: (anchor: AnchorWire) => void;
	open: ReturnType<typeof vi.fn>;
}

// `vi.hoisted` (not a plain top-level `const`) is required here: `vi.mock`
// factories are hoisted above every other module-level statement, so a
// factory that closes over an ordinary `const` declared later in the file
// hits a TDZ `ReferenceError` at import time. `vi.hoisted` runs its
// initializer as part of that same hoist pass, guaranteeing these arrays
// exist before any factory below can run.
const {
	templatePickerInstances,
	locationPickerInstances,
	tagPickerInstances,
	mocPickerInstances,
	spotPickerInstances,
	makeFieldPickerMock,
} = vi.hoisted(() => {
	const templatePickerInstances: FieldPickerInstance[] = [];
	const locationPickerInstances: FieldPickerInstance[] = [];
	const tagPickerInstances: FieldPickerInstance[] = [];
	const mocPickerInstances: FieldPickerInstance[] = [];
	const spotPickerInstances: SpotPickerInstance[] = [];

	function makeFieldPickerMock(instances: FieldPickerInstance[]) {
		return vi.fn(function FieldPicker(app: unknown, onChoose: (value: string) => void) {
			const instance: FieldPickerInstance = { app, onChoose, open: vi.fn() };
			instances.push(instance);
			return instance;
		});
	}

	return {
		templatePickerInstances,
		locationPickerInstances,
		tagPickerInstances,
		mocPickerInstances,
		spotPickerInstances,
		makeFieldPickerMock,
	};
});

vi.mock("../../../../../src/ui/suggestions-view/pickers/TemplatePicker", () => ({
	TemplatePicker: makeFieldPickerMock(templatePickerInstances),
}));
vi.mock("../../../../../src/ui/suggestions-view/pickers/LocationPicker", () => ({
	LocationPicker: makeFieldPickerMock(locationPickerInstances),
}));
vi.mock("../../../../../src/ui/suggestions-view/pickers/TagPicker", () => ({
	TagPicker: makeFieldPickerMock(tagPickerInstances),
}));
vi.mock("../../../../../src/ui/suggestions-view/pickers/MocPicker", () => ({
	MocPicker: makeFieldPickerMock(mocPickerInstances),
}));

vi.mock("../../../../../src/ui/suggestions-view/pickers/SpotPicker", () => ({
	SpotPicker: vi.fn(function SpotPicker(
		app: unknown,
		opts: { content: string; kind: string; onPick: (anchor: AnchorWire) => void },
	) {
		const instance: SpotPickerInstance = { app, ...opts, open: vi.fn() };
		spotPickerInstances.push(instance);
		return instance;
	}),
}));

// --- factories -----------------------------------------------------------

const DOC_PATH = "100 Inbox/2026-07-06_1115_suggestions.json";
const WORTHY_ID = "S07"; // zettelkasten-method — the 1115 run's sole worthy suggestion
const SUPPRESSED_ID = "S01"; // call-vendor — suppressed, worthiness 0.2

async function loadModel(): Promise<EditModel> {
	return new FakeSuggestionsDoc().load(DOC_PATH);
}

function makeCtx(): { ctx: TabContext; applyCalls: Array<(model: EditModel) => EditModel> } {
	const applyCalls: Array<(model: EditModel) => EditModel> = [];
	const ctx: TabContext = {
		app: new App(),
		apply: vi.fn((transform: (model: EditModel) => EditModel) => {
			applyCalls.push(transform);
		}),
	};
	return { ctx, applyCalls };
}

function cardFor(container: HTMLElement, suggestionId: string): HTMLElement {
	const card = container.querySelector(`[data-suggestion-id="${suggestionId}"]`);
	if (card === null) {
		throw new Error(`no card rendered for suggestion "${suggestionId}"`);
	}
	return card as HTMLElement;
}

function renderTab(model: EditModel, ctx: TabContext): HTMLElement {
	const container = document.createElement("div");
	new SuggestionsTab().render(container, model, ctx);
	return container;
}

/**
 * Clicks a candidate MOC's "Set spot…" button and drives its `SpotPicker`
 * mock's `onPick` with `anchor` — the arrange sequence shared by the
 * `setCandidateAnchor` behavior tests below (happy path + both no-op
 * guards). No vault mocking needed: `getAbstractFileByPath` returns
 * `undefined` by default in the obsidian mock, so `readMocContent` resolves
 * `""` and still proceeds to construct the (mocked) `SpotPicker` — these
 * tests only care about the dispatched transform, not the picker's content.
 */
async function pickSpot(container: HTMLElement, candidatePath: string, anchor: AnchorWire): Promise<void> {
	const row = container.querySelector(`.hashi-suggestion-moc[data-moc-path="${candidatePath}"]`)!;
	row.querySelector<HTMLButtonElement>(".hashi-suggestion-moc-spot")!.click();

	await vi.waitFor(() => {
		expect(spotPickerInstances.length).toBeGreaterThan(0);
	});
	spotPickerInstances[spotPickerInstances.length - 1]!.onPick(anchor);
}

// ---------------------------------------------------------------------------

describe("SuggestionsTab", () => {
	beforeEach(() => {
		templatePickerInstances.length = 0;
		locationPickerInstances.length = 0;
		tagPickerInstances.length = 0;
		mocPickerInstances.length = 0;
		spotPickerInstances.length = 0;
	});

	describe("EditorTab contract", () => {
		it("exposes id/label and counts every suggestion", async () => {
			const tab = new SuggestionsTab();
			const model = await loadModel();

			expect(tab.id).toBe("suggestions");
			expect(tab.label).toBe("Suggestions");
			expect(tab.count(model)).toBe(7);
		});
	});

	describe("worthy card (S07)", () => {
		it("renders title/template/location/tags/candidate-MOCs/+Add MOC/keep-source/decision", async () => {
			const model = await loadModel();
			const { ctx } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			expect(card.classList.contains("hashi-suggestion-card-suppressed")).toBe(false);

			const title = card.querySelector<HTMLInputElement>(".hashi-suggestion-title");
			expect(title?.value).toBe("The Zettelkasten Method — Atomic Notes and Link-Based Thinking");

			expect(card.querySelector(".hashi-suggestion-template")?.textContent).toBe(
				"t_note_tomo.md",
			);
			expect(card.querySelector(".hashi-suggestion-location")?.textContent).toBe(
				"Atlas/202 Notes/",
			);

			const tags = Array.from(card.querySelectorAll(".hashi-suggestion-tag")).map(
				(el) => el.textContent,
			);
			expect(tags).toEqual(["topic/knowledge/frameworks"]);
			expect(card.querySelector(".hashi-suggestion-add-tag")).not.toBeNull();

			const mocRows = card.querySelectorAll(".hashi-suggestion-moc");
			expect(mocRows).toHaveLength(3);
			expect(card.querySelector(".hashi-suggestion-add-moc")?.textContent).toBe("＋ Add MOC");

			expect(card.querySelector(".hashi-suggestion-keep-source")).not.toBeNull();
			expect(card.querySelector(".hashi-suggestion-decision")?.textContent).toBe("Approve");

			// No suppressed-only controls leak into the worthy card.
			expect(card.querySelector(".hashi-suggestion-worthiness")).toBeNull();
			expect(card.querySelector(".hashi-suggestion-force-atomic")).toBeNull();
		});

		it("editing the title dispatches setTitle", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			const title = card.querySelector<HTMLInputElement>(".hashi-suggestion-title")!;
			title.value = "A renamed atomic note";
			title.dispatchEvent(new Event("change"));

			expect(ctx.apply).toHaveBeenCalledOnce();
			const next = applyCalls[0]!(model);
			expect(next.doc.suggestions.find((s) => s.id === WORTHY_ID)?.title).toBe(
				"A renamed atomic note",
			);
			expect(next.dirty).toBe(true);
		});

		it("choosing a template opens TemplatePicker and dispatches setTemplate", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			card.querySelector<HTMLButtonElement>(".hashi-suggestion-template")!.click();

			expect(templatePickerInstances).toHaveLength(1);
			expect(templatePickerInstances[0]?.app).toBe(ctx.app);

			templatePickerInstances[0]!.onChoose("Templates/new-template.md");

			expect(ctx.apply).toHaveBeenCalledOnce();
			const next = applyCalls[0]!(model);
			expect(next.doc.suggestions.find((s) => s.id === WORTHY_ID)?.template).toBe(
				"Templates/new-template.md",
			);
		});

		it("choosing a location opens LocationPicker and dispatches setLocation", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			card.querySelector<HTMLButtonElement>(".hashi-suggestion-location")!.click();

			expect(locationPickerInstances).toHaveLength(1);
			locationPickerInstances[0]!.onChoose("Atlas/300 Reference/");

			const next = applyCalls[0]!(model);
			expect(next.doc.suggestions.find((s) => s.id === WORTHY_ID)?.location).toBe(
				"Atlas/300 Reference/",
			);
		});

		it("adding a tag opens TagPicker and dispatches an append-only tags update", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			card.querySelector<HTMLButtonElement>(".hashi-suggestion-add-tag")!.click();

			expect(tagPickerInstances).toHaveLength(1);
			tagPickerInstances[0]!.onChoose("topic/new-tag");

			const next = applyCalls[0]!(model);
			expect(next.doc.suggestions.find((s) => s.id === WORTHY_ID)?.tags).toEqual([
				"topic/knowledge/frameworks",
				"topic/new-tag",
			]);
		});

		it("adding a tag that is already present is a no-op", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			card.querySelector<HTMLButtonElement>(".hashi-suggestion-add-tag")!.click();
			tagPickerInstances[0]!.onChoose("topic/knowledge/frameworks");

			const next = applyCalls[0]!(model);
			expect(next).toBe(model);
			expect(next.dirty).toBe(false);
		});

		it("selecting a candidate MOC dispatches selectCandidateMoc as a single re-point", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			const suggestion = model.doc.suggestions.find((s) => s.id === WORTHY_ID)!;
			const secondCandidate = suggestion.candidate_mocs[1]!;
			const row = card.querySelector(
				`.hashi-suggestion-moc[data-moc-path="${secondCandidate.path}"]`,
			)!;
			const radio = row.querySelector<HTMLInputElement>(".hashi-suggestion-moc-select")!;
			radio.checked = true;
			radio.dispatchEvent(new Event("change"));

			const next = applyCalls[0]!(model);
			const nextSuggestion = next.doc.suggestions.find((s) => s.id === WORTHY_ID)!;
			expect(
				nextSuggestion.candidate_mocs.map((c) => [c.path, c.selected]),
			).toEqual([
				[suggestion.candidate_mocs[0]!.path, false],
				[secondCandidate.path, true],
				[suggestion.candidate_mocs[2]!.path, false],
			]);
		});

		it("adding a MOC opens MocPicker and dispatches addMoc", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			card.querySelector<HTMLButtonElement>(".hashi-suggestion-add-moc")!.click();

			expect(mocPickerInstances).toHaveLength(1);
			mocPickerInstances[0]!.onChoose("Atlas/200 Maps/New MOC.md");

			const next = applyCalls[0]!(model);
			const nextSuggestion = next.doc.suggestions.find((s) => s.id === WORTHY_ID)!;
			const added = nextSuggestion.candidate_mocs.find(
				(c) => c.path === "Atlas/200 Maps/New MOC.md",
			);
			expect(added?.selected).toBe(true);
			expect(added?.source).toBe("user");
		});

		it("setting a spot reads the MOC's content then opens SpotPicker and dispatches an anchor set", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const mockedVault = ctx.app.vault as unknown as {
				getAbstractFileByPath: ReturnType<typeof vi.fn>;
				read: ReturnType<typeof vi.fn>;
			};
			mockedVault.getAbstractFileByPath.mockReturnValue(new TFile());
			mockedVault.read.mockResolvedValue("# Existing MOC content");

			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);
			const suggestion = model.doc.suggestions.find((s) => s.id === WORTHY_ID)!;
			const firstCandidate = suggestion.candidate_mocs[0]!;
			const row = card.querySelector(
				`.hashi-suggestion-moc[data-moc-path="${firstCandidate.path}"]`,
			)!;

			row.querySelector<HTMLButtonElement>(".hashi-suggestion-moc-spot")!.click();

			await vi.waitFor(() => {
				expect(spotPickerInstances).toHaveLength(1);
			});
			expect(spotPickerInstances[0]?.content).toBe("# Existing MOC content");
			expect(spotPickerInstances[0]?.kind).toBe("existing");

			const anchor: AnchorWire = { type: "heading", value: "Notes", placement: "after" };
			spotPickerInstances[0]!.onPick(anchor);

			const next = applyCalls[0]!(model);
			const nextSuggestion = next.doc.suggestions.find((s) => s.id === WORTHY_ID)!;
			const nextCandidate = nextSuggestion.candidate_mocs.find(
				(c) => c.path === firstCandidate.path,
			);
			expect(nextCandidate?.anchor).toEqual(anchor);
		});

		describe("setCandidateAnchor no-op guards", () => {
			// Each test drives the SAME dispatched closure — `(model) =>
			// setCandidateAnchor(model, WORTHY_ID, firstCandidate.path, anchor)`
			// — against a DIFFERENT model, to exercise setCandidateAnchor's
			// internal branches without exporting it from SuggestionsTab.ts.

			it("no-ops when the suggestion id is unknown (dirty preserved)", async () => {
				const model = await loadModel();
				const { ctx, applyCalls } = makeCtx();
				const container = renderTab(model, ctx);
				const suggestion = model.doc.suggestions.find((s) => s.id === WORTHY_ID)!;
				const firstCandidate = suggestion.candidate_mocs[0]!;
				const anchor: AnchorWire = { type: "heading", value: "Notes", placement: "after" };

				await pickSpot(container, firstCandidate.path, anchor);
				const transform = applyCalls[0]!;

				// Same shape as `model`, but WORTHY_ID no longer exists — the
				// suggestion id the transform closes over is now unknown.
				const modelWithoutSuggestion: EditModel = {
					...model,
					doc: {
						...model.doc,
						suggestions: model.doc.suggestions.filter((s) => s.id !== WORTHY_ID),
					},
				};

				const result = transform(modelWithoutSuggestion);

				expect(result).toBe(modelWithoutSuggestion);
				expect(result.dirty).toBe(false);
			});

			it("no-ops when the candidate path is unknown (dirty preserved)", async () => {
				const model = await loadModel();
				const { ctx, applyCalls } = makeCtx();
				const container = renderTab(model, ctx);
				const suggestion = model.doc.suggestions.find((s) => s.id === WORTHY_ID)!;
				const firstCandidate = suggestion.candidate_mocs[0]!;
				const anchor: AnchorWire = { type: "heading", value: "Notes", placement: "after" };

				await pickSpot(container, firstCandidate.path, anchor);
				const transform = applyCalls[0]!;

				// Suggestion S07 still exists, but its candidate list no longer
				// carries the path the transform closes over.
				const modelWithoutCandidate: EditModel = {
					...model,
					doc: {
						...model.doc,
						suggestions: model.doc.suggestions.map((s) =>
							s.id === WORTHY_ID
								? {
										...s,
										candidate_mocs: s.candidate_mocs.filter(
											(c) => c.path !== firstCandidate.path,
										),
									}
								: s,
						),
					},
				};

				const result = transform(modelWithoutCandidate);

				expect(result).toBe(modelWithoutCandidate);
				expect(result.dirty).toBe(false);
			});

			it("no-ops when the incoming anchor structurally equals the candidate's current anchor", async () => {
				const model = await loadModel();
				const { ctx, applyCalls } = makeCtx();
				const container = renderTab(model, ctx);
				const suggestion = model.doc.suggestions.find((s) => s.id === WORTHY_ID)!;
				const firstCandidate = suggestion.candidate_mocs[0]!;
				const anchor: AnchorWire = { type: "heading", value: "Notes", placement: "after" };

				await pickSpot(container, firstCandidate.path, anchor);
				const transform = applyCalls[0]!;

				// A CLEAN model where the candidate's anchor already equals the
				// incoming one — a fresh object (`{ ...anchor }`), not the same
				// reference, so this proves a structural compare, not `===`.
				const modelWithAnchorAlreadySet: EditModel = {
					dirty: false,
					doc: {
						...model.doc,
						suggestions: model.doc.suggestions.map((s) =>
							s.id === WORTHY_ID
								? {
										...s,
										candidate_mocs: s.candidate_mocs.map((c) =>
											c.path === firstCandidate.path
												? { ...c, anchor: { ...anchor } }
												: c,
										),
									}
								: s,
						),
					},
				};

				const result = transform(modelWithAnchorAlreadySet);

				expect(result).toBe(modelWithAnchorAlreadySet);
				expect(result.dirty).toBe(false);
			});
		});

		it("toggling keep-source dispatches setKeepSource", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			const checkbox = card.querySelector<HTMLInputElement>(".hashi-suggestion-keep-source")!;
			checkbox.checked = true;
			checkbox.dispatchEvent(new Event("change"));

			const next = applyCalls[0]!(model);
			expect(next.doc.suggestions.find((s) => s.id === WORTHY_ID)?.keep_source).toBe(true);
		});

		it("clicking the decision toggle flips approve to skip", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			card.querySelector<HTMLButtonElement>(".hashi-suggestion-decision")!.click();

			const next = applyCalls[0]!(model);
			expect(next.doc.suggestions.find((s) => s.id === WORTHY_ID)?.decision).toBe("skip");
		});
	});

	describe("suppressed card (S01)", () => {
		it("renders worthiness + hint + Force-Atomic only — no MOC UI, no note fields", async () => {
			const model = await loadModel();
			const { ctx } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, SUPPRESSED_ID);

			expect(card.classList.contains("hashi-suggestion-card-suppressed")).toBe(true);
			expect(card.querySelector(".hashi-suggestion-worthiness")?.textContent).toBe(
				"Worthiness: 20%",
			);
			expect(card.querySelector(".hashi-suggestion-skip-hint")).not.toBeNull();
			expect(card.querySelector(".hashi-suggestion-force-atomic")).not.toBeNull();

			for (const selector of [
				".hashi-suggestion-title",
				".hashi-suggestion-template",
				".hashi-suggestion-location",
				".hashi-suggestion-tags",
				".hashi-suggestion-mocs",
				".hashi-suggestion-add-moc",
				".hashi-suggestion-keep-source",
				".hashi-suggestion-decision",
			]) {
				expect(card.querySelector(selector)).toBeNull();
			}
		});

		it("toggling Force-Atomic dispatches setForceAtomicFromSuggestion, syncing the daily mirror by stem", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, SUPPRESSED_ID);

			const checkbox = card.querySelector<HTMLInputElement>(".hashi-suggestion-force-atomic")!;
			checkbox.checked = true;
			checkbox.dispatchEvent(new Event("change"));

			expect(ctx.apply).toHaveBeenCalledOnce();
			const next = applyCalls[0]!(model);

			expect(next.doc.suggestions.find((s) => s.id === SUPPRESSED_ID)?.force_atomic).toBe(true);
			// call-vendor is S01's stem AND the 2026-07-05 daily log entry's
			// source_stem — the sync (T1.4) must flip both from one control.
			const dailyEntry = next.doc.daily_updates
				.flatMap((d) => d.log_entries)
				.find((entry) => entry.source_stem === "call-vendor");
			expect(dailyEntry?.force_atomic_note).toBe(true);
			expect(next.dirty).toBe(true);
		});
	});
});
