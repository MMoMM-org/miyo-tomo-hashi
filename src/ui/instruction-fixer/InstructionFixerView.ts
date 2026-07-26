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
 * DOM construction is not this file's business either: `renderFixerBody.ts`
 * owns every element the leaf draws, as pure functions of a `FixerRenderContext`
 * snapshot. What stays here is what only the leaf can own — the `ItemView`
 * lifecycle, the adapter I/O in `loadAndRender`, and the mutable save/re-run
 * state with the reference-identity guards that protect it. Those guards are
 * deliberately NOT split across files: each one is a capture-before-await /
 * compare-after-await pair, and a pair that spans a module boundary is a pair
 * someone will eventually break.
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
 * 5. A re-run (T3.3) reconciles by RELOADING the document, not by re-resolving
 *    outcomes alone. The run rewrites the very file this leaf holds open — the
 *    executor flushes `applied: true` through its own atomic path — so when it
 *    finishes, both the in-memory model AND the adapter's save baseline
 *    (`ActiveDoc.pristine`, captured at `load()`) describe a file that no
 *    longer exists. Refreshing only the outcomes would fix the badges while
 *    leaving the model claiming `applied:false` for actions that just applied,
 *    and would leave the next Save diffing against a superseded baseline.
 *    `loadAndRender()` re-establishes model, baseline and outcomes from disk in
 *    one step — and re-resolving outcomes is exactly what it already does, so
 *    the reload IS the "refresh in place" (PRD F7-AC2). It is lossless because
 *    of Decision 6, and it therefore happens UNCONDITIONALLY: a rejected run is
 *    not a promise that nothing landed (see `handleRerun`), so the failure path
 *    needs the refresh at least as much as the success path does.
 * 6. Re-run is REFUSED while the model is dirty, and the document is frozen for
 *    the duration of a run (no card edits, no Save/Revert/Re-run). The executor
 *    reads the set FROM DISK, so a dirty model's repairs would not be part of
 *    the run at all — the user would watch the same action fail again for a fix
 *    they had already made — and Decision 5's reload would then discard them.
 *    Of the three defensible options (block / save-then-run / run-and-preserve)
 *    this is the only one that neither writes on the user's behalf nor loses
 *    their work, and it matches PRD F7-AC1's framing ("given a SAVED edited
 *    set"). Freezing edits during the run closes the same hole from the other
 *    side: nothing can become dirty in the window the reload will overwrite.
 */

import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";

import type { InstructionSet } from "../../schema/types.js";
import { InstructionSetSaveError } from "../../instruction-fixer/ObsidianInstructionSetDoc.js";
import { validate } from "../../schema/validator.js";
import { Store } from "../../util/store.js";
import type {
	InstructionFixerModel,
	InstructionSetDoc,
} from "../../vault/InstructionSetDoc.js";
import { ConfirmModal } from "../ConfirmModal.js";

import type { FixerCardRenderer } from "./fixerContract.js";
import { VIEW_TYPE_INSTRUCTION_FIXER } from "./index.js";
import { NO_TRUSTED_SIGNAL, type OutcomeResolution } from "./outcomeSource.js";
import {
	renderFixerBody,
	renderFixerLeafHead,
	renderFixerRerunError,
	type FixerRenderContext,
	type SaveFailure,
} from "./renderFixerBody.js";

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
	/**
	 * Re-run bridge (T3.3) — runs the set at `docPath` through the existing
	 * `InstructionExecutor` and resolves when the run is over (ADR-9: one
	 * executor, one write path, no second writer). Absent → the Run/Re-run
	 * affordances are disabled.
	 *
	 * It takes the path rather than closing over one because the leaf can be
	 * retargeted (`setState`) at any time: the view is the only component that
	 * knows which document is on screen when the button is pressed.
	 */
	readonly rerun?: (docPath: string) => Promise<void>;
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

	// True while a re-run is in flight. Freezes the whole document — Save,
	// Revert, Re-run AND card edits — because the executor is rewriting the file
	// underneath and the reload that follows replaces the model (Decisions 5/6).
	private running = false;

	// Why the last re-run didn't happen (unsaved repairs) or didn't finish (the
	// run threw). Cleared when a run starts and on every doc-load.
	private rerunError: string | null = null;

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

	/**
	 * `rerunError` carries a re-run failure ACROSS the reload it triggers, which
	 * is why it is a parameter rather than something the caller assigns
	 * afterwards. A post-await assignment would need its own staleness guard
	 * (another `setState` can land while this load is in flight); passing it in
	 * makes the notice part of the state this load installs, so the next load —
	 * a retarget, a Revert — clears it by defaulting to null, as before.
	 */
	private async loadAndRender(rerunError: string | null = null): Promise<void> {
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
		this.rerunError = rerunError;
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

		this.outcomes = await this.resolveOutcomesFailClosed(model.doc, this.docPath);
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
	private async resolveOutcomesFailClosed(
		set: InstructionSet,
		docPath: string,
	): Promise<OutcomeResolution> {
		try {
			return await this.deps.resolveOutcomes(set, docPath);
		} catch {
			return NO_TRUSTED_SIGNAL;
		}
	}

	private renderError(root: HTMLElement, err: unknown): void {
		// A re-run failure that was riding along into this load still gets said:
		// "the run failed AND the set is now unreadable" is two facts, and the
		// second one does not explain the first.
		renderFixerRerunError(root, this.rerunError);
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

	/**
	 * A snapshot of everything the render layer may see, plus the callbacks its
	 * buttons fire. Rebuilt per render so every field is current; the callbacks
	 * close over `this` so a press always runs against LIVE state, never the
	 * state as it was when the button was drawn.
	 */
	private renderContext(model: InstructionFixerModel): FixerRenderContext {
		return {
			app: this.app,
			model,
			outcomes: this.outcomes,
			saveError: this.saveError,
			rerunError: this.rerunError,
			saving: this.saving,
			running: this.running,
			canRerun: this.deps.rerun !== undefined,
			card: this.deps.card,
			onSave: () => {
				void this.handleSave();
			},
			onRevert: () => {
				void this.loadAndRender();
			},
			onRerun: () => {
				void this.handleRerun();
			},
			apply: (transform) => {
				if (this.store === null) return;
				// Frozen for the duration of a run (Decision 6): the executor is
				// rewriting this file and the reload that follows replaces the
				// model, so an edit accepted here would be silently discarded.
				if (this.running) return;
				this.store.set(transform(this.store.get()));
			},
		};
	}

	private render(): void {
		if (this.store === null || this.leafHeadEl === null || this.bodyEl === null) return;
		const ctx = this.renderContext(this.store.get());
		renderFixerLeafHead(this.leafHeadEl, ctx);
		renderFixerBody(this.bodyEl, ctx);
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
		// A pending "save your repairs before re-running" is being answered right
		// now, so it must not outlive the press that answers it.
		this.rerunError = null;
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
	 * Runs the set through the injected bridge, then reconciles this leaf with
	 * the file the run just rewrote (T3.3). Nothing here knows about the
	 * executor — the view owns the affordance, the freeze, and the reconcile.
	 *
	 * Three things this method is responsible for, in order:
	 *
	 * 1. REFUSING a run over unsaved repairs (Decision 6). The executor reads
	 *    the set off disk, so pending edits simply would not be in the run.
	 * 2. FREEZING the document while the run is in flight — every write
	 *    affordance and `ctx.apply` — so step 3 cannot destroy anything.
	 * 3. RECONCILING by reloading (Decision 5), which re-establishes the model,
	 *    the adapter's save baseline and the outcomes from disk at once.
	 *
	 * Reference-identity discipline, exactly as in `handleSave` and for the same
	 * reason: `savedStore` is captured BEFORE the await. `setState` can retarget
	 * the leaf mid-run (it is not gated by `running` — it calls `loadAndRender`
	 * directly), and a stale run must then touch nothing: not the new document's
	 * baseline (a reload of a document this run never executed would be a lie
	 * about what is on disk), and not its error state. The `finally` re-render
	 * is deliberately unconditional — `running` is leaf state, so whichever
	 * document is on screen has to see it cleared or its buttons stay dead.
	 */
	private async handleRerun(): Promise<void> {
		const rerun = this.deps.rerun;
		if (rerun === undefined) return;
		const savedStore = this.store;
		if (savedStore === null) return;
		if (this.saving || this.running) return;

		if (savedStore.get().dirty) {
			this.rerunError =
				"Save your repairs before re-running — the run reads the set from disk.";
			this.render();
			return;
		}

		const docPath = this.docPath;
		let failure: string | null = null;
		this.running = true;
		this.rerunError = null;
		this.render();
		try {
			await rerun(docPath);
		} catch (err) {
			failure = `Re-run failed: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			this.running = false;
			this.render();
		}

		// Stale: a retarget owns the leaf now. Reloading would re-baseline a
		// document this run never executed, and the failure belongs to the model
		// that retarget already discarded — so neither may be applied here.
		if (this.store !== savedStore) return;

		// Reload on BOTH paths — a rejected run does NOT mean nothing landed.
		// The executor's applied-flag flush and the peer-checkbox tick are
		// separate awaited steps of one try block, so a throw on the tick leaves
		// `applied: true` already durable; likewise a handler throwing for action
		// k leaves actions 1..k-1's vault changes in place while the batched
		// applied write never runs. Keeping the pre-run model on the failure path
		// would show "failed / needs repair" for an action that is now applied on
		// disk — precisely the lie this surface exists to prevent. The freeze
		// above guarantees nothing became dirty, so the reload is lossless
		// whatever the outcome, and the failure rides INTO the refreshed state
		// rather than replacing it: the user needs both "why it failed" and
		// "what the set looks like now".
		await this.loadAndRender(failure);
	}
}
