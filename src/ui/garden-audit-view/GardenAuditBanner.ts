/**
 * `renderGardenAuditBanner` (spec-005 Phase 6, 2026-07-24 suggest_pending
 * gate) — the two-state header banner rendered at the TOP of
 * `GardenAuditTab.render`, before the tier sections, so it re-renders live as
 * the user toggles "Suggest targets" checkboxes. Extracted as a sibling
 * module rather than inlined in `GardenAuditTab.ts` — mirrors
 * `SuggestControl.ts`'s plain-function widget idiom (no lifecycle of its own;
 * rebuilt on every re-render) and curbs further growth of the tab file. NOTE:
 * `GardenAuditTab.ts` is already over the repo's ~300-500 LOC soft band
 * (Constitution L2); this extraction reduces the growth, it does not bring the
 * file into compliance — a dedicated split (candidate-chips / card renderers)
 * is a tracked follow-up.
 *
 * Two independent, mutually-exclusive-by-precedence states, both derived
 * straight from the model via `transforms.ts`'s pure predicates (no
 * duplicated finding-scan logic):
 *
 *   - pending (`hasPendingSuggest`) — ≥1 finding has a requested-but-not-yet-
 *     enriched suggest. Blocking state: Saving now would park the run
 *     (`applyApprovalGate`), so this ALWAYS wins over the fresh state below
 *     if somehow both are true at once.
 *   - fresh (`countFreshFindings`) — nothing pending, but ≥1 finding is
 *     "fresh" (Tomo enriched it and left ≥1 display-only candidate). Purely
 *     informational — points at the highlighted cards below
 *     (`GardenAuditTab.renderCardHeader`'s `--fresh` modifier + badge).
 *   - neither → no banner.
 */

import {
	countFreshFindings,
	hasPendingSuggest,
} from "../../garden-audit/transforms.js";
import type { GardenAuditModel } from "../../types/garden-audit.js";

const PENDING_TEXT =
	"Suggestions requested — run /garden-audit --suggest in Tomo, then reopen. " +
	"Saving now parks this run; it won't be applied until suggestions are generated.";

function freshText(count: number): string {
	// Literal "finding(s)" — mirrors ObsidianSuggestionsDoc.ts's "date(s)"
	// convention rather than a fully-conjugated singular/plural swap.
	return (
		`Suggestions generated — ${count} finding(s) with new suggestions are highlighted below. ` +
		"Review them, then Save to approve."
	);
}

/** Renders the banner into `container` when one of the two states applies; renders nothing otherwise. */
export function renderGardenAuditBanner(container: HTMLElement, model: GardenAuditModel): void {
	if (hasPendingSuggest(model)) {
		container.createDiv({
			cls: ["hashi-ga-banner", "hashi-ga-banner--pending"],
			text: PENDING_TEXT,
		});
		return;
	}

	const freshCount = countFreshFindings(model);
	if (freshCount > 0) {
		container.createDiv({
			cls: ["hashi-ga-banner", "hashi-ga-banner--fresh"],
			text: freshText(freshCount),
		});
	}
}
