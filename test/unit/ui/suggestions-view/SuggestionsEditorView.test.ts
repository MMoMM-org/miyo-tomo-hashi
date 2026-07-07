/**
 * Unit tests for SuggestionsEditorView — Phase-3 T3.1 leaf ItemView + tab
 * chrome + tab contract, plus the spec-004 follow-up Save/Revert affordance.
 *
 * Spec refs: spec-004 SDD §3 (ADR-S1); plan/phase-3.md T3.1; ADR-026
 * follow-up (Save affordance).
 *
 * Real Obsidian populates `View.app` after construction (WorkspaceLeaf wires
 * it before onOpen runs) — TomoChatView never needed `this.app`, so this is
 * the first view here that does. `makeView()` assigns `view.app` manually
 * right after construction to mirror that real-world wiring order (see the
 * obsidian mock's ItemView.app comment).
 */

import "obsidian";
import { App, WorkspaceLeaf } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	DEFAULT_SEED,
	FakeSuggestionsDoc,
} from "../../../__mocks__/FakeSuggestionsDoc";
import { SuggestionsStore } from "../../../../src/suggestions/store";
import type { EditModel } from "../../../../src/types/suggestions";
import { VIEW_TYPE_SUGGESTIONS_EDITOR } from "../../../../src/ui/suggestions-view/index";
import { SuggestionsEditorView } from "../../../../src/ui/suggestions-view/SuggestionsEditorView";
import type { EditorTab } from "../../../../src/ui/suggestions-view/tabContract";
import type { SuggestionsDoc } from "../../../../src/vault/SuggestionsDoc";

// --- ConfirmModal mock -------------------------------------------------------
//
// Mirrors TomoChatView.test.ts's `vi.mock(".../terminalHost", ...)` pattern:
// the real ConfirmModal is a thin Obsidian Modal wrapper already covered by
// its own unit tests (test/unit/ui/ConfirmModal.test.ts); here we only need
// to observe THAT the view constructs + opens one, with which title/message.

const confirmModalInstances: Array<{
	title: string;
	message: string;
	onConfirm: () => Promise<void>;
	open: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("../../../../src/ui/ConfirmModal", () => ({
	// Plain `function` (not an arrow) so `new ConfirmModal(...)` in the view
	// works: a constructor call that returns an object uses that object as
	// the instance, even without a `class`.
	ConfirmModal: vi.fn(function ConfirmModal(
		_app: unknown,
		title: string,
		message: string,
		onConfirm: () => Promise<void>,
	) {
		const instance = { title, message, onConfirm, open: vi.fn() };
		confirmModalInstances.push(instance);
		return instance;
	}),
}));

// --- factories ---------------------------------------------------------------

const DOC_PATH = "100 Inbox/2026-07-06_1115_suggestions.json";

/** Waits enough microtask ticks for a fire-and-forget async click handler
 * (`void this.handleSave()` / `void this.loadAndRender()`) to settle. */
async function flushAsyncHandler(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

function makeView(adapter: SuggestionsDoc): SuggestionsEditorView {
	const leaf = new WorkspaceLeaf();
	const view = new SuggestionsEditorView(leaf, { adapter, docPath: DOC_PATH });
	view.app = new App();
	return view;
}

function subtabs(view: SuggestionsEditorView): HTMLElement | null {
	return view.contentEl.querySelector(".hashi-se-subtabs");
}

function body(view: SuggestionsEditorView): HTMLElement | null {
	return view.contentEl.querySelector(".hashi-se-body");
}

function leafActions(view: SuggestionsEditorView): HTMLElement | null {
	return view.contentEl.querySelector(".hashi-se-leaf-actions");
}

function dirtyBadge(view: SuggestionsEditorView): HTMLElement | null {
	return view.contentEl.querySelector(".hashi-se-dirty");
}

function tabButtonTexts(view: SuggestionsEditorView): string[] {
	return Array.from(subtabs(view)?.querySelectorAll("button") ?? []).map(
		(b) => b.textContent ?? "",
	);
}

function findTabButton(
	view: SuggestionsEditorView,
	labelPrefix: string,
): HTMLButtonElement {
	const btn = Array.from(subtabs(view)?.querySelectorAll("button") ?? []).find(
		(b) => (b.textContent ?? "").startsWith(labelPrefix),
	);
	if (btn === undefined) {
		throw new Error(`no tab button starting with "${labelPrefix}"`);
	}
	return btn as HTMLButtonElement;
}

function findActionButton(
	view: SuggestionsEditorView,
	text: string,
): HTMLButtonElement {
	const btn = Array.from(
		leafActions(view)?.querySelectorAll("button") ?? [],
	).find((b) => b.textContent === text);
	if (btn === undefined) {
		throw new Error(`no action button with text "${text}"`);
	}
	return btn as HTMLButtonElement;
}

function makeFailingAdapter(error: Error): SuggestionsDoc {
	return {
		load: vi.fn(async () => {
			throw error;
		}),
		save: vi.fn(async () => {}),
	};
}

function makeDirtyAdapter(): SuggestionsDoc {
	return {
		load: vi.fn(async (): Promise<EditModel> => ({
			doc: DEFAULT_SEED,
			dirty: true,
		})),
		save: vi.fn(async () => {}),
	};
}

interface SpyAdapter extends SuggestionsDoc {
	load: Mock<(docPath: string) => Promise<EditModel>>;
	save: Mock<(model: EditModel) => Promise<void>>;
}

/** A spy adapter whose seed model's `dirty` flag is controllable, so Save/
 * Revert tests can start from either a clean or an already-dirty document. */
function makeSpyAdapter(seedDirty: boolean): SpyAdapter {
	return {
		load: vi.fn<(docPath: string) => Promise<EditModel>>(async () => ({
			doc: DEFAULT_SEED,
			dirty: seedDirty,
		})),
		save: vi.fn<(model: EditModel) => Promise<void>>(async () => {}),
	};
}

/** A single-tab override whose body renders one plain button; clicking it
 * dispatches a real dirtying transform through `ctx.apply` — exercises the
 * Save/dirty-badge wiring without needing a real EditorTab's edit surface. */
const DIRTYING_TAB: EditorTab = {
	id: "suggestions",
	label: "Suggestions",
	count: () => 1,
	render: (container, _model, ctx) => {
		const btn = container.createEl("button", { text: "mark dirty" });
		btn.addEventListener("click", () => {
			ctx.apply((m) => ({ doc: m.doc, dirty: true }));
		});
	},
};

// ---------------------------------------------------------------------------

describe("SuggestionsEditorView", () => {
	beforeEach(() => {
		confirmModalInstances.length = 0;
	});

	describe("view type", () => {
		it("exposes VIEW_TYPE_SUGGESTIONS_EDITOR via getViewType", () => {
			const view = makeView(new FakeSuggestionsDoc());
			expect(view.getViewType()).toBe(VIEW_TYPE_SUGGESTIONS_EDITOR);
			expect(VIEW_TYPE_SUGGESTIONS_EDITOR).toBe("miyo-suggestions-editor");
		});
	});

	describe("onOpen — happy path", () => {
		it("loads via the injected adapter and renders 4 subtabs with counts from the fixture", async () => {
			const adapter = new FakeSuggestionsDoc();
			const view = makeView(adapter);

			await view.onOpen();

			expect(tabButtonTexts(view)).toEqual([
				"Suggestions · 7",
				"Proposed MOCs · 0",
				"Daily · 2",
				"Tag-Handler · 1",
			]);
		});

		it("calls adapter.load with the configured docPath", async () => {
			const adapter = new FakeSuggestionsDoc();
			const loadSpy = vi.spyOn(adapter, "load");
			const view = makeView(adapter);

			await view.onOpen();

			expect(loadSpy).toHaveBeenCalledWith(DOC_PATH);
		});

		it("renders the first tab active by default with its (non-empty) content", async () => {
			const view = makeView(new FakeSuggestionsDoc());
			await view.onOpen();

			const suggestionsBtn = findTabButton(view, "Suggestions");
			expect(suggestionsBtn.classList.contains("is-active")).toBe(true);
			// count lives on the subtab button
			expect(suggestionsBtn.textContent).toContain("7");

			// the real SuggestionsTab renders one card per suggestion
			const content = body(view);
			expect(content?.querySelector(".hashi-se-card")).not.toBeNull();
		});

		it("renders the leaf-head title and meta from the loaded doc", async () => {
			const view = makeView(new FakeSuggestionsDoc());
			await view.onOpen();

			const head = view.contentEl.querySelector(".hashi-se-leaf-head");
			expect(head?.querySelector("h3")?.textContent).toBe(
				"Suggestions editor",
			);
			const meta = head?.querySelector(".hashi-se-leaf-meta");
			expect(meta?.textContent).toBe(
				`run ${DEFAULT_SEED.run_id} · profile ${DEFAULT_SEED.profile} · ${DEFAULT_SEED.source_items} items`,
			);
		});
	});

	describe("tab switching", () => {
		it("clicking a tab makes it active and renders that tab's content", async () => {
			const view = makeView(new FakeSuggestionsDoc());
			await view.onOpen();

			// render() recreates all subtab buttons (bar.empty() then rebuild), so
			// the pre-click element reference is stale after the click — re-query.
			findTabButton(view, "Daily").click();

			expect(
				findTabButton(view, "Daily").classList.contains("is-active"),
			).toBe(true);
			expect(
				findTabButton(view, "Suggestions").classList.contains("is-active"),
			).toBe(false);

			// count lives on the subtab button; the real DailyTab renders date
			// groups as daily-flavored cards.
			expect(findTabButton(view, "Daily").textContent).toContain("2");
			const content = body(view);
			expect(
				content?.querySelector(".hashi-se-card.hashi-se-daily"),
			).not.toBeNull();
		});

		it("re-clicking the already-active tab is a no-op (content unchanged)", async () => {
			const view = makeView(new FakeSuggestionsDoc());
			await view.onOpen();

			const suggestionsBtn = findTabButton(view, "Suggestions");
			const before = body(view)?.innerHTML;
			suggestionsBtn.click();

			expect(body(view)?.innerHTML).toBe(before);
		});
	});

	describe("empty state", () => {
		it("shows the generic empty state for a tab with count 0 (Proposed MOCs in the 1115 fixture)", async () => {
			const view = makeView(new FakeSuggestionsDoc());
			await view.onOpen();

			findTabButton(view, "Proposed MOCs").click();

			const content = body(view);
			expect(content?.querySelector(".hashi-se-empty")).not.toBeNull();
		});
	});

	describe("load failure", () => {
		it("renders an error state instead of throwing when adapter.load rejects", async () => {
			const view = makeView(makeFailingAdapter(new Error("schema version mismatch")));

			await expect(view.onOpen()).resolves.toBeUndefined();

			const error = view.contentEl.querySelector(".hashi-se-error");
			expect(error).not.toBeNull();
			expect(error?.textContent).toContain("schema version mismatch");
			expect(subtabs(view)).toBeNull();
		});

		it("onClose after a load failure does not throw and does not open a ConfirmModal", async () => {
			const view = makeView(makeFailingAdapter(new Error("boom")));
			await view.onOpen();

			await expect(view.onClose()).resolves.toBeUndefined();
			expect(confirmModalInstances).toHaveLength(0);
		});
	});

	describe("view-state wiring (T4.1)", () => {
		it("without a docPath in deps, onOpen renders a placeholder without calling adapter.load", async () => {
			const adapter = new FakeSuggestionsDoc();
			const loadSpy = vi.spyOn(adapter, "load");
			const leaf = new WorkspaceLeaf();
			const view = new SuggestionsEditorView(leaf, { adapter });
			view.app = new App();

			await view.onOpen();

			expect(loadSpy).not.toHaveBeenCalled();
			expect(
				view.contentEl.querySelector(".hashi-se-nodoc"),
			).not.toBeNull();
			expect(subtabs(view)).toBeNull();
		});

		it("getState reflects the currently loaded docPath", async () => {
			const view = makeView(new FakeSuggestionsDoc());
			await view.onOpen();

			expect(view.getState()).toEqual({ docPath: DOC_PATH });
		});

		it("setState called before onOpen records docPath; onOpen then loads it", async () => {
			const adapter = new FakeSuggestionsDoc();
			const loadSpy = vi.spyOn(adapter, "load");
			const leaf = new WorkspaceLeaf();
			const view = new SuggestionsEditorView(leaf, { adapter });
			view.app = new App();

			await view.setState({ docPath: DOC_PATH }, { history: false });
			// Leaf isn't open yet — Obsidian calls setState before onOpen, so no
			// load should happen until onOpen actually runs.
			expect(loadSpy).not.toHaveBeenCalled();

			await view.onOpen();

			expect(loadSpy).toHaveBeenCalledWith(DOC_PATH);
			expect(tabButtonTexts(view)).toEqual([
				"Suggestions · 7",
				"Proposed MOCs · 0",
				"Daily · 2",
				"Tag-Handler · 1",
			]);
		});

		it("setState called while already open (retarget) re-loads and re-renders for the new docPath", async () => {
			const adapter = new FakeSuggestionsDoc();
			const loadSpy = vi.spyOn(adapter, "load");
			const view = makeView(adapter);
			await view.onOpen();
			expect(loadSpy).toHaveBeenCalledWith(DOC_PATH);

			const OTHER_PATH = "100 Inbox/2026-07-06_0949_suggestions.json";
			await view.setState({ docPath: OTHER_PATH }, { history: false });

			expect(loadSpy).toHaveBeenCalledTimes(2);
			expect(loadSpy).toHaveBeenLastCalledWith(OTHER_PATH);
			expect(view.getState()).toEqual({ docPath: OTHER_PATH });
			// Re-rendered — subtab strip still present with fresh content.
			expect(subtabs(view)).not.toBeNull();
		});

		it("setState with a state object lacking docPath does not change the current docPath", async () => {
			const view = makeView(new FakeSuggestionsDoc());
			await view.onOpen();

			await view.setState({}, { history: false });

			expect(view.getState()).toEqual({ docPath: DOC_PATH });
		});

		describe("retarget subscription teardown (regression)", () => {
			// SuggestionsStore.subscribe() returns an unsubscribe function — the
			// real contract a caller must honor to stop being notified. Wrapping
			// the REAL implementation (not replacing it) lets the store still
			// behave normally while letting us observe whether loadAndRender()
			// actually invokes the old store's unsubscribe before subscribing to
			// the new one. Without that teardown, a retargeted-while-open leaf
			// would keep a stale subscription to the discarded doc's store alive.
			afterEach(() => {
				vi.restoreAllMocks();
			});

			it("calls the PREVIOUS doc's unsubscribe exactly once when setState retargets an already-open view", async () => {
				const originalSubscribe = SuggestionsStore.prototype.subscribe;
				const unsubscribeSpies: Array<ReturnType<typeof vi.fn>> = [];
				vi.spyOn(SuggestionsStore.prototype, "subscribe").mockImplementation(
					function (
						this: SuggestionsStore,
						listener: (model: EditModel) => void,
					): () => void {
						const realUnsubscribe = originalSubscribe.call(this, listener);
						const wrapped = vi.fn(realUnsubscribe);
						unsubscribeSpies.push(wrapped);
						return wrapped;
					},
				);

				const view = makeView(new FakeSuggestionsDoc());
				await view.onOpen();

				expect(unsubscribeSpies).toHaveLength(1);
				expect(unsubscribeSpies[0]).not.toHaveBeenCalled();

				const OTHER_PATH = "100 Inbox/2026-07-06_0949_suggestions.json";
				await view.setState({ docPath: OTHER_PATH }, { history: false });

				// A second store was constructed and subscribed to for the new doc...
				expect(unsubscribeSpies).toHaveLength(2);
				// ...and the FIRST (now-discarded) store's subscription was torn
				// down exactly once — proving the old store can no longer trigger
				// this view's render().
				expect(unsubscribeSpies[0]).toHaveBeenCalledTimes(1);
				expect(unsubscribeSpies[1]).not.toHaveBeenCalled();
			});
		});
	});

	describe("onClose — dirty guard", () => {
		it("opens a ConfirmModal when the current model is dirty", async () => {
			const view = makeView(makeDirtyAdapter());
			await view.onOpen();

			await view.onClose();

			expect(confirmModalInstances).toHaveLength(1);
			expect(confirmModalInstances[0]?.title).toBe("Unsaved changes");
			expect(confirmModalInstances[0]?.open).toHaveBeenCalledOnce();
		});

		it("does NOT open a ConfirmModal on a clean close", async () => {
			const view = makeView(new FakeSuggestionsDoc());
			await view.onOpen();

			await view.onClose();

			expect(confirmModalInstances).toHaveLength(0);
		});
	});

	describe("Save affordance (spec-004 follow-up)", () => {
		it("Save is disabled and no dirty badge shows on a clean freshly-loaded doc", async () => {
			const adapter = makeSpyAdapter(false);
			const view = makeView(adapter);

			await view.onOpen();

			expect(findActionButton(view, "Save").disabled).toBe(true);
			expect(dirtyBadge(view)).toBeNull();
		});

		it("after an edit, the dirty badge shows 'Edited' and Save becomes enabled", async () => {
			const adapter = makeSpyAdapter(false);
			const leaf = new WorkspaceLeaf();
			const view = new SuggestionsEditorView(leaf, {
				adapter,
				docPath: DOC_PATH,
				tabs: [DIRTYING_TAB],
			});
			view.app = new App();
			await view.onOpen();

			expect(findActionButton(view, "Save").disabled).toBe(true);
			expect(dirtyBadge(view)).toBeNull();

			const markDirtyBtn = Array.from(
				body(view)?.querySelectorAll("button") ?? [],
			).find((b) => b.textContent === "mark dirty");
			markDirtyBtn?.click();

			expect(dirtyBadge(view)?.textContent).toContain("Edited");
			expect(findActionButton(view, "Save").disabled).toBe(false);
		});

		it("clicking Save calls adapter.save with the current (dirty) model", async () => {
			const adapter = makeSpyAdapter(true);
			const view = makeView(adapter);
			await view.onOpen();

			findActionButton(view, "Save").click();
			await flushAsyncHandler();

			expect(adapter.save).toHaveBeenCalledTimes(1);
			expect(adapter.save).toHaveBeenCalledWith({
				doc: DEFAULT_SEED,
				dirty: true,
			});
		});

		it("after a successful save, the dirty badge disappears and Save disables", async () => {
			const adapter = makeSpyAdapter(true);
			const view = makeView(adapter);
			await view.onOpen();
			expect(dirtyBadge(view)).not.toBeNull();

			findActionButton(view, "Save").click();
			await flushAsyncHandler();

			expect(dirtyBadge(view)).toBeNull();
			expect(findActionButton(view, "Save").disabled).toBe(true);
		});

		it("a failed save leaves the dirty badge and Save enabled (adapter already surfaced its own Notice)", async () => {
			const adapter: SpyAdapter = {
				load: vi.fn<(docPath: string) => Promise<EditModel>>(async () => ({
					doc: DEFAULT_SEED,
					dirty: true,
				})),
				save: vi.fn<(model: EditModel) => Promise<void>>(async () => {
					throw new Error("disk full");
				}),
			};
			const view = makeView(adapter);
			await view.onOpen();

			findActionButton(view, "Save").click();
			await flushAsyncHandler();

			expect(adapter.save).toHaveBeenCalledTimes(1);
			expect(dirtyBadge(view)).not.toBeNull();
			expect(findActionButton(view, "Save").disabled).toBe(false);
		});
	});

	describe("Revert affordance (spec-004 follow-up)", () => {
		it("clicking Revert re-invokes adapter.load(docPath), discarding in-memory edits", async () => {
			const adapter = makeSpyAdapter(true);
			const view = makeView(adapter);
			await view.onOpen();
			expect(adapter.load).toHaveBeenCalledTimes(1);
			expect(dirtyBadge(view)).not.toBeNull();

			findActionButton(view, "Revert").click();
			await flushAsyncHandler();

			expect(adapter.load).toHaveBeenCalledTimes(2);
			expect(adapter.load).toHaveBeenLastCalledWith(DOC_PATH);
		});
	});

	describe("Save/Revert race safety (code-quality-review fix)", () => {
		// Both tests below hold `adapter.save`'s promise open manually so a
		// second, independent view action can land WHILE the save is still
		// in flight — reproducing the two races the reference-identity guard
		// in handleSave() protects against (see its doc comment).

		it("an edit that lands while a save is in flight is NOT silently marked clean", async () => {
			let resolveSave: () => void = () => {};
			const pendingSave = new Promise<void>((resolve) => {
				resolveSave = resolve;
			});
			const adapter: SpyAdapter = {
				load: vi.fn<(docPath: string) => Promise<EditModel>>(async () => ({
					doc: DEFAULT_SEED,
					dirty: false,
				})),
				save: vi.fn<(model: EditModel) => Promise<void>>(() => pendingSave),
			};
			const leaf = new WorkspaceLeaf();
			const view = new SuggestionsEditorView(leaf, {
				adapter,
				docPath: DOC_PATH,
				tabs: [DIRTYING_TAB],
			});
			view.app = new App();
			await view.onOpen();

			const clickMarkDirty = (): void => {
				const btn = Array.from(
					body(view)?.querySelectorAll("button") ?? [],
				).find((b) => b.textContent === "mark dirty");
				btn?.click();
			};

			// Model A: dirty via a first edit, enabling Save.
			clickMarkDirty();
			expect(findActionButton(view, "Save").disabled).toBe(false);

			// Kick off Save — captures model A and awaits the still-pending
			// adapter.save(A).
			findActionButton(view, "Save").click();
			await Promise.resolve();
			expect(adapter.save).toHaveBeenCalledTimes(1);

			// Model B lands WHILE the save above is still in flight — a second,
			// independent edit the in-flight save knows nothing about.
			clickMarkDirty();

			// Now let the stale save resolve.
			resolveSave();
			await flushAsyncHandler();

			// Model B's edits were never written — they must stay dirty, not
			// get silently cleared just because SOME save resolved.
			expect(dirtyBadge(view)).not.toBeNull();
			expect(dirtyBadge(view)?.textContent).toContain("Edited");
			expect(findActionButton(view, "Save").disabled).toBe(false);
		});

		it("a Revert (setState) that lands while a save is in flight does not throw, and the stale save's dirty-clear is skipped", async () => {
			let resolveSave: () => void = () => {};
			const pendingSave = new Promise<void>((resolve) => {
				resolveSave = resolve;
			});
			// The retargeted (Revert) load is ALSO held open manually — this is
			// what pins `this.store` at `null` for the window we need: the
			// stale save must resolve WHILE loadAndRender has already nulled
			// `this.store` but hasn't yet replaced it with the new doc's store.
			// Without gating this second load too, both promises tend to settle
			// in the same microtask batch and the crash window never opens.
			let resolveRetargetLoad: (model: EditModel) => void = () => {};
			const pendingRetargetLoad = new Promise<EditModel>((resolve) => {
				resolveRetargetLoad = resolve;
			});
			let loadCount = 0;
			const adapter: SpyAdapter = {
				load: vi.fn<(docPath: string) => Promise<EditModel>>(() => {
					loadCount += 1;
					// First load (onOpen) comes back dirty immediately so Save is
					// clickable; the retargeted (Revert) load stays pending until
					// the test resolves it explicitly.
					if (loadCount === 1) {
						return Promise.resolve({ doc: DEFAULT_SEED, dirty: true });
					}
					return pendingRetargetLoad;
				}),
				save: vi.fn<(model: EditModel) => Promise<void>>(() => pendingSave),
			};
			const view = makeView(adapter);
			await view.onOpen();
			expect(dirtyBadge(view)).not.toBeNull();

			findActionButton(view, "Save").click();
			await Promise.resolve();
			expect(adapter.save).toHaveBeenCalledTimes(1);

			// Retarget the still-open leaf to a different doc WHILE the save
			// above is still pending — this is what Revert's click handler
			// does internally (loadAndRender via setState). loadAndRender nulls
			// `this.store` synchronously before awaiting adapter.load, so by
			// the time this call returns, `this.store` is already null and
			// stays null until `pendingRetargetLoad` resolves below.
			const OTHER_PATH = "100 Inbox/2026-07-06_0949_suggestions.json";
			const setStatePromise = view.setState(
				{ docPath: OTHER_PATH },
				{ history: false },
			);
			expect(adapter.load).toHaveBeenCalledTimes(2);

			// Resolve the STALE save now, while `this.store` is still null —
			// this is exactly the window in which the unguarded pre-fix code
			// threw "Cannot read properties of null (reading 'apply')" as an
			// unhandled rejection from the fire-and-forget `void
			// this.handleSave()` call site.
			resolveSave();
			await flushAsyncHandler();

			// Only now does the retarget's own load resolve, completing Revert.
			resolveRetargetLoad({ doc: DEFAULT_SEED, dirty: false });
			await expect(setStatePromise).resolves.toBeUndefined();
			await flushAsyncHandler();

			expect(adapter.load).toHaveBeenLastCalledWith(OTHER_PATH);
			// The retargeted doc loaded clean — the stale save's dirty-clear
			// must have been skipped (store identity changed/nulled), not
			// thrown and not applied against the new store.
			expect(dirtyBadge(view)).toBeNull();
		});
	});
});
