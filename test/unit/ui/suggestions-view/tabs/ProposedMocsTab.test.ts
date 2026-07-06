/**
 * Unit tests for the Proposed MOCs tab (T3.5, SDD §6 Proposed MOCs, PRD
 * F4/F5). Covers per-card rename / reparent / decision-toggle / merge
 * dispatch, member-chip title lookup (with raw-id fallback), and the tag
 * picker's inline (non-transform) tag-add helper.
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
	const cards = Array.from(container.querySelectorAll<HTMLElement>(".hashi-proposed-moc-card"));
	const card = cards[["M1", "M2", "M3"].indexOf(mocId)];
	if (card === undefined) throw new Error(`no card found for index of ${mocId}`);
	return card;
}

// ---------------------------------------------------------------------------

describe("ProposedMocsTab", () => {
	beforeEach(() => {
		parentPickerInstances.length = 0;
		tagPickerInstances.length = 0;
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
		it("renders one card per proposed MOC with a name input pre-filled", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			const model = seededModel();

			tab.render(container, model, makeCtx());

			const cards = container.querySelectorAll(".hashi-proposed-moc-card");
			expect(cards).toHaveLength(3);
			const nameInput = cardFor(container, "M1").querySelector<HTMLInputElement>(
				".hashi-proposed-moc-name",
			);
			expect(nameInput?.value).toBe("Projects");
		});

		it("renders a parent control showing the current parent", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			tab.render(container, seededModel(), makeCtx());

			const parentEl = cardFor(container, "M1").querySelector(".hashi-proposed-moc-parent");
			expect(parentEl?.textContent).toContain("MOCs/Root.md");
		});

		it("renders a decision toggle reflecting skip vs approve", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			tab.render(container, seededModel(), makeCtx());

			const skipDecision = cardFor(container, "M1").querySelector(".hashi-proposed-moc-decision");
			const approveDecision = cardFor(container, "M3").querySelector(".hashi-proposed-moc-decision");
			expect(skipDecision?.textContent?.toLowerCase()).toContain("skip");
			expect(approveDecision?.textContent?.toLowerCase()).toContain("approve");
		});

		it("renders member chips using the referenced suggestion's TITLE, with the raw id on hover, and falls back to the raw id when no suggestion matches", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			tab.render(container, seededModel(), makeCtx());

			const chips = Array.from(
				cardFor(container, "M1").querySelectorAll<HTMLElement>(".hashi-proposed-moc-member"),
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
			const tags = Array.from(card.querySelectorAll(".hashi-proposed-moc-tag")).map((t) => t.textContent);
			expect(tags).toEqual(["#area"]);
			expect(card.querySelector(".hashi-proposed-moc-add-tag")).not.toBeNull();
		});

		it("shows a Merge affordance only for MOCs with a same-name sibling", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			tab.render(container, seededModel(), makeCtx());

			expect(cardFor(container, "M1").querySelector(".hashi-proposed-moc-merge")).not.toBeNull();
			expect(cardFor(container, "M2").querySelector(".hashi-proposed-moc-merge")).not.toBeNull();
			expect(cardFor(container, "M3").querySelector(".hashi-proposed-moc-merge")).toBeNull();
		});
	});

	describe("editing name", () => {
		it("dispatches renameProposedMoc via ctx.apply on change", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			const model = seededModel();
			const ctx = makeCtx();
			tab.render(container, model, ctx);

			const input = cardFor(container, "M1").querySelector<HTMLInputElement>(".hashi-proposed-moc-name");
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

			const parentControl = cardFor(container, "M1").querySelector<HTMLElement>(".hashi-proposed-moc-parent");
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

	describe("decision toggle", () => {
		it("dispatches setProposedMocDecision via ctx.apply, flipping skip to approve", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			const model = seededModel();
			const ctx = makeCtx();
			tab.render(container, model, ctx);

			const decisionControl = cardFor(container, "M1").querySelector<HTMLElement>(
				".hashi-proposed-moc-decision",
			);
			decisionControl?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

			expect(ctx.apply).toHaveBeenCalledTimes(1);
			const transform = firstAppliedTransform(ctx.apply);
			const result = transform(model);
			expect(result.doc.proposed_mocs.find((m) => m.id === "M1")?.decision).toBe("approve");
		});
	});

	describe("tags", () => {
		it("opens a TagPicker and adds the chosen tag to that MOC's tags without touching a transforms file", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			const model = seededModel();
			const ctx = makeCtx();
			tab.render(container, model, ctx);

			const addTagBtn = cardFor(container, "M2").querySelector<HTMLElement>(".hashi-proposed-moc-add-tag");
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

			const addTagBtn = cardFor(container, "M1").querySelector<HTMLElement>(".hashi-proposed-moc-add-tag");
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

			const addTagBtn = cardFor(container, "M1").querySelector<HTMLElement>(".hashi-proposed-moc-add-tag");
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

	describe("merge same-name siblings", () => {
		it("dispatches mergeSameNameProposedMocs via ctx.apply, collapsing the duplicate", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			const model = seededModel();
			const ctx = makeCtx();
			tab.render(container, model, ctx);

			const mergeBtn = cardFor(container, "M1").querySelector<HTMLElement>(".hashi-proposed-moc-merge");
			mergeBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

			expect(ctx.apply).toHaveBeenCalledTimes(1);
			const transform = firstAppliedTransform(ctx.apply);
			const result = transform(model);

			expect(result.doc.proposed_mocs).toHaveLength(2);
			const merged = result.doc.proposed_mocs.find((m) => m.id === "M1");
			expect(merged?.member_ids).toEqual(expect.arrayContaining(["S1", "S99", "S2"]));
			expect(result.doc.proposed_mocs.find((m) => m.id === "M2")).toBeUndefined();
		});

		it("does not render a Merge control at all when no sibling shares the name (M3)", () => {
			const tab = new ProposedMocsTab();
			const container = document.createElement("div");
			tab.render(container, seededModel(), makeCtx());

			expect(cardFor(container, "M3").querySelector(".hashi-proposed-moc-merge")).toBeNull();
		});
	});
});
