/**
 * Proposed MOCs tab (T3.5, SDD §6 Proposed MOCs, PRD F4/F5). Renders one
 * card per proposed MOC: inline-editable name, a parent control that opens
 * `ParentPicker`, an approve/skip decision toggle, member chips (rendered by
 * the referenced suggestion's TITLE — S## id shown on hover, falling back
 * to the raw id when no suggestion matches), a tag list with a `TagPicker`
 * add affordance, and a "Merge into…" control for same-name siblings.
 *
 * Tag edits have no dedicated Phase-1 transform (`transforms/proposedMoc.ts`
 * only covers rename/reparent/decision/merge) — `addProposedMocTag` below is
 * a small immutable helper local to this file, mirroring that module's
 * find-by-id / no-op-when-unchanged / new-`EditModel` convention rather than
 * editing the shared transforms directory.
 */

import type {
	EditModel,
	ProposedMocWire,
} from "../../../types/suggestions.js";
import {
	mergeSameNameProposedMocs,
	renameProposedMoc,
	reparentProposedMoc,
	setProposedMocDecision,
} from "../../../suggestions/transforms/proposedMoc.js";
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

/** The referenced suggestion's title, or the raw S## id when unresolved. */
function memberTitle(model: EditModel, suggestionId: string): string {
	const suggestion = model.doc.suggestions.find((candidate) => candidate.id === suggestionId);
	return suggestion?.title ?? suggestionId;
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
		const card = container.createDiv({ cls: "hashi-proposed-moc-card" });

		this.renderNameInput(card, moc, ctx);
		this.renderParentControl(card, moc, ctx);
		this.renderDecisionToggle(card, moc, ctx);
		this.renderMembers(card, model, moc);
		this.renderTags(card, moc, ctx);
		this.renderMergeControl(card, model, moc, ctx);
	}

	private renderNameInput(card: HTMLElement, moc: ProposedMocWire, ctx: TabContext): void {
		const input = card.createEl("input", {
			cls: "hashi-proposed-moc-name",
			attr: { type: "text", value: moc.name },
		});
		input.addEventListener("change", () => {
			const name = input.value;
			ctx.apply((m) => renameProposedMoc(m, moc.id, name));
		});
	}

	private renderParentControl(card: HTMLElement, moc: ProposedMocWire, ctx: TabContext): void {
		const button = card.createEl("button", {
			cls: "hashi-proposed-moc-parent",
			text: moc.parent.length > 0 ? moc.parent : "Choose parent…",
		});
		button.addEventListener("click", () => {
			new ParentPicker(ctx.app, (parentPath) => {
				ctx.apply((m) => reparentProposedMoc(m, moc.id, parentPath));
			}).open();
		});
	}

	private renderDecisionToggle(card: HTMLElement, moc: ProposedMocWire, ctx: TabContext): void {
		const button = card.createEl("button", {
			cls: "hashi-proposed-moc-decision",
			text: moc.decision === "approve" ? "Approve" : "Skip",
		});
		button.addEventListener("click", () => {
			const next = moc.decision === "approve" ? "skip" : "approve";
			ctx.apply((m) => setProposedMocDecision(m, moc.id, next));
		});
	}

	private renderMembers(card: HTMLElement, model: EditModel, moc: ProposedMocWire): void {
		const members = card.createDiv({ cls: "hashi-proposed-moc-members" });
		for (const memberId of moc.member_ids) {
			members.createSpan({
				cls: "hashi-proposed-moc-member",
				text: memberTitle(model, memberId),
				attr: { title: memberId },
			});
		}
	}

	private renderTags(card: HTMLElement, moc: ProposedMocWire, ctx: TabContext): void {
		const tags = card.createDiv({ cls: "hashi-proposed-moc-tags" });
		for (const tag of moc.tags ?? []) {
			tags.createSpan({ cls: "hashi-proposed-moc-tag", text: tag });
		}
		const addTagButton = tags.createEl("button", {
			cls: "hashi-proposed-moc-add-tag",
			text: "+ Tag",
		});
		addTagButton.addEventListener("click", () => {
			new TagPicker(ctx.app, (tag) => {
				ctx.apply((m) => addProposedMocTag(m, moc.id, tag));
			}).open();
		});
	}

	private renderMergeControl(
		card: HTMLElement,
		model: EditModel,
		moc: ProposedMocWire,
		ctx: TabContext,
	): void {
		const hasSameNameSibling = model.doc.proposed_mocs.some(
			(other) => other.id !== moc.id && other.name === moc.name,
		);
		if (!hasSameNameSibling) return;

		const button = card.createEl("button", {
			cls: "hashi-proposed-moc-merge",
			text: "Merge into…",
		});
		button.addEventListener("click", () => {
			ctx.apply((m) => mergeSameNameProposedMocs(m, moc.id));
		});
	}
}
