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
 * the target note's title as an openable link (Phase 6 T6.2:
 * `noteNavigation.renderNavigableNoteLink` — side-split open + hover-preview,
 * see that module's header for why it's a sibling of the Suggestions
 * Editor's `openNote.renderNoteLink` rather than a shared helper).
 *
 * An advisory finding (`duplicate_stem`/`stale_moc` — never `fixable`, never
 * carries a `decision`) renders through `renderAdvisoryCard` (T5.5): a
 * strictly read-only card, dimmed via `.hashi-ga-card--advisory`, showing
 * only its per-check detail (colliding paths / last-modified) — no Apply
 * toggle, target field, or candidate chip, only its note-title link is
 * interactive. This is a UI-level guarantee on top of the wire's structural
 * one (advisory findings have no `decision` block, so the fixable transforms
 * are already no-ops for them).
 *
 * T4.4: an all-advisory run (zero `fixable` findings) still renders every
 * tier section — including the advisory cards — but leads with a "Nothing
 * to apply" note, since Save would have nothing to act on. This is NOT the
 * same as the view's zero-findings empty state (GardenAuditEditorView's
 * `count(model) === 0` gate) — there ARE findings here, just none fixable.
 *
 * T5.3: each fixable card also renders its scored candidate chips beneath the
 * target field — `decision.candidates` (LLM, all four checks) and, for
 * unparented/orphan, `detail.candidate_mocs` (scan) as a SEPARATE row. Chips
 * are display-only advisory input (SDD "User Interface & UX" / Handoff Q2):
 * a click writes the chip's stem into the SAME per-check transform the
 * TargetControl uses (never `decision.selected`), so the pick becomes an
 * explicit committed value rather than a second channel Tomo reads.
 *
 * T5.4: each fixable card also renders a "Suggest targets" checkbox +
 * two-run hint (pending / "no suggestions found") beneath the chips, via
 * `renderSuggestField` → `SuggestControl.renderSuggestControl` — extracted to
 * a sibling module (mirrors `TargetControl.ts`) rather than inlined here, to
 * keep this file inside the repo's LOC soft band. The toggle routes through
 * `transforms.setSuggestRequested`; the hint precedence between the editor's
 * own `suggest_requested` and Tomo's `suggested` ran-marker lives in
 * `SuggestControl.ts`, not here.
 *
 * 2026-07-23 (user decision): committing a target change on a SKIPPED finding
 * (`decision.selected === false`) through `TargetControl` — a free-typed
 * commit (change/Enter) or a picker pick, both of which fire the SAME
 * `onChange` — flips it to Apply in the same dispatch (target intent implies
 * apply intent). `renderTargetField` is the single site this is wired: it
 * chains `setSelected(…, true)` onto the per-check setter's result, but ONLY
 * when the setter actually changed the model (`next !== model` — a same-value
 * re-commit is a no-op and must not auto-apply; an explicit-empty commit that
 * clears a previously non-empty target DOES change the model, so it also
 * flips to Apply). `setSelected` on an already-`true` decision is itself a
 * no-op (`transforms.ts`), so an already-Apply finding is unaffected. Applies
 * uniformly to all three target fields (repoint/replace/file_under).
 * Candidate CHIPS are explicitly excluded from this rule (PRD F4 / SDD
 * "Q2 precedence" — candidates are display-only and never auto-applied): the
 * chip click handlers in `renderCandidateChips`/`renderChipRow` dispatch the
 * per-check setter directly, never through `renderTargetField`'s `onChange`.
 */

import type {
	FindingCheck,
	FindingTier,
	FindingWire,
	GardenAuditModel,
} from "../../../types/garden-audit.js";
import {
	setFileUnder,
	setRepoint,
	setReplace,
	setSelected,
	setSuggestRequested,
} from "../../../garden-audit/transforms.js";
import { renderDeadLinkContext } from "../DeadLinkContextView.js";
import { renderNavigableNoteLink } from "../noteNavigation.js";
import { renderSuggestControl } from "../SuggestControl.js";
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

/**
 * Guarded string-array read (for `duplicate_stem`'s `dupes`) — a missing key,
 * a non-array value, or non-string entries within the array all degrade
 * rather than crash: non-array returns `undefined` (caller falls back to an
 * empty list), non-string entries are silently skipped.
 */
function detailStringArray(detail: Record<string, unknown>, key: string): string[] | undefined {
	const raw = detail[key];
	if (!Array.isArray(raw)) return undefined;
	return raw.filter((entry): entry is string => typeof entry === "string");
}

/** The target note's display title — falls back to the full path if Tomo left `stem` null. */
function targetTitle(finding: FindingWire): string {
	return finding.target.stem ?? finding.target.path;
}

// ---------------------------------------------------------------------------
// Candidate chips (T5.3) — one normalized {stem, score} shape for both the
// LLM row (`decision.candidates`, already this shape) and the scan row
// (`detail.candidate_mocs`, keyed `target_moc` on the wire — see
// src/types/garden-audit.ts's file header on why `detail` stays a generic
// Record rather than a per-check union).
// ---------------------------------------------------------------------------

interface ChipCandidate {
	readonly stem: string;
	readonly score: number;
}

/**
 * Reads `detail.candidate_mocs` defensively: a missing field, a non-array
 * value, or a malformed entry (wrong key name / wrong field type) is skipped
 * rather than crashing the card — `detail` is opaque, per-check data Hashi
 * doesn't control the shape of.
 */
function readScanCandidates(detail: Record<string, unknown>): ChipCandidate[] {
	const raw = detail["candidate_mocs"];
	if (!Array.isArray(raw)) return [];

	const candidates: ChipCandidate[] = [];
	for (const entry of raw) {
		if (typeof entry !== "object" || entry === null) continue;
		const targetMoc = (entry as Record<string, unknown>)["target_moc"];
		const score = (entry as Record<string, unknown>)["score"];
		if (typeof targetMoc === "string" && typeof score === "number") {
			candidates.push({ stem: targetMoc, score });
		}
	}
	return candidates;
}

/** Mockup format `⟨stem .60⟩` — a leading "0." on the score reads as noise at chip size. */
function formatScore(score: number): string {
	const fixed = score.toFixed(2);
	return fixed.startsWith("0.") ? fixed.slice(1) : fixed;
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
			this.renderAdvisoryCard(row, finding, ctx);
		}
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
				// Fall back to the strict read-only card rather than crash if
				// that invariant ever breaks.
				this.renderAdvisoryCard(row, finding, ctx);
				return;
		}
	}

	// -- shared card scaffolding ----------------------------------------------

	/**
	 * `readOnly` (T5.5) adds the `--advisory` dim modifier and a trailing
	 * "(read-only)" tag to the header — the note link stays the one
	 * interactive element either way.
	 */
	private renderCardHeader(
		row: HTMLElement,
		finding: FindingWire,
		ctx: GardenAuditTabContext,
		lead: string,
		readOnly = false,
	): HTMLElement {
		const card = row.createDiv({ cls: readOnly ? ["hashi-ga-card", "hashi-ga-card--advisory"] : "hashi-ga-card" });
		const header = card.createDiv({ cls: "hashi-ga-card-header" });
		header.createSpan({ text: `${finding.id} · ${lead}` });
		renderNavigableNoteLink(header, ctx.app, targetTitle(finding));
		if (readOnly) {
			header.createSpan({ cls: "hashi-ga-card-readonly-tag", text: "(read-only)" });
		}
		return card;
	}

	/**
	 * Apply/Skip segmented toggle — mirrors `SuggestionsTab.renderDecisionControl`
	 * (`aria-pressed` on both buttons), narrowed to the boolean `decision.selected`
	 * this editor uses instead of the Suggestions Editor's 3-state decision enum.
	 *
	 * `hashi-ga-apply`/`hashi-ga-skip` carry no rules of their own in
	 * styles.css — they're intentionally unstyled semantic/test hooks
	 * (query selectors, not style targets); the actual look rides entirely
	 * on the paired `hashi-se-approve`/`hashi-se-skip` classes reused from
	 * the Suggestions Editor.
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

	/**
	 * Renders both candidate chip rows beneath a card's target field —
	 * `decision.candidates` (LLM, all checks) and, when present, the scan row
	 * from `detail.candidate_mocs` (unparented/orphan only in practice, but
	 * driven by whatever `detail` actually carries rather than gated by
	 * `finding.check`). Absent/empty sources render no row at all (T5.4 owns
	 * the pending/none hint states, not this method).
	 */
	private renderCandidateChips(
		card: HTMLElement,
		finding: FindingWire,
		committedValue: string | undefined,
		onPick: (stem: string) => void,
	): void {
		const llmCandidates = finding.decision?.candidates ?? [];
		if (llmCandidates.length > 0) {
			this.renderChipRow(card, "hashi-ga-chip-row--llm", "Suggested", llmCandidates, committedValue, onPick);
		}

		const scanCandidates = readScanCandidates(finding.detail);
		if (scanCandidates.length > 0) {
			this.renderChipRow(
				card,
				"hashi-ga-chip-row--scan",
				"Scan candidates",
				scanCandidates,
				committedValue,
				onPick,
			);
		}
	}

	/** One scored chip row — `<button>`s so chips are keyboard-activatable. */
	private renderChipRow(
		card: HTMLElement,
		rowClass: string,
		label: string,
		candidates: readonly ChipCandidate[],
		committedValue: string | undefined,
		onPick: (stem: string) => void,
	): void {
		const row = card.createDiv({ cls: ["hashi-ga-chip-row", rowClass] });
		row.createSpan({ cls: "hashi-ga-chip-row-label", text: label });

		for (const candidate of candidates) {
			const isActive = candidate.stem === committedValue;
			const chip = row.createEl("button", {
				cls: isActive ? ["hashi-ga-chip", "is-active"] : ["hashi-ga-chip"],
				text: `⟨${candidate.stem} ${formatScore(candidate.score)}⟩`,
				attr: { type: "button", "aria-pressed": String(isActive) },
			});
			// Candidates are display-only advisory input (Handoff Q2): a click
			// writes the stem via the SAME per-check transform the
			// TargetControl uses, becoming an explicit value — it NEVER
			// touches `decision.selected`.
			chip.addEventListener("click", () => onPick(candidate.stem));
		}
	}

	/**
	 * Renders the shared `TargetControl` widget and wires its `onChange` to
	 * `setTarget` (the finding's per-check setter — `setRepoint`/`setReplace`/
	 * `setFileUnder`). This is the SINGLE site that implements the 2026-07-23
	 * "target edit on a Skip auto-selects Apply" rule (see file-header note):
	 * a commit that actually changes the model (`next !== model`, the
	 * transforms' own no-op-on-same-ref idiom) also flips `selected` to true.
	 * Candidate chips do NOT go through this method's `onChange` — they call
	 * `setTarget` directly from their own click handlers — which is how they
	 * stay excluded from auto-apply.
	 */
	private renderTargetField(
		card: HTMLElement,
		ctx: GardenAuditTabContext,
		label: string,
		check: FindingCheck,
		findingId: string,
		value: string | undefined,
		setTarget: (model: GardenAuditModel, findingId: string, value: string) => GardenAuditModel,
	): void {
		const field = card.createDiv({ cls: "hashi-ga-target-field" });
		field.createEl("label", { text: label });
		renderTargetControl(field, {
			app: ctx.app,
			check,
			value,
			onChange: (next) => {
				ctx.apply((model) => {
					const updated = setTarget(model, findingId, next);
					return updated === model ? model : setSelected(updated, findingId, true);
				});
			},
		});
	}

	/**
	 * T5.4 — "Suggest targets" toggle + pending/no-suggestions hints, shared
	 * by every fixable card (widget itself lives in `SuggestControl.ts` — see
	 * that file's header for the state precedence). Routes through
	 * `transforms.setSuggestRequested`, which already marks the model dirty
	 * on a suggest-only edit (PRD F5/F7 — dirty is NOT digest-gated) — this
	 * method never re-implements that.
	 */
	private renderSuggestField(card: HTMLElement, finding: FindingWire, ctx: GardenAuditTabContext): void {
		// Guard rather than assert: only fixable findings with a `decision`
		// reach this method (renderFindingRow gates the call), but TS doesn't
		// carry that narrowing across the method boundary.
		if (finding.decision === undefined) return;
		const decision = finding.decision;
		renderSuggestControl(card, {
			decision,
			onToggle: (checked) => {
				ctx.apply((model) => setSuggestRequested(model, finding.id, checked));
			},
		});
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
			ctx,
			"Repoint to",
			"broken_up",
			finding.id,
			finding.decision?.repoint,
			setRepoint,
		);
		this.renderCandidateChips(card, finding, finding.decision?.repoint, (stem) => {
			ctx.apply((model) => setRepoint(model, finding.id, stem));
		});
		this.renderSuggestField(card, finding, ctx);
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

		renderDeadLinkContext(card, {
			notePath: finding.target.path,
			deadTarget,
			deadLinkContext: ctx.deadLinkContext,
		});

		this.renderTargetField(
			card,
			ctx,
			"Replace with",
			"dead_link",
			finding.id,
			finding.decision?.replace,
			setReplace,
		);
		this.renderCandidateChips(card, finding, finding.decision?.replace, (stem) => {
			ctx.apply((model) => setReplace(model, finding.id, stem));
		});
		this.renderSuggestField(card, finding, ctx);
	}

	// -- orphan/unparented: file_under --------------------------------------

	private renderFileUnderCard(row: HTMLElement, finding: FindingWire, ctx: GardenAuditTabContext): void {
		const lead = finding.check === "orphan" ? "orphan:" : "unparented:";
		const card = this.renderCardHeader(row, finding, ctx, lead);

		const decisionRow = card.createDiv({ cls: "hashi-ga-card-row" });
		this.renderApplySkip(decisionRow, finding, ctx);

		this.renderTargetField(
			card,
			ctx,
			"File under",
			finding.check,
			finding.id,
			finding.decision?.file_under,
			setFileUnder,
		);
		this.renderCandidateChips(card, finding, finding.decision?.file_under, (stem) => {
			ctx.apply((model) => setFileUnder(model, finding.id, stem));
		});
		this.renderSuggestField(card, finding, ctx);
	}

	// -- advisory: duplicate_stem / stale_moc — strictly read-only (T5.5) ------

	/**
	 * Advisory findings carry no `decision` block on the wire — that's the
	 * structural guarantee that they can't be mutated. This card is the
	 * matching UI-level guarantee (SDD EARS "WHILE rendering an advisory
	 * finding, THE SYSTEM SHALL expose no Apply/target/candidate/suggest
	 * control"): only `renderCardHeader`'s note link is interactive; every
	 * other span here is inert text.
	 */
	private renderAdvisoryCard(row: HTMLElement, finding: FindingWire, ctx: GardenAuditTabContext): void {
		const lead = finding.check === "stale_moc" ? "stale MOC" : "duplicate stem";
		const card = this.renderCardHeader(row, finding, ctx, lead, true);

		if (finding.check === "stale_moc") {
			this.renderStaleMocDetail(card, finding);
		} else {
			this.renderDuplicateStemDetail(card, finding);
		}
	}

	/** Mirrors Tomo's `.md` rendering: "Last modified: <mtime>". */
	private renderStaleMocDetail(card: HTMLElement, finding: FindingWire): void {
		const mtime = detailString(finding.detail, "mtime");
		const detailRow = card.createDiv({ cls: "hashi-ga-card-row" });
		detailRow.createSpan({
			cls: "hashi-ga-card-detail",
			text: `Last modified: ${mtime ?? "(unknown)"}`,
		});
	}

	/**
	 * Mirrors Tomo's `.md` rendering: "Notes sharing stem <stem>:" followed by
	 * one line per FULL colliding path (paths — not stems — disambiguate the
	 * collision). Plain text lines, not links: the note link in the header
	 * stays the card's only interactive element.
	 */
	private renderDuplicateStemDetail(card: HTMLElement, finding: FindingWire): void {
		const stem = finding.target.stem ?? finding.target.path;
		const dupes = detailStringArray(finding.detail, "dupes") ?? [];

		const detailRow = card.createDiv({ cls: "hashi-ga-card-row" });
		detailRow.createSpan({
			cls: "hashi-ga-card-detail",
			text: `Notes sharing stem "${stem}":`,
		});

		const list = card.createDiv({ cls: "hashi-ga-advisory-dupes" });
		if (dupes.length === 0) {
			list.createDiv({ cls: "hashi-ga-advisory-dupe", text: "(no colliding paths reported)" });
			return;
		}
		for (const path of dupes) {
			list.createDiv({ cls: "hashi-ga-advisory-dupe", text: path });
		}
	}
}
