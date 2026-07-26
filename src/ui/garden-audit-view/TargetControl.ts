/**
 * `renderTargetControl` (spec-005 Phase 5, T5.1; SDD ADR-3) — the composite
 * fix-target widget shared by all three fixable-finding target fields
 * (broken_up's repoint, dead_link's replace, orphan/unparented's file_under).
 *
 * A plain function, NOT an Obsidian `Component`: it renders into a given
 * `container`, reports every change through `onChange`, and leaves the
 * caller (T5.2's `GardenAuditTab`) to decide which transform to dispatch —
 * mirrors `SuggestionsTab`'s field-renderer idiom (`renderTemplateField` etc.)
 * rather than introducing a class hierarchy for a widget with no lifecycle
 * of its own. The subtree is rebuilt on every re-render (store convention),
 * so listeners here need no manual cleanup.
 *
 * ADR-3's rationale: the existing fuzzy pickers (`MocPicker`/`VaultNotePicker`
 * & co.) can only return an EXISTING vault note — they can't express a
 * free-typed not-yet-existing target, nor a first-class "explicitly empty"
 * state. This widget adds a text input (bare stem or `[[wikilink]]`, free
 * type or picked) alongside the picker button, plus a constant per-check-type
 * caption naming what an empty commit means — visible regardless of the
 * current value (mirrors the approved mockup's inline "(empty=remove)" /
 * "(empty=unlink)" captions), so the meaning of "empty" is never ambiguous.
 *
 * Per-check empty wording (PRD Detailed Feature Specification; README
 * 2026-07-22 "dead_link empty = UNLINK, not delete" correction):
 *   - dead_link            → "unlink" (strip `[[ ]]`, keep the text)
 *   - broken_up            → "remove" (drop the broken `up::` line)
 *   - orphan / unparented  → "fallback" (use the scan candidate, or skip)
 * `duplicate_stem`/`stale_moc` are advisory-only and never reach this widget
 * (T5.5's read-only cards have no target control) — their map entries exist
 * only so the lookup stays a total function over `FindingCheck`.
 *
 * Target-value format (T5.2, 2026-07-22 handoff — source of truth): a
 * free-typed value commits VERBATIM (bare stem or `[[wikilink]]`, Tomo
 * normalizes either). A PICKED value is different — `TargetNotePicker`
 * returns a full vault-relative path, and the wire's target fields want a
 * bare stem — so the pick handler here converts path → stem (basename minus
 * `.md`) before it ever reaches the input or `onChange`. This is the one
 * seam that knows about picked-vs-typed provenance; callers (the T5.2 cards)
 * only ever see a plain committed string and never re-derive it.
 */

import type { App } from "obsidian";

import type { FindingCheck } from "../../types/garden-audit.js";

import { TargetNotePicker } from "./pickers/TargetNotePicker.js";

const EMPTY_LABEL: Record<FindingCheck, string> = {
	dead_link: "unlink",
	broken_up: "remove",
	orphan: "fallback",
	unparented: "fallback",
	// Advisory checks never render this widget — see file header.
	duplicate_stem: "n/a",
	stale_moc: "n/a",
};

/**
 * Per-check hover explanation for the `(empty=…)` caption (2026-07-23 user
 * QA) — Obsidian renders a plain `aria-label` as a native tooltip (no
 * `setTooltip`/stronger idiom found elsewhere in this repo, see
 * `rg -n "aria-label" src/`), so this map feeds the caption span's
 * `aria-label` directly. Same totality pattern as `EMPTY_LABEL` above:
 * advisory checks get a harmless placeholder since they never reach this
 * widget.
 */
const EMPTY_TOOLTIP: Record<FindingCheck, string> = {
	dead_link:
		"Empty = unlink: the [[brackets]] are removed but the link text is kept, at every occurrence. The note text is not deleted.",
	broken_up:
		"Empty = remove: only the broken link is removed from the up:: line; if it was the only link, up:: is left empty (the field is kept, never deleted).",
	orphan:
		"Empty = fallback: Tomo files the note under the first scan candidate. With no scan candidate the finding is skipped.",
	unparented:
		"Empty = fallback: Tomo files the note under the first scan candidate. With no scan candidate the finding is skipped.",
	// Advisory checks never render this widget — see file header.
	duplicate_stem: "n/a",
	stale_moc: "n/a",
};

/** Basename minus a trailing `.md` — vault path → bare stem. */
function pathToStem(path: string): string {
	const base = path.split("/").pop() ?? path;
	return base.endsWith(".md") ? base.slice(0, -3) : base;
}

export interface TargetControlOptions {
	/** For the picker button's `TargetNotePicker`. */
	readonly app: App;
	/** Selects the empty-state caption's wording. */
	readonly check: FindingCheck;
	/** Current committed value. `undefined` and `""` both render a blank input. */
	readonly value: string | undefined;
	/** Fired on every commit: free-typed change/Enter, or a picker choice. */
	readonly onChange: (value: string) => void;
}

/** Renders the widget's DOM into `container`. Caller empties/rebuilds `container` per render. */
export function renderTargetControl(container: HTMLElement, opts: TargetControlOptions): void {
	const { app, check, value, onChange } = opts;

	const wrap = container.createDiv({ cls: "hashi-ga-target" });

	const input = wrap.createEl("input", {
		cls: ["hashi-ga-target-inp", "hashi-se-inp"],
		attr: {
			type: "text",
			value: value ?? "",
			placeholder: "Type or pick a note…",
			"aria-label": "Target note",
		},
	});

	const commit = (): void => {
		onChange(input.value);
	};
	input.addEventListener("change", commit);
	input.addEventListener("keydown", (evt) => {
		if (evt.key === "Enter") {
			evt.preventDefault();
			commit();
		}
	});

	const pick = wrap.createEl("button", {
		cls: ["hashi-se-mini-pick"],
		text: "Choose…",
		attr: { type: "button", "aria-label": "Choose target note from vault" },
	});
	pick.addEventListener("click", () => {
		new TargetNotePicker(app, (path) => {
			const stem = pathToStem(path);
			input.value = stem;
			onChange(stem);
		}).open();
	});

	wrap.createSpan({
		cls: "hashi-ga-target-hint",
		text: `(empty=${EMPTY_LABEL[check]})`,
		attr: { "aria-label": EMPTY_TOOLTIP[check] },
	});
}
