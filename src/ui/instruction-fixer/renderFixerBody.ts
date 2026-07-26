/**
 * renderFixerBody.ts — the Instruction Fixer's DOM construction layer (spec-006
 * Phase 3, T3.3 review seam). Extracted out of `InstructionFixerView.ts` (MiYo
 * Constitution L2 Code Quality — files should stay small and focused; the view
 * passed 700 LOC once the re-run bridge landed, and `plan/phase-5.md` pinned
 * this exact split as the follow-up) so that the leaf keeps only what it alone
 * can own: the `ItemView` lifecycle, the adapter I/O, and the mutable
 * save/re-run state with its reference-identity race guards.
 *
 * This is the third module in the same family as `sections.ts` (which answers
 * "which section/tag/badge/reason", DOM-free) and `fixerContract.ts` (which
 * defines where the card body seam sits). The division of labour:
 *
 *   sections.ts        → WHAT each action is (pure derivation over the gate)
 *   renderFixerBody.ts → HOW the leaf is drawn (pure DOM over read-only inputs)
 *   InstructionFixerView.ts → WHEN any of it happens (lifecycle, I/O, races)
 *
 * Everything here is a pure function of `FixerRenderContext`: a snapshot of the
 * view's state plus the callbacks a pressed button should invoke. Nothing in
 * this file reads or writes view state, keeps a reference across a tick, or
 * awaits — which is precisely why the race guards had to stay behind.
 */

import { setIcon, type App } from "obsidian";

import type { Action } from "../../schema/types.js";
import type { InstructionFixerModel } from "../../vault/InstructionSetDoc.js";

import type { FixerCardContext, FixerCardRenderer } from "./fixerContract.js";
import { NO_TRUSTED_SIGNAL, type OutcomeResolution } from "./outcomeSource.js";
import {
	badgeText,
	gateFor,
	gateTag,
	groupActionsByGate,
	outcomeFor,
	outcomeReason,
} from "./sections.js";

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
export interface SaveFailure {
	readonly message: string;
	readonly landed: number | null;
	readonly total: number;
}

/**
 * Everything the render layer is allowed to see: a read-only snapshot of the
 * view's state for this pass, plus the callbacks its buttons fire.
 *
 * Deliberately NOT the view itself — a renderer that could reach `this.store`
 * or `this.saving` would be able to re-enter the state machine whose races
 * `handleSave`/`handleRerun` guard, and the point of the split is that it
 * cannot. The context is rebuilt on every render, so every field is current.
 */
export interface FixerRenderContext {
	/** For pickers and note navigation inside card bodies (T3.2). */
	readonly app: App;
	/** The model being rendered — captured once per pass by the caller. */
	readonly model: InstructionFixerModel;
	/** The Phase-2 outcome resolution the gate is derived from. */
	readonly outcomes: OutcomeResolution;
	/** The last Save rejection, or null. */
	readonly saveError: SaveFailure | null;
	/** Why the last Re-run press produced no run / no finish, or null. */
	readonly rerunError: string | null;
	/** True while a Save is in flight — disables Save/Revert/Re-run. */
	readonly saving: boolean;
	/** True while a re-run is in flight — freezes the whole document. */
	readonly running: boolean;
	/** Whether a re-run bridge is wired at all; absent → Run/Re-run disabled. */
	readonly canRerun: boolean;
	/** Card-body renderer (T3.2). Absent → cards render header-only. */
	readonly card: FixerCardRenderer | undefined;
	onSave(): void;
	onRevert(): void;
	onRerun(): void;
	/** Dispatches a card's domain transform through the view's store. */
	apply(transform: (model: InstructionFixerModel) => InstructionFixerModel): void;
}

/** The panel's headline — what happened to the document, in plain language.
 *
 * Deliberately NOT the error's own message: that string is written for a
 * developer reading a stack trace (class name, method name, "ADR-9",
 * "per-action field patches") and names things the reader cannot act on. It
 * stays on the error object for logs and tests, and is demoted to the detail
 * line below the recovery instruction.
 */
export function saveErrorHeadline(failure: SaveFailure): string {
	if (failure.landed === null) return "Couldn't confirm whether your repairs were saved.";
	if (failure.landed === 0) return "Couldn't save your repairs — nothing was written.";
	return `Wrote ${failure.landed} of ${failure.total} repairs, then hit a problem.`;
}

/** The recovery instruction for a failed Save. See `SaveFailure`. */
export function saveErrorHint(failure: SaveFailure): string {
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

function createButton(
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

/** The leaf-head chrome: identity, meta line, dirty badge, Re-run/Revert/Save. */
export function renderFixerLeafHead(head: HTMLElement, ctx: FixerRenderContext): void {
	head.empty();
	const { model } = ctx;

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

	createButton(actions, "Re-run", ["hashi-se-btn", "hashi-se-subtle"], {
		disabled: ctx.saving || ctx.running || !ctx.canRerun,
		onClick: () => {
			ctx.onRerun();
		},
	});

	createButton(actions, "Revert", ["hashi-se-btn", "hashi-se-subtle"], {
		disabled: ctx.saving || ctx.running,
		onClick: () => {
			ctx.onRevert();
		},
	});

	createButton(actions, "Save", ["hashi-se-btn", "hashi-se-primary"], {
		disabled: ctx.saving || ctx.running || !model.dirty,
		onClick: () => {
			ctx.onSave();
		},
	});
}

/**
 * The leaf body: notices, the no-signal banner (when it has something to
 * offer), then one section per gate group with its cards.
 */
export function renderFixerBody(body: HTMLElement, ctx: FixerRenderContext): void {
	body.empty();

	renderSaveError(body, ctx.saveError);
	renderFixerRerunError(body, ctx.rerunError);

	const actions = ctx.model.doc.actions;
	if (actions.length === 0) {
		body.createDiv({
			cls: "hashi-se-empty",
			text: "No actions in this instruction set.",
		});
		return;
	}

	if (ctx.outcomes === NO_TRUSTED_SIGNAL) {
		renderNoSignalBanner(body, ctx);
	}

	for (const group of groupActionsByGate(actions, ctx.outcomes)) {
		renderSection(body, group.label, group.actions, group.tag, ctx);
	}
}

/**
 * Why the last Re-run press produced no run. One line, no recovery hint:
 * unlike a failed Save there is nothing pending and nothing partly written
 * — either the user saves and presses again, or the run's own error already
 * says what went wrong.
 *
 * Exported because the view renders it on its load-ERROR path too, where there
 * is no body and no model: "the run failed AND the set is now unreadable" is
 * two facts, and the second one does not explain the first.
 */
export function renderFixerRerunError(parent: HTMLElement, message: string | null): void {
	if (message === null) return;
	parent.createDiv({ cls: "hashi-if-rerun-error", text: message });
}

function renderSaveError(body: HTMLElement, error: SaveFailure | null): void {
	if (error === null) return;
	const panel = body.createDiv({ cls: "hashi-if-save-error" });
	panel.createDiv({ cls: "hashi-if-save-error-head", text: saveErrorHeadline(error) });
	panel.createDiv({ cls: "hashi-if-save-error-hint", text: saveErrorHint(error) });
	// The raw diagnostic, last and de-emphasised: it names the failing value
	// or the underlying I/O error, which is worth showing, but it is not the
	// sentence the user should read first.
	panel.createDiv({ cls: "hashi-if-save-error-detail", text: error.message });
}

function renderNoSignalBanner(body: HTMLElement, ctx: FixerRenderContext): void {
	const banner = body.createDiv({ cls: "hashi-if-banner" });
	const text = banner.createDiv({ cls: "hashi-if-banner-text" });
	text.createDiv({ text: "No trusted outcome for this set." });
	text.createDiv({
		cls: "hashi-if-banner-detail",
		text: "Hashi can't tell which actions failed until it runs them.",
	});
	createButton(banner, "Run", ["hashi-se-btn", "hashi-se-primary"], {
		disabled: ctx.saving || ctx.running || !ctx.canRerun,
		onClick: () => {
			ctx.onRerun();
		},
	});
}

function renderSection(
	body: HTMLElement,
	label: string,
	actions: readonly Action[],
	tag: string | null,
	ctx: FixerRenderContext,
): void {
	const section = body.createDiv({ cls: "hashi-if-group" });
	const header = section.createDiv({ cls: "hashi-if-group-header" });
	header.createSpan({ cls: "hashi-if-group-label", text: label });
	header.createSpan({ cls: "hashi-if-group-count", text: String(actions.length) });
	if (tag !== null) header.createSpan({ cls: "hashi-if-group-tag", text: tag });

	for (const action of actions) renderCard(section, action, ctx);
}

/**
 * The card SHELL — header (id · kind), outcome badge and state tag, all of it
 * derived from the outcome/gate the view owns. The body is delegated to the
 * injected renderer (T3.2); see `fixerContract.ts` for why the seam sits
 * exactly here.
 *
 * The failure reason is DERIVED here (one `outcomeReason`, never re-derived
 * downstream) but RENDERED by the card, which is the only collaborator that
 * can place it where the binding layout puts it — between the intent line it
 * explains and the target fields. With no card renderer wired (the T3.1 shell,
 * and the view's own tests), the reason is rendered into the body here so it
 * never silently disappears with the seam.
 */
function renderCard(section: HTMLElement, action: Action, ctx: FixerRenderContext): void {
	const gate = gateFor(action, ctx.outcomes);
	const outcome = outcomeFor(action, ctx.outcomes);

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
	const cardCtx: FixerCardContext = {
		app: ctx.app,
		gate,
		outcome,
		reason,
		apply: (transform) => {
			ctx.apply(transform);
		},
	};

	if (ctx.card !== undefined) {
		ctx.card.render(cardBody, action, cardCtx);
		return;
	}
	if (reason !== null) {
		cardBody.createDiv({ cls: "hashi-if-card-reason", text: reason });
	}
}
