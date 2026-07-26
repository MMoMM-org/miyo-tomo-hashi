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
import { Store } from "../../../../src/util/store";
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
	readonly rerun?: (docPath: string) => Promise<void>;
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

function savePanel(view: InstructionFixerView): {
	head: string;
	hint: string;
	detail: string;
} | null {
	const panel = view.contentEl.querySelector(".hashi-if-save-error");
	if (panel === null) return null;
	return {
		head: panel.querySelector(".hashi-if-save-error-head")?.textContent ?? "",
		hint: panel.querySelector(".hashi-if-save-error-hint")?.textContent ?? "",
		detail: panel.querySelector(".hashi-if-save-error-detail")?.textContent ?? "",
	};
}

/** The re-run notice line (blocked or failed run), or null when there is none. */
function rerunNotice(view: InstructionFixerView): string | null {
	return view.contentEl.querySelector(".hashi-if-rerun-error")?.textContent ?? null;
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

	/** The banner offers Run and explains that outcomes are unknown until the
	 * set runs. Both halves are vacuous when every action is already applied —
	 * and that state is reachable from a SUCCESSFUL repair: `executionMode:
	 * "silent"` auto-idles the execution store, and `runLogRetention:
	 * "only-after-failed"` writes no log for a zero-failure run, so
	 * `resolveOutcomes` legitimately returns no signal right afterwards. */
	it("suppresses the banner when every action is already applied (nothing to run)", async () => {
		const applied = makeSet([
			{ ...I07, applied: true },
			I09,
			{ ...I12, applied: true },
		]);
		const view = makeView(makeSpyAdapter(applied), {
			outcomes: NO_TRUSTED_SIGNAL,
			rerun: async () => {},
		});

		await view.onOpen();

		expect(view.contentEl.querySelector(".hashi-if-banner")).toBeNull();
		// The sections are untouched — the gate still fails closed, every card
		// still renders, and each one still reads as applied-and-frozen.
		expect(groups(view)).toEqual([
			{
				label: "All actions",
				count: "3",
				ids: ["I07 · link_to_moc", "I09 · edit_note_text", "I12 · move_note"],
			},
		]);
		for (const id of ["I07", "I09", "I12"]) {
			expect(cardEl(view, id)?.querySelector(".hashi-if-card-tag")?.textContent).toBe(
				"frozen",
			);
			expect(cardEl(view, id)?.classList.contains("hashi-if-card--readonly")).toBe(true);
		}
	});

	it("still shows the banner when even ONE action is not yet applied", async () => {
		// The other direction: the offer is real as long as anything could run,
		// so suppression must not weaken the fail-closed no-signal state.
		const partly = makeSet([{ ...I07, applied: true }, I09, I12]);
		const view = makeView(makeSpyAdapter(partly), {
			outcomes: NO_TRUSTED_SIGNAL,
			rerun: async () => {},
		});

		await view.onOpen();

		expect(view.contentEl.querySelector(".hashi-if-banner")?.textContent).toContain(
			"No trusted outcome for this set.",
		);
		expect(groups(view).map((g) => g.label)).toEqual(["All actions"]);
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

	/** T3.2: the reason's TEXT stays the view's (one `outcomeReason`); only its
	 * placement moved into the body, which is the card's to lay out. */
	it("hands the card a ready-to-render failure reason and renders no copy of its own", async () => {
		const card = makeRecordingCard();
		const view = makeView(makeSpyAdapter(), { card });

		await view.onOpen();

		expect(card.calls.find((c) => c.id === "I07")?.ctx.reason).toBe(
			"anchor not found: ## Tools",
		);
		expect(card.calls.find((c) => c.id === "I09")?.ctx.reason).toBeNull();
		expect(cardEl(view, "I07")?.querySelector(".hashi-if-card-reason")).toBeNull();
	});

	it("renders the reason itself when no card renderer is wired (shell fallback)", async () => {
		const view = makeView(makeSpyAdapter());

		await view.onOpen();

		expect(
			cardEl(view, "I07")?.querySelector(".hashi-if-card-body .hashi-if-card-reason")
				?.textContent,
		).toBe("anchor not found: ## Tools");
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

		const panel = savePanel(view);
		expect(panel?.head).toBe("Couldn't confirm whether your repairs were saved.");
		expect(panel?.detail).toContain("disk full");
		// Neither confident claim may be made on an untagged error.
		expect(panel?.head).not.toContain("nothing was written");
		expect(panel?.hint).not.toContain("partly repaired");
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
		const panel = savePanel(view);
		expect(panel?.head).toBe("Couldn't save your repairs — nothing was written.");
		expect(panel?.hint).toContain("The set on disk is unchanged");
		// The validator's own message survives, as the de-emphasised detail line.
		expect(panel?.detail).not.toBe("");
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

		const panel = savePanel(view);
		expect(panel?.head).toBe("Couldn't save your repairs — nothing was written.");
		expect(panel?.hint).not.toContain("write the rest");
		expect(panel?.detail).toContain("unsupported edit");
		// The headline and the recovery instruction stay free of internals the
		// reader cannot act on; only the detail line carries the raw diagnostic.
		for (const jargon of ["ObsidianInstructionSetDoc", "ADR-9", "field patches"]) {
			expect(panel?.head).not.toContain(jargon);
			expect(panel?.hint).not.toContain(jargon);
		}
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

		const panel = savePanel(view);
		expect(panel?.head).toBe("Wrote 1 of 3 repairs, then hit a problem.");
		expect(panel?.hint).toContain("save again to write the rest");
		expect(panel?.detail).toBe("disk full on write 2");
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

	it("a save that FAILS after a retarget does not blame the newly-loaded document", async () => {
		// The mirror image of the success-path guard: `setState` (re-invoking the
		// opener on another set) is not gated by `saving` the way Revert is, so a
		// stale save can reject after the leaf already shows a different, clean
		// document. Its error belongs to the model that was being written — never
		// to the one now on screen.
		let rejectSave: (err: Error) => void = () => {};
		const pendingSave = new Promise<void>((_resolve, reject) => {
			rejectSave = reject;
		});
		const adapter = makeSpyAdapter();
		adapter.save.mockImplementation(() => pendingSave);
		const view = makeView(adapter, { card: makeDirtyingCard() });
		await view.onOpen();
		clickBodyButton(view, "dirty I07");

		findActionButton(view, "Save").click();
		await Promise.resolve();
		expect(adapter.save).toHaveBeenCalledTimes(1);

		const otherPath = "100 Inbox/2026-07-21_0900_instructions.json";
		await view.setState({ docPath: otherPath }, { history: false });

		rejectSave(new Error("disk full"));
		await flushAsyncHandler();

		expect(view.contentEl.querySelector(".hashi-if-save-error")).toBeNull();
		expect(view.getState()).toEqual({ docPath: otherPath });
		// The freshly-loaded document is clean and fully usable.
		expect(dirtyBadge(view)).toBeNull();
		expect(findActionButton(view, "Save").disabled).toBe(true);
		expect(findActionButton(view, "Revert").disabled).toBe(false);
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

describe("InstructionFixerView — re-run bridge (T3.3)", () => {
	it("hands the bridge the loaded set's docPath", async () => {
		const rerun = vi.fn<(docPath: string) => Promise<void>>(async () => {});
		const view = makeView(makeSpyAdapter(), { rerun });
		await view.onOpen();

		findActionButton(view, "Re-run").click();
		await flushAsyncHandler();

		expect(rerun).toHaveBeenCalledWith(DOC_PATH);
	});

	it("the no-signal banner's Run uses the same bridge and docPath", async () => {
		const rerun = vi.fn<(docPath: string) => Promise<void>>(async () => {});
		const view = makeView(makeSpyAdapter(), { outcomes: NO_TRUSTED_SIGNAL, rerun });
		await view.onOpen();

		view.contentEl.querySelector<HTMLButtonElement>(".hashi-if-banner button")?.click();
		await flushAsyncHandler();

		expect(rerun).toHaveBeenCalledWith(DOC_PATH);
	});

	it("reloads the set through the adapter once the run completes", async () => {
		// The run rewrites the very file this leaf holds open (applied-flag
		// flush), so the in-memory model AND the adapter's save baseline are
		// both stale the moment it finishes. Reloading is the reconciliation.
		const adapter = makeSpyAdapter();
		const view = makeView(adapter, { rerun: async () => {} });
		await view.onOpen();
		expect(adapter.load).toHaveBeenCalledTimes(1);

		findActionButton(view, "Re-run").click();
		await flushAsyncHandler();

		expect(adapter.load).toHaveBeenCalledTimes(2);
		expect(adapter.load).toHaveBeenLastCalledWith(DOC_PATH);
	});

	it("refreshes outcomes in place — a now-applied action moves to Applied and freezes", async () => {
		let ran = false;
		const adapter = makeSpyAdapter();
		adapter.load.mockImplementation(async () => ({
			doc: ran ? makeSet([{ ...I07, applied: true }, I09, I12]) : makeSet(),
			dirty: false,
		}));
		const view = makeView(adapter, {
			resolveOutcomes: async () =>
				ran
					? new Map<string, ActionOutcome>([
							["I07", { kind: "applied" }],
							["I09", { kind: "applied" }],
						])
					: tracedOutcomes(),
			rerun: async () => {
				ran = true;
			},
		});
		await view.onOpen();
		expect(groups(view).map((g) => g.label)).toEqual([
			"Needs repair",
			"Applied",
			"Not attempted",
		]);

		findActionButton(view, "Re-run").click();
		await flushAsyncHandler();

		expect(groups(view)).toEqual([
			{
				label: "Applied",
				count: "2",
				ids: ["I07 · link_to_moc", "I09 · edit_note_text"],
			},
			{ label: "Not attempted", count: "1", ids: ["I12 · move_note"] },
		]);
		expect(cardEl(view, "I07")?.querySelector(".hashi-if-badge")?.textContent).toBe("applied");
		expect(cardEl(view, "I07")?.querySelector(".hashi-if-card-tag")?.textContent).toBe("frozen");
	});

	it("refuses to run with unsaved repairs and keeps the edit pending", async () => {
		// The executor reads the set FROM DISK, so a dirty model's repairs would
		// not be in the run at all — and the post-run reload would then discard
		// them. Blocking is the only option that neither lies nor loses work.
		const rerun = vi.fn<(docPath: string) => Promise<void>>(async () => {});
		const adapter = makeSpyAdapter();
		const view = makeView(adapter, { card: makeDirtyingCard(), rerun });
		await view.onOpen();
		clickBodyButton(view, "dirty I07");

		findActionButton(view, "Re-run").click();
		await flushAsyncHandler();

		expect(rerun).not.toHaveBeenCalled();
		expect(rerunNotice(view)).toContain("Save your repairs before re-running");
		expect(adapter.load).toHaveBeenCalledTimes(1);
		expect(dirtyBadge(view)).not.toBeNull();
		expect(findActionButton(view, "Save").disabled).toBe(false);
	});

	it("runs once the pending repairs are saved, clearing the blocked notice", async () => {
		const rerun = vi.fn<(docPath: string) => Promise<void>>(async () => {});
		const view = makeView(makeSpyAdapter(), { card: makeDirtyingCard(), rerun });
		await view.onOpen();
		clickBodyButton(view, "dirty I07");
		findActionButton(view, "Re-run").click();
		await flushAsyncHandler();
		expect(rerunNotice(view)).not.toBeNull();

		findActionButton(view, "Save").click();
		await flushAsyncHandler();
		// Saving answers the block, so the notice must not outlive that press.
		expect(rerunNotice(view)).toBeNull();

		findActionButton(view, "Re-run").click();
		await flushAsyncHandler();

		expect(rerun).toHaveBeenCalledWith(DOC_PATH);
		expect(rerunNotice(view)).toBeNull();
	});

	it("surfaces a failed run AND still refreshes the document from disk", async () => {
		// A rejected run is not a promise that nothing landed, so the failure
		// path reloads too — and the failure rides along INTO the refreshed
		// state rather than replacing it.
		const adapter = makeSpyAdapter();
		const view = makeView(adapter, {
			rerun: async () => {
				throw new Error("Execution already in progress");
			},
		});
		await view.onOpen();

		findActionButton(view, "Re-run").click();
		await flushAsyncHandler();

		expect(rerunNotice(view)).toContain("Execution already in progress");
		expect(adapter.load).toHaveBeenCalledTimes(2);
		expect(adapter.load).toHaveBeenLastCalledWith(DOC_PATH);
		expect(findActionButton(view, "Re-run").disabled).toBe(false);
		expect(groups(view).map((g) => g.label)).toEqual([
			"Needs repair",
			"Applied",
			"Not attempted",
		]);
	});

	it("the run failure survives the reload it triggers, and a later Revert clears it", async () => {
		const view = makeView(makeSpyAdapter(), {
			rerun: async () => {
				throw new Error("run aborted");
			},
		});
		await view.onOpen();
		findActionButton(view, "Re-run").click();
		await flushAsyncHandler();
		expect(rerunNotice(view)).toContain("run aborted");

		findActionButton(view, "Revert").click();
		await flushAsyncHandler();

		expect(rerunNotice(view)).toBeNull();
	});

	it("says BOTH why the run failed and why the reload failed", async () => {
		const adapter = makeSpyAdapter();
		adapter.load.mockImplementationOnce(async () => ({ doc: makeSet(), dirty: false }));
		adapter.load.mockImplementationOnce(async () => {
			throw new Error("invalid JSON — Unexpected token");
		});
		const view = makeView(adapter, {
			rerun: async () => {
				throw new Error("run aborted");
			},
		});
		await view.onOpen();

		findActionButton(view, "Re-run").click();
		await flushAsyncHandler();

		expect(rerunNotice(view)).toContain("run aborted");
		expect(bodyText(view)).toContain("Couldn't load instruction set: invalid JSON");
	});

	it("freezes Revert and Re-run while a run is in flight, then restores them", async () => {
		let resolveRun: () => void = () => {};
		const pending = new Promise<void>((resolve) => {
			resolveRun = resolve;
		});
		const view = makeView(makeSpyAdapter(), { rerun: () => pending });
		await view.onOpen();

		findActionButton(view, "Re-run").click();
		await Promise.resolve();
		expect(findActionButton(view, "Re-run").disabled).toBe(true);
		expect(findActionButton(view, "Revert").disabled).toBe(true);

		resolveRun();
		await flushAsyncHandler();

		expect(findActionButton(view, "Re-run").disabled).toBe(false);
		expect(findActionButton(view, "Revert").disabled).toBe(false);
	});

	it("refuses card edits while a run is in flight, so the reload discards nothing", async () => {
		// The whole document is frozen for the duration of the run: the executor
		// is rewriting the file, and the post-run reload replaces the model. An
		// edit accepted in that window would be silently thrown away.
		let resolveRun: () => void = () => {};
		const pending = new Promise<void>((resolve) => {
			resolveRun = resolve;
		});
		const view = makeView(makeSpyAdapter(), {
			card: makeDirtyingCard(),
			rerun: () => pending,
		});
		await view.onOpen();

		findActionButton(view, "Re-run").click();
		await Promise.resolve();
		clickBodyButton(view, "dirty I07");
		expect(dirtyBadge(view)).toBeNull();

		resolveRun();
		await flushAsyncHandler();

		expect(dirtyBadge(view)).toBeNull();
	});

	it("a run completing after a retarget does not reload the newly-loaded document", async () => {
		let resolveRun: () => void = () => {};
		const pending = new Promise<void>((resolve) => {
			resolveRun = resolve;
		});
		const adapter = makeSpyAdapter();
		const view = makeView(adapter, { rerun: () => pending });
		await view.onOpen();
		findActionButton(view, "Re-run").click();
		await Promise.resolve();

		const otherPath = "100 Inbox/2026-07-21_0900_instructions.json";
		await view.setState({ docPath: otherPath }, { history: false });
		expect(adapter.load).toHaveBeenCalledTimes(2);

		resolveRun();
		await flushAsyncHandler();

		// No third load: the stale run must not re-baseline a document it never ran.
		expect(adapter.load).toHaveBeenCalledTimes(2);
		expect(adapter.load).toHaveBeenLastCalledWith(otherPath);
		expect(view.getState()).toEqual({ docPath: otherPath });
		// The freshly-loaded document is clean and fully usable.
		expect(findActionButton(view, "Re-run").disabled).toBe(false);
		expect(findActionButton(view, "Revert").disabled).toBe(false);
		expect(dirtyBadge(view)).toBeNull();
	});

	it("a run that FAILS after a retarget does not blame the newly-loaded document", async () => {
		let rejectRun: (err: Error) => void = () => {};
		const pending = new Promise<void>((_resolve, reject) => {
			rejectRun = reject;
		});
		const adapter = makeSpyAdapter();
		const view = makeView(adapter, { rerun: () => pending });
		await view.onOpen();
		findActionButton(view, "Re-run").click();
		await Promise.resolve();

		const otherPath = "100 Inbox/2026-07-21_0900_instructions.json";
		await view.setState({ docPath: otherPath }, { history: false });

		rejectRun(new Error("run aborted"));
		await flushAsyncHandler();

		expect(rerunNotice(view)).toBeNull();
		expect(view.getState()).toEqual({ docPath: otherPath });
		expect(findActionButton(view, "Re-run").disabled).toBe(false);
	});

	it("a load failure during the post-run reload surfaces as a load error, not a crash", async () => {
		const adapter = makeSpyAdapter();
		adapter.load.mockImplementationOnce(async () => ({ doc: makeSet(), dirty: false }));
		adapter.load.mockImplementationOnce(async () => {
			throw new Error("invalid JSON — Unexpected token");
		});
		const view = makeView(adapter, { rerun: async () => {} });
		await view.onOpen();

		findActionButton(view, "Re-run").click();
		await flushAsyncHandler();

		expect(bodyText(view)).toContain("Couldn't load instruction set: invalid JSON");
	});
});

describe("InstructionFixerView — loadAndRender reentrancy guard", () => {
	const PATH_A = "100 Inbox/2026-07-21_0900_instructions.json";
	const PATH_B = "100 Inbox/2026-07-22_1100_instructions.json";

	/** Every unsubscribe function the view has been handed, in creation order,
	 * so a test can assert BOTH that no superseded load subscribed and that the
	 * one it replaced was torn down. */
	let unsubscribes: Array<Mock<() => void>> = [];

	function trackSubscriptions(): void {
		const real = Store.prototype.subscribe;
		vi.spyOn(Store.prototype, "subscribe").mockImplementation(function (
			this: Store<unknown>,
			listener: (value: unknown) => void,
		): () => void {
			const off = vi.fn(real.call(this, listener));
			unsubscribes.push(off);
			return off;
		});
	}

	/** An adapter whose loads hang until the test releases them by path. */
	function gatedAdapter(): {
		adapter: SpyAdapter;
		release: (docPath: string, actions: readonly Action[]) => void;
	} {
		const adapter = makeSpyAdapter();
		const gates = new Map<string, (actions: readonly Action[]) => void>();
		adapter.load.mockImplementation(
			(docPath: string) =>
				new Promise<{ doc: InstructionSet; dirty: false }>((resolve) => {
					gates.set(docPath, (actions) => {
						resolve({ doc: makeSet(actions), dirty: false });
					});
				}),
		);
		return {
			adapter,
			release: (docPath, actions) => {
				const gate = gates.get(docPath);
				if (gate === undefined) throw new Error(`no pending load for ${docPath}`);
				gate(actions);
			},
		};
	}

	beforeEach(() => {
		unsubscribes = [];
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("a superseded load renders no second head/body and installs no subscription", async () => {
		// Two retargets overlap over a gated load, and the FIRST one resolves
		// last. Without a per-call token it would createDiv a second head and a
		// second body onto a root it never emptied (the winner emptied only what
		// existed when it started) and overwrite `unsubscribe`, orphaning the
		// live subscription along with the DOM it renders into.
		trackSubscriptions();
		const { adapter, release } = gatedAdapter();
		const view = makeView(adapter);
		// The gate registers synchronously inside adapter.load, so the initial
		// load has to be in flight before it can be released.
		const opened = view.onOpen();
		release(DOC_PATH, [I07, I09, I12]);
		await opened;
		expect(unsubscribes).toHaveLength(1);

		const loadA = view.setState({ docPath: PATH_A }, { history: false });
		const loadB = view.setState({ docPath: PATH_B }, { history: false });
		release(PATH_B, [I07, I09]);
		await flushAsyncHandler();
		release(PATH_A, [I07]);
		await Promise.all([loadA, loadB]);
		await flushAsyncHandler();

		expect(view.contentEl.querySelectorAll(".hashi-se-leaf-head")).toHaveLength(1);
		expect(view.contentEl.querySelectorAll(".hashi-se-body")).toHaveLength(1);
		// The winner owns the leaf: its document, its state, its subscription.
		expect(view.getState()).toEqual({ docPath: PATH_B });
		expect(leafMeta(view)).toBe("profile default · 2 actions");
		// One subscription per load that finished — the superseded load made
		// none — and the one it replaced was torn down.
		expect(unsubscribes).toHaveLength(2);
		expect(unsubscribes[0]).toHaveBeenCalled();
		expect(unsubscribes[1]).not.toHaveBeenCalled();
	});

	it("a superseded load that FAILS does not render its error over the winner", async () => {
		const adapter = makeSpyAdapter();
		const gates = new Map<string, (err: Error) => void>();
		adapter.load.mockImplementationOnce(async () => ({ doc: makeSet(), dirty: false }));
		adapter.load.mockImplementation(
			(docPath: string) =>
				new Promise<{ doc: InstructionSet; dirty: false }>((resolve, reject) => {
					if (docPath === PATH_B) {
						resolve({ doc: makeSet([I07, I09]), dirty: false });
						return;
					}
					gates.set(docPath, reject);
				}),
		);
		const view = makeView(adapter);
		await view.onOpen();

		const loadA = view.setState({ docPath: PATH_A }, { history: false });
		const loadB = view.setState({ docPath: PATH_B }, { history: false });
		await flushAsyncHandler();
		gates.get(PATH_A)?.(new Error("invalid JSON — Unexpected token"));
		await Promise.all([loadA, loadB]);
		await flushAsyncHandler();

		expect(view.contentEl.querySelector(".hashi-se-error")).toBeNull();
		expect(bodyText(view)).not.toContain("Couldn't load instruction set");
		expect(leafMeta(view)).toBe("profile default · 2 actions");
		expect(view.contentEl.querySelectorAll(".hashi-se-body")).toHaveLength(1);
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
