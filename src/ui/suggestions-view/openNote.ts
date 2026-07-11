/**
 * Shared "open a note" affordance for the Suggestions Editor tabs.
 *
 * Several places in the editor reference a source/target note by its bare
 * stem (a suppressed suggestion's origin note, a daily log entry's
 * `source_stem`, …) and the owner wants each of those to be a clickable link
 * that opens the note — mirroring the approved mockup, whose `.wlink` spans
 * carry a `data-open` handler (`docs/XDD/specs/004-suggestions-editor/
 * mockups/suggestions-editor.html`). Rather than repeat the span + click +
 * keyboard wiring at every call site, both tabs render through
 * `renderNoteLink` here.
 *
 * Opening always goes through `workspace.openLinkText` — Hashi never calls
 * `vault.create`; Obsidian resolves the link (and creates the note when it
 * does not exist) exactly as clicking a wikilink would. Resolution is by
 * Obsidian's own link lookup, so a bare stem resolves the same way a
 * `[[stem]]` wikilink would in the active note's context (v1 approximation —
 * same trade-off already documented for the daily-note date control).
 */

import type { App } from "obsidian";

/** Opens (or, per Obsidian's link resolution, creates) the note `linktext` points at. */
export function openNoteByStem(app: App, linktext: string): void {
	void app.workspace.openLinkText(linktext, "", false);
}

/**
 * Appends a clickable `.hashi-se-wlink` to `parent` that opens the note
 * `linktext` resolves to. `text` defaults to `linktext` itself. Keyboard
 * accessible (Enter/Space) and `stopPropagation`s its click so a link nested
 * inside a wider clickable/label region opens the note without also
 * triggering the surrounding control.
 */
export function renderNoteLink(
	parent: HTMLElement,
	app: App,
	linktext: string,
	text: string = linktext,
): HTMLElement {
	const link = parent.createSpan({
		cls: "hashi-se-wlink",
		text,
		attr: {
			role: "link",
			tabindex: "0",
			title: "Open note (creates if missing)",
		},
	});
	link.addEventListener("click", (evt) => {
		evt.stopPropagation();
		openNoteByStem(app, linktext);
	});
	link.addEventListener("keydown", (evt) => {
		if (evt.key !== "Enter" && evt.key !== " ") return;
		evt.preventDefault();
		openNoteByStem(app, linktext);
	});
	return link;
}
