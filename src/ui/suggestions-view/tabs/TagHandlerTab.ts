/**
 * Tag-Handler tab (T3.7) — one card per tag_handler_group. Each card shows
 * Tomo's read-only capture context (handler / target_path / marker /
 * source_paths / preview) plus the two editable toggles the wire schema
 * actually supports: Approve and Keep-source. There is no separate Skip
 * control — `approved: false` IS the skipped state (SDD §6 Tag-Handler,
 * PRD F9; src/suggestions/transforms/tagHandler.ts).
 *
 * The preview is Tomo-composed arbitrary text (a rendered block, not markup
 * Hashi should interpret) — it is written via `createEl(...).text`
 * (textContent), never innerHTML, so it can never be parsed as HTML.
 */

import { setTagGroupApproved, setTagGroupKeepSource } from "../../../suggestions/transforms/tagHandler.js";
import type { EditModel, TagGroupWire } from "../../../types/suggestions.js";
import type { EditorTab, TabContext } from "../tabContract.js";

const NS = "hashi-suggestions-editor-tag-handler";

export class TagHandlerTab implements EditorTab {
	readonly id = "tag-handler";
	readonly label = "Tag-Handler";

	count(model: EditModel): number {
		return model.doc.tag_handler_groups.length;
	}

	render(container: HTMLElement, model: EditModel, ctx: TabContext): void {
		const list = container.createDiv({ cls: `${NS}-list` });
		for (const group of model.doc.tag_handler_groups) {
			this.renderCard(list, group, ctx);
		}
	}

	private renderCard(list: HTMLElement, group: TagGroupWire, ctx: TabContext): void {
		const card = list.createDiv({ cls: `${NS}-card` });
		card.setAttribute("data-group-id", group.group_id);

		const context = card.createDiv({ cls: `${NS}-context` });
		this.renderField(context, "Handler", group.handler);
		this.renderField(context, "Target", group.target_path);
		this.renderField(context, "Marker", group.marker);
		this.renderSourcePaths(context, group.source_paths);
		this.renderPreview(context, group.preview);

		this.renderControls(card, group, ctx);
	}

	private renderField(
		container: HTMLElement,
		label: string,
		value: string | null | undefined,
	): void {
		const row = container.createDiv({ cls: `${NS}-field` });
		row.createSpan({ cls: `${NS}-field-label`, text: `${label}:` });
		row.createSpan({ cls: `${NS}-field-value`, text: value ?? "—" });
	}

	private renderSourcePaths(
		container: HTMLElement,
		sourcePaths: readonly string[] | undefined,
	): void {
		const row = container.createDiv({ cls: `${NS}-field` });
		row.createSpan({ cls: `${NS}-field-label`, text: "Source paths:" });
		const list = row.createEl("ul", { cls: `${NS}-source-paths` });
		for (const path of sourcePaths ?? []) {
			list.createEl("li", { text: path });
		}
	}

	private renderPreview(container: HTMLElement, preview: string | undefined): void {
		container.createDiv({ cls: `${NS}-field-label`, text: "Preview:" });
		// `text:` sets textContent (see test/__mocks__/obsidian.ts) — the
		// composed block is rendered verbatim as text, never as innerHTML.
		container.createEl("pre", { cls: `${NS}-preview`, text: preview ?? "" });
	}

	private renderControls(card: HTMLElement, group: TagGroupWire, ctx: TabContext): void {
		const controls = card.createDiv({ cls: `${NS}-controls` });
		this.renderToggle(controls, "Approve", group.approved, `${NS}-approve`, (checked) => {
			ctx.apply((model) => setTagGroupApproved(model, group.group_id, checked));
		});
		this.renderToggle(controls, "Keep source", group.keep_source, `${NS}-keep-source`, (checked) => {
			ctx.apply((model) => setTagGroupKeepSource(model, group.group_id, checked));
		});
	}

	private renderToggle(
		container: HTMLElement,
		label: string,
		checked: boolean,
		cls: string,
		onChange: (checked: boolean) => void,
	): void {
		const wrapper = container.createEl("label", { cls: `${NS}-toggle` });
		const input = wrapper.createEl("input", { cls, attr: { type: "checkbox" } });
		input.checked = checked;
		wrapper.createSpan({ text: label });
		input.addEventListener("change", () => onChange(input.checked));
	}
}
