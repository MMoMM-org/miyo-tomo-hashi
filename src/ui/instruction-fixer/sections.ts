/**
 * sections.ts — the Instruction Fixer's gate-derived section grouping (spec-006
 * Phase 3, T3.1/T3.2 review seam). Extracted out of `InstructionFixerView.ts`
 * (MiYo Constitution L2 Code Quality — files should stay small and focused;
 * two independent reviews flagged the view's 650+ LOC and named this exact
 * seam) so the DECISION of which section/tag/badge/reason an action gets is
 * pure and DOM-free, testable without a rendered leaf. The view still owns all
 * DOM construction (`renderSection`, `renderCard`, `renderNoSignalBanner`) —
 * this module only ever answers "what", never "how it's drawn".
 *
 * Group membership is derived from the Phase-2 edit gate (`editGate`,
 * `outcomeSource.ts`), never re-derived independently: `editable` → "Needs
 * repair", `frozen-applied` → "Applied", `read-only-no-signal` → "Not
 * attempted", failed-first because that's the whole point of the surface. A
 * `NO_TRUSTED_SIGNAL` resolution collapses everything into one read-only "All
 * actions" group instead — see `outcomeSource.ts` for why that state exists.
 */

import type { ActionOutcome } from "../../executor/state.js";
import type { Action } from "../../schema/types.js";

import { editGate, NO_TRUSTED_SIGNAL, type EditGateResult, type OutcomeResolution } from "./outcomeSource.js";

/** One rendered section: its human label, card tag, and member actions. */
export interface ActionGroup {
	readonly label: string;
	/** Per-card state tag for every action in this group, or null (editable). */
	readonly tag: string | null;
	readonly actions: readonly Action[];
}

const GATE_SECTIONS: readonly { readonly gate: EditGateResult; readonly label: string }[] = [
	// Failed first — the whole point of the surface.
	{ gate: "editable", label: "Needs repair" },
	{ gate: "frozen-applied", label: "Applied" },
	{ gate: "read-only-no-signal", label: "Not attempted" },
];

/** Per-card state tag, or null when the card needs none (it is editable). */
const GATE_TAGS: Record<EditGateResult, string | null> = {
	editable: null,
	"frozen-applied": "frozen",
	"read-only-no-signal": "read-only",
};

/** The gate for ONE action, always paired with that same action's `applied`. */
export function gateFor(action: Action, outcomes: OutcomeResolution): EditGateResult {
	return editGate(action, outcomes, action.applied);
}

/** The trusted outcome for one action, or null (no signal at all, or never attempted). */
export function outcomeFor(action: Action, outcomes: OutcomeResolution): ActionOutcome | null {
	if (outcomes === NO_TRUSTED_SIGNAL) return null;
	return outcomes.get(action.id) ?? null;
}

/** The per-card state tag for a gate. See `GATE_TAGS`. */
export function gateTag(gate: EditGateResult): string | null {
	return GATE_TAGS[gate];
}

/** The outcome's own `kind`, verbatim — no lookup table to drift out of sync. */
export function badgeText(outcome: ActionOutcome | null): string {
	return outcome === null ? "—" : outcome.kind;
}

/** The one-line "why" beneath a card header, or null when there is nothing to say. */
export function outcomeReason(outcome: ActionOutcome | null): string | null {
	if (outcome === null) return null;
	if (outcome.kind === "failed") return outcome.reason === "" ? null : outcome.reason;
	if (outcome.kind === "skipped-dependency") {
		return outcome.dependsOn === "" ? null : `depends on ${outcome.dependsOn}`;
	}
	return null;
}

/**
 * Partitions `actions` into the sections the view renders.
 *
 * With a trusted resolution, this is the three `GATE_SECTIONS` buckets
 * (failed-first order), each omitted when empty. With `NO_TRUSTED_SIGNAL`,
 * every action collapses into a single read-only "All actions" group instead
 * — viewing stays unrestricted even though nothing is editable (ADR-027 ①).
 */
export function groupActionsByGate(
	actions: readonly Action[],
	outcomes: OutcomeResolution,
): readonly ActionGroup[] {
	if (outcomes === NO_TRUSTED_SIGNAL) {
		return [{ label: "All actions", tag: "read-only", actions }];
	}

	const groups: ActionGroup[] = [];
	for (const section of GATE_SECTIONS) {
		const matched = actions.filter((action) => gateFor(action, outcomes) === section.gate);
		if (matched.length === 0) continue;
		groups.push({ label: section.label, tag: null, actions: matched });
	}
	return groups;
}
