/**
 * Unit tests for the Proposed MOCs tab (T3.5, SDD §6 Proposed MOCs, PRD
 * F4/F5), rebuilt to the approved mockup's `hashi-se-*` structure. Covers
 * per-card rename / reparent / decision-segmented / merge dispatch,
 * member-chip title lookup (with raw-id fallback), and the tag picker's
 * inline (non-transform) tag-add helper.
 *
 * `ParentPicker`/`TagPicker` are mocked at module level (mirrors
 * `SuggestionsEditorView.test.ts`'s `ConfirmModal` mock) — they're already
 * unit-tested on their own; here we only need to observe that the tab wires
 * their `onChoose` callback to the right transform, not drive the real
 * fuzzy-match popover.
 */

import "obsidian";
import { App } from "obsidian";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type {
	EditModel,
	ProposedMocWire,
	SuggestionsWire,
	SuggestionWire,
} from "../../../../../src/types/suggestions";
import { ProposedMocsTab } from "../../../../../src/ui/suggestions-view/tabs/ProposedMocsTab";
import type { TabContext } from "../../../../../src/ui/suggestions-view/tabContract";

// --- picker mocks ------------------------------------------------------------

interface CapturedPicker<T> {
	onChoose: (value: T) => void;
	open: Mock<() => void>;
}

const parentPickerInstances: CapturedPicker<string>[] = [];
vi.mock("../../../../../src/ui/suggestions-view/pickers/ParentPicker", () => ({
	ParentPicker: vi.fn(function ParentPicker(
		_app: unknown,
		onChoose: (value: string) => void,
	) {
		const instance: CapturedPicker<string> = { onChoose, open: vi.fn() };
		parentPickerInstances.push(instance);
		return instance;
	}),
}));

const tagPickerInstances: CapturedPicker<string>[] = [];
vi.mock("../../../../../src/ui/suggestions-view/pickers/TagPicker", () => ({
	TagPicker: vi.fn(function TagPicker(
		_app: unknown,
		onChoose: (value: string) => void,
	) {
		const instance: CapturedPicker<string> = { onChoose, open: vi.fn() };
		tagPickerInstances.push(instance);
		return instance;
	}),
}));

interface CapturedMergePicker {
	options: readonly { id: string; name: string }[];
	onChoose: (targetId: string) => void;
	open: Mock<() => void>;
}
const mergeTargetPickerInstances: CapturedMergePicker[] = [];
vi.mock("../../../../../src/ui/suggestions-view/pickers/MergeTargetPicker", () => ({
	MergeTargetPicker: vi.fn(function MergeTargetPicker(
		_app: unknown,
		options: readonly { id: string; name: string }[],
		onChoose: (targetId: string) => void,
	) {
		const instance: CapturedMergePicker = { options, onChoose, open: vi.fn() };
		mergeTargetPickerInstances.push(instance);
		return instance;
	}),
}));

// --- factories ---------------------------------------------------------------

function makeSuggestion(overrides: Partial<SuggestionWire> & { id: string; title: string }): SuggestionWire {
	return {
		stem: overrides.id,
		template: "[[Templates/Atomic]]",
		location: "Atomics",
		tags: [],
		decision: "skip",
		keep_source: false,
		delete_source: false,
		force_atomic: false,
		suppressed: false,
		candidate_mocs: [],
		...overrides,
	};
}

function makeProposedMoc(overrides: Partial<ProposedMocWire> & { id: string }): ProposedMocWire {
	return {
		topic: "topic",
		name: "Unnamed",
		parent: "",
		member_ids: [],
		decision: "skip",
		...overrides,
	};
}

function makeDoc(overrides: Partial<SuggestionsWire> = {}): SuggestionsWire {
	return {
		schema_version: "1",
		generated: "2026-07-06T11:15:00Z",
		run_id: "run-1",
		profile: "default",
		source_items: 0,
		emit_digest: "sha256:" + "0".repeat(64),
		suggestions: [],
		proposed_mocs: [],
		daily_updates: [],
		tag_handler_groups: [],
		...overrides,
	};
}

function makeModel(doc: SuggestionsWire): EditModel {
	return { doc, dirty: false };
}

function makeCtx(): TabContext & { apply: Mock<(transform: (model: EditModel) => EditModel) => void> } {
	return {
		app: new App(),
		apply: vi.fn<(transform: (model: EditModel) => EditModel) => void>(),
	};
}

function firstAppliedTransform(
	apply: Mock<(transform: (model: EditModel) => EditModel) => void>,
	callIndex = 0,
): (model: EditModel) => EditModel {
	const call = apply.mock.calls[callIndex];
	if (call === undefined) {
		throw new Error(`ctx.apply was not called (index ${callIndex})`);
	}
	return call[0];
}

// --- shared fixture: two same-name MOCs (merge candidates) + one unique ------

const SUGGESTION_A = makeSuggestion({ id: "S1", title: "Note A" });
const SUGGESTION_B = makeSuggestion({ id: "S2", title: "Note B" });

function seededModel(): EditModel {
	return makeModel(
		makeDoc({
			suggestions: [SUGGESTION_A, SUGGESTION_B],
			proposed_mocs: [
				makeProposedMoc({
					id: "M1",
					name: "Projects",
					parent: "MOCs/Root.md",
					member_ids: ["S1", "S99"],
					tags: ["#area"],
					reason: "2 notes share topic Projects and have no dedicated MOC.",
					decision: "skip",
				}),
				makeProposedMoc({
					id: "M2",
					name: "Projects",
					parent: "",
					member_ids: ["S2"],
					decision: "skip",
				}),
				makeProposedMoc({
					id: "M3",
					name: "Unique",
					parent: "MOCs/Other.md",
					member_ids: [],
					decision: "approve",
				}),
			],
		}),
	);
}

function cardFor(container: HTMLElement, mocId: string): HTMLElement {
	const cards = Array.from(container.querySelectorAll<HTMLElement>(".hashi-se-pmoc"));
	const card = cards[["M1", "M2", "M3"].indexOf(mocId)];
	if (card === undefined) throw new Error(`no card found for index of ${mocId}`);
	return card;
}

// ---------------------------------------------------------------------------

describe("ProposedMocsTab", () => {
	beforeEach(() => {
		parentPickerInstances.length = 0;
		tagPickerInstances.length = 0;
		mergeTargetPickerInstances.length = 0;
	});

	describe("contract", () => {
		it("has id 'proposed' and label 'Proposed MOCs'", () => {
			const tab = new ProposedMocsTab();
			expect(tab.id).toBe("proposed");
			expect(tab.label).toBe("Proposed MOCs");
		});

		it("counts proposed_mocs", () => {
			const tab = new ProposedMocsTab();
			expect(tab.count(seededModel())).toBe(3);
		});
	});

	describe("render — card structure", () => {
		it("renders one hashi-se-pmoc card per proposed MOC with a name input pre-filled", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			const model = seededModel();

			tab.render(container, model, makeCtx());

			const cards = container.querySelectorAll(".hashi-se-pmoc");
			expect(cards).toHaveLength(3);
			const nameInput = cardFor(container, "M1").querySelector<HTMLInputElement>(
				".hashi-se-inp.hashi-se-name",
			);
			expect(nameInput?.value).toBe("Projects");
			expect(nameInput?.closest(".hashi-se-field")?.querySelector("label")?.textContent).toBe(
				"Name (M1)",
			);
		});

		it("renders a parent mini-pick control showing the current parent", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			tab.render(container, seededModel(), makeCtx());

			const parentEl = cardFor(container, "M1").querySelector(".hashi-se-mini-pick");
			expect(parentEl?.textContent).toBe("MOCs/Root.md");
		});

		it("renders a decision segmented control with the current decision marked is-active and aria-pressed", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			tab.render(container, seededModel(), makeCtx());

			const skipCard = cardFor(container, "M1");
			const skipApprove = skipCard.querySelector(".hashi-se-decision .hashi-se-approve");
			const skipSkip = skipCard.querySelector(".hashi-se-decision .hashi-se-skip");
			expect(skipApprove?.classList.contains("is-active")).toBe(false);
			expect(skipApprove?.getAttribute("aria-pressed")).toBe("false");
			expect(skipSkip?.classList.contains("is-active")).toBe(true);
			expect(skipSkip?.getAttribute("aria-pressed")).toBe("true");

			const approveCard = cardFor(container, "M3");
			const approveApprove = approveCard.querySelector(".hashi-se-decision .hashi-se-approve");
			const approveSkip = approveCard.querySelector(".hashi-se-decision .hashi-se-skip");
			expect(approveApprove?.classList.contains("is-active")).toBe(true);
			expect(approveApprove?.getAttribute("aria-pressed")).toBe("true");
			expect(approveSkip?.classList.contains("is-active")).toBe(false);
			expect(approveSkip?.getAttribute("aria-pressed")).toBe("false");
		});

		it("renders member chips using the referenced suggestion's TITLE, with the raw id on hover, and falls back to the raw id when no suggestion matches", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			tab.render(container, seededModel(), makeCtx());

			const chips = Array.from(
				cardFor(container, "M1").querySelectorAll<HTMLElement>(".hashi-se-chip.hashi-se-member"),
			);
			expect(chips.map((c) => c.textContent)).toEqual(["Note A", "S99"]);
			expect(chips[0]?.getAttribute("title")).toBe("S1");
			expect(chips[1]?.getAttribute("title")).toBe("S99");
		});

		it("renders existing tags and an add-tag affordance", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			tab.render(container, seededModel(), makeCtx());

			const card = cardFor(container, "M1");
			const tags = Array.from(card.querySelectorAll(".hashi-se-tag-text")).map(
				(t) => t.textContent,
			);
			expect(tags).toEqual(["#area"]);
			expect(card.querySelector(".hashi-se-tag.hashi-se-add")).not.toBeNull();
			// each existing chip carries an × remove control
			expect(card.querySelector(".hashi-se-tag .hashi-se-tag-x")).not.toBeNull();
		});

		it("renders the add-tag affordance as a real, keyboard-operable button — not a non-focusable span", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			tab.render(container, seededModel(), makeCtx());

			const addTagBtn = cardFor(container, "M1").querySelector<HTMLButtonElement>(".hashi-se-tag.hashi-se-add");
			expect(addTagBtn?.tagName).toBe("BUTTON");
			expect(addTagBtn?.type).toBe("button");
			// Native <button>s default to tabIndex 0 (in the tab order, Enter/Space
			// activatable) — a <span> defaults to -1. This is the regression check
			// for the a11y fix: the affordance must be reachable by keyboard.
			expect(addTagBtn?.tabIndex).toBe(0);
		});

		it("renders the reason text when present", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			tab.render(container, seededModel(), makeCtx());

			const reasonEl = cardFor(container, "M1").querySelector(".hashi-se-reason");
			expect(reasonEl?.textContent).toBe("2 notes share topic Projects and have no dedicated MOC.");
		});

		it("omits the reason element entirely when reason is absent", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			tab.render(container, seededModel(), makeCtx());

			expect(cardFor(container, "M3").querySelector(".hashi-se-reason")).toBeNull();
		});

		it("shows a Merge affordance on EVERY card (>1 proposal), but the merge hint only for same-name siblings", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			tab.render(container, seededModel(), makeCtx());

			// Merge into… is now available on all three cards (any can fold into another).
			expect(cardFor(container, "M1").querySelector(".hashi-se-link-btn")).not.toBeNull();
			expect(cardFor(container, "M2").querySelector(".hashi-se-link-btn")).not.toBeNull();
			expect(cardFor(container, "M3").querySelector(".hashi-se-link-btn")).not.toBeNull();
			// The informational hint still only appears for the same-name pair (M1/M2).
			expect(cardFor(container, "M1").querySelector(".hashi-se-merge-hint")).not.toBeNull();
			expect(cardFor(container, "M2").querySelector(".hashi-se-merge-hint")).not.toBeNull();
			expect(cardFor(container, "M3").querySelector(".hashi-se-merge-hint")).toBeNull();
		});
	});

	describe("editing name", () => {
		it("dispatches renameProposedMoc via ctx.apply on change", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			const model = seededModel();
			const ctx = makeCtx();
			tab.render(container, model, ctx);

			const input = cardFor(container, "M1").querySelector<HTMLInputElement>(
				".hashi-se-inp.hashi-se-name",
			);
			expect(input).not.toBeNull();
			if (input === null) throw new Error("unreachable");
			input.value = "New Name";
			input.dispatchEvent(new Event("change"));

			expect(ctx.apply).toHaveBeenCalledTimes(1);
			const transform = firstAppliedTransform(ctx.apply);
			const result = transform(model);
			expect(result.doc.proposed_mocs.find((m) => m.id === "M1")?.name).toBe("New Name");
		});
	});

	describe("reparenting", () => {
		it("opens a ParentPicker and dispatches reparentProposedMoc via ctx.apply on choice", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			const model = seededModel();
			const ctx = makeCtx();
			tab.render(container, model, ctx);

			const parentControl = cardFor(container, "M1").querySelector<HTMLElement>(".hashi-se-mini-pick");
			expect(parentControl).not.toBeNull();
			parentControl?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

			expect(parentPickerInstances).toHaveLength(1);
			parentPickerInstances[0]?.onChoose("MOCs/NewParent.md");

			expect(ctx.apply).toHaveBeenCalledTimes(1);
			const transform = firstAppliedTransform(ctx.apply);
			const result = transform(model);
			expect(result.doc.proposed_mocs.find((m) => m.id === "M1")?.parent).toBe("MOCs/NewParent.md");
		});
	});

	describe("decision segmented control", () => {
		it("clicking Approve dispatches setProposedMocDecision(approve)", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			const model = seededModel();
			const ctx = makeCtx();
			tab.render(container, model, ctx);

			const approveButton = cardFor(container, "M1").querySelector<HTMLElement>(
				".hashi-se-decision .hashi-se-approve",
			);
			approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

			expect(ctx.apply).toHaveBeenCalledTimes(1);
			const transform = firstAppliedTransform(ctx.apply);
			const result = transform(model);
			expect(result.doc.proposed_mocs.find((m) => m.id === "M1")?.decision).toBe("approve");
		});

		it("clicking Skip on an approved MOC dispatches setProposedMocDecision(skip)", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			const model = seededModel();
			const ctx = makeCtx();
			tab.render(container, model, ctx);

			const skipButton = cardFor(container, "M3").querySelector<HTMLElement>(
				".hashi-se-decision .hashi-se-skip",
			);
			skipButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

			expect(ctx.apply).toHaveBeenCalledTimes(1);
			const transform = firstAppliedTransform(ctx.apply);
			const result = transform(model);
			expect(result.doc.proposed_mocs.find((m) => m.id === "M3")?.decision).toBe("skip");
		});
	});

	describe("tags", () => {
		it("opens a TagPicker and adds the chosen tag to that MOC's tags without touching a transforms file", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			const model = seededModel();
			const ctx = makeCtx();
			tab.render(container, model, ctx);

			const addTagBtn = cardFor(container, "M2").querySelector<HTMLElement>(".hashi-se-tag.hashi-se-add");
			addTagBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

			expect(tagPickerInstances).toHaveLength(1);
			tagPickerInstances[0]?.onChoose("#new-tag");

			expect(ctx.apply).toHaveBeenCalledTimes(1);
			const transform = firstAppliedTransform(ctx.apply);
			const result = transform(model);
			// M2 starts with no `tags` field at all — verifies the helper
			// tolerates an absent array, not just an empty one.
			expect(result.doc.proposed_mocs.find((m) => m.id === "M2")?.tags).toEqual(["#new-tag"]);
			expect(result.dirty).toBe(true);
		});

		it("adding a tag that already exists is a no-op (same model reference)", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			const model = seededModel();
			const ctx = makeCtx();
			tab.render(container, model, ctx);

			const addTagBtn = cardFor(container, "M1").querySelector<HTMLElement>(".hashi-se-tag.hashi-se-add");
			addTagBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			tagPickerInstances[0]?.onChoose("#area");

			const transform = firstAppliedTransform(ctx.apply);
			const result = transform(model);
			expect(result).toBe(model);
			expect(result.dirty).toBe(false);
		});

		it("fails closed (same reference, dirty untouched) when the target moc no longer exists by the time the transform runs", () => {
			// Regression for the unknown-mocId branch of the local
			// addProposedMocTag helper — e.g. a merge already collapsed M1
			// out of the model between render and this apply() actually
			// running. Wired the same way as every other test in this file:
			// through the tab's public render/click/onChoose surface, then
			// applying the captured transform — here to a model that no
			// longer has the moc the picker was opened for.
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			const model = seededModel();
			const ctx = makeCtx();
			tab.render(container, model, ctx);

			const addTagBtn = cardFor(container, "M1").querySelector<HTMLElement>(".hashi-se-tag.hashi-se-add");
			addTagBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			tagPickerInstances[0]?.onChoose("#new-tag");

			const transform = firstAppliedTransform(ctx.apply);
			const modelWithoutM1: EditModel = {
				doc: {
					...model.doc,
					proposed_mocs: model.doc.proposed_mocs.filter((m) => m.id !== "M1"),
				},
				dirty: false,
			};

			const result = transform(modelWithoutM1);
			expect(result).toBe(modelWithoutM1);
			expect(result.dirty).toBe(false);
		});
	});

	describe("merge into another proposal", () => {
		it("opens MergeTargetPicker with the OTHER proposals and dispatches mergeProposedMocs on choice", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			const model = seededModel();
			const ctx = makeCtx();
			tab.render(container, model, ctx);

			const mergeBtn = cardFor(container, "M1").querySelector<HTMLElement>(".hashi-se-link-btn");
			mergeBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

			// The picker is offered every OTHER proposal — M2 and M3, not M1 itself.
			const picker = mergeTargetPickerInstances.at(-1);
			expect(picker?.options.map((o) => o.id)).toEqual(["M2", "M3"]);

			// Choosing M2 folds M1 INTO M2 (M1 dropped, its members unioned into M2).
			picker?.onChoose("M2");
			expect(ctx.apply).toHaveBeenCalledTimes(1);
			const transform = firstAppliedTransform(ctx.apply);
			const result = transform(model);

			expect(result.doc.proposed_mocs).toHaveLength(2);
			expect(result.doc.proposed_mocs.find((m) => m.id === "M1")).toBeUndefined();
			const merged = result.doc.proposed_mocs.find((m) => m.id === "M2");
			expect(merged?.member_ids).toEqual(expect.arrayContaining(["S2", "S1", "S99"]));
		});

		it("removing a tag dispatches removeProposedMocTag via ctx.apply", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			const model = seededModel();
			const ctx = makeCtx();
			tab.render(container, model, ctx);

			const removeBtn = cardFor(container, "M1").querySelector<HTMLElement>(".hashi-se-tag-x");
			removeBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

			expect(ctx.apply).toHaveBeenCalledTimes(1);
			const result = firstAppliedTransform(ctx.apply)(model);
			expect(result.doc.proposed_mocs.find((m) => m.id === "M1")?.tags).toEqual([]);
			expect(result.dirty).toBe(true);
		});
	});
});
