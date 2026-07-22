/**
 * GardenAuditTab (spec-005 Phase 4, T4.2) — the Garden-Audit Editor's single
 * tab: three tier sections — Integrity, Structure, Advisory (SDD "User
 * Interface & UX" Information Architecture) — each with a count, findings
 * kept in wire order within a tier (no re-sorting), each finding row showing
 * its id.
 *
 * Grouped by `finding.tier` directly (already computed by Tomo) rather than
 * re-deriving from `finding.check` — the wire is the source of truth for
 * which tier a check belongs to. `TIER_ORDER` fixes the section order
 * regardless of the tier field's relative order in `findings[]` (Tomo
 * already emits severity-ordered, but this doesn't rely on that).
 *
 * `renderFindingRow` is a deliberate PLACEHOLDER — id · check · target path
 * only. Phase 5 replaces it with the real card (Apply/Skip, target control,
 * candidates, suggest toggle); this task only establishes the tier shell
 * findings render into.
 */

import type {
	FindingTier,
	FindingWire,
	GardenAuditModel,
} from "../../../types/garden-audit.js";
import type { GardenAuditTabContext, GardenAuditTabSpec } from "../tabContract.js";

const TIER_ORDER: readonly FindingTier[] = ["integrity", "structure", "advisory"];

const TIER_LABELS: Record<FindingTier, string> = {
	integrity: "INTEGRITY",
	structure: "STRUCTURE",
	advisory: "ADVISORY",
};

export class GardenAuditTab implements GardenAuditTabSpec {
	count(model: GardenAuditModel): number {
		return model.doc.findings.length;
	}

	render(container: HTMLElement, model: GardenAuditModel, ctx: GardenAuditTabContext): void {
		for (const tier of TIER_ORDER) {
			const findings = model.doc.findings.filter((f) => f.tier === tier);
			this.renderTierSection(container, tier, findings, ctx);
		}
	}

	private renderTierSection(
		container: HTMLElement,
		tier: FindingTier,
		findings: readonly FindingWire[],
		ctx: GardenAuditTabContext,
	): void {
		const section = container.createDiv({ cls: "hashi-ga-tier" });
		const header = section.createDiv({ cls: "hashi-ga-tier-header" });
		header.createSpan({ cls: "hashi-ga-tier-label", text: TIER_LABELS[tier] });
		header.createSpan({ cls: "hashi-ga-tier-count", text: String(findings.length) });

		for (const finding of findings) {
			this.renderFindingRow(section, finding, ctx);
		}
	}

	private renderFindingRow(
		container: HTMLElement,
		finding: FindingWire,
		_ctx: GardenAuditTabContext,
	): void {
		const row = container.createDiv({
			cls: "hashi-ga-finding-row",
			attr: { "data-finding-id": finding.id },
		});
		row.createSpan({ cls: "hashi-ga-finding-id", text: finding.id });
		row.createSpan({ cls: "hashi-ga-finding-check", text: finding.check });
		row.createSpan({ cls: "hashi-ga-finding-target", text: finding.target.path });
	}
}
