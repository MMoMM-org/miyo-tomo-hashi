/**
 * GardenAuditEditorView — the Garden-Audit Editor's leaf `ItemView`
 * (spec-005 Phase 4, T4.1 lifecycle). Mirrors
 * `src/ui/suggestions-view/SuggestionsEditorView.ts`'s lifecycle (ADR-1:
 * parallel view, not a shared tabbed view) with the garden-audit deltas:
 *
 *   - ONE tier-grouped tab, no subtab bar (contrast the Suggestions
 *     Editor's 4-tab strip) — `renderSubtabs` has no equivalent here.
 *   - Identity: "Garden audit" / "compass" (not "Suggestions editor" /
 *     "list-checks").
 *   - Leaf-head meta: `run {run_id} · profile {profile} · {N} findings`
 *     (finding count, not `source_items`).
 *   - No `.md` write (ADR-6) — irrelevant to the view; the adapter already
 *     owns that constraint.
 *
 * --- Decisions ---
 *
 * 1. Store: reuses the generic `Store<GardenAuditModel>` (src/util/store.ts)
 *    directly rather than a `GardenAuditStore` wrapper class (contrast
 *    `SuggestionsStore`) — the wrapper would add nothing beyond `Store`'s
 *    existing get/set/subscribe; `ctx.apply` below inlines the two-line
 *    "transform then set" logic instead.
 * 2. Tab: injected via `deps.tab` (singular, optional test seam — defaults
 *    to a real `GardenAuditTab`), not `deps.tabs` (plural) — there is
 *    exactly one tab and no subtab strip to iterate over.
 * 3. (T4.3) Save/Revert/dirty chrome mirrors SuggestionsEditorView's
 *    `handleSave` exactly, including its reference-identity guard against
 *    two races (see `handleSave`'s own doc comment): `savedStore`/
 *    `savedModel` are captured BEFORE the `await adapter.save(...)`, and
 *    `dirty` is only cleared if `this.store === savedStore &&
 *    this.store.get() === savedModel` post-await — an edit or a Revert
 *    landing mid-flight is never silently marked clean. A `saving` flag
 *    additionally disables Save/Revert for the whole in-flight window.
 */

import {
	ItemView,
	setIcon,
	type ViewStateResult,
	type WorkspaceLeaf,
} from "obsidian";

import { normalizeBrokenUpActions } from "../../garden-audit/transforms.js";
import type { GardenAuditModel } from "../../types/garden-audit.js";
import { Store } from "../../util/store.js";
import type { GardenAuditDoc } from "../../vault/GardenAuditDoc.js";
import { ConfirmModal } from "../ConfirmModal.js";

import { VIEW_TYPE_GARDEN_AUDIT_EDITOR } from "./index.js";
import type { GardenAuditTabContext, GardenAuditTabSpec } from "./tabContract.js";
import { GardenAuditTab } from "./tabs/GardenAuditTab.js";

export interface GardenAuditEditorViewDeps {
	/** The only wire-aware collaborator — owns all JSON/vault I/O. */
	readonly adapter: GardenAuditDoc;
	/**
	 * Vault-relative path of the `_garden-audit.json` document to open.
	 * Optional — production leaves this unset and supplies the path later via
	 * `setState` (mirrors SuggestionsEditorView's registerView-factory
	 * gotcha: the factory signature is `(leaf) => View`, so it cannot
	 * receive a per-open docPath).
	 */
	readonly docPath?: string;
	/** Test seam — defaults to a real `GardenAuditTab`; production never overrides it. */
	readonly tab?: GardenAuditTabSpec;
}

/** Narrow, defensive read of `state.docPath` — never throws on a malformed state. */
function extractDocPath(state: unknown): string | null {
	if (typeof state !== "object" || state === null) return null;
	const docPath = (state as Record<string, unknown>).docPath;
	return typeof docPath === "string" ? docPath : null;
}

export class GardenAuditEditorView extends ItemView {
	private readonly tab: GardenAuditTabSpec;
	private store: Store<GardenAuditModel> | null = null;
	private unsubscribe: (() => void) | null = null;
	private docPath: string;
	// Set once onOpen has run; lets setState() know whether a retarget should
	// re-render immediately (leaf already open) or just record the path for
	// the upcoming onOpen (leaf being freshly constructed).
	private opened = false;

	// DOM refs — captured in loadAndRender so render() can rebuild them on
	// every store change (SuggestionsEditorView precedent).
	private leafHeadEl: HTMLElement | null = null;
	private bodyEl: HTMLElement | null = null;

	// True while a Save is in flight — disables Save/Revert so a user can't
	// double-click Save or Revert-out-from-under an in-flight write. See
	// handleSave() for the store+model reference-identity guard this pairs
	// with.
	private saving = false;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly deps: GardenAuditEditorViewDeps,
	) {
		super(leaf);
		this.tab = deps.tab ?? new GardenAuditTab();
		this.docPath = deps.docPath ?? "";
	}

	override getViewType(): string {
		return VIEW_TYPE_GARDEN_AUDIT_EDITOR;
	}

	override getDisplayText(): string {
		return "Garden audit";
	}

	override getIcon(): string {
		return "compass";
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
		// can retarget an already-open leaf to a different docPath, and a
		// stale subscription would keep notifying a discarded store. Revert
		// (T4.3) reuses this same path.
		if (this.unsubscribe !== null) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
		this.store = null;
		this.leafHeadEl = null;
		this.bodyEl = null;

		const root = this.contentEl;
		root.empty();
		root.addClass("hashi-garden-audit-editor-view");
		root.addClass("hashi-se-view");

		if (this.docPath === "") {
			this.renderNoDocument(root);
			return;
		}

		let model: GardenAuditModel;
		try {
			model = await this.deps.adapter.load(this.docPath);
		} catch (err) {
			// Schema reject / bad JSON — fail loud in the adapter's own
			// contract, but never crash the view, and never enter an
			// editable state over bad data (SDD Error Handling).
			this.renderError(root, err);
			return;
		}

		this.store = new Store<GardenAuditModel>(model);

		this.leafHeadEl = root.createDiv({ cls: "hashi-se-leaf-head" });
		this.bodyEl = root.createDiv({ cls: "hashi-se-body" });

		// Subscribe AFTER the skeleton is built — the store fires the
		// listener immediately on subscribe with the current model, and
		// render() needs leafHeadEl/bodyEl already attached.
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

		const model = this.store?.get();
		if (model !== undefined && model.dirty) {
			new ConfirmModal(
				this.app,
				"Unsaved changes",
				"This garden-audit run has unsaved edits. Closing now discards them.",
				async () => {
					// Confirmed discard — nothing further to do here; ItemView's
					// onClose cannot veto the leaf detach already in flight
					// (mirrors SuggestionsEditorView's identical accepted gap).
				},
			).open();
		}
	}

	private renderError(root: HTMLElement, err: unknown): void {
		const message = err instanceof Error ? err.message : String(err);
		root.createDiv({
			cls: "hashi-se-error",
			text: `Couldn't load garden audit: ${message}`,
		});
	}

	private renderNoDocument(root: HTMLElement): void {
		root.createDiv({
			cls: "hashi-se-nodoc",
			text: "Open a Tomo _garden-audit.json (or its .md) first.",
		});
	}

	private render(): void {
		if (this.store === null || this.leafHeadEl === null || this.bodyEl === null) {
			return;
		}
		const model = this.store.get();
		this.renderLeafHead(model);
		this.renderBody(model);
	}

	private renderLeafHead(model: GardenAuditModel): void {
		const head = this.leafHeadEl;
		if (head === null) return;
		head.empty();

		const title = head.createDiv({ cls: "hashi-se-leaf-title" });
		const icon = title.createSpan();
		setIcon(icon, "compass");
		const textWrap = title.createDiv();
		textWrap.createEl("h3", { text: "Garden audit" });
		textWrap.createDiv({
			cls: "hashi-se-leaf-meta",
			text: `run ${model.doc.run_id} · profile ${model.doc.profile} · ${model.doc.findings.length} findings`,
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

	/**
	 * Persists the current model via the adapter, then clears `dirty` on
	 * success. `ObsidianGardenAuditDoc.save()` already shows its own
	 * `Notice` and rethrows on the load-bearing JSON-write failure — so a
	 * rejection here means the user has already been told; the model simply
	 * stays dirty (nothing to do beyond letting the render reflect that).
	 *
	 * Reference-identity guard against two races (mirrors
	 * SuggestionsEditorView.handleSave exactly): `savedStore`/`savedModel`
	 * are captured BEFORE the `await`, not re-read from `this.store` after
	 * it.
	 *   1. Edit-during-save: a synchronous `ctx.apply` can land a NEWER model
	 *      while `adapter.save(savedModel)` is still in flight. Clearing
	 *      `dirty` on whatever `this.store` currently holds (rather than on
	 *      `savedModel` specifically) would mark those newer, never-written
	 *      edits as saved — silent data loss. Comparing
	 *      `this.store.get() === savedModel` after the await catches this:
	 *      if a newer model landed, its `dirty` stays true.
	 *   2. Revert/setState-during-save: `loadAndRender()` (Revert's handler)
	 *      replaces `this.store` — possibly with `null` mid-flight — while a
	 *      save is still pending. Comparing `this.store === savedStore`
	 *      catches a replaced/nulled store and skips the clear entirely.
	 * The `saving` flag additionally disables Save/Revert for the whole
	 * in-flight window (see renderLeafHead), narrowing the window these
	 * checks guard.
	 *
	 * ADR-5 apply-only gap: `normalizeBrokenUpActions` runs here, BEFORE the
	 * reference-identity guard's baseline is captured — so `savedModel` is
	 * already the normalized model, and the store itself is updated to match
	 * (via `savedStore.set`) so `this.store.get() === savedModel` still holds
	 * post-await when the user made no further edits. Normalizing after
	 * capturing `savedModel` instead would make that comparison falsely look
	 * like a concurrent edit landed, leaving `dirty` stuck true on a clean
	 * save. `ObsidianGardenAuditDoc.save()` stays untouched (ADR-2 — the
	 * adapter writes verbatim; this view owns save-time semantics).
	 */
	private async handleSave(): Promise<void> {
		const savedStore = this.store;
		if (savedStore === null) return;
		savedStore.set(normalizeBrokenUpActions(savedStore.get()));
		const savedModel = savedStore.get();

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

		if (this.store === savedStore && this.store.get() === savedModel) {
			this.store.set({ doc: savedModel.doc, dirty: false });
		}
	}

	private renderBody(model: GardenAuditModel): void {
		const body = this.bodyEl;
		if (body === null) return;
		body.empty();

		const count = this.tab.count(model);
		if (count === 0) {
			body.createDiv({
				cls: "hashi-se-empty",
				text: "No findings — this vault is clean.",
			});
			return;
		}

		const ctx: GardenAuditTabContext = {
			app: this.app,
			apply: (transform) => {
				if (this.store === null) return;
				this.store.set(transform(this.store.get()));
			},
		};
		this.tab.render(body, model, ctx);
	}
}
