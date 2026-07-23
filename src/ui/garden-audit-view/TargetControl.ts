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
		cls: ["hashi-ga-target-pick", "hashi-se-mini-pick"],
		text: "Choose…",
		attr: { type: "button", "aria-label": "Choose target note from vault" },
	});
	pick.addEventListener("click", () => {
		new TargetNotePicker(app, (path) => {
			input.value = path;
			onChange(path);
		}).open();
	});

	wrap.createSpan({
		cls: "hashi-ga-target-hint",
		text: `(empty=${EMPTY_LABEL[check]})`,
	});
}
