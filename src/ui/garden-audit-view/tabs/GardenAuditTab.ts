/**
 * GardenAuditTab (spec-005 Phase 4) — the Garden-Audit Editor's single tab.
 *
 * T4.1 MINIMAL SHELL: `count()` is already the real total-findings count (the
 * view's empty-state gate depends on it being correct from the start), but
 * `render()` is a placeholder — a flat, unGrouped finding-id list — just
 * enough for the view's lifecycle tests to exercise a non-empty body. T4.2
 * replaces `render()` with the real tier-grouped shell (Integrity/Structure/
 * Advisory sections + count pills, wire order preserved within each tier).
 */

import type { GardenAuditModel } from "../../../types/garden-audit.js";
import type { GardenAuditTabContext, GardenAuditTabSpec } from "../tabContract.js";

export class GardenAuditTab implements GardenAuditTabSpec {
	count(model: GardenAuditModel): number {
		return model.doc.findings.length;
	}

	render(container: HTMLElement, model: GardenAuditModel, _ctx: GardenAuditTabContext): void {
		for (const finding of model.doc.findings) {
			container.createDiv({ text: finding.id });
		}
	}
}
