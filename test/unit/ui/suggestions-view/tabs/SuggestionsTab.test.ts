/**
 * Unit tests for SuggestionsTab (T3.2) — worthy vs suppressed suggestion
 * cards (SDD §6 Suggestions; PRD F2/F6/F7), rebuilt to the approved mockup
 * (`docs/XDD/specs/004-suggestions-editor/mockups/suggestions-editor.html`).
 *
 * Built against the real vendored `1115` Tomo emission via
 * `FakeSuggestionsDoc` (spec-002 lesson: real Tomo output over a synthetic
 * fixture). In that run: S01/S02/S03/S04/S05/S06 are suppressed, S07
 * ("zettelkasten-method") is the sole worthy suggestion, with 3 candidate
 * MOCs, all unselected. S01 ("call-vendor") and S05 ("quick-thought") are
 * both suppressed at worthiness 0.2 (low).
 *
 * Two confirmed bugs verified as fixed here:
 *   1. The suppressed card now renders an editable title input (previously
 *      it showed only a worthiness percentage, with no way to tell WHICH
 *      note it was).
 *   2. The decision control is a two-button Approve/Skip segment with
 *      `is-active` on whichever matches `suggestion.decision` (previously a
 *      single ambiguous toggle button).
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
import { App, setIcon, TFile } from "obsidian";
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
const SUPPRESSED_ID = "S01"; // call-vendor — suppressed, worthiness 0.2 (low)

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
 * Test-only setup helper: the anchor chip only renders for a SELECTED
 * candidate (mockup behavior — see SuggestionsTab.ts renderCandidateMain),
 * and `ctx.apply` is a spy here (it records the dispatched transform rather
 * than mutating-and-re-rendering) — so to exercise the anchor-chip click
 * path, tests must render against a model where the target candidate is
 * ALREADY marked `selected`, rather than relying on a live re-render after
 * clicking the check.
 */
function withCandidateSelected(model: EditModel, suggestionId: string, path: string): EditModel {
	return {
		...model,
		doc: {
			...model.doc,
			suggestions: model.doc.suggestions.map((s) =>
				s.id === suggestionId
					? {
							...s,
							candidate_mocs: s.candidate_mocs.map((c) =>
								c.path === path ? { ...c, selected: true } : c,
							),
						}
					: s,
			),
		},
	};
}

/**
 * Clicks a SELECTED candidate MOC's anchor chip and drives its `SpotPicker`
 * mock's `onPick` with `anchor` — the arrange sequence shared by the
 * `setCandidateAnchor` behavior tests below (happy path + both no-op
 * guards). No vault mocking needed: `getAbstractFileByPath` returns
 * `undefined` by default in the obsidian mock, so `readMocContent` resolves
 * `""` and still proceeds to construct the (mocked) `SpotPicker` — these
 * tests only care about the dispatched transform, not the picker's content.
 */
async function pickSpot(container: HTMLElement, candidatePath: string, anchor: AnchorWire): Promise<void> {
	const row = container.querySelector(`.hashi-se-cand[data-moc-path="${candidatePath}"]`)!;
	row.querySelector<HTMLButtonElement>(".hashi-se-anchor-chip")!.click();

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

	describe("summary gist line (wire `summary`)", () => {
		function withSummary(model: EditModel, id: string, summary: string | null): EditModel {
			return {
				...model,
				doc: {
					...model.doc,
					suggestions: model.doc.suggestions.map((s) =>
						s.id === id ? { ...s, summary } : s,
					),
				},
			};
		}

		it("renders the summary at the top of the card when present", async () => {
			const model = withSummary(await loadModel(), WORTHY_ID, "A one-sentence gist.");
			const { ctx } = makeCtx();
			const card = cardFor(renderTab(model, ctx), WORTHY_ID);
			expect(card.querySelector(".hashi-se-summary")?.textContent).toBe("A one-sentence gist.");
		});

		it("renders the summary on a suppressed card too", async () => {
			const model = withSummary(await loadModel(), SUPPRESSED_ID, "Gist of a light block.");
			const { ctx } = makeCtx();
			const card = cardFor(renderTab(model, ctx), SUPPRESSED_ID);
			expect(card.querySelector(".hashi-se-summary")?.textContent).toBe("Gist of a light block.");
		});

		it("omits the summary line for null (legacy runs)", async () => {
			const model = withSummary(await loadModel(), WORTHY_ID, null);
			const { ctx } = makeCtx();
			const card = cardFor(renderTab(model, ctx), WORTHY_ID);
			expect(card.querySelector(".hashi-se-summary")).toBeNull();
		});

		it("omits the summary line for a blank string", async () => {
			const model = withSummary(await loadModel(), WORTHY_ID, "   ");
			const { ctx } = makeCtx();
			const card = cardFor(renderTab(model, ctx), WORTHY_ID);
			expect(card.querySelector(".hashi-se-summary")).toBeNull();
		});
	});

	describe("worthy card (S07)", () => {
		it("renders title/decision/template/location/keep-source/tags/candidate-MOCs/+Add MOC", async () => {
			const model = await loadModel();
			const { ctx } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			expect(card.classList.contains("hashi-se-suppressed")).toBe(false);

			const title = card.querySelector<HTMLInputElement>(".hashi-se-inp.hashi-se-name");
			expect(title?.value).toBe("The Zettelkasten Method — Atomic Notes and Link-Based Thinking");

			const approveBtn = card.querySelector<HTMLButtonElement>(".hashi-se-decision .hashi-se-approve");
			const skipBtn = card.querySelector<HTMLButtonElement>(".hashi-se-decision .hashi-se-skip");
			expect(approveBtn?.classList.contains("is-active")).toBe(true);
			expect(skipBtn?.classList.contains("is-active")).toBe(false);
			expect(approveBtn?.getAttribute("aria-pressed")).toBe("true");
			expect(skipBtn?.getAttribute("aria-pressed")).toBe("false");

			expect(card.querySelector(".hashi-se-mini-pick")?.textContent).toBe("t_note_tomo.md");
			const miniPicks = card.querySelectorAll(".hashi-se-mini-pick");
			expect(miniPicks[1]?.textContent).toBe("Atlas/202 Notes/");

			const tags = Array.from(card.querySelectorAll(".hashi-se-tag-text")).map(
				(el) => el.textContent,
			);
			expect(tags).toEqual(["topic/knowledge/frameworks"]);
			expect(card.querySelector(".hashi-se-tag.hashi-se-add")).not.toBeNull();

			const candRows = card.querySelectorAll(".hashi-se-cand");
			expect(candRows).toHaveLength(3);
			expect(card.querySelector(".hashi-se-add-moc button")?.textContent).toBe("＋ Add MOC…");

			expect(card.querySelector(".hashi-se-cbx input[type='checkbox']")).not.toBeNull();

			// No suppressed-only controls leak into the worthy card.
			expect(card.querySelector(".hashi-se-worthiness")).toBeNull();
			expect(card.querySelector(".hashi-se-force-atomic")).toBeNull();
		});

		it("editing the title dispatches setTitle", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			const title = card.querySelector<HTMLInputElement>(".hashi-se-inp.hashi-se-name")!;
			title.value = "A renamed atomic note";
			title.dispatchEvent(new Event("change"));

			expect(ctx.apply).toHaveBeenCalledOnce();
			const next = applyCalls[0]!(model);
			expect(next.doc.suggestions.find((s) => s.id === WORTHY_ID)?.title).toBe(
				"A renamed atomic note",
			);
			expect(next.dirty).toBe(true);
		});

		it("clicking Skip on the decision segment dispatches setDecision, flipping aria-pressed on re-render", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			card.querySelector<HTMLButtonElement>(".hashi-se-decision .hashi-se-skip")!.click();

			const next = applyCalls[0]!(model);
			expect(next.doc.suggestions.find((s) => s.id === WORTHY_ID)?.decision).toBe("skip");

			// Re-render with the post-transform model (ctx.apply is a spy here,
			// it doesn't live-mutate the DOM) to prove aria-pressed tracks
			// `suggestion.decision` in both directions, not just the initial
			// approve-active case.
			const reCard = cardFor(renderTab(next, ctx), WORTHY_ID);
			expect(
				reCard.querySelector(".hashi-se-decision .hashi-se-approve")?.getAttribute("aria-pressed"),
			).toBe("false");
			expect(
				reCard.querySelector(".hashi-se-decision .hashi-se-skip")?.getAttribute("aria-pressed"),
			).toBe("true");
		});

		it("clicking Approve on the decision segment dispatches setDecision (no-op when already approved)", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			card.querySelector<HTMLButtonElement>(".hashi-se-decision .hashi-se-approve")!.click();

			const next = applyCalls[0]!(model);
			expect(next.doc.suggestions.find((s) => s.id === WORTHY_ID)?.decision).toBe("approve");
		});

		it("choosing a template opens TemplatePicker and dispatches setTemplate", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			card.querySelectorAll<HTMLButtonElement>(".hashi-se-mini-pick")[0]!.click();

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

			card.querySelectorAll<HTMLButtonElement>(".hashi-se-mini-pick")[1]!.click();

			expect(locationPickerInstances).toHaveLength(1);
			locationPickerInstances[0]!.onChoose("Atlas/300 Reference/");

			const next = applyCalls[0]!(model);
			expect(next.doc.suggestions.find((s) => s.id === WORTHY_ID)?.location).toBe(
				"Atlas/300 Reference/",
			);
		});

		it("toggling keep-source dispatches setKeepSource", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			const checkbox = card.querySelector<HTMLInputElement>(".hashi-se-cbx input[type='checkbox']")!;
			checkbox.checked = true;
			checkbox.dispatchEvent(new Event("change"));

			const next = applyCalls[0]!(model);
			expect(next.doc.suggestions.find((s) => s.id === WORTHY_ID)?.keep_source).toBe(true);
		});

		it("adding a tag opens TagPicker and dispatches an append-only tags update", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			card.querySelector<HTMLButtonElement>(".hashi-se-tag.hashi-se-add")!.click();

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

			card.querySelector<HTMLButtonElement>(".hashi-se-tag.hashi-se-add")!.click();
			tagPickerInstances[0]!.onChoose("topic/knowledge/frameworks");

			const next = applyCalls[0]!(model);
			expect(next).toBe(model);
			expect(next.dirty).toBe(false);
		});

		it("checking a candidate MOC toggles it on (click), leaving the other candidates untouched", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			const suggestion = model.doc.suggestions.find((s) => s.id === WORTHY_ID)!;
			const secondCandidate = suggestion.candidate_mocs[1]!;
			const row = card.querySelector(
				`.hashi-se-cand[data-moc-path="${secondCandidate.path}"]`,
			)!;
			row.querySelector<HTMLElement>(".hashi-se-check")!.click();

			const next = applyCalls[0]!(model);
			const nextSuggestion = next.doc.suggestions.find((s) => s.id === WORTHY_ID)!;
			// Independent multi-select: only the clicked candidate flips; the
			// others keep their (unselected) state — no re-point clearing.
			expect(nextSuggestion.candidate_mocs.map((c) => [c.path, c.selected])).toEqual([
				[suggestion.candidate_mocs[0]!.path, false],
				[secondCandidate.path, true],
				[suggestion.candidate_mocs[2]!.path, false],
			]);
		});

		it("clicking an already-selected candidate toggles it OFF (deselect)", async () => {
			const base = await loadModel();
			const suggestion = base.doc.suggestions.find((s) => s.id === WORTHY_ID)!;
			const firstPath = suggestion.candidate_mocs[0]!.path;
			// Render against a model where the first candidate is already selected.
			const model = withCandidateSelected(base, WORTHY_ID, firstPath);
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			const row = card.querySelector(`.hashi-se-cand[data-moc-path="${firstPath}"]`)!;
			row.querySelector<HTMLElement>(".hashi-se-check")!.click();

			const next = applyCalls[0]!(model);
			const nextSuggestion = next.doc.suggestions.find((s) => s.id === WORTHY_ID)!;
			expect(nextSuggestion.candidate_mocs.find((c) => c.path === firstPath)?.selected).toBe(false);
			expect(next.dirty).toBe(true);
		});

		it("renders the check glyph ONLY on selected candidates (empty box otherwise)", async () => {
			const base = await loadModel();
			const suggestion = base.doc.suggestions.find((s) => s.id === WORTHY_ID)!;
			const selectedPath = suggestion.candidate_mocs[0]!.path;
			const model = withCandidateSelected(base, WORTHY_ID, selectedPath);
			const { ctx } = makeCtx();

			// setIcon draws the check glyph. It must fire once — for the single
			// selected candidate — and not for the two unselected ones (which
			// render as empty boxes). The obsidian mock's setIcon is a no-op, so
			// we assert on the call rather than the (absent) rendered SVG.
			// Filter to the "check" glyph specifically: suppressed cards also call
			// setIcon for their daily-log indicator, which is not what this tests.
			vi.mocked(setIcon).mockClear();
			const container = renderTab(model, ctx);

			const checkCalls = vi.mocked(setIcon).mock.calls.filter(([, name]) => name === "check");
			expect(checkCalls).toHaveLength(1);
			const selectedCheck = container.querySelector(
				`.hashi-se-cand[data-moc-path="${selectedPath}"] .hashi-se-check`,
			);
			expect(checkCalls[0]?.[0]).toBe(selectedCheck);
		});

		it("checking a candidate MOC via keyboard Enter toggles it on", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			const suggestion = model.doc.suggestions.find((s) => s.id === WORTHY_ID)!;
			const firstCandidate = suggestion.candidate_mocs[0]!;
			const row = card.querySelector(`.hashi-se-cand[data-moc-path="${firstCandidate.path}"]`)!;
			const check = row.querySelector<HTMLElement>(".hashi-se-check")!;
			check.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

			expect(ctx.apply).toHaveBeenCalledOnce();
			const next = applyCalls[0]!(model);
			const nextSuggestion = next.doc.suggestions.find((s) => s.id === WORTHY_ID)!;
			expect(nextSuggestion.candidate_mocs.find((c) => c.path === firstCandidate.path)?.selected).toBe(
				true,
			);
		});

		it("checking a candidate MOC via keyboard Space toggles it on and prevents the page scroll", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			const suggestion = model.doc.suggestions.find((s) => s.id === WORTHY_ID)!;
			const secondCandidate = suggestion.candidate_mocs[1]!;
			const row = card.querySelector(`.hashi-se-cand[data-moc-path="${secondCandidate.path}"]`)!;
			const check = row.querySelector<HTMLElement>(".hashi-se-check")!;
			const spaceEvent = new KeyboardEvent("keydown", { key: " ", cancelable: true });
			check.dispatchEvent(spaceEvent);

			// Space must not scroll the page — the handler has to call
			// preventDefault(), same as it does for Enter.
			expect(spaceEvent.defaultPrevented).toBe(true);

			expect(ctx.apply).toHaveBeenCalledOnce();
			const next = applyCalls[0]!(model);
			const nextSuggestion = next.doc.suggestions.find((s) => s.id === WORTHY_ID)!;
			expect(
				nextSuggestion.candidate_mocs.find((c) => c.path === secondCandidate.path)?.selected,
			).toBe(true);
		});

		it("a candidate check exposes role=checkbox and aria-checked reflecting selection", async () => {
			const model = await loadModel();
			const { ctx } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			const check = card.querySelector<HTMLElement>(".hashi-se-check")!;
			expect(check.getAttribute("role")).toBe("checkbox");
			expect(check.getAttribute("aria-checked")).toBe("false");
			expect(check.getAttribute("tabindex")).toBe("0");
		});

		it("an unselected candidate shows no anchor row; a selected one with anchor:null shows the empty chip", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			const suggestion = model.doc.suggestions.find((s) => s.id === WORTHY_ID)!;
			const firstCandidate = suggestion.candidate_mocs[0]!;
			const row = card.querySelector(`.hashi-se-cand[data-moc-path="${firstCandidate.path}"]`)!;
			expect(row.classList.contains("hashi-se-off")).toBe(true);
			expect(row.querySelector(".hashi-se-anchor-row")).toBeNull();

			row.querySelector<HTMLElement>(".hashi-se-check")!.click();
			const next = applyCalls[0]!(model);
			const rerendered = renderTab(next, ctx);

			const reCard = cardFor(rerendered, WORTHY_ID);
			const reRow = reCard.querySelector(`.hashi-se-cand[data-moc-path="${firstCandidate.path}"]`)!;
			expect(reRow.classList.contains("hashi-se-on")).toBe(true);
			const chip = reRow.querySelector(".hashi-se-anchor-chip");
			expect(chip?.classList.contains("hashi-se-empty")).toBe(true);
			expect(chip?.textContent).toBe("＋ set a spot");
		});

		it("a candidate marked source:user shows the 'added' badge", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			card.querySelector<HTMLButtonElement>(".hashi-se-add-moc button")!.click();
			expect(mocPickerInstances).toHaveLength(1);
			mocPickerInstances[0]!.onChoose("Atlas/200 Maps/New MOC.md");

			const next = applyCalls[0]!(model);
			const rerendered = renderTab(next, ctx);
			const reCard = cardFor(rerendered, WORTHY_ID);
			const row = reCard.querySelector(
				`.hashi-se-cand[data-moc-path="Atlas/200 Maps/New MOC.md"]`,
			)!;
			expect(row.querySelector(".hashi-se-src-badge")?.textContent).toBe("added");
		});

		it("adding a MOC opens MocPicker and dispatches addMoc", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			card.querySelector<HTMLButtonElement>(".hashi-se-add-moc button")!.click();

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

		it("clicking a candidate's path opens it via workspace.openLinkText", async () => {
			const model = await loadModel();
			const { ctx } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, WORTHY_ID);

			const suggestion = model.doc.suggestions.find((s) => s.id === WORTHY_ID)!;
			const firstCandidate = suggestion.candidate_mocs[0]!;
			const row = card.querySelector(`.hashi-se-cand[data-moc-path="${firstCandidate.path}"]`)!;
			row.querySelector<HTMLElement>(".hashi-se-cand-path")!.click();

			expect(ctx.app.workspace.openLinkText).toHaveBeenCalledWith(firstCandidate.path, "", false);
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

			const suggestion = model.doc.suggestions.find((s) => s.id === WORTHY_ID)!;
			const firstCandidate = suggestion.candidate_mocs[0]!;
			// The anchor chip only renders for a selected candidate.
			const container = renderTab(withCandidateSelected(model, WORTHY_ID, firstCandidate.path), ctx);
			const anchor: AnchorWire = { type: "heading", value: "Notes", placement: "after" };

			await pickSpot(container, firstCandidate.path, { ...anchor });

			expect(spotPickerInstances[0]?.content).toBe("# Existing MOC content");
			expect(spotPickerInstances[0]?.kind).toBe("existing");

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
				const suggestion = model.doc.suggestions.find((s) => s.id === WORTHY_ID)!;
				const firstCandidate = suggestion.candidate_mocs[0]!;
				const container = renderTab(withCandidateSelected(model, WORTHY_ID, firstCandidate.path), ctx);
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
				const suggestion = model.doc.suggestions.find((s) => s.id === WORTHY_ID)!;
				const firstCandidate = suggestion.candidate_mocs[0]!;
				const container = renderTab(withCandidateSelected(model, WORTHY_ID, firstCandidate.path), ctx);
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
				const suggestion = model.doc.suggestions.find((s) => s.id === WORTHY_ID)!;
				const firstCandidate = suggestion.candidate_mocs[0]!;
				const container = renderTab(withCandidateSelected(model, WORTHY_ID, firstCandidate.path), ctx);
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
	});

	describe("proposed-MOC cross-reference (mockup .xref)", () => {
		function withProposedMoc(base: EditModel, name: string, memberIds: string[]): EditModel {
			return {
				...base,
				doc: {
					...base.doc,
					proposed_mocs: [
						{
							id: "M01",
							topic: "AI",
							name,
							parent: "",
							member_ids: memberIds,
							decision: "skip",
						},
					],
				},
			};
		}

		it("shows the proposed MOC a note will be added to, by name", async () => {
			const model = withProposedMoc(await loadModel(), "AI (MOC)", [WORTHY_ID]);
			const { ctx } = makeCtx();
			const container = renderTab(model, ctx);

			const xref = cardFor(container, WORTHY_ID).querySelector(".hashi-se-xref");
			expect(xref?.textContent).toBe(
				"↳ also proposed as a new MOC: AI (MOC) — see the Proposed MOCs tab",
			);
		});

		it("uses the CURRENT proposed-MOC name (so a rename/merge shows through)", async () => {
			// Simulate a post-merge state: the member now lives under the renamed
			// target proposal — the card must reflect the new name, not a stale id.
			const model = withProposedMoc(await loadModel(), "Merged Topics (MOC)", [WORTHY_ID]);
			const { ctx } = makeCtx();
			const container = renderTab(model, ctx);

			expect(cardFor(container, WORTHY_ID).querySelector(".hashi-se-xref")?.textContent).toContain(
				"Merged Topics (MOC)",
			);
		});

		it("renders no cross-reference when the note is not a member of any proposed MOC", async () => {
			// The 1115 fixture has proposed_mocs: [] — no card should show an xref.
			const model = await loadModel();
			const { ctx } = makeCtx();
			const container = renderTab(model, ctx);

			expect(container.querySelector(".hashi-se-xref")).toBeNull();
		});
	});

	describe("suppressed card (S01) — the origin note is openable, atomic title editable", () => {
		it("renders the openable origin-note link, editable title, worthiness, hint, and Force-Atomic — no MOC UI, no decision/template/tags", async () => {
			const model = await loadModel();
			const { ctx } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, SUPPRESSED_ID);

			expect(card.classList.contains("hashi-se-suppressed")).toBe(true);

			// The card must show WHICH note it is — the origin note name as an
			// openable link (owner follow-up: the opaque "Note (S01)" gave no
			// way to reach the note).
			const idLine = card.querySelector(".hashi-se-suppressed-id");
			expect(idLine).not.toBeNull();
			const link = idLine?.querySelector<HTMLElement>(".hashi-se-wlink");
			expect(link?.textContent).toBe("call-vendor"); // S01's origin stem
			expect(idLine?.textContent).toBe("call-vendor · not promoted");

			// The editable atomic-title input is kept below the link.
			const title = card.querySelector<HTMLInputElement>(".hashi-se-inp.hashi-se-name");
			expect(title).not.toBeNull();
			expect(title?.value).toBe("Vendor call — review quote, send references");

			const worthiness = card.querySelector(".hashi-se-worthiness");
			expect(worthiness?.classList.contains("hashi-se-low")).toBe(true);
			expect(worthiness?.querySelector(".hashi-se-wv")?.textContent).toBe("20%");
			expect(worthiness?.querySelector(".hashi-se-wl")?.textContent).toBe("worthiness");

			expect(card.querySelector(".hashi-se-suppressed-note")).not.toBeNull();
			expect(card.querySelector(".hashi-se-force-atomic input[type='checkbox']")).not.toBeNull();

			for (const selector of [
				".hashi-se-decision",
				".hashi-se-mini-pick",
				".hashi-se-tags",
				".hashi-se-cand",
				".hashi-se-add-moc",
				".hashi-se-cbx",
			]) {
				expect(card.querySelector(selector)).toBeNull();
			}
		});

		it("clicking the origin-note link opens it via workspace.openLinkText", async () => {
			const model = await loadModel();
			const { ctx } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, SUPPRESSED_ID);

			const link = card.querySelector<HTMLElement>(".hashi-se-suppressed-id .hashi-se-wlink")!;
			link.dispatchEvent(new MouseEvent("click", { bubbles: true }));

			expect(ctx.app.workspace.openLinkText).toHaveBeenCalledWith("call-vendor", "", false);
			// Opening a suppressed card's link must not dispatch an edit.
			expect(ctx.apply).not.toHaveBeenCalled();
		});

		it("shows the daily-log skip hint when the stem has a daily-log entry (S01 → call-vendor)", async () => {
			const model = await loadModel();
			const { ctx } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, SUPPRESSED_ID);

			expect(card.querySelector(".hashi-se-suppressed-note")?.textContent).toBe(
				"Below the 0.5 threshold — kept in inbox, not made an atomic note. " +
					"Daily Log suggested. Check Force Atomic to create a note.",
			);
		});

		function setDailyAccepted(model: EditModel, stem: string, accepted: boolean): EditModel {
			return {
				...model,
				doc: {
					...model.doc,
					daily_updates: model.doc.daily_updates.map((d) => ({
						...d,
						log_entries: d.log_entries.map((e) =>
							e.source_stem === stem ? { ...e, accepted } : e,
						),
					})),
				},
			};
		}

		it("renders a MUTED daily-log icon when the entry exists but is not accepted (fixture default)", async () => {
			const model = await loadModel(); // call-vendor's log entry is accepted:false in the fixture
			const { ctx } = makeCtx();
			const card = cardFor(renderTab(model, ctx), SUPPRESSED_ID);

			const icon = card.querySelector(".hashi-se-suppressed-note .hashi-se-daily-icon");
			expect(icon).not.toBeNull();
			expect(icon?.classList.contains("is-active")).toBe(false);
		});

		it("HIGHLIGHTS the daily-log icon (is-active) once the daily-log entry is accepted", async () => {
			const model = setDailyAccepted(await loadModel(), "call-vendor", true);
			const { ctx } = makeCtx();
			const card = cardFor(renderTab(model, ctx), SUPPRESSED_ID);

			const icon = card.querySelector(".hashi-se-suppressed-note .hashi-se-daily-icon");
			expect(icon?.classList.contains("is-active")).toBe(true);
		});

		it("editing the suppressed title dispatches setTitle (the bug-1 regression)", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, SUPPRESSED_ID);

			const title = card.querySelector<HTMLInputElement>(".hashi-se-inp.hashi-se-name")!;
			title.value = "Renamed vendor call note";
			title.dispatchEvent(new Event("change"));

			expect(ctx.apply).toHaveBeenCalledOnce();
			const next = applyCalls[0]!(model);
			expect(next.doc.suggestions.find((s) => s.id === SUPPRESSED_ID)?.title).toBe(
				"Renamed vendor call note",
			);
			expect(next.dirty).toBe(true);
		});

		it("toggling Force-Atomic dispatches setForceAtomicFromSuggestion, syncing the daily mirror by stem", async () => {
			const model = await loadModel();
			const { ctx, applyCalls } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, SUPPRESSED_ID);

			const checkbox = card.querySelector<HTMLInputElement>(
				".hashi-se-force-atomic input[type='checkbox']",
			)!;
			checkbox.checked = true;
			checkbox.dispatchEvent(new Event("change"));

			expect(ctx.apply).toHaveBeenCalledOnce();
			const next = applyCalls[0]!(model);

			expect(next.doc.suggestions.find((s) => s.id === SUPPRESSED_ID)?.force_atomic).toBe(true);
			// call-vendor is S01's stem AND the daily log entry's source_stem —
			// the sync (T1.4) must flip both from one control.
			const dailyEntry = next.doc.daily_updates
				.flatMap((d) => d.log_entries)
				.find((entry) => entry.source_stem === "call-vendor");
			expect(dailyEntry?.force_atomic_note).toBe(true);
			expect(next.dirty).toBe(true);
		});
	});

	describe("suppressed card (S05) — a second suppressed note, distinguishable by its origin", () => {
		it("renders its own origin link + title, distinct from S01's, and the no-daily-log skip hint", async () => {
			const model = await loadModel();
			const { ctx } = makeCtx();
			const container = renderTab(model, ctx);
			const card = cardFor(container, "S05");

			// S05's origin stem is quick-thought — distinct from S01's call-vendor.
			expect(card.querySelector(".hashi-se-suppressed-id .hashi-se-wlink")?.textContent).toBe(
				"quick-thought",
			);
			const title = card.querySelector<HTMLInputElement>(".hashi-se-inp.hashi-se-name");
			expect(title?.value).toBe("Replace the hallway light bulb");

			const worthiness = card.querySelector(".hashi-se-worthiness");
			expect(worthiness?.querySelector(".hashi-se-wv")?.textContent).toBe("20%");
			expect(worthiness?.classList.contains("hashi-se-low")).toBe(true);

			// quick-thought has NO daily-log entry → the "force creation" hint.
			expect(card.querySelector(".hashi-se-suppressed-note")?.textContent).toBe(
				"Below the 0.5 threshold — kept in inbox, not made an atomic note. " +
					"Force creation if necessary.",
			);
			// …and no daily-log indicator icon at all.
			expect(card.querySelector(".hashi-se-suppressed-note .hashi-se-daily-icon")).toBeNull();
		});
	});
});
