/**
 * `renderNavigableNoteLink` (spec-005 Phase 6, T6.2; PRD F9) — the Garden-
 * Audit Editor's note-reference affordance: click opens the target beside
 * the editor (a side-split leaf), hover makes Obsidian's page hover-preview
 * available, and a target that no longer resolves (moved/deleted since the
 * audit ran) degrades to plain text + "note not found" instead of a dead
 * link.
 *
 * Deliberately a SIBLING of `suggestions-view/openNote.ts`'s `renderNoteLink`
 * rather than a shared helper: that module is used by the spec-004
 * Suggestions Editor too, whose links must keep REPLACING the active leaf
 * (`openLinkText(linktext, "", false)`, unchanged) — see that file's header.
 * Garden-audit's F9 wants a different navigation contract (side-split +
 * hover-preview + missing-note degrade), so this module owns it rather than
 * growing `openNote.ts` with a branchy options bag two unrelated editors
 * would have to reason about.
 *
 * Existence check: `metadataCache.getFirstLinkpathDest` is the standard
 * Obsidian idiom for "does this link resolve to a file" at render time (not
 * the content-read race documented in docs/ai/memory/troubleshooting.md —
 * this only resolves a path, it never reads note content). Guarded by
 * `typeof` so a mock/host missing the method degrades to the same
 * "note not found" rendering rather than throwing.
 */

import type { App } from "obsidian";

/**
 * Stable `hover-link` event source id — identifies Hashi as the trigger's
 * emitter. Exported so `main.ts` can register it with
 * `Plugin.registerHoverLinkSource` (Obsidian's Page Preview settings entry) —
 * single-sourced so the id used in the trigger payload and the registration
 * can never drift apart.
 */
export const HOVER_LINK_SOURCE = "miyo-tomo-hashi";

function resolvesToFile(app: App, linktext: string, sourcePath: string): boolean {
	if (typeof app.metadataCache.getFirstLinkpathDest !== "function") return false;
	return app.metadataCache.getFirstLinkpathDest(linktext, sourcePath) !== null;
}

/**
 * Appends a clickable `.hashi-se-wlink` (same look as the Suggestions
 * Editor's note links) to `parent` — click opens `linktext` in a side-split
 * leaf, hover fires `hover-link` for Obsidian's page preview. If `linktext`
 * doesn't resolve to a vault file, renders inert plain text plus a
 * "(note not found)" tag instead, and returns that element unlinked.
 */
export function renderNavigableNoteLink(
	parent: HTMLElement,
	app: App,
	linktext: string,
	text: string = linktext,
): HTMLElement {
	const sourcePath = "";

	if (!resolvesToFile(app, linktext, sourcePath)) {
		const missing = parent.createSpan({ cls: "hashi-ga-note-missing", text });
		missing.createSpan({ cls: "hashi-ga-note-missing-tag", text: " (note not found)" });
		return missing;
	}

	const link = parent.createSpan({
		cls: "hashi-se-wlink",
		text,
		attr: {
			role: "link",
			tabindex: "0",
			title: "Open note beside",
		},
	});

	const open = (): void => {
		void app.workspace.openLinkText(linktext, sourcePath, "split");
	};
	link.addEventListener("click", (evt) => {
		evt.stopPropagation();
		open();
	});
	link.addEventListener("keydown", (evt) => {
		if (evt.key !== "Enter" && evt.key !== " ") return;
		evt.preventDefault();
		open();
	});
	link.addEventListener("mouseover", (evt) => {
		app.workspace.trigger("hover-link", {
			event: evt,
			source: HOVER_LINK_SOURCE,
			hoverParent: link,
			targetEl: link,
			linktext,
			sourcePath,
		});
	});

	return link;
}
