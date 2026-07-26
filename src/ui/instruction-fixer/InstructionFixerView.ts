/**
 * InstructionFixerView — the Instruction Fixer's leaf `ItemView`
 * (spec-006 Phase 3, T3.1; SDD ADR-2). Mirrors
 * `src/ui/garden-audit-view/GardenAuditEditorView.ts`'s lifecycle — Store
 * subscription, `setState`-docPath handoff, load-error state, Save/Revert
 * chrome with the reference-identity race guard — with the Fixer's deltas:
 *
 *   - Identity: "Instruction fixer" / `wrench` (not "Garden audit" / "compass").
 *     Sentence case, per the obsidianmd lint rule and the SDD's own command
 *     name ("Open instruction fixer") — the SDD prose's Title Case is a
 *     documentation-side inconsistency, not a UI string.
 *   - Sections are derived from the Phase-2 EDIT GATE, not from a wire field:
 *     `editable` → "Needs repair", `frozen-applied` → "Applied",
 *     `read-only-no-signal` → "Not attempted". Grouping is what makes the
 *     fail-closed state legible, and deriving it from the gate keeps exactly
 *     one definition of "can this be repaired?".
 *   - A `NO_TRUSTED_SIGNAL` resolution collapses the sections into ONE
 *     read-only "All actions" group under a banner that states the reason once
 *     (never per card) and offers Run. Cards still render: viewing is
 *     unrestricted and is a distinct capability from editing (ADR-027 ①).
 *   - Card BODIES are not this file's business — see `fixerContract.ts` for
 *     where the T3.2 seam sits and why.
 *
 * --- Decisions ---
 *
 * 1. Outcomes are resolved once per DOC LOAD (`loadAndRender`), not per render:
 *    `resolveOutcomes` is async (it may parse a run log off disk) while
 *    `render()` is a synchronous store subscriber. The GATE is still derived
 *    per render from that stored resolution, exactly as the SDD requires — the
 *    model itself never carries outcomes, so a re-run refresh (T3.3) only has
 *    to re-resolve and re-render.
 * 2. `resolveOutcomes` arrives as an injected `(set, docPath) => Promise<…>`
 *    rather than as its `OutcomeSourceDeps`. The real dep bundle needs
 *    `logFolder` = `settings.tomoInboxFolder`, which can change while a leaf is
 *    open; closing over it at the main.ts call site keeps that live and keeps
 *    this view from reaching into settings or the executionStore singleton.
 * 3. Save pre-validates the edited document, so a schema-invalid edit is
 *    reported against the pending edit without a round trip (PRD F4-AC2). The
 *    adapter re-validates on its own — this is a promptness convenience, not
 *    the gate, and NOT how the failure taxonomy below is decided.
 * 4. `ObsidianInstructionSetDoc.save()` writes one atomic patch PER CHANGED
 *    ACTION, so atomicity is per-action, not per-save: a mid-loop I/O failure
 *    leaves the set schema-valid but only partially repaired. That case and a
 *    reject-before-any-write (schema-invalid, or a structural edit the patch
 *    path can't express) need OPPOSITE recovery instructions, and the view
 *    cannot tell them apart on its own — a structural rejection is schema-VALID,
 *    so no amount of pre-checking here would catch it without duplicating an
 *    invariant only the adapter enforces. So the adapter says: every rejection
 *    is an `InstructionSetSaveError` carrying `landedPatchCount` (T3.1 review).
 *    `SaveFailure`/`saveErrorHint` below render from that number, and report
 *    "unknown" rather than guess when a rejection carries none.
 */

import { ItemView, setIcon, type ViewStateResult, type WorkspaceLeaf } from "obsidian";

import type { Action, InstructionSet } from "../../schema/types.js";
import { InstructionSetSaveError } from "../../instruction-fixer/ObsidianInstructionSetDoc.js";
import { validate } from "../../schema/validator.js";
import { Store } from "../../util/store.js";
import type {
	InstructionFixerModel,
	InstructionSetDoc,
} from "../../vault/InstructionSetDoc.js";
import { ConfirmModal } from "../ConfirmModal.js";

import type { FixerCardContext, FixerCardRenderer } from "./fixerContract.js";
import { VIEW_TYPE_INSTRUCTION_FIXER } from "./index.js";
import { NO_TRUSTED_SIGNAL, type OutcomeResolution } from "./outcomeSource.js";
import {
	badgeText,
	gateFor,
	gateTag,
	groupActionsByGate,
	outcomeFor,
	outcomeReason,
} from "./sections.js";

export interface InstructionFixerViewDeps {
	/** The only wire-aware collaborator — owns all JSON/vault I/O. */
	readonly adapter: InstructionSetDoc;
	/**
	 * Vault-relative path of the `_instructions.json` document to open.
	 * Optional — production leaves this unset and supplies the path later via
	 * `setState` (the `registerView` factory signature is `(leaf) => View`, so
	 * it cannot receive a per-open docPath).
	 */
	readonly docPath?: string;
	/**
	 * Phase-2 outcome resolution for the loaded set, pre-bound to its
	 * `OutcomeSourceDeps` (`{ vault, getRunState, logFolder }` — `logFolder` is
	 * `settings.tomoInboxFolder`). Injected as a function so the live setting is
	 * read per call; see Decision 2.
	 */
	readonly resolveOutcomes: (
		set: InstructionSet,
		docPath: string,
	) => Promise<OutcomeResolution>;
	/** Card-body renderer (T3.2). Absent → cards render header-only. */
	readonly card?: FixerCardRenderer;
	/** Re-run bridge (T3.3). Absent → the Run/Re-run affordances are disabled. */
	readonly rerun?: () => Promise<void>;
}

/**
 * A rejected Save, plus how much of it reached disk.
 *
 * `landed` is the load-bearing field, because the two failure shapes need
 * OPPOSITE instructions: nothing written → the retry is pointless until the
 * problem is fixed; some patches written → retrying is exactly the recovery.
 * It comes from the adapter (`InstructionSetSaveError`), which is the only
 * component that knows where in its per-action write loop it was. `null` means
 * the rejection carried no count — a foreign `InstructionSetDoc` implementation
 * or an unexpected throw — and is reported as genuinely unknown rather than
 * guessed in either direction.
 */
interface SaveFailure {
	readonly message: string;
	readonly landed: number | null;
	readonly total: number;
}

/**
 * The panel's headline — what happened to the document, in plain language.
 *
 * Deliberately NOT the error's own message: that string is written for a
 * developer reading a stack trace (class name, method name, "ADR-9",
 * "per-action field patches") and names things the reader cannot act on. It
 * stays on the error object for logs and tests, and is demoted to the detail
 * line below the recovery instruction.
 */
function saveErrorHeadline(failure: SaveFailure): string {
	if (failure.landed === null) return "Couldn't confirm whether your repairs were saved.";
	if (failure.landed === 0) return "Couldn't save your repairs — nothing was written.";
	return `Wrote ${failure.landed} of ${failure.total} repairs, then hit a problem.`;
}

/** The recovery instruction for a failed Save. See `SaveFailure`. */
function saveErrorHint(failure: SaveFailure): string {
	if (failure.landed === null) {
		return (
			"Your edits are still pending: save again to re-send every repair, or revert " +
			"to reload from disk."
		);
	}
	if (failure.landed === 0) {
		return (
			"The set on disk is unchanged and your edits are still pending. Check the " +
			"details below, then save again."
		);
	}
	return (
		"The set is partly repaired and still valid. Your edits are still pending: save " +
		"again to write the rest, or revert to reload from disk."
	);
}

/** Narrow, defensive read of `state.docPath` — never throws on a malformed state. */
function extractDocPath(state: unknown): string | null {
	if (typeof state !== "object" || state === null) return null;
	const docPath = (state as Record<string, unknown>).docPath;
	return typeof docPath === "string" ? docPath : null;
}

export class InstructionFixerView extends ItemView {
	private store: Store<InstructionFixerModel> | null = null;
	private unsubscribe: (() => void) | null = null;
	private docPath: string;
	// Resolved once per doc-load (Decision 1); the gate is re-derived from it on
	// every render. Fail-closed default so a render that somehow precedes a
	// resolution offers nothing editable.
	private outcomes: OutcomeResolution = NO_TRUSTED_SIGNAL;
	// Set once onOpen has run; lets setState() know whether a retarget should
	// re-render immediately (leaf already open) or just record the path for the
	// upcoming onOpen (leaf being freshly constructed).
	private opened = false;

	// DOM refs — captured in loadAndRender so render() can rebuild them on every
	// store change.
	private leafHeadEl: HTMLElement | null = null;
	private bodyEl: HTMLElement | null = null;

	// True while a Save is in flight — disables Save/Revert/Re-run so the user
	// can't double-click Save or pull the document out from under it. Pairs with
	// handleSave()'s store+model reference-identity guard.
	private saving = false;

	// Last Save failure, cleared on the next successful save and on every
	// doc-load. See `SaveFailure` for how the recovery copy is chosen.
	private saveError: SaveFailure | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly deps: InstructionFixerViewDeps,
	) {
		super(leaf);
		this.docPath = deps.docPath ?? "";
	}

	override getViewType(): string {
		return VIEW_TYPE_INSTRUCTION_FIXER;
	}

	override getDisplayText(): string {
		return "Instruction fixer";
	}

	override getIcon(): string {
		return "wrench";
	}

	override async onOpen(): Promise<void> {
		this.opened = true;
		await this.loadAndRender();
	}

	override getState(): Record<string, unknown> {
		return { docPath: this.docPath };
	}

	override async setState(state: unknown, _result: ViewStateResult): Promise<void> {
		const docPath = extractDocPath(state);
		if (docPath !== null) this.docPath = docPath;
		// Only re-render if onOpen has already built the DOM — otherwise the
		// upcoming onOpen call will pick up `this.docPath` on its own.
		if (this.opened) await this.loadAndRender();
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
				"This instruction set has unsaved repairs. Closing now discards them.",
				async () => {
					// Confirmed discard — ItemView's onClose cannot veto the leaf
					// detach already in flight (same accepted gap as the other
					// Tomo editors).
				},
			).open();
		}
	}

	// -------------------------------------------------------------------------
	// Load
	// -------------------------------------------------------------------------

	private async loadAndRender(): Promise<void> {
		// Tear down any previously-loaded doc's subscription first — setState can
		// retarget an already-open leaf, and a stale subscription would keep
		// notifying a discarded store. Revert reuses this same path.
		if (this.unsubscribe !== null) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
		this.store = null;
		this.leafHeadEl = null;
		this.bodyEl = null;
		this.saveError = null;
		this.outcomes = NO_TRUSTED_SIGNAL;

		const root = this.contentEl;
		root.empty();
		root.addClass("hashi-instruction-fixer-view");
		root.addClass("hashi-se-view");

		if (this.docPath === "") {
			this.renderNoDocument(root);
			return;
		}

		let model: { doc: InstructionSet; dirty: false };
		try {
			model = await this.deps.adapter.load(this.docPath);
		} catch (err) {
			// Schema reject / bad JSON — never crash the view, and never enter an
			// editable state over bad data (SDD Error Handling).
			this.renderError(root, err);
			return;
		}

		this.outcomes = await this.resolveOutcomesFailClosed(model.doc);
		this.store = new Store<InstructionFixerModel>(model);

		this.leafHeadEl = root.createDiv({ cls: "hashi-se-leaf-head" });
		this.bodyEl = root.createDiv({ cls: "hashi-se-body" });

		// Subscribe AFTER the skeleton is built — the store fires the listener
		// immediately with the current model, and render() needs the refs.
		this.unsubscribe = this.store.subscribe(() => {
			this.render();
		});
	}

	/**
	 * Outcome resolution can only ever make the surface MORE permissive, so a
	 * resolver failure must degrade to no signal rather than propagate — the
	 * user gets the read-only banner and a Run button (ADR-4's asymmetric bias).
	 */
	private async resolveOutcomesFailClosed(set: InstructionSet): Promise<OutcomeResolution> {
		try {
			return await this.deps.resolveOutcomes(set, this.docPath);
		} catch {
			return NO_TRUSTED_SIGNAL;
		}
	}

	private renderError(root: HTMLElement, err: unknown): void {
		const message = err instanceof Error ? err.message : String(err);
		root.createDiv({
			cls: "hashi-se-error",
			text: `Couldn't load instruction set: ${message}`,
		});
	}

	private renderNoDocument(root: HTMLElement): void {
		root.createDiv({
			cls: "hashi-se-nodoc",
			text: "Open a Tomo _instructions.json (or its .md) first.",
		});
	}

	// -------------------------------------------------------------------------
	// Render
	// -------------------------------------------------------------------------

	private render(): void {
		if (this.store === null || this.leafHeadEl === null || this.bodyEl === null) return;
		const model = this.store.get();
		this.renderLeafHead(model);
		this.renderBody(model);
	}

	private renderLeafHead(model: InstructionFixerModel): void {
		const head = this.leafHeadEl;
		if (head === null) return;
		head.empty();

		const title = head.createDiv({ cls: "hashi-se-leaf-title" });
		const icon = title.createSpan();
		setIcon(icon, "wrench");
		const textWrap = title.createDiv();
		textWrap.createEl("h3", { text: "Instruction fixer" });
		const count = model.doc.actions.length;
		textWrap.createDiv({
			cls: "hashi-se-leaf-meta",
			text: `profile ${model.doc.profile ?? "—"} · ${count} ${count === 1 ? "action" : "actions"}`,
		});

		const actions = head.createDiv({ cls: "hashi-se-leaf-actions" });
		if (model.dirty) {
			const dirty = actions.createSpan({ cls: "hashi-se-dirty" });
			dirty.createEl("i");
			dirty.createSpan({ text: "Edited" });
		}

		this.createButton(actions, "Re-run", ["hashi-se-btn", "hashi-se-subtle"], {
			disabled: this.saving || this.deps.rerun === undefined,
			onClick: () => {
				void this.handleRerun();
			},
		});

		this.createButton(actions, "Revert", ["hashi-se-btn", "hashi-se-subtle"], {
			disabled: this.saving,
			onClick: () => {
				void this.loadAndRender();
			},
		});

		this.createButton(actions, "Save", ["hashi-se-btn", "hashi-se-primary"], {
			disabled: this.saving || !model.dirty,
			onClick: () => {
				void this.handleSave();
			},
		});
	}

	private createButton(
		parent: HTMLElement,
		text: string,
		cls: readonly string[],
		options: { readonly disabled: boolean; readonly onClick: () => void },
	): HTMLButtonElement {
		// `cls` is passed as an array — a space-separated string throws
		// InvalidCharacterError under the obsidian test mock.
		const btn = parent.createEl("button", { cls: [...cls], text });
		btn.setAttr("type", "button");
		btn.disabled = options.disabled;
		btn.addEventListener("click", options.onClick);
		return btn;
	}

	private renderBody(model: InstructionFixerModel): void {
		const body = this.bodyEl;
		if (body === null) return;
		body.empty();

		this.renderSaveError(body);

		if (model.doc.actions.length === 0) {
			body.createDiv({
				cls: "hashi-se-empty",
				text: "No actions in this instruction set.",
			});
			return;
		}

		if (this.outcomes === NO_TRUSTED_SIGNAL) {
			this.renderNoSignalBanner(body);
		}

		for (const group of groupActionsByGate(model.doc.actions, this.outcomes)) {
			this.renderSection(body, group.label, group.actions, group.tag);
		}
	}

	private renderSaveError(body: HTMLElement): void {
		const error = this.saveError;
		if (error === null) return;
		const panel = body.createDiv({ cls: "hashi-if-save-error" });
		panel.createDiv({ cls: "hashi-if-save-error-head", text: saveErrorHeadline(error) });
		panel.createDiv({ cls: "hashi-if-save-error-hint", text: saveErrorHint(error) });
		// The raw diagnostic, last and de-emphasised: it names the failing value
		// or the underlying I/O error, which is worth showing, but it is not the
		// sentence the user should read first.
		panel.createDiv({ cls: "hashi-if-save-error-detail", text: error.message });
	}

	private renderNoSignalBanner(body: HTMLElement): void {
		const banner = body.createDiv({ cls: "hashi-if-banner" });
		const text = banner.createDiv({ cls: "hashi-if-banner-text" });
		text.createDiv({ text: "No trusted outcome for this set." });
		text.createDiv({
			cls: "hashi-if-banner-detail",
			text: "Hashi can't tell which actions failed until it runs them.",
		});
		this.createButton(banner, "Run", ["hashi-se-btn", "hashi-se-primary"], {
			disabled: this.saving || this.deps.rerun === undefined,
			onClick: () => {
				void this.handleRerun();
			},
		});
	}

	private renderSection(
		body: HTMLElement,
		label: string,
		actions: readonly Action[],
		tag: string | null,
	): void {
		const section = body.createDiv({ cls: "hashi-if-group" });
		const header = section.createDiv({ cls: "hashi-if-group-header" });
		header.createSpan({ cls: "hashi-if-group-label", text: label });
		header.createSpan({ cls: "hashi-if-group-count", text: String(actions.length) });
		if (tag !== null) header.createSpan({ cls: "hashi-if-group-tag", text: tag });

		for (const action of actions) this.renderCard(section, action);
	}

	/**
	 * The card SHELL — header (id · kind), outcome badge and state tag, all of
	 * it derived from the outcome/gate this view owns. The body is delegated to
	 * the injected renderer (T3.2); see `fixerContract.ts` for why the seam sits
	 * exactly here.
	 *
	 * The failure reason is DERIVED here (one `outcomeReason`, never re-derived
	 * downstream) but RENDERED by the card, which is the only collaborator that
	 * can place it where the binding layout puts it — between the intent line it
	 * explains and the target fields. With no card renderer wired (the T3.1
	 * shell, and the view's own tests), the view renders it into the body
	 * itself so the reason never silently disappears with the seam.
	 */
	private renderCard(section: HTMLElement, action: Action): void {
		const gate = gateFor(action, this.outcomes);
		const outcome = outcomeFor(action, this.outcomes);

		const card = section.createDiv({ cls: "hashi-if-card" });
		card.setAttr("data-action-id", action.id);
		if (gate !== "editable") card.addClass("hashi-if-card--readonly");

		const header = card.createDiv({ cls: "hashi-if-card-header" });
		header.createSpan({
			cls: "hashi-if-card-id",
			text: `${action.id} · ${action.action}`,
		});
		header.createSpan({ cls: "hashi-if-badge", text: badgeText(outcome) });
		const tag = gateTag(gate);
		if (tag !== null) header.createSpan({ cls: "hashi-if-card-tag", text: tag });

		const reason = outcomeReason(outcome);
		const cardBody = card.createDiv({ cls: "hashi-if-card-body" });
		const ctx: FixerCardContext = {
			app: this.app,
			gate,
			outcome,
			reason,
			apply: (transform) => {
				if (this.store === null) return;
				this.store.set(transform(this.store.get()));
			},
		};

		if (this.deps.card !== undefined) {
			this.deps.card.render(cardBody, action, ctx);
			return;
		}
		if (reason !== null) {
			cardBody.createDiv({ cls: "hashi-if-card-reason", text: reason });
		}
	}

	// -------------------------------------------------------------------------
	// Save / re-run
	// -------------------------------------------------------------------------

	/**
	 * Persists the current model via the adapter, then clears `dirty` on success.
	 *
	 * Reference-identity guard against two races (mirrors
	 * `GardenAuditEditorView.handleSave` exactly): `savedStore`/`savedModel` are
	 * captured BEFORE the `await`, not re-read from `this.store` after it.
	 *   1. Edit-during-save: a synchronous `ctx.apply` can land a NEWER model
	 *      while `adapter.save(savedModel)` is in flight. Clearing `dirty` on
	 *      whatever `this.store` currently holds would mark those never-written
	 *      edits as saved — silent data loss. `this.store.get() === savedModel`
	 *      catches it.
	 *   2. Revert/setState-during-save: `loadAndRender()` replaces `this.store`
	 *      — possibly with `null` — mid-flight. `this.store === savedStore`
	 *      catches a replaced/nulled store and skips the clear entirely.
	 * The `saving` flag additionally disables Save/Revert/Re-run for the whole
	 * in-flight window, narrowing what these checks have to guard.
	 *
	 * On the failure paths see Decision 4 in the class doc comment: the recovery
	 * copy is chosen from the adapter's reported `landedPatchCount`, never
	 * assumed. No failure path discards the user's edit.
	 */
	private async handleSave(): Promise<void> {
		const savedStore = this.store;
		if (savedStore === null) return;
		const savedModel = savedStore.get();
		if (!savedModel.dirty) return;

		const validation = validate(savedModel.doc);
		if (!validation.ok) {
			this.saveError = { message: validation.message, landed: 0, total: 0 };
			this.render();
			return;
		}

		this.saving = true;
		this.saveError = null;
		this.render();
		try {
			await this.deps.adapter.save(savedModel);
		} catch (err) {
			// Same reference-identity discipline as the success path below, and
			// for the same reason. `setState` — re-invoking the opener on another
			// set — is NOT gated by `saving` the way Revert is: it calls
			// loadAndRender() directly, which swaps in a new store and docPath and
			// clears saveError. A stale save rejecting after that must not
			// repopulate an error against the document now on screen, which was
			// never written to. The failure dies with the model it belonged to:
			// the retarget already discarded those edits, so there is nothing left
			// to retry or revert, and the adapter has surfaced its own Notice for
			// the I/O case regardless.
			if (this.store !== savedStore) return;
			this.saveError = {
				message: err instanceof Error ? err.message : String(err),
				// The adapter is the only component that knows how far its
				// per-action write loop got, so the count is READ off the error
				// rather than re-derived here — a second copy of that invariant
				// would drift from the one the adapter actually enforces.
				landed: err instanceof InstructionSetSaveError ? err.landedPatchCount : null,
				total: err instanceof InstructionSetSaveError ? err.totalPatchCount : 0,
			};
			return;
		} finally {
			this.saving = false;
			this.render();
		}

		if (this.store === savedStore && this.store.get() === savedModel) {
			this.store.set({ doc: savedModel.doc, dirty: false });
		}
	}

	/**
	 * Delegates to the injected re-run bridge (T3.3). Nothing here knows about
	 * the executor — this view only owns the affordance and its disabled state.
	 */
	private async handleRerun(): Promise<void> {
		const rerun = this.deps.rerun;
		if (rerun === undefined) return;
		await rerun();
	}
}
