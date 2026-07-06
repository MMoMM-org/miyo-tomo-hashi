/**
 * Unit tests for SuggestionsEditorView — Phase-3 T3.1 leaf ItemView + tab
 * chrome + tab contract.
 *
 * Spec refs: spec-004 SDD §3 (ADR-S1); plan/phase-3.md T3.1.
 *
 * Real Obsidian populates `View.app` after construction (WorkspaceLeaf wires
 * it before onOpen runs) — TomoChatView never needed `this.app`, so this is
 * the first view here that does. `makeView()` assigns `view.app` manually
 * right after construction to mirror that real-world wiring order (see the
 * obsidian mock's ItemView.app comment).
 */

import "obsidian";
import { App, WorkspaceLeaf } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	DEFAULT_SEED,
	FakeSuggestionsDoc,
} from "../../../__mocks__/FakeSuggestionsDoc";
import type { EditModel } from "../../../../src/types/suggestions";
import { VIEW_TYPE_SUGGESTIONS_EDITOR } from "../../../../src/ui/suggestions-view/index";
import { SuggestionsEditorView } from "../../../../src/ui/suggestions-view/SuggestionsEditorView";
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

function makeView(adapter: SuggestionsDoc): SuggestionsEditorView {
	const leaf = new WorkspaceLeaf();
	const view = new SuggestionsEditorView(leaf, { adapter, docPath: DOC_PATH });
	view.app = new App();
	return view;
}

function tabBar(view: SuggestionsEditorView): HTMLElement | null {
	return view.contentEl.querySelector(".hashi-suggestions-editor-tabbar");
}

function tabContent(view: SuggestionsEditorView): HTMLElement | null {
	return view.contentEl.querySelector(".hashi-suggestions-editor-content");
}

function tabButtonTexts(view: SuggestionsEditorView): string[] {
	return Array.from(tabBar(view)?.querySelectorAll("button") ?? []).map(
		(b) => b.textContent ?? "",
	);
}

function findTabButton(
	view: SuggestionsEditorView,
	labelPrefix: string,
): HTMLButtonElement {
	const btn = Array.from(tabBar(view)?.querySelectorAll("button") ?? []).find(
		(b) => (b.textContent ?? "").startsWith(labelPrefix),
	);
	if (btn === undefined) {
		throw new Error(`no tab button starting with "${labelPrefix}"`);
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
		it("loads via the injected adapter and renders 4 tabs with counts from the fixture", async () => {
			const adapter = new FakeSuggestionsDoc();
			const view = makeView(adapter);

			await view.onOpen();

			expect(tabButtonTexts(view)).toEqual([
				"Suggestions (7)",
				"Proposed MOCs (0)",
				"Daily (2)",
				"Tag-Handler (1)",
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
			// count lives on the tab-bar button
			expect(suggestionsBtn.textContent).toContain("7");

			// the real SuggestionsTab renders one card per suggestion
			const content = tabContent(view);
			expect(content?.querySelector(".hashi-suggestion-card")).not.toBeNull();
		});
	});

	describe("tab switching", () => {
		it("clicking a tab makes it active and renders that tab's content", async () => {
			const view = makeView(new FakeSuggestionsDoc());
			await view.onOpen();

			// render() recreates all tab buttons (bar.empty() then rebuild), so
			// the pre-click element reference is stale after the click — re-query.
			findTabButton(view, "Daily").click();

			expect(
				findTabButton(view, "Daily").classList.contains("is-active"),
			).toBe(true);
			expect(
				findTabButton(view, "Suggestions").classList.contains("is-active"),
			).toBe(false);

			// count lives on the tab-bar button; the real DailyTab renders date groups
			expect(findTabButton(view, "Daily").textContent).toContain("2");
			const content = tabContent(view);
			expect(content?.querySelector(".hashi-daily-group")).not.toBeNull();
		});

		it("re-clicking the already-active tab is a no-op (content unchanged)", async () => {
			const view = makeView(new FakeSuggestionsDoc());
			await view.onOpen();

			const suggestionsBtn = findTabButton(view, "Suggestions");
			const before = tabContent(view)?.innerHTML;
			suggestionsBtn.click();

			expect(tabContent(view)?.innerHTML).toBe(before);
		});
	});

	describe("empty state", () => {
		it("shows the generic empty state for a tab with count 0 (Proposed MOCs in the 1115 fixture)", async () => {
			const view = makeView(new FakeSuggestionsDoc());
			await view.onOpen();

			findTabButton(view, "Proposed MOCs").click();

			const content = tabContent(view);
			expect(
				content?.querySelector(".hashi-suggestions-editor-empty"),
			).not.toBeNull();
			expect(
				content?.querySelector(".hashi-suggestions-editor-tab-stub"),
			).toBeNull();
		});
	});

	describe("load failure", () => {
		it("renders an error state instead of throwing when adapter.load rejects", async () => {
			const view = makeView(makeFailingAdapter(new Error("schema version mismatch")));

			await expect(view.onOpen()).resolves.toBeUndefined();

			const error = view.contentEl.querySelector(
				".hashi-suggestions-editor-error",
			);
			expect(error).not.toBeNull();
			expect(error?.textContent).toContain("schema version mismatch");
			expect(tabBar(view)).toBeNull();
		});

		it("onClose after a load failure does not throw and does not open a ConfirmModal", async () => {
			const view = makeView(makeFailingAdapter(new Error("boom")));
			await view.onOpen();

			await expect(view.onClose()).resolves.toBeUndefined();
			expect(confirmModalInstances).toHaveLength(0);
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
});
