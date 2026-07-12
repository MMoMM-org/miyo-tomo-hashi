/**
 * Tag-Handler tab (T3.7) — one `hashi-se-card hashi-se-tagh` per
 * tag_handler_group, rebuilt to the approved mockup
 * (docs/XDD/specs/004-suggestions-editor/mockups/suggestions-editor.html).
 * Each card shows Tomo's read-only capture context (handler / target_path /
 * marker / source_paths / preview) plus the two editable fields the wire
 * schema actually supports: `approved` (as an Approve/Skip segmented
 * control) and `keep_source` (as a checkbox). There is no separate Skip
 * field on the wire — `approved: false` IS the skipped state (SDD §6
 * Tag-Handler, PRD F9; src/suggestions/transforms/tagHandler.ts).
 *
 * The preview is Tomo-composed arbitrary text (a rendered block, not markup
 * Hashi should interpret) — it is written via `createEl(..., { text })`
 * (textContent), never innerHTML, so it can never be parsed as HTML.
 */

import { setTagGroupApproved, setTagGroupKeepSource } from "../../../suggestions/transforms/tagHandler.js";
import type { EditModel, TagGroupWire } from "../../../types/suggestions.js";
import type { EditorTab, TabContext } from "../tabContract.js";

const NS = "hashi-se";

export class TagHandlerTab implements EditorTab {
	readonly id = "tag-handler";
	readonly label = "Tag-Handler";

	count(model: EditModel): number {
		return model.doc.tag_handler_groups.length;
	}

	render(container: HTMLElement, model: EditModel, ctx: TabContext): void {
		for (const group of model.doc.tag_handler_groups) {
			this.renderCard(container, group, ctx);
		}
	}

	private renderCard(container: HTMLElement, group: TagGroupWire, ctx: TabContext): void {
		const card = container.createDiv({ cls: [`${NS}-card`, `${NS}-tagh`] });
		card.setAttribute("data-group-id", group.group_id);
		const top = card.createDiv({ cls: `${NS}-card-top` });

		this.renderTitle(top, group);
		this.renderContext(top, group);
		this.renderRow2(top, group, ctx);
	}

	private renderTitle(top: HTMLElement, group: TagGroupWire): void {
		const title = top.createDiv({ cls: `${NS}-th-title` });
		title.createSpan({ cls: `${NS}-wlink`, text: group.target_path ?? "—" });
		title.createSpan({ cls: `${NS}-th-marker`, text: group.marker ?? "—" });
	}

	private renderContext(top: HTMLElement, group: TagGroupWire): void {
		const contextBlock = top.createDiv({ cls: `${NS}-th-ctx` });
		contextBlock.createSpan({
			cls: `${NS}-ctx-note`,
			text: "Read-only display context — carried in the wire.",
		});

		const row = contextBlock.createDiv({ cls: `${NS}-th-row` });
		row.appendChild(activeDocument.createTextNode("Handler "));
		row.createEl("code", { text: group.handler ?? "—" });
		row.appendChild(activeDocument.createTextNode(` · Sources ${group.source_paths?.length ?? 0}`));

		// `text:` sets textContent (see test/__mocks__/obsidian.ts) — the
		// composed block is rendered verbatim as text, never as innerHTML.
		contextBlock.createDiv({ cls: `${NS}-th-preview`, text: group.preview ?? "" });
	}

	private renderRow2(top: HTMLElement, group: TagGroupWire, ctx: TabContext): void {
		const row2 = top.createDiv({ cls: `${NS}-row2` });

		this.renderDecision(row2, group, ctx);
		row2.createDiv({ cls: `${NS}-spacer` });
		this.renderKeepSource(row2, group, ctx);
	}

	private renderDecision(row2: HTMLElement, group: TagGroupWire, ctx: TabContext): void {
		const decision = row2.createDiv({ cls: `${NS}-decision` });
		const approve = decision.createEl("button", { cls: `${NS}-approve`, text: "Approve" });
		const skip = decision.createEl("button", { cls: `${NS}-skip`, text: "Skip" });

		this.setDecisionState(approve, skip, group.approved);

		approve.addEventListener("click", () => {
			ctx.apply((model) => setTagGroupApproved(model, group.group_id, true));
		});
		skip.addEventListener("click", () => {
			ctx.apply((model) => setTagGroupApproved(model, group.group_id, false));
		});
	}

	private setDecisionState(approve: HTMLElement, skip: HTMLElement, approved: boolean): void {
		approve.classList.toggle("is-active", approved);
		approve.setAttribute("aria-pressed", String(approved));
		skip.classList.toggle("is-active", !approved);
		skip.setAttribute("aria-pressed", String(!approved));
	}

	private renderKeepSource(row2: HTMLElement, group: TagGroupWire, ctx: TabContext): void {
		const label = row2.createEl("label", { cls: `${NS}-cbx` });
		const input = label.createEl("input", { attr: { type: "checkbox" } });
		input.checked = group.keep_source;
		label.createSpan({ text: "Keep source files" });

		input.addEventListener("change", () => {
			const checked = input.checked;
			ctx.apply((model) => setTagGroupKeepSource(model, group.group_id, checked));
		});
	}
}
