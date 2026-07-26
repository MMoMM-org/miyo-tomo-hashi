/**
 * `renderSuggestControl` (spec-005 Phase 5, T5.4) — the "Suggest targets"
 * checkbox + two-run hint states shared by all three fixable-finding cards
 * (broken_up/dead_link/orphan/unparented). Extracted as a sibling module
 * rather than inlined in `GardenAuditTab.ts` — mirrors `TargetControl.ts`'s
 * plain-function widget idiom (no lifecycle of its own; rebuilt on every
 * re-render) and keeps the tab file inside the repo's ~300-500 LOC soft band
 * (Constitution L2 — Code Quality) rather than pushing it past 500.
 *
 * Two independent wire fields drive three mutually-exclusive states (Tomo's
 * 2026-07-23 reply handoff, `_inbox/from-tomo/…garden-audit-suggested-marker-
 * and-wire-reupload.md` — authoritative):
 *   - `suggest_requested` (editable, Hashi-owned) — the user ticked the box.
 *   - `suggested`         (read-only, Tomo-owned)  — `--suggest` processed
 *     this finding on its last run, whatever the candidate count.
 *
 * Precedence (checked in this order — `suggested` wins over
 * `suggest_requested` once candidates are ruled out):
 *   1. `decision.candidates` non-empty  → no hint (the chip row already shows
 *      them).
 *   2. `suggested === true`             → "No suggestions found." (ran, came
 *      back empty) — shown regardless of the current `suggest_requested`
 *      tick, per the handoff's explicit two-state test (both tick states show
 *      it).
 *   3. `suggest_requested === true`     → pending hint (ticked, never ran —
 *      covers both a fresh tick and every pre-030 wire, which never carries
 *      `suggested` at all: absent behaves as "never ran" by construction).
 *   4. otherwise                        → no hint.
 */

import type { DecisionWire } from "../../types/garden-audit.js";

const PENDING_HINT = "Suggestions pending — run /garden-audit --suggest in Tomo, then reopen.";
const EMPTY_HINT = "No suggestions found.";

interface SuggestHint {
	readonly text: string;
	/** BEM-ish `--modifier` variant class (repo convention — see `.hashi-ga-chip-row--llm`/`--scan`). */
	readonly modifierClass: string;
}

/** Pure precedence lookup — exported for direct unit testing without a DOM. */
export function resolveSuggestHint(decision: DecisionWire): SuggestHint | undefined {
	if ((decision.candidates?.length ?? 0) > 0) return undefined;
	if (decision.suggested === true) {
		return { text: EMPTY_HINT, modifierClass: "hashi-ga-suggest-hint--empty" };
	}
	if (decision.suggest_requested === true) {
		return { text: PENDING_HINT, modifierClass: "hashi-ga-suggest-hint--pending" };
	}
	return undefined;
}

export interface SuggestControlOptions {
	readonly decision: DecisionWire;
	/** Fired on every checkbox change with the new checked state. */
	readonly onToggle: (checked: boolean) => void;
}

/** Renders the widget's DOM into `container`. Caller empties/rebuilds `container` per render. */
export function renderSuggestControl(container: HTMLElement, opts: SuggestControlOptions): void {
	const { decision, onToggle } = opts;

	const wrap = container.createDiv({ cls: "hashi-ga-suggest" });

	// Dual-class idiom (see `TargetControl.ts`/`GardenAuditTab.renderApplySkip`):
	// `hashi-ga-suggest-toggle` is the unstyled semantic/test hook,
	// `hashi-se-cbx` (reused from `SuggestionsTab`) carries the actual look.
	const label = wrap.createEl("label", { cls: ["hashi-ga-suggest-label", "hashi-se-cbx"] });
	const checkbox = label.createEl("input", {
		cls: "hashi-ga-suggest-toggle",
		attr: { type: "checkbox" },
	});
	checkbox.checked = decision.suggest_requested === true;
	label.createSpan({ text: "Suggest targets" });
	checkbox.addEventListener("change", () => {
		onToggle(checkbox.checked);
	});

	const hint = resolveSuggestHint(decision);
	if (hint !== undefined) {
		wrap.createSpan({ cls: ["hashi-ga-suggest-hint", hint.modifierClass], text: hint.text });
	}
}
