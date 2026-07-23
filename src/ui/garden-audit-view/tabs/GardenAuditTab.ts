/**
 * GardenAuditTab (spec-005 Phase 4 T4.2 tier shell + Phase 5 T5.2 fixable
 * cards) — the Garden-Audit Editor's single tab: three tier sections —
 * Integrity, Structure, Advisory (SDD "User Interface & UX" Information
 * Architecture) — each with a count, findings kept in wire order within a
 * tier (no re-sorting).
 *
 * Grouped by `finding.tier` directly (already computed by Tomo) rather than
 * re-deriving from `finding.check` — the wire is the source of truth for
 * which tier a check belongs to. `TIER_ORDER` fixes the section order
 * regardless of the tier field's relative order in `findings[]` (Tomo
 * already emits severity-ordered, but this doesn't rely on that).
 *
 * A `fixable` finding (unparented/orphan/broken_up/dead_link — always has a
 * `decision`) now renders its real interactive card: an Apply/Skip toggle
 * (`renderDecisionControl` idiom from `SuggestionsTab`, ADR-5-safe for
 * broken_up via `transforms.setRepoint`), a per-check `TargetControl`, and
 * the target note's title as an openable link (`openNote.renderNoteLink`).
 * An advisory finding still renders through `renderAdvisoryPlaceholder` — a
 * deliberate placeholder; T5.5 gives advisory findings their own strictly
 * read-only card.
 *
 * T4.4: an all-advisory run (zero `fixable` findings) still renders every
 * tier section — including the advisory cards — but leads with a "Nothing
 * to apply" note, since Save would have nothing to act on. This is NOT the
 * same as the view's zero-findings empty state (GardenAuditEditorView's
 * `count(model) === 0` gate) — there ARE findings here, just none fixable.
 */

import type {
	FindingCheck,
	FindingTier,
	FindingWire,
	GardenAuditModel,
} from "../../../types/garden-audit.js";
import { setFileUnder, setRepoint, setReplace, setSelected } from "../../../garden-audit/transforms.js";
import { renderNoteLink } from "../../suggestions-view/openNote.js";
import type { GardenAuditTabContext, GardenAuditTabSpec } from "../tabContract.js";
import { renderTargetControl } from "../TargetControl.js";

const TIER_ORDER: readonly FindingTier[] = ["integrity", "structure", "advisory"];

// Title Case source text — the repo convention (see .hashi-se-sec-label in
// SuggestionsTab.ts/styles.css) keeps DOM text sentence/Title case and does
// the visual all-caps via CSS `text-transform`, not baked into the string.
const TIER_LABELS: Record<FindingTier, string> = {
	integrity: "Integrity",
	structure: "Structure",
	advisory: "Advisory",
};

// ---------------------------------------------------------------------------
// `detail` is a generic Record<string, unknown> (per-check, opaque) — these
// guards read it defensively so a missing/mistyped field degrades the card
// display rather than crashing it.
// ---------------------------------------------------------------------------

function detailString(detail: Record<string, unknown>, key: string): string | undefined {
	const value = detail[key];
	return typeof value === "string" ? value : undefined;
}

function detailNumber(detail: Record<string, unknown>, key: string): number | undefined {
	const value = detail[key];
	return typeof value === "number" ? value : undefined;
}

/** The target note's display title — falls back to the full path if Tomo left `stem` null. */
function targetTitle(finding: FindingWire): string {
	return finding.target.stem ?? finding.target.path;
}

export class GardenAuditTab implements GardenAuditTabSpec {
	count(model: GardenAuditModel): number {
		return model.doc.findings.length;
	}

	render(container: HTMLElement, model: GardenAuditModel, ctx: GardenAuditTabContext): void {
		const hasFixable = model.doc.findings.some((f) => f.fixable);
		if (!hasFixable) {
			container.createDiv({
				cls: "hashi-ga-nothing-to-apply",
				text: "Nothing to apply — this run has no fixable findings.",
			});
		}

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

	private renderFindingRow(container: HTMLElement, finding: FindingWire, ctx: GardenAuditTabContext): void {
		const row = container.createDiv({
			cls: "hashi-ga-finding-row",
			attr: { "data-finding-id": finding.id },
		});

		if (finding.fixable && finding.decision !== undefined) {
			this.renderFixableCard(row, finding, ctx);
		} else {
			this.renderAdvisoryPlaceholder(row, finding);
		}
	}

	// -- advisory placeholder (T4.2; real read-only card is T5.5) ----------

	private renderAdvisoryPlaceholder(row: HTMLElement, finding: FindingWire): void {
		row.createSpan({ cls: "hashi-ga-finding-id", text: finding.id });
		row.createSpan({ cls: "hashi-ga-finding-check", text: finding.check });
		row.createSpan({ cls: "hashi-ga-finding-target", text: finding.target.path });
	}

	// -- fixable card dispatch ------------------------------------------------

	private renderFixableCard(row: HTMLElement, finding: FindingWire, ctx: GardenAuditTabContext): void {
		switch (finding.check) {
			case "broken_up":
				this.renderBrokenUpCard(row, finding, ctx);
				return;
			case "dead_link":
				this.renderDeadLinkCard(row, finding, ctx);
				return;
			case "orphan":
			case "unparented":
				this.renderFileUnderCard(row, finding, ctx);
				return;
			case "duplicate_stem":
			case "stale_moc":
				// Schema-level invariant: these two checks are never `fixable`.
				// Fall back to the placeholder rather than crash if that ever breaks.
				this.renderAdvisoryPlaceholder(row, finding);
				return;
		}
	}

	// -- shared card scaffolding ----------------------------------------------

	private renderCardHeader(row: HTMLElement, finding: FindingWire, ctx: GardenAuditTabContext, lead: string): HTMLElement {
		const card = row.createDiv({ cls: "hashi-ga-card" });
		const header = card.createDiv({ cls: "hashi-ga-card-header" });
		header.createSpan({ text: `${finding.id} · ${lead}` });
		renderNoteLink(header, ctx.app, targetTitle(finding));
		return card;
	}

	/**
	 * Apply/Skip segmented toggle — mirrors `SuggestionsTab.renderDecisionControl`
	 * (`aria-pressed` on both buttons), narrowed to the boolean `decision.selected`
	 * this editor uses instead of the Suggestions Editor's 3-state decision enum.
	 */
	private renderApplySkip(container: HTMLElement, finding: FindingWire, ctx: GardenAuditTabContext): void {
		// Guard rather than assert: only fixable findings with a `decision`
		// reach this method (renderFindingRow gates the call), but TS doesn't
		// carry that narrowing across the method boundary.
		if (finding.decision === undefined) return;
		const decision = finding.decision;
		const control = container.createDiv({ cls: ["hashi-ga-decision", "hashi-se-decision"] });

		const applyActive = decision.selected;
		const apply = control.createEl("button", {
			cls: applyActive
				? ["hashi-ga-apply", "hashi-se-approve", "is-active"]
				: ["hashi-ga-apply", "hashi-se-approve"],
			text: "Apply",
			attr: { type: "button", "aria-pressed": String(applyActive) },
		});
		apply.addEventListener("click", () => {
			ctx.apply((model) => setSelected(model, finding.id, true));
		});

		const skipActive = !decision.selected;
		const skip = control.createEl("button", {
			cls: skipActive ? ["hashi-ga-skip", "hashi-se-skip", "is-active"] : ["hashi-ga-skip", "hashi-se-skip"],
			text: "Skip",
			attr: { type: "button", "aria-pressed": String(skipActive) },
		});
		skip.addEventListener("click", () => {
			ctx.apply((model) => setSelected(model, finding.id, false));
		});
	}

	private renderTargetField(
		card: HTMLElement,
		finding: FindingWire,
		ctx: GardenAuditTabContext,
		label: string,
		check: FindingCheck,
		value: string | undefined,
		onChange: (value: string) => void,
	): void {
		const field = card.createDiv({ cls: "hashi-ga-target-field" });
		field.createEl("label", { text: label });
		renderTargetControl(field, { app: ctx.app, check, value, onChange });
	}

	// -- broken_up: repoint (ADR-5 action-gating lives in transforms.setRepoint) --

	private renderBrokenUpCard(row: HTMLElement, finding: FindingWire, ctx: GardenAuditTabContext): void {
		const card = this.renderCardHeader(row, finding, ctx, "broken up:: in");

		const upTarget = detailString(finding.detail, "up_target");
		const detailRow = card.createDiv({ cls: "hashi-ga-card-row" });
		detailRow.createSpan({
			cls: "hashi-ga-card-detail",
			text: `up:: → ${upTarget ?? "(unknown)"}`,
		});
		this.renderApplySkip(detailRow, finding, ctx);

		this.renderTargetField(
			card,
			finding,
			ctx,
			"Repoint to",
			"broken_up",
			finding.decision?.repoint,
			(value) => {
				ctx.apply((model) => setRepoint(model, finding.id, value));
			},
		);
	}

	// -- dead_link: replace ------------------------------------------------

	private renderDeadLinkCard(row: HTMLElement, finding: FindingWire, ctx: GardenAuditTabContext): void {
		const card = this.renderCardHeader(row, finding, ctx, "dead link in");

		const deadTarget = detailString(finding.detail, "dead_target");
		const count = detailNumber(finding.detail, "count");
		const detailRow = card.createDiv({ cls: "hashi-ga-card-row" });
		const label = deadTarget !== undefined ? `[[${deadTarget}]]` : "[[unknown]]";
		const countSuffix = count !== undefined ? ` (${count}×)` : "";
		detailRow.createSpan({ cls: "hashi-ga-card-detail", text: `${label}${countSuffix}` });
		this.renderApplySkip(detailRow, finding, ctx);

		this.renderTargetField(
			card,
			finding,
			ctx,
			"Replace with",
			"dead_link",
			finding.decision?.replace,
			(value) => {
				ctx.apply((model) => setReplace(model, finding.id, value));
			},
		);
	}

	// -- orphan/unparented: file_under --------------------------------------

	private renderFileUnderCard(row: HTMLElement, finding: FindingWire, ctx: GardenAuditTabContext): void {
		const lead = finding.check === "orphan" ? "orphan:" : "unparented:";
		const card = this.renderCardHeader(row, finding, ctx, lead);

		const decisionRow = card.createDiv({ cls: "hashi-ga-card-row" });
		this.renderApplySkip(decisionRow, finding, ctx);

		this.renderTargetField(
			card,
			finding,
			ctx,
			"File under",
			finding.check,
			finding.decision?.file_under,
			(value) => {
				ctx.apply((model) => setFileUnder(model, finding.id, value));
			},
		);
	}
}
