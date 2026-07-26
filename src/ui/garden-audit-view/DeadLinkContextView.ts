/**
 * `renderDeadLinkContext` (spec-005 Phase 6, T6.1) — the dead_link card's
 * async context block. Kicks off `ctx.deadLinkContext(...)`, shows a
 * "Loading context…" placeholder synchronously, then fills in the resolved
 * occurrence snippet(s), a "Note not found." message (the note itself is
 * missing/moved), or a "No longer found in note." hint (the note still
 * exists, but the note has been edited since the audit ran and the flagged
 * `[[dead_target]]` wikilink is simply gone — a Phase-6 validation edge case,
 * distinct from the note-not-found degrade). Extracted as a sibling module
 * (mirrors `SuggestControl.ts`/`TargetControl.ts`'s plain-function widget
 * idiom) rather than inlined in `GardenAuditTab.ts`, which is already past
 * the repo's ~300-500 LOC soft band (Constitution L2).
 *
 * Stale-completion guard: `GardenAuditTab` rebuilds its whole subtree on
 * every re-render (store convention), so a card's placeholder element can be
 * detached from the DOM before its extraction promise resolves — a newer
 * render already kicked off its OWN call for the same finding. After the
 * await, the placeholder's `.isConnected` is checked: if it's gone, the
 * result is dropped silently rather than mutated into a detached, invisible
 * element. This is cheap to just let happen — the extractor's per-note-path
 * promise cache (`deadLinkContext.ts`) means the abandoned call never issued
 * a second vault read.
 */

import type { DeadLinkContextResult } from "../../garden-audit/deadLinkContext.js";

export interface DeadLinkContextViewOptions {
	/** The finding's affected note — where the dead link's occurrences live. */
	readonly notePath: string;
	/** `detail.dead_target` — absent/malformed detail renders nothing at all. */
	readonly deadTarget: string | undefined;
	readonly deadLinkContext: (
		notePath: string,
		deadTarget: string,
	) => Promise<DeadLinkContextResult>;
}

/** Renders into `container`. Caller empties/rebuilds `container` per render (store convention). */
export function renderDeadLinkContext(container: HTMLElement, opts: DeadLinkContextViewOptions): void {
	const { notePath, deadTarget, deadLinkContext } = opts;
	if (deadTarget === undefined) return;

	const placeholder = container.createDiv({ cls: "hashi-ga-context", text: "Loading context…" });

	// Fire-and-forget by design: render() stays synchronous, the resolution
	// mutates the placeholder in place once ready (or drops the result if the
	// placeholder went stale — see file header).
	void deadLinkContext(notePath, deadTarget).then((result) => {
		if (!placeholder.isConnected) return;
		placeholder.empty();
		renderResult(placeholder, result);
	});
}

function renderResult(container: HTMLElement, result: DeadLinkContextResult): void {
	if (result.status === "note-not-found") {
		container.createSpan({ cls: "hashi-ga-context-missing", text: "Note not found." });
		return;
	}

	if (result.occurrences.length === 0) {
		// The note has been edited since the audit ran — the `[[dead_target]]`
		// wikilink is simply gone. Distinct from "note not found": the note
		// still exists, it just no longer contains the flagged link.
		container.createSpan({
			cls: "hashi-ga-context-missing",
			text: "No longer found in note.",
		});
		return;
	}

	for (const occurrence of result.occurrences) {
		const line = container.createDiv({ cls: "hashi-ga-context-line" });
		const prefix = occurrence.heading !== null ? `${occurrence.heading} › ` : "";
		line.createSpan({ text: `…context: ${prefix}"${occurrence.line}"` });
	}
}
