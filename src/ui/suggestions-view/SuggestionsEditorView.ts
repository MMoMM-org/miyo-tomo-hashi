/**
 * SuggestionsEditorView — the Suggestions Editor's leaf `ItemView` (T3.1).
 * Hosts a tab bar over the four sections of one `_suggestions.json` document
 * (Suggestions / Proposed MOCs / Daily / Tag-Handler) and delegates each
 * tab's non-empty content to an `EditorTab` implementation (tabContract.ts).
 *
 * Spec refs: spec-004 SDD §3 (ADR-S1 — leaf ItemView, 4 tabs, lifecycle +
 * dirty-guard); PRD F1; plan/phase-3.md T3.1.
 *
 * --- Decisions ---
 *
 * 1. Mirrors `src/ui/chat-view/TomoChatView.ts`: DOM refs captured in
 *    `onOpen`, `render()` rebuilds them from the current store model, the
 *    store subscription is wired up AFTER the DOM skeleton exists (the
 *    store fires its listener immediately on subscribe).
 *
 * 2. Constructor takes `(leaf, deps)` with `deps.adapter: SuggestionsDoc` +
 *    `deps.docPath` — the ONLY wire-aware collaborator this view touches.
 *    Tests inject `FakeSuggestionsDoc`; a later phase wires
 *    `ObsidianSuggestionsDoc`. `deps.tabs` is an optional override (defaults
 *    to `DEFAULT_TABS`) so tests can substitute tabs without touching the
 *    view; production code never needs to pass it.
 *
 * 3. Tab buttons use raw `addEventListener`, not `registerDomEvent` —
 *    mirrors `TomoChatView`'s zoom/force-reconnect buttons. Buttons are
 *    fully recreated on every `render()` (`tabBarEl.empty()` first), so
 *    there is nothing to leak: the listener goes away with its element.
 *
 * 4. Empty-state handling lives HERE, not in each `EditorTab`: the view
 *    checks `tab.count(model) === 0` and renders a generic empty state
 *    instead of calling `tab.render()`. This keeps the tab contract small
 *    and means no tab implementation has to special-case "nothing to show".
 *
 * 5. `onClose`'s dirty-guard opens a `ConfirmModal` but cannot veto the
 *    leaf close — `ItemView.onClose` runs as part of Obsidian's own
 *    leaf-detach flow, so there is no hook to cancel it from here. This is
 *    an accepted v1 gap (plan/phase-3.md T3.1: "at minimum prompt on
 *    dirty"): the prompt itself is the safeguard against silent data loss,
 *    even though Cancel cannot stop the detach already in flight.
 *
 * 6. (T4.1) `docPath` is now mutable, sourced from Obsidian's view-state
 *    mechanism rather than only the constructor. `registerView`'s factory
 *    signature is `(leaf) => View` — it cannot receive a per-open docPath —
 *    so the real open path is `leaf.setViewState({ type, state: { docPath }
 *    })`, which Obsidian resolves by constructing the view via the factory
 *    (deps.docPath defaults to `""`) and then calling `setState(state,
 *    result)` BEFORE `onOpen()`. `deps.docPath` stays as an optional
 *    constructor default purely so existing/unit tests can keep injecting
 *    it directly without going through setState.
 *
 * 7. `loadAndRender()` factors the load+build-DOM logic out of `onOpen` so
 *    `setState` can re-run it when the view is already open (ADR-S1 "one
 *    active doc": re-invoking the open command while a Suggestions Editor
 *    leaf already exists retargets that leaf via `setState` instead of
 *    opening a second one — see `openSuggestionsEditor.ts`). An empty
 *    `docPath` (no document chosen yet) renders a benign placeholder rather
 *    than calling `adapter.load("")`. Retargeting to a different docPath
 *    while the current one is dirty silently discards in-memory edits — an
 *    accepted v1 gap symmetric with decision 5's onClose gap; there is no
 *    hook to veto a `setState` call either.
 */

import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";

import { SuggestionsStore } from "../../suggestions/store.js";
import type { EditModel } from "../../types/suggestions.js";
import type { SuggestionsDoc } from "../../vault/SuggestionsDoc.js";
import { ConfirmModal } from "../ConfirmModal.js";

import { VIEW_TYPE_SUGGESTIONS_EDITOR } from "./index.js";
import type { EditorTab, TabContext } from "./tabContract.js";
import { DEFAULT_TABS } from "./tabs/defaultTabs.js";

export interface SuggestionsEditorViewDeps {
	/** The only wire-aware collaborator — owns all JSON/vault I/O. */
	readonly adapter: SuggestionsDoc;
	/**
	 * Vault-relative path of the `_suggestions.json` document to open.
	 * Optional (see decision 6) — production leaves this unset and supplies
	 * the path later via `setState`; tests may still inject it directly.
	 */
	readonly docPath?: string;
	/** Test seam — defaults to `DEFAULT_TABS`; production never overrides it. */
	readonly tabs?: readonly EditorTab[];
}

/** Narrow, defensive read of `state.docPath` — never throws on a malformed state. */
function extractDocPath(state: unknown): string | null {
	if (typeof state !== "object" || state === null) return null;
	const docPath = (state as Record<string, unknown>).docPath;
	return typeof docPath === "string" ? docPath : null;
}

export class SuggestionsEditorView extends ItemView {
	private readonly tabs: readonly EditorTab[];
	private store: SuggestionsStore | null = null;
	private unsubscribe: (() => void) | null = null;
	private activeTabId: string;
	private docPath: string;
	// Set once onOpen has run; lets setState() know whether a retarget should
	// re-render immediately (leaf already open) or just record the path for
	// the upcoming onOpen (leaf being freshly constructed).
	private opened = false;

	// DOM refs — captured in onOpen so render() can rebuild them on every
	// store change (TomoChatView precedent).
	private tabBarEl: HTMLElement | null = null;
	private tabContentEl: HTMLElement | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly deps: SuggestionsEditorViewDeps,
	) {
		super(leaf);
		this.tabs = deps.tabs ?? DEFAULT_TABS;
		this.activeTabId = this.tabs[0]?.id ?? "";
		this.docPath = deps.docPath ?? "";
	}

	override getViewType(): string {
		return VIEW_TYPE_SUGGESTIONS_EDITOR;
	}

	override getDisplayText(): string {
		return "Suggestions editor";
	}

	override getIcon(): string {
		return "list-checks";
	}

	override async onOpen(): Promise<void> {
		this.opened = true;
		await this.loadAndRender();
	}

	override getState(): Record<string, unknown> {
		return { docPath: this.docPath };
	}

	override async setState(
		state: unknown,
		_result: ViewStateResult,
	): Promise<void> {
		const docPath = extractDocPath(state);
		if (docPath !== null) this.docPath = docPath;
		// Only re-render if onOpen has already built the DOM — otherwise the
		// upcoming onOpen call will pick up `this.docPath` on its own.
		if (this.opened) await this.loadAndRender();
	}

	private async loadAndRender(): Promise<void> {
		// Tear down any previously-loaded doc's subscription first — setState
		// can retarget an already-open leaf to a different docPath (decision 7),
		// and a stale subscription would keep notifying a discarded store.
		if (this.unsubscribe !== null) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
		this.store = null;

		const root = this.contentEl;
		root.empty();
		root.addClass("hashi-suggestions-editor-view");

		if (this.docPath === "") {
			this.renderNoDocument(root);
			return;
		}

		let model: EditModel;
		try {
			model = await this.deps.adapter.load(this.docPath);
		} catch (err) {
			// Version mismatch / malformed doc — fail loud in the adapter's own
			// contract, but never crash the view. Render a clear error instead.
			this.renderError(root, err);
			return;
		}

		this.store = new SuggestionsStore(model);

		this.tabBarEl = root.createDiv({ cls: "hashi-suggestions-editor-tabbar" });
		this.tabContentEl = root.createDiv({
			cls: "hashi-suggestions-editor-content",
		});

		// Subscribe AFTER the skeleton is built — the store fires the listener
		// immediately on subscribe with the current model, and render() needs
		// tabBarEl/tabContentEl already attached.
		this.unsubscribe = this.store.subscribe(() => {
			this.render();
		});
	}

	override async onClose(): Promise<void> {
		this.opened = false;
		if (this.unsubscribe !== null) {
			this.unsubscribe();
			this.unsubscribe = null;
		}

		const model = this.store?.getModel();
		if (model !== undefined && model.dirty) {
			new ConfirmModal(
				this.app,
				"Unsaved changes",
				"This suggestions document has unsaved edits. Closing now discards them.",
				async () => {
					// Confirmed discard — nothing further to do here; see
					// decision 5 above re: onClose cannot veto the leaf detach.
				},
			).open();
		}
	}

	private renderError(root: HTMLElement, err: unknown): void {
		const message = err instanceof Error ? err.message : String(err);
		root.createDiv({
			cls: "hashi-suggestions-editor-error",
			text: `Couldn't load suggestions: ${message}`,
		});
	}

	private renderNoDocument(root: HTMLElement): void {
		root.createDiv({
			cls: "hashi-suggestions-editor-no-doc",
			text: "Open a Tomo _suggestions.json (or its .md) first.",
		});
	}

	private render(): void {
		if (
			this.store === null ||
			this.tabBarEl === null ||
			this.tabContentEl === null
		) {
			return;
		}
		const model = this.store.getModel();
		this.renderTabBar(model);
		this.renderActiveTabContent(model);
	}

	private renderTabBar(model: EditModel): void {
		const bar = this.tabBarEl;
		if (bar === null) return;
		bar.empty();

		for (const tab of this.tabs) {
			const count = tab.count(model);
			const btn = bar.createEl("button", {
				cls: "hashi-suggestions-editor-tab",
				text: `${tab.label} (${count})`,
			});
			btn.setAttr("type", "button");
			if (tab.id === this.activeTabId) btn.addClass("is-active");

			btn.addEventListener("click", () => {
				if (this.activeTabId === tab.id) return;
				this.activeTabId = tab.id;
				this.render();
			});
		}
	}

	private renderActiveTabContent(model: EditModel): void {
		const content = this.tabContentEl;
		if (content === null) return;
		content.empty();

		const activeTab = this.tabs.find((tab) => tab.id === this.activeTabId);
		if (activeTab === undefined) return;

		const count = activeTab.count(model);
		if (count === 0) {
			content.createDiv({
				cls: "hashi-suggestions-editor-empty",
				text: `No ${activeTab.label.toLowerCase()} in this run.`,
			});
			return;
		}

		const ctx: TabContext = {
			app: this.app,
			apply: (transform) => {
				this.store?.apply(transform);
			},
		};
		activeTab.render(content, model, ctx);
	}
}
