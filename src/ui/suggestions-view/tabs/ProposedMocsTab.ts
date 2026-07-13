/**
 * Proposed MOCs tab (T3.5, SDD §6 Proposed MOCs, PRD F4/F5). Renders one
 * `hashi-se-pmoc` card per proposed MOC, matching the approved mockup
 * (`docs/XDD/specs/004-suggestions-editor/mockups/suggestions-editor.html`,
 * `proposedCard()`): an inline-editable name, a parent mini-pick control
 * that opens `ParentPicker`, an approve/skip segmented decision control,
 * member chips (rendered by the referenced suggestion's TITLE — S## id
 * shown on hover, falling back to the raw id when no suggestion matches), a
 * "⇄ Merge into…" affordance that folds this proposal into any OTHER proposal
 * (via `MergeTargetPicker` → `mergeProposedMocs`), a tag list whose chips are
 * individually removable plus a `TagPicker` add affordance, the read-only
 * reason text, and an informational merge hint when another proposal shares
 * this one's name.
 *
 * Tag edits have no dedicated Phase-1 transform (`transforms/proposedMoc.ts`
 * only covers rename/reparent/decision/merge) — `addProposedMocTag` /
 * `removeProposedMocTag` below are small immutable helpers local to this file,
 * mirroring that module's find-by-id / no-op-when-unchanged / new-`EditModel`
 * convention rather than editing the shared transforms directory.
 */

import type {
	EditModel,
	ProposedMocWire,
} from "../../../types/suggestions.js";
import {
	mergeProposedMocs,
	renameProposedMoc,
	reparentProposedMoc,
	setProposedMocDecision,
} from "../../../suggestions/transforms/proposedMoc.js";
import { MergeTargetPicker } from "../pickers/MergeTargetPicker.js";
import { ParentPicker } from "../pickers/ParentPicker.js";
import { TagPicker } from "../pickers/TagPicker.js";
import type { EditorTab, TabContext } from "../tabContract.js";

/**
 * Adds `tag` to a proposed MOC's `tags` list (deduped, order-preserving).
 * No-op (same model reference, `dirty` untouched) when the id is unknown or
 * the tag is already present — same convention as
 * `transforms/proposedMoc.ts`'s `updateProposedMoc`.
 */
function addProposedMocTag(model: EditModel, mocId: string, tag: string): EditModel {
	const moc = model.doc.proposed_mocs.find((candidate) => candidate.id === mocId);
	if (moc === undefined) return model;

	const existingTags = moc.tags ?? [];
	if (existingTags.includes(tag)) return model;

	const updated: ProposedMocWire = { ...moc, tags: [...existingTags, tag] };
	const proposedMocs = model.doc.proposed_mocs.map((candidate) =>
		candidate.id === mocId ? updated : candidate,
	);
	return { doc: { ...model.doc, proposed_mocs: proposedMocs }, dirty: true };
}

/**
 * Removes `tag` from a proposed MOC's `tags` list. No-op (same model
 * reference, `dirty` untouched) when the id is unknown or the tag is absent —
 * same convention as `addProposedMocTag`.
 */
function removeProposedMocTag(model: EditModel, mocId: string, tag: string): EditModel {
	const moc = model.doc.proposed_mocs.find((candidate) => candidate.id === mocId);
	if (moc === undefined) return model;

	const existingTags = moc.tags ?? [];
	if (!existingTags.includes(tag)) return model;

	const updated: ProposedMocWire = { ...moc, tags: existingTags.filter((t) => t !== tag) };
	const proposedMocs = model.doc.proposed_mocs.map((candidate) =>
		candidate.id === mocId ? updated : candidate,
	);
	return { doc: { ...model.doc, proposed_mocs: proposedMocs }, dirty: true };
}

/** The referenced suggestion's title, or the raw S## id when unresolved. */
function memberTitle(model: EditModel, suggestionId: string): string {
	const suggestion = model.doc.suggestions.find((candidate) => candidate.id === suggestionId);
	return suggestion?.title ?? suggestionId;
}

/** Another proposed MOC in the doc shares `moc`'s name — the merge trigger. */
function hasSameNameSibling(model: EditModel, moc: ProposedMocWire): boolean {
	return model.doc.proposed_mocs.some((other) => other.id !== moc.id && other.name === moc.name);
}

export class ProposedMocsTab implements EditorTab {
	readonly id = "proposed";
	readonly label = "Proposed MOCs";

	count(model: EditModel): number {
		return model.doc.proposed_mocs.length;
	}

	render(container: HTMLElement, model: EditModel, ctx: TabContext): void {
		for (const moc of model.doc.proposed_mocs) {
			this.renderCard(container, model, moc, ctx);
		}
	}

	private renderCard(
		container: HTMLElement,
		model: EditModel,
		moc: ProposedMocWire,
		ctx: TabContext,
	): void {
		const card = container.createDiv({ cls: "hashi-se-pmoc" });

		this.renderRow1(card, moc, ctx);
		this.renderMembersRow(card, model, moc, ctx);
		this.renderTagsRow(card, moc, ctx);
		this.renderReason(card, moc);
		this.renderMergeHint(card, model, moc);
	}

	// -- row 1: name / parent / decision ------------------------------------

	private renderRow1(card: HTMLElement, moc: ProposedMocWire, ctx: TabContext): void {
		const row = card.createDiv({ cls: "hashi-se-row1" });
		this.renderNameField(row, moc, ctx);
		this.renderParentField(row, moc, ctx);
		this.renderDecisionField(row, moc, ctx);
	}

	private renderNameField(row: HTMLElement, moc: ProposedMocWire, ctx: TabContext): void {
		const field = row.createDiv({ cls: ["hashi-se-field", "hashi-se-field-grow"] });
		field.createEl("label", { text: `Name (${moc.id})` });
		const input = field.createEl("input", {
			cls: ["hashi-se-inp", "hashi-se-name"],
			attr: { type: "text", value: moc.name },
		});
		input.addEventListener("change", () => {
			const name = input.value;
			ctx.apply((m) => renameProposedMoc(m, moc.id, name));
		});
	}

	private renderParentField(row: HTMLElement, moc: ProposedMocWire, ctx: TabContext): void {
		const field = row.createDiv({ cls: "hashi-se-field" });
		field.createEl("label", { text: "Parent" });
		const button = field.createEl("button", {
			cls: "hashi-se-mini-pick",
			text: moc.parent,
			attr: { type: "button" },
		});
		button.addEventListener("click", () => {
			new ParentPicker(ctx.app, (parentPath) => {
				ctx.apply((m) => reparentProposedMoc(m, moc.id, parentPath));
			}).open();
		});
	}

	private renderDecisionField(row: HTMLElement, moc: ProposedMocWire, ctx: TabContext): void {
		const field = row.createDiv({ cls: "hashi-se-field" });
		field.createEl("label", { text: "Create?" });
		const decision = field.createDiv({ cls: "hashi-se-decision" });

		const approveButton = decision.createEl("button", {
			cls: "hashi-se-approve",
			text: "Approve",
			attr: { type: "button" },
		});
		const skipButton = decision.createEl("button", {
			cls: "hashi-se-skip",
			text: "Skip",
			attr: { type: "button" },
		});
		this.setDecisionState(approveButton, skipButton, moc.decision === "approve");

		approveButton.addEventListener("click", () => {
			ctx.apply((m) => setProposedMocDecision(m, moc.id, "approve"));
		});
		skipButton.addEventListener("click", () => {
			ctx.apply((m) => setProposedMocDecision(m, moc.id, "skip"));
		});
	}

	/** Mirrors TagHandlerTab's decision-toggle convention: class + aria-pressed together. */
	private setDecisionState(approve: HTMLElement, skip: HTMLElement, approved: boolean): void {
		approve.classList.toggle("is-active", approved);
		approve.setAttribute("aria-pressed", String(approved));
		skip.classList.toggle("is-active", !approved);
		skip.setAttribute("aria-pressed", String(!approved));
	}

	// -- row 2: members + merge affordance -----------------------------------

	private renderMembersRow(
		card: HTMLElement,
		model: EditModel,
		moc: ProposedMocWire,
		ctx: TabContext,
	): void {
		const row = card.createDiv({ cls: "hashi-se-row2" });

		const members = row.createDiv({ cls: "hashi-se-members" });
		members.createSpan({ cls: "hashi-se-lbl", text: "Members" });
		for (const memberId of moc.member_ids) {
			members.createSpan({
				cls: ["hashi-se-chip", "hashi-se-member"],
				text: memberTitle(model, memberId),
				attr: { title: memberId },
			});
		}

		row.createDiv({ cls: "hashi-se-spacer" });

		// Merge into any OTHER proposal (owner refinement — no longer gated on a
		// same-name sibling). Hidden only when this is the sole proposal.
		const others = model.doc.proposed_mocs.filter((other) => other.id !== moc.id);
		if (others.length === 0) return;

		const mergeButton = row.createEl("button", {
			cls: "hashi-se-link-btn",
			text: "⇄ merge into…",
			attr: { type: "button" },
		});
		mergeButton.addEventListener("click", () => {
			new MergeTargetPicker(
				ctx.app,
				others.map((other) => ({ id: other.id, name: other.name })),
				(targetId) => {
					ctx.apply((m) => mergeProposedMocs(m, moc.id, targetId));
				},
			).open();
		});
	}

	// -- row 2: tags ----------------------------------------------------------

	private renderTagsRow(card: HTMLElement, moc: ProposedMocWire, ctx: TabContext): void {
		const row = card.createDiv({ cls: "hashi-se-row2" });
		row.createSpan({ cls: "hashi-se-tags-lbl", text: "Tags" });
		for (const tag of moc.tags ?? []) {
			this.renderTagChip(row, moc, tag, ctx);
		}
		const addTagButton = row.createEl("button", {
			cls: ["hashi-se-tag", "hashi-se-add"],
			text: "＋ tag",
			attr: { type: "button" },
		});
		addTagButton.addEventListener("click", () => {
			new TagPicker(
				ctx.app,
				(tag) => {
					ctx.apply((m) => addProposedMocTag(m, moc.id, tag));
				},
				ctx.pickerScopes?.tagFilters,
			).open();
		});
	}

	/** A tag chip with an `×` remove control (edit = remove + re-add via ＋ tag). */
	private renderTagChip(
		row: HTMLElement,
		moc: ProposedMocWire,
		tag: string,
		ctx: TabContext,
	): void {
		const chip = row.createSpan({ cls: "hashi-se-tag" });
		chip.createSpan({ cls: "hashi-se-tag-text", text: tag });
		const remove = chip.createEl("button", {
			cls: "hashi-se-tag-x",
			text: "×",
			attr: { type: "button", "aria-label": `Remove tag ${tag}` },
		});
		remove.addEventListener("click", () => {
			ctx.apply((m) => removeProposedMocTag(m, moc.id, tag));
		});
	}

	// -- reason + merge hint --------------------------------------------------

	private renderReason(card: HTMLElement, moc: ProposedMocWire): void {
		if (moc.reason === undefined || moc.reason.length === 0) return;
		card.createDiv({ cls: "hashi-se-reason", text: moc.reason });
	}

	private renderMergeHint(card: HTMLElement, model: EditModel, moc: ProposedMocWire): void {
		if (!hasSameNameSibling(model, moc)) return;
		card.createDiv({
			cls: "hashi-se-merge-hint",
			text: "◆ shares a name with another proposal → Tomo will merge them and union members",
		});
	}
}
