/**
 * Unit tests for InstructionFixerView — spec-006 Phase 3, T3.1 (the view
 * shell): identity/registration, setState-docPath handoff, load/empty/error
 * states, the gate-derived section grouping + no-trusted-signal banner, the
 * card-render seam T3.2 plugs into, and the Save affordance with the
 * garden-audit reference-identity race guard.
 *
 * Per-kind card BODIES are NOT exercised here — that is T3.2
 * (test/unit/ui/instruction-fixer/cards/*).
 */

import "obsidian";
import { App, WorkspaceLeaf } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { ActionOutcome } from "../../../../src/executor/state";
import {
	InstructionSetSaveError,
	ObsidianInstructionSetDoc,
} from "../../../../src/instruction-fixer/ObsidianInstructionSetDoc";
import type { Action, InstructionSet } from "../../../../src/schema/types";
import type {
	FixerCardContext,
	FixerCardRenderer,
} from "../../../../src/ui/instruction-fixer/fixerContract";
import { VIEW_TYPE_INSTRUCTION_FIXER } from "../../../../src/ui/instruction-fixer/index";
import { InstructionFixerView } from "../../../../src/ui/instruction-fixer/InstructionFixerView";
import {
	NO_TRUSTED_SIGNAL,
	type OutcomeResolution,
} from "../../../../src/ui/instruction-fixer/outcomeSource";
import { FakeVaultFS } from "../../../../src/vault/FakeVaultFS";
import type {
	InstructionFixerModel,
	InstructionSetDoc,
} from "../../../../src/vault/InstructionSetDoc";

// --- ConfirmModal mock -------------------------------------------------------
// Mirrors GardenAuditEditorView.test.ts exactly: the real ConfirmModal is a
// thin Obsidian Modal wrapper with its own unit tests — here we only observe
// THAT the view constructs one.

const confirmModalInstances: Array<{ title: string; message: string }> = [];

vi.mock("../../../../src/ui/ConfirmModal", () => ({
	ConfirmModal: vi.fn(function ConfirmModal(
		_app: unknown,
		title: string,
		message: string,
		_onConfirm: () => Promise<void>,
	) {
		const instance = { title, message, open: vi.fn() };
		confirmModalInstances.push(instance);
		return instance;
	}),
}));

// --- fixtures ----------------------------------------------------------------

const DOC_PATH = "100 Inbox/2026-07-20_1015_instructions.json";

const I07: Action = {
	id: "I07",
	action: "link_to_moc",
	target_moc: "Systems (MOC)",
	target_moc_path: "Atlas/200 Maps/Systems (MOC).md",
	anchor: { type: "heading", value: "Tools" },
	placement: "after",
	line_to_add: "- [[Kanban]]",
	source_note_title: "Kanban",
	applied: false,
};

const I09: Action = {
	id: "I09",
	action: "edit_note_text",
	path: "Atlas/202 Notes/Existing.md",
	match: "[[Missing Note]]",
	replace: "",
	occurrence: "first",
	applied: true,
};

const I12: Action = {
	id: "I12",
	action: "move_note",
	source: "100 Inbox/Kanban.md",
	destination: "Atlas/202 Notes/Kanban.md",
	title: "Kanban",
	applied: false,
};

function makeSet(actions: readonly Action[] = [I07, I09, I12]): InstructionSet {
	return {
		schema_version: "2",
		type: "tomo-instructions",
		generated: "2026-07-20T10:15:00Z",
		profile: "default",
		action_count: actions.length,
		actions,
	};
}

/** The same set as `makeSet()` but without `action_count` — seeded into a
 * FakeVaultFS for the tests that drive the REAL adapter, where an edit changes
 * the action count and a stale `action_count` would muddy what is under test. */
function makeWireSet(): InstructionSet {
	const { action_count: _omitted, ...rest } = makeSet();
	return rest;
}

/** A trusted resolution matching the SDD's traced example: I07 failed, I09
 * applied, I12 never reached (absent → read-only-no-signal). */
function tracedOutcomes(): ReadonlyMap<string, ActionOutcome> {
	return new Map<string, ActionOutcome>([
		["I07", { kind: "failed", reason: "anchor not found: ## Tools" }],
		["I09", { kind: "applied" }],
	]);
}

// --- adapters / seams --------------------------------------------------------

interface SpyAdapter extends InstructionSetDoc {
	load: Mock<(docPath: string) => Promise<{ doc: InstructionSet; dirty: false }>>;
	save: Mock<(model: InstructionFixerModel) => Promise<void>>;
}

function makeSpyAdapter(set: InstructionSet = makeSet()): SpyAdapter {
	return {
		load: vi.fn<(docPath: string) => Promise<{ doc: InstructionSet; dirty: false }>>(
			async () => ({ doc: set, dirty: false }),
		),
		save: vi.fn<(model: InstructionFixerModel) => Promise<void>>(async () => {}),
	};
}

function makeFailingAdapter(error: Error): SpyAdapter {
	const adapter = makeSpyAdapter();
	adapter.load.mockImplementation(async () => {
		throw error;
	});
	return adapter;
}

interface ViewOptions {
	readonly docPath?: string;
	readonly outcomes?: OutcomeResolution;
	readonly resolveOutcomes?: (
		set: InstructionSet,
		docPath: string,
	) => Promise<OutcomeResolution>;
	readonly card?: FixerCardRenderer;
	readonly rerun?: () => Promise<void>;
}

function makeView(adapter: InstructionSetDoc, options: ViewOptions = {}): InstructionFixerView {
	const leaf = new WorkspaceLeaf();
	const view = new InstructionFixerView(leaf, {
		adapter,
		docPath: options.docPath ?? DOC_PATH,
		resolveOutcomes:
			options.resolveOutcomes ??
			(async () => options.outcomes ?? tracedOutcomes()),
		card: options.card,
		rerun: options.rerun,
	});
	view.app = new App();
	return view;
}

/** Records what the view hands the card seam, per action id. */
interface RecordingCard extends FixerCardRenderer {
	readonly calls: Array<{ id: string; body: HTMLElement; ctx: FixerCardContext }>;
}

function makeRecordingCard(): RecordingCard {
	const calls: Array<{ id: string; body: HTMLElement; ctx: FixerCardContext }> = [];
	return {
		calls,
		render(body, action, ctx) {
			calls.push({ id: action.id, body, ctx });
		},
	};
}

/** A card seam whose body renders one button; clicking it commits a dirtying
 * transform through `ctx.apply` — exercises Save/dirty wiring without the real
 * per-kind cards (T3.2). Mirrors GardenAuditEditorView.test.ts's DIRTYING_TAB. */
function makeDirtyingCard(
	transform: (model: InstructionFixerModel) => InstructionFixerModel = (m) => ({
		doc: m.doc,
		dirty: true,
	}),
): FixerCardRenderer {
	return {
		render(body, action, ctx) {
			const btn = body.createEl("button", { text: `dirty ${action.id}` });
			btn.addEventListener("click", () => {
				ctx.apply(transform);
			});
		},
	};
}

// --- DOM helpers -------------------------------------------------------------

function leafMeta(view: InstructionFixerView): string | null {
	return view.contentEl.querySelector(".hashi-se-leaf-meta")?.textContent ?? null;
}

function leafActions(view: InstructionFixerView): HTMLElement | null {
	return view.contentEl.querySelector(".hashi-se-leaf-actions");
}

function bodyEl(view: InstructionFixerView): HTMLElement | null {
	return view.contentEl.querySelector(".hashi-se-body");
}

function bodyText(view: InstructionFixerView): string {
	return view.contentEl.textContent ?? "";
}

function dirtyBadge(view: InstructionFixerView): HTMLElement | null {
	return view.contentEl.querySelector(".hashi-se-dirty");
}

function findActionButton(view: InstructionFixerView, text: string): HTMLButtonElement {
	const btn = Array.from(leafActions(view)?.querySelectorAll("button") ?? []).find(
		(b) => b.textContent === text,
	);
	if (btn === undefined) throw new Error(`no action button with text "${text}"`);
	return btn as HTMLButtonElement;
}

function groups(view: InstructionFixerView): Array<{ label: string; count: string; ids: string[] }> {
	return Array.from(view.contentEl.querySelectorAll(".hashi-if-group")).map((group) => ({
		label: group.querySelector(".hashi-if-group-label")?.textContent ?? "",
		count: group.querySelector(".hashi-if-group-count")?.textContent ?? "",
		ids: Array.from(group.querySelectorAll(".hashi-if-card-id")).map(
			(el) => el.textContent ?? "",
		),
	}));
}

function cardEl(view: InstructionFixerView, id: string): HTMLElement | null {
	return view.contentEl.querySelector(`.hashi-if-card[data-action-id="${id}"]`);
}

function clickBodyButton(view: InstructionFixerView, text: string): void {
	const btn = Array.from(bodyEl(view)?.querySelectorAll("button") ?? []).find(
		(b) => b.textContent === text,
	);
	if (btn === undefined) throw new Error(`no body button with text "${text}"`);
	btn.click();
}

/** Waits enough ticks for a fire-and-forget async click handler to settle. */
async function flushAsyncHandler(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// --- tests -------------------------------------------------------------------

describe("InstructionFixerView — identity", () => {
	it("getViewType() returns VIEW_TYPE_INSTRUCTION_FIXER", () => {
		expect(makeView(makeSpyAdapter()).getViewType()).toBe(VIEW_TYPE_INSTRUCTION_FIXER);
	});

	it("getDisplayText() is 'Instruction fixer' (sentence case) and getIcon() is 'wrench'", () => {
		const view = makeView(makeSpyAdapter());
		expect(view.getDisplayText()).toBe("Instruction fixer");
		expect(view.getIcon()).toBe("wrench");
	});
});

describe("InstructionFixerView — onOpen with no docPath", () => {
	it("renders the 'open a set first' placeholder without calling adapter.load", async () => {
		const adapter = makeSpyAdapter();
		const view = makeView(adapter, { docPath: "" });

		await view.onOpen();

		expect(bodyText(view)).toContain("Open a Tomo _instructions.json (or its .md) first.");
		expect(adapter.load).not.toHaveBeenCalled();
	});
});

describe("InstructionFixerView — onOpen with a docPath", () => {
	it("loads via the adapter and renders the leaf-head meta line", async () => {
		const adapter = makeSpyAdapter();
		const view = makeView(adapter);

		await view.onOpen();

		expect(adapter.load).toHaveBeenCalledWith(DOC_PATH);
		expect(leafMeta(view)).toBe("profile default · 3 actions");
	});

	it("resolves outcomes for the loaded set at its docPath", async () => {
		const resolveOutcomes =
			vi.fn<(set: InstructionSet, docPath: string) => Promise<OutcomeResolution>>(
				async () => tracedOutcomes(),
			);
		const set = makeSet();
		const view = makeView(makeSpyAdapter(set), { resolveOutcomes });

		await view.onOpen();

		expect(resolveOutcomes).toHaveBeenCalledWith(set, DOC_PATH);
	});

	it("renders a load error and does NOT enter an editable state (no leaf-actions)", async () => {
		const view = makeView(makeFailingAdapter(new Error("schema version mismatch")));

		await view.onOpen();

		expect(bodyText(view)).toContain(
			"Couldn't load instruction set: schema version mismatch",
		);
		expect(leafActions(view)).toBeNull();
	});

	it("falls closed to read-only when outcome resolution itself throws", async () => {
		const view = makeView(makeSpyAdapter(), {
			resolveOutcomes: async () => {
				throw new Error("run-log folder unreadable");
			},
		});

		await view.onOpen();

		expect(bodyText(view)).toContain("No trusted outcome for this set.");
		expect(groups(view).map((g) => g.label)).toEqual(["All actions"]);
	});

	it("renders an empty state when the set has zero actions", async () => {
		const view = makeView(makeSpyAdapter(makeSet([])));

		await view.onOpen();

		expect(bodyEl(view)?.querySelector(".hashi-se-empty")?.textContent).toBe(
			"No actions in this instruction set.",
		);
		// leaf-head chrome still renders — only the body swaps to the empty state.
		expect(leafActions(view)).not.toBeNull();
	});
});

describe("InstructionFixerView — setState docPath handoff", () => {
	it("re-loads and re-renders when retargeted to a different docPath after onOpen", async () => {
		const adapter = makeSpyAdapter();
		const view = makeView(adapter);
		await view.onOpen();
		adapter.load.mockClear();

		const otherPath = "100 Inbox/2026-07-21_0900_instructions.json";
		await view.setState({ docPath: otherPath }, { history: false });

		expect(adapter.load).toHaveBeenCalledWith(otherPath);
		expect(view.getState()).toEqual({ docPath: otherPath });
	});

	it("records the docPath without rendering when setState precedes onOpen", async () => {
		const adapter = makeSpyAdapter();
		const view = makeView(adapter, { docPath: "" });

		await view.setState({ docPath: DOC_PATH }, { history: false });
		expect(adapter.load).not.toHaveBeenCalled();

		await view.onOpen();
		expect(adapter.load).toHaveBeenCalledWith(DOC_PATH);
	});

	it("tolerates malformed setState input without throwing or losing the docPath", async () => {
		const view = makeView(makeSpyAdapter());
		await view.onOpen();

		await expect(view.setState(null, { history: false })).resolves.toBeUndefined();
		await expect(view.setState("not an object", { history: false })).resolves.toBeUndefined();
		await expect(view.setState({ docPath: 123 }, { history: false })).resolves.toBeUndefined();

		expect(view.getState()).toEqual({ docPath: DOC_PATH });
	});
});

describe("InstructionFixerView — gate-derived section grouping", () => {
	it("groups by the edit gate, failed-first: Needs repair / Applied / Not attempted", async () => {
		const view = makeView(makeSpyAdapter());

		await view.onOpen();

		expect(groups(view)).toEqual([
			{ label: "Needs repair", count: "1", ids: ["I07 · link_to_moc"] },
			{ label: "Applied", count: "1", ids: ["I09 · edit_note_text"] },
			{ label: "Not attempted", count: "1", ids: ["I12 · move_note"] },
		]);
	});

	it("omits a group that has no actions in it", async () => {
		const view = makeView(makeSpyAdapter(makeSet([I07])));

		await view.onOpen();

		expect(groups(view).map((g) => g.label)).toEqual(["Needs repair"]);
	});

	it("shows each card's outcome badge and the failure reason verbatim", async () => {
		const view = makeView(makeSpyAdapter());

		await view.onOpen();

		expect(cardEl(view, "I07")?.querySelector(".hashi-if-badge")?.textContent).toBe("failed");
		expect(cardEl(view, "I07")?.querySelector(".hashi-if-card-reason")?.textContent).toContain(
			"anchor not found: ## Tools",
		);
		expect(cardEl(view, "I09")?.querySelector(".hashi-if-badge")?.textContent).toBe("applied");
		expect(cardEl(view, "I12")?.querySelector(".hashi-if-badge")?.textContent).toBe("—");
	});

	it("marks a frozen-applied card and a read-only card with their state tag", async () => {
		const view = makeView(makeSpyAdapter());

		await view.onOpen();

		expect(cardEl(view, "I09")?.querySelector(".hashi-if-card-tag")?.textContent).toBe("frozen");
		expect(cardEl(view, "I12")?.querySelector(".hashi-if-card-tag")?.textContent).toBe(
			"read-only",
		);
		expect(cardEl(view, "I07")?.querySelector(".hashi-if-card-tag")).toBeNull();
	});

	it("derives each card's gate from its OWN applied flag (never a sibling's)", async () => {
		// I07 and I09 both sit in a trusted `failed` map; only I09 carries
		// applied:true, so only I09 may freeze.
		const outcomes = new Map<string, ActionOutcome>([
			["I07", { kind: "failed", reason: "boom" }],
			["I09", { kind: "failed", reason: "boom" }],
		]);
		const card = makeRecordingCard();
		const view = makeView(makeSpyAdapter(makeSet([I07, I09])), { outcomes, card });

		await view.onOpen();

		expect(card.calls.map((c) => [c.id, c.ctx.gate])).toEqual([
			["I07", "editable"],
			["I09", "frozen-applied"],
		]);
	});
});

describe("InstructionFixerView — no-trusted-signal state", () => {
	it("renders the banner once (not per card) and one read-only 'All actions' group", async () => {
		const view = makeView(makeSpyAdapter(), { outcomes: NO_TRUSTED_SIGNAL });

		await view.onOpen();

		const banners = view.contentEl.querySelectorAll(".hashi-if-banner");
		expect(banners).toHaveLength(1);
		expect(banners[0]?.textContent).toContain("No trusted outcome for this set.");
		expect(groups(view)).toEqual([
			{
				label: "All actions",
				count: "3",
				ids: ["I07 · link_to_moc", "I09 · edit_note_text", "I12 · move_note"],
			},
		]);
		expect(
			view.contentEl.querySelector(".hashi-if-group-tag")?.textContent,
		).toBe("read-only");
	});

	it("still renders every card (viewing is unrestricted) but none editable", async () => {
		const card = makeRecordingCard();
		const view = makeView(makeSpyAdapter(), { outcomes: NO_TRUSTED_SIGNAL, card });

		await view.onOpen();

		expect(card.calls.map((c) => c.id)).toEqual(["I07", "I09", "I12"]);
		expect(card.calls.every((c) => c.ctx.gate !== "editable")).toBe(true);
	});

	it("the banner's Run button delegates to the injected re-run seam", async () => {
		const rerun = vi.fn(async () => {});
		const view = makeView(makeSpyAdapter(), { outcomes: NO_TRUSTED_SIGNAL, rerun });

		await view.onOpen();
		const runBtn = Array.from(
			view.contentEl.querySelectorAll<HTMLButtonElement>(".hashi-if-banner button"),
		)[0];
		expect(runBtn?.disabled).toBe(false);
		runBtn?.click();
		await flushAsyncHandler();

		expect(rerun).toHaveBeenCalledTimes(1);
	});

	it("disables Run and Re-run when no re-run seam is wired (T3.3 not landed)", async () => {
		const view = makeView(makeSpyAdapter(), { outcomes: NO_TRUSTED_SIGNAL });

		await view.onOpen();

		const runBtn = view.contentEl.querySelector<HTMLButtonElement>(".hashi-if-banner button");
		expect(runBtn?.disabled).toBe(true);
		expect(findActionButton(view, "Re-run").disabled).toBe(true);
	});
});

describe("InstructionFixerView — card render seam (T3.2 contract)", () => {
	it("renders one card body per action, in wire order within its group", async () => {
		const card = makeRecordingCard();
		const view = makeView(makeSpyAdapter(), { card });

		await view.onOpen();

		expect(card.calls.map((c) => c.id)).toEqual(["I07", "I09", "I12"]);
		for (const call of card.calls) {
			expect(call.body.classList.contains("hashi-if-card-body")).toBe(true);
			expect(call.body.closest(".hashi-if-card")).not.toBeNull();
		}
	});

	it("hands each card its own outcome plus app and a dispatching apply()", async () => {
		const card = makeRecordingCard();
		const view = makeView(makeSpyAdapter(), { card });

		await view.onOpen();

		const i07 = card.calls.find((c) => c.id === "I07");
		expect(i07?.ctx.outcome).toEqual({ kind: "failed", reason: "anchor not found: ## Tools" });
		expect(card.calls.find((c) => c.id === "I12")?.ctx.outcome).toBeNull();
		expect(i07?.ctx.app).toBe(view.app);
		expect(typeof i07?.ctx.apply).toBe("function");
	});

	it("an apply() from a card dirties the model and re-renders", async () => {
		const view = makeView(makeSpyAdapter(), { card: makeDirtyingCard() });
		await view.onOpen();
		expect(dirtyBadge(view)).toBeNull();

		clickBodyButton(view, "dirty I07");

		expect(dirtyBadge(view)?.textContent).toContain("Edited");
		expect(findActionButton(view, "Save").disabled).toBe(false);
	});
});

describe("InstructionFixerView — Save affordance", () => {
	it("Save is disabled and no dirty badge shows on a clean freshly-loaded set", async () => {
		const view = makeView(makeSpyAdapter());

		await view.onOpen();

		expect(findActionButton(view, "Save").disabled).toBe(true);
		expect(dirtyBadge(view)).toBeNull();
	});

	it("Save writes the current model through the adapter and clears dirty", async () => {
		const adapter = makeSpyAdapter();
		const view = makeView(adapter, { card: makeDirtyingCard() });
		await view.onOpen();
		clickBodyButton(view, "dirty I07");

		findActionButton(view, "Save").click();
		await flushAsyncHandler();

		expect(adapter.save).toHaveBeenCalledTimes(1);
		expect(adapter.save.mock.calls[0]?.[0]).toEqual({ doc: makeSet(), dirty: true });
		expect(dirtyBadge(view)).toBeNull();
		expect(findActionButton(view, "Save").disabled).toBe(true);
	});

	it("a rejection carrying no landed-count is reported as genuinely unknown, edit pending", async () => {
		const adapter = makeSpyAdapter();
		adapter.save.mockImplementation(async () => {
			throw new Error("disk full");
		});
		const view = makeView(adapter, { card: makeDirtyingCard() });
		await view.onOpen();
		clickBodyButton(view, "dirty I07");

		findActionButton(view, "Save").click();
		await flushAsyncHandler();

		const panel = view.contentEl.querySelector(".hashi-if-save-error");
		expect(panel?.textContent).toContain("disk full");
		expect(panel?.textContent).toContain("couldn't tell how much of this save was written");
		// Neither of the two confident claims may be made on an untagged error.
		expect(panel?.textContent).not.toContain("Nothing was written");
		expect(dirtyBadge(view)).not.toBeNull();
		expect(findActionButton(view, "Save").disabled).toBe(false);
	});

	it("a schema-invalid edit is rejected before any write, with the validator message", async () => {
		const adapter = makeSpyAdapter();
		const view = makeView(adapter, {
			// Drops a required field off I07 — the whole document no longer
			// validates, so nothing may be written (PRD F4-AC2).
			card: makeDirtyingCard((m) => ({
				doc: {
					...m.doc,
					actions: m.doc.actions.map((a) =>
						a.id === "I07"
							? ({ ...a, anchor: undefined } as unknown as Action)
							: a,
					),
				},
				dirty: true,
			})),
		});
		await view.onOpen();
		clickBodyButton(view, "dirty I07");

		findActionButton(view, "Save").click();
		await flushAsyncHandler();

		expect(adapter.save).not.toHaveBeenCalled();
		const panel = view.contentEl.querySelector(".hashi-if-save-error");
		expect(panel?.textContent).toContain("Save failed");
		expect(panel?.textContent).toContain("Nothing was written");
		expect(panel?.textContent).not.toContain("Some actions may already have been written");
		// The edit stays pending — the user's work is never discarded.
		expect(dirtyBadge(view)).not.toBeNull();
		expect(findActionButton(view, "Save").disabled).toBe(false);
	});

	it("a structural edit reports that nothing was written (never invites a pointless retry)", async () => {
		// Through the REAL adapter: a schema-VALID edit the per-action patch
		// path still cannot express rejects in derivePatches, before the write
		// loop. Nothing landed, so "save again to finish" would be a lie — and
		// retrying cannot fix it. The view must read that off the adapter's
		// error rather than re-deriving the invariant (T3.1 review).
		const vault = new FakeVaultFS();
		await vault.create(DOC_PATH, `${JSON.stringify(makeWireSet(), null, 2)}\n`);
		const view = makeView(new ObsidianInstructionSetDoc(vault, vi.fn()), {
			card: makeDirtyingCard((m) => ({
				doc: { ...m.doc, actions: m.doc.actions.slice(0, 2) },
				dirty: true,
			})),
		});
		await view.onOpen();
		clickBodyButton(view, "dirty I07");

		findActionButton(view, "Save").click();
		await flushAsyncHandler();

		const panel = view.contentEl.querySelector(".hashi-if-save-error");
		expect(panel?.textContent).toContain("unsupported edit");
		expect(panel?.textContent).toContain("Nothing was written");
		expect(panel?.textContent).not.toContain("may already have been written");
		expect(dirtyBadge(view)).not.toBeNull();
	});

	it("a mid-loop write failure reports how many patches landed", async () => {
		const adapter = makeSpyAdapter();
		adapter.save.mockImplementation(async () => {
			throw new InstructionSetSaveError("disk full on write 2", 1, 3);
		});
		const view = makeView(adapter, { card: makeDirtyingCard() });
		await view.onOpen();
		clickBodyButton(view, "dirty I07");

		findActionButton(view, "Save").click();
		await flushAsyncHandler();

		const panel = view.contentEl.querySelector(".hashi-if-save-error");
		expect(panel?.textContent).toContain("disk full on write 2");
		expect(panel?.textContent).toContain("1 of 3");
		expect(panel?.textContent).toContain("save again to write the rest");
		expect(dirtyBadge(view)).not.toBeNull();
	});

	it("a later successful save clears the error panel", async () => {
		const adapter = makeSpyAdapter();
		adapter.save.mockImplementationOnce(async () => {
			throw new Error("disk full");
		});
		const view = makeView(adapter, { card: makeDirtyingCard() });
		await view.onOpen();
		clickBodyButton(view, "dirty I07");

		findActionButton(view, "Save").click();
		await flushAsyncHandler();
		expect(view.contentEl.querySelector(".hashi-if-save-error")).not.toBeNull();

		findActionButton(view, "Save").click();
		await flushAsyncHandler();

		expect(view.contentEl.querySelector(".hashi-if-save-error")).toBeNull();
		expect(dirtyBadge(view)).toBeNull();
	});

	it("Revert re-loads the set from the adapter, discarding in-memory edits", async () => {
		const adapter = makeSpyAdapter();
		const view = makeView(adapter, { card: makeDirtyingCard() });
		await view.onOpen();
		clickBodyButton(view, "dirty I07");
		expect(dirtyBadge(view)).not.toBeNull();

		findActionButton(view, "Revert").click();
		await flushAsyncHandler();

		expect(adapter.load).toHaveBeenCalledTimes(2);
		expect(adapter.load).toHaveBeenLastCalledWith(DOC_PATH);
		expect(dirtyBadge(view)).toBeNull();
	});
});

describe("InstructionFixerView — save/dirty race guard", () => {
	it("an edit that lands while a save is in flight is NOT silently marked clean", async () => {
		let resolveSave: () => void = () => {};
		const pendingSave = new Promise<void>((resolve) => {
			resolveSave = resolve;
		});
		const adapter = makeSpyAdapter();
		adapter.save.mockImplementation(() => pendingSave);
		const view = makeView(adapter, { card: makeDirtyingCard() });
		await view.onOpen();

		clickBodyButton(view, "dirty I07");
		expect(findActionButton(view, "Save").disabled).toBe(false);

		findActionButton(view, "Save").click();
		await Promise.resolve();
		expect(adapter.save).toHaveBeenCalledTimes(1);

		// The in-flight window disables both write affordances.
		expect(findActionButton(view, "Save").disabled).toBe(true);
		expect(findActionButton(view, "Revert").disabled).toBe(true);

		// A second, independent edit lands while the save is still pending.
		clickBodyButton(view, "dirty I07");

		resolveSave();
		await flushAsyncHandler();

		expect(findActionButton(view, "Revert").disabled).toBe(false);
		expect(dirtyBadge(view)?.textContent).toContain("Edited");
		expect(findActionButton(view, "Save").disabled).toBe(false);
	});

	it("a revert that lands while a save is in flight does not clear the reloaded store's state", async () => {
		let resolveSave: () => void = () => {};
		const pendingSave = new Promise<void>((resolve) => {
			resolveSave = resolve;
		});
		const adapter = makeSpyAdapter();
		adapter.save.mockImplementation(() => pendingSave);
		// The reload arrives already dirty — if the stale save cleared `dirty`
		// on the NEW store, this would flip clean and lose the reloaded state.
		adapter.load.mockImplementation(async () => ({ doc: makeSet(), dirty: false }));
		const view = makeView(adapter, { card: makeDirtyingCard() });
		await view.onOpen();
		clickBodyButton(view, "dirty I07");

		findActionButton(view, "Save").click();
		await Promise.resolve();

		// Revert lands mid-flight (the button is disabled in the UI, but the
		// same path runs on a setState retarget, which is not).
		await view.setState({ docPath: DOC_PATH }, { history: false });
		clickBodyButton(view, "dirty I07");

		resolveSave();
		await flushAsyncHandler();

		// The post-revert edit survives the stale save's completion.
		expect(dirtyBadge(view)).not.toBeNull();
	});
});

describe("InstructionFixerView — close while dirty", () => {
	beforeEach(() => {
		confirmModalInstances.length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("prompts a ConfirmModal when the model is dirty", async () => {
		const view = makeView(makeSpyAdapter(), { card: makeDirtyingCard() });
		await view.onOpen();
		clickBodyButton(view, "dirty I07");

		await view.onClose();

		expect(confirmModalInstances).toHaveLength(1);
		expect(confirmModalInstances[0]?.title).toBe("Unsaved changes");
		expect(confirmModalInstances[0]?.message).toContain("instruction set");
	});

	it("does NOT prompt when the model is clean", async () => {
		const view = makeView(makeSpyAdapter());
		await view.onOpen();

		await view.onClose();

		expect(confirmModalInstances).toHaveLength(0);
	});
});
