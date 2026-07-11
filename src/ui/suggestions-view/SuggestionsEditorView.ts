/**
 * SuggestionsEditorView — the Suggestions Editor's leaf `ItemView` (T3.1).
 * Hosts a tab bar over the four sections of one `_suggestions.json` document
 * (Suggestions / Proposed MOCs / Daily / Tag-Handler) and delegates each
 * tab's non-empty content to an `EditorTab` implementation (tabContract.ts).
 *
 * Spec refs: spec-004 SDD §3 (ADR-S1 — leaf ItemView, 4 tabs, lifecycle +
 * dirty-guard); PRD F1; plan/phase-3.md T3.1; ADR-026 follow-up (Save
 * affordance, this revision) — see decision 8.
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
 * 3. Tab and action buttons use raw `addEventListener`, not
 *    `registerDomEvent` — mirrors `TomoChatView`'s zoom/force-reconnect
 *    buttons. The subtab strip and leaf-head are fully recreated on every
 *    `render()` (`.empty()` first), so there is nothing to leak: the
 *    listener goes away with its element.
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
 *
 * 8. (spec-004 follow-up) Save/Revert chrome — the view previously had no
 *    way to persist edits at all. `Save` calls `deps.adapter.save(model)`
 *    and, on success, applies a transform through the store that clears
 *    `dirty` (a real reference change so `Store.set`'s `Object.is` dedup
 *    still notifies). `ObsidianSuggestionsDoc.save()` rethrows on the
 *    load-bearing JSON-write failure after already showing its own
 *    `Notice` (see src/suggestions/ObsidianSuggestionsDoc.ts) — so the
 *    Save handler only needs to swallow that rejection, not double-report
 *    it; the model stays dirty and the badge/button state is simply
 *    whatever the next render shows. `Revert` re-runs `loadAndRender()` —
 *    the same load path `onOpen`/`setState` use — discarding in-memory
 *    edits in favor of a fresh, clean model. Root chrome classes
 *    (`hashi-se-*`) replace the earlier ad hoc `hashi-suggestions-editor-*`
 *    names to match the approved mockup; see styles.css. A `saving` flag
 *    disables both buttons for the duration of an in-flight save (see
 *    `handleSave()`'s doc comment for the reference-identity guard this
 *    pairs with, closing two save/edit and save/revert race windows).
 */

import {
	ItemView,
	setIcon,
	type ViewStateResult,
	type WorkspaceLeaf,
} from "obsidian";

import { SuggestionsStore } from "../../suggestions/store.js";
import type { EditModel } from "../../types/suggestions.js";
import type { SuggestionsDoc } from "../../vault/SuggestionsDoc.js";
import { ConfirmModal } from "../ConfirmModal.js";

import { VIEW_TYPE_SUGGESTIONS_EDITOR } from "./index.js";
import type { EditorTab, PickerScopes, TabContext } from "./tabContract.js";
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
	/**
	 * Supplies the current picker scopes (Template/Location/Tag limits) at
	 * render time, read live from plugin settings so a settings change takes
	 * effect on the next tab render without reconstructing the view. Absent in
	 * tests → pickers run unscoped.
	 */
	readonly getPickerScopes?: () => PickerScopes;
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

	// DOM refs — captured in loadAndRender so render() can rebuild them on
	// every store change (TomoChatView precedent).
	private leafHeadEl: HTMLElement | null = null;
	private subtabsEl: HTMLElement | null = null;
	private bodyEl: HTMLElement | null = null;

	// True while a Save is in flight — disables Save/Revert so a user can't
	// double-click Save or Revert-out-from-under an in-flight write. See
	// decision 8 / handleSave() for the store+model reference-identity guard
	// this pairs with.
	private saving = false;

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
		// Revert (decision 8) reuses this same path, so a stale subscription
		// from the model being reverted must be torn down the same way.
		if (this.unsubscribe !== null) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
		this.store = null;
		this.leafHeadEl = null;
		this.subtabsEl = null;
		this.bodyEl = null;

		const root = this.contentEl;
		root.empty();
		root.addClass("hashi-suggestions-editor-view");
		root.addClass("hashi-se-view");

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

		this.leafHeadEl = root.createDiv({ cls: "hashi-se-leaf-head" });
		this.subtabsEl = root.createDiv({ cls: "hashi-se-subtabs" });
		this.bodyEl = root.createDiv({ cls: "hashi-se-body" });

		// Subscribe AFTER the skeleton is built — the store fires the listener
		// immediately on subscribe with the current model, and render() needs
		// leafHeadEl/subtabsEl/bodyEl already attached.
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

	/**
	 * Persists the current model via the adapter, then clears `dirty` on
	 * success. `ObsidianSuggestionsDoc.save()` already shows its own `Notice`
	 * and rethrows on the load-bearing JSON-write failure (decision 8) — so a
	 * rejection here means the user has already been told; the model simply
	 * stays dirty (nothing to do beyond letting the render reflect that).
	 *
	 * Reference-identity guard against two races (code-quality-review
	 * finding, spec-004 follow-up): `savedStore`/`savedModel` are captured
	 * BEFORE the `await`, not re-read from `this.store` after it.
	 *   1. Edit-during-save: a synchronous `ctx.apply` can land a NEWER model
	 *      while `adapter.save(savedModel)` is still in flight. Clearing
	 *      `dirty` on whatever `this.store` currently holds (rather than on
	 *      `savedModel` specifically) would mark those newer, never-written
	 *      edits as saved — silent data loss. Comparing
	 *      `this.store.getModel() === savedModel` after the await catches
	 *      this: if a newer model landed, its `dirty` stays true.
	 *   2. Revert/setState-during-save: `loadAndRender()` (Revert's handler)
	 *      replaces `this.store` — possibly with `null` mid-flight — while a
	 *      save is still pending. Comparing `this.store === savedStore`
	 *      catches a replaced/nulled store and skips the clear entirely
	 *      instead of calling `.apply` on a discarded (or null) store.
	 * The `saving` flag additionally disables Save/Revert for the whole
	 * in-flight window (see renderLeafHead), narrowing — though for Revert
	 * specifically not fully eliminating, since setState can still retarget
	 * this leaf from outside a button click — the window these checks guard.
	 */
	private async handleSave(): Promise<void> {
		const savedStore = this.store;
		if (savedStore === null) return;
		const savedModel = savedStore.getModel();

		this.saving = true;
		this.render();
		try {
			await this.deps.adapter.save(savedModel);
		} catch {
			return;
		} finally {
			this.saving = false;
			this.render();
		}

		if (this.store === savedStore && this.store.getModel() === savedModel) {
			this.store.apply(() => ({ doc: savedModel.doc, dirty: false }));
		}
	}

	private renderError(root: HTMLElement, err: unknown): void {
		const message = err instanceof Error ? err.message : String(err);
		root.createDiv({
			cls: "hashi-se-error",
			text: `Couldn't load suggestions: ${message}`,
		});
	}

	private renderNoDocument(root: HTMLElement): void {
		root.createDiv({
			cls: "hashi-se-nodoc",
			text: "Open a Tomo _suggestions.json (or its .md) first.",
		});
	}

	private render(): void {
		if (
			this.store === null ||
			this.leafHeadEl === null ||
			this.subtabsEl === null ||
			this.bodyEl === null
		) {
			return;
		}
		const model = this.store.getModel();
		this.renderLeafHead(model);
		this.renderSubtabs(model);
		this.renderBody(model);
	}

	private renderLeafHead(model: EditModel): void {
		const head = this.leafHeadEl;
		if (head === null) return;
		head.empty();

		const title = head.createDiv({ cls: "hashi-se-leaf-title" });
		const icon = title.createSpan();
		setIcon(icon, "list-checks");
		const textWrap = title.createDiv();
		textWrap.createEl("h3", { text: "Suggestions editor" });
		textWrap.createDiv({
			cls: "hashi-se-leaf-meta",
			text: `run ${model.doc.run_id} · profile ${model.doc.profile} · ${model.doc.source_items} items`,
		});

		const actions = head.createDiv({ cls: "hashi-se-leaf-actions" });
		if (model.dirty) {
			const dirty = actions.createSpan({ cls: "hashi-se-dirty" });
			dirty.createEl("i");
			dirty.createSpan({ text: "Edited" });
		}

		const revertBtn = actions.createEl("button", {
			cls: ["hashi-se-btn", "hashi-se-subtle"],
			text: "Revert",
		});
		revertBtn.setAttr("type", "button");
		revertBtn.disabled = this.saving;
		revertBtn.addEventListener("click", () => {
			void this.loadAndRender();
		});

		const saveBtn = actions.createEl("button", {
			cls: ["hashi-se-btn", "hashi-se-primary"],
			text: "Save",
		});
		saveBtn.setAttr("type", "button");
		saveBtn.disabled = this.saving || !model.dirty;
		saveBtn.addEventListener("click", () => {
			void this.handleSave();
		});
	}

	private renderSubtabs(model: EditModel): void {
		const bar = this.subtabsEl;
		if (bar === null) return;
		bar.empty();

		for (const tab of this.tabs) {
			const count = tab.count(model);
			const btn = bar.createEl("button", {
				cls: "hashi-se-subtab",
				text: `${tab.label} · ${count}`,
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

	private renderBody(model: EditModel): void {
		const body = this.bodyEl;
		if (body === null) return;
		body.empty();

		const activeTab = this.tabs.find((tab) => tab.id === this.activeTabId);
		if (activeTab === undefined) return;

		const count = activeTab.count(model);
		if (count === 0) {
			body.createDiv({
				cls: "hashi-se-empty",
				text: `No ${activeTab.label.toLowerCase()} in this run.`,
			});
			return;
		}

		const ctx: TabContext = {
			app: this.app,
			pickerScopes: this.deps.getPickerScopes?.(),
			apply: (transform) => {
				this.store?.apply(transform);
			},
		};
		activeTab.render(body, model, ctx);
	}
}
