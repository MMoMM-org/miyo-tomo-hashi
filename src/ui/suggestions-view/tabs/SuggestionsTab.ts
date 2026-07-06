/**
 * Suggestions tab (T3.2, SDD §6 Suggestions, PRD F2/F6/F7). Renders one card
 * per `SuggestionWire`, branching on `suggestion.suppressed`:
 *
 * - **worthy** (`suppressed:false`) — the full note-editable surface: title
 *   (free text), template (`TemplatePicker`), location (`LocationPicker`),
 *   tags (list + `TagPicker` add), candidate MOCs (single-select re-point +
 *   per-candidate `SpotPicker` + `＋ Add MOC` via `MocPicker`), keep-source,
 *   and an approve/skip decision toggle.
 * - **suppressed** (`suppressed:true`) — ONLY a worthiness badge, a short
 *   "why skipped" hint, and the single Force-Atomic control
 *   (`setForceAtomicFromSuggestion`, which keeps the daily-log mirror in
 *   sync by stem — SDD §6 "Force-Atomic is one decision per source"). Tomo
 *   emits an empty `candidate_mocs` for suppressed suggestions, so there is
 *   no MOC UI to render here, and no other field is exposed for them either
 *   (matches the "single real control" framing in SDD §6).
 *
 * Plain render function, not an Obsidian `Component` — the view rebuilds
 * this tab's whole DOM subtree on every re-render (`ctx.apply` triggers a
 * fresh `render()` from the store), so bare `addEventListener` on
 * freshly-created elements never leaks: the old subtree (and its listeners)
 * is discarded wholesale, and `registerDomEvent` is unavailable here anyway
 * (tabs are not Components — see src/CLAUDE.md).
 *
 * Candidate-anchor set (op 2, SpotPicker): Phase 1 has no dedicated
 * transform for `candidate_mocs[].anchor` (`transforms/suggestion.ts` only
 * covers op 1 re-point/add, op 4 decision, and the plain note fields).
 * Rather than touch the shared transforms directory for one call site,
 * `setCandidateAnchor` below is a small local, pure `EditModel -> EditModel`
 * helper mirroring that module's `updateSuggestion` convention: it
 * spreads/maps into new objects/arrays and returns the SAME model reference
 * (no-op) when the suggestion or candidate is unknown.
 */

import { type App, TFile } from "obsidian";

import { setForceAtomicFromSuggestion } from "../../../suggestions/transforms/forceAtomicSync.js";
import {
	addMoc,
	selectCandidateMoc,
	setDecision,
	setKeepSource,
	setLocation,
	setTags,
	setTemplate,
	setTitle,
} from "../../../suggestions/transforms/suggestion.js";
import type {
	AnchorWire,
	CandidateMocWire,
	EditModel,
	SuggestionWire,
} from "../../../types/suggestions.js";
import { LocationPicker } from "../pickers/LocationPicker.js";
import { MocPicker } from "../pickers/MocPicker.js";
import { SpotPicker } from "../pickers/SpotPicker.js";
import { TagPicker } from "../pickers/TagPicker.js";
import { TemplatePicker } from "../pickers/TemplatePicker.js";
import type { EditorTab, TabContext } from "../tabContract.js";

// ---------------------------------------------------------------------------
// Local anchor-set helper — see file header re: no Phase-1 transform for this
// ---------------------------------------------------------------------------

/** Structural equality for `alt_headings` — order-sensitive, absent treated as empty. */
function altHeadingsEqual(a?: readonly string[], b?: readonly string[]): boolean {
	const left = a ?? [];
	const right = b ?? [];
	return left.length === right.length && left.every((value, i) => value === right[i]);
}

/**
 * Structural equality between a candidate's CURRENT anchor (`null` when
 * unresolved) and an INCOMING anchor from the picker. `AnchorWire` is flat,
 * so a field-by-field compare (rather than a reference `===` or a
 * key-order-fragile `JSON.stringify`) is enough. `null`/`undefined` never
 * equals an incoming anchor — `onPick` always supplies a concrete
 * `AnchorWire` (never `null`), so an unresolved candidate always counts as a
 * real change.
 */
function anchorsEqual(current: AnchorWire | null | undefined, incoming: AnchorWire): boolean {
	if (current === null || current === undefined) return false;
	return (
		current.type === incoming.type &&
		(current.value ?? null) === (incoming.value ?? null) &&
		current.placement === incoming.placement &&
		(current.new_section ?? null) === (incoming.new_section ?? null) &&
		(current.fit_confidence ?? null) === (incoming.fit_confidence ?? null) &&
		altHeadingsEqual(current.alt_headings, incoming.alt_headings)
	);
}

/**
 * Sets `anchor` on the candidate MOC named `mocPath` within `suggestionId`.
 * No-op (same model reference, `dirty` untouched) when the suggestion or the
 * candidate is unknown, OR when the candidate's current anchor already
 * structurally equals `anchor` — mirrors every sibling setter in
 * `transforms/suggestion.ts`: re-picking the same spot must not dirty the
 * doc.
 */
function setCandidateAnchor(
	model: EditModel,
	suggestionId: string,
	mocPath: string,
	anchor: AnchorWire,
): EditModel {
	const suggestion = model.doc.suggestions.find((s) => s.id === suggestionId);
	if (suggestion === undefined) return model;

	const candidate = suggestion.candidate_mocs.find((c) => c.path === mocPath);
	if (candidate === undefined) return model;
	if (anchorsEqual(candidate.anchor, anchor)) return model;

	const candidate_mocs: CandidateMocWire[] = suggestion.candidate_mocs.map((c) =>
		c.path === mocPath ? { ...c, anchor } : c,
	);
	const nextSuggestion: SuggestionWire = { ...suggestion, candidate_mocs };
	const suggestions = model.doc.suggestions.map((s) =>
		s.id === suggestionId ? nextSuggestion : s,
	);
	return { doc: { ...model.doc, suggestions }, dirty: true };
}

// ---------------------------------------------------------------------------
// Vault content read for SpotPicker (op 2) — read fresh at click time, never
// cached (mirrors SpotPicker's own "race-safe #68" framing). Falls back to
// an empty string (SpotPicker's no-structure / membership-only rendering)
// rather than throwing, so a moved/deleted candidate note degrades
// gracefully instead of breaking the affordance.
// ---------------------------------------------------------------------------

async function readMocContent(app: App, path: string): Promise<string> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return "";
	try {
		return await app.vault.read(file);
	} catch {
		return "";
	}
}

export class SuggestionsTab implements EditorTab {
	readonly id = "suggestions";
	readonly label = "Suggestions";

	count(model: EditModel): number {
		return model.doc.suggestions.length;
	}

	render(container: HTMLElement, model: EditModel, ctx: TabContext): void {
		for (const suggestion of model.doc.suggestions) {
			this.renderCard(container, suggestion, ctx);
		}
	}

	private renderCard(container: HTMLElement, suggestion: SuggestionWire, ctx: TabContext): void {
		const card = container.createDiv({
			cls: suggestion.suppressed
				? ["hashi-suggestion-card", "hashi-suggestion-card-suppressed"]
				: ["hashi-suggestion-card"],
			attr: { "data-suggestion-id": suggestion.id },
		});

		if (suggestion.suppressed) {
			this.renderSuppressed(card, suggestion, ctx);
			return;
		}
		this.renderWorthy(card, suggestion, ctx);
	}

	// -- suppressed: worthiness badge + hint + the single Force-Atomic control --

	private renderSuppressed(card: HTMLElement, suggestion: SuggestionWire, ctx: TabContext): void {
		const worthinessPct = Math.round((suggestion.worthiness ?? 0) * 100);
		card.createDiv({
			cls: "hashi-suggestion-worthiness",
			text: `Worthiness: ${worthinessPct}%`,
		});
		card.createDiv({
			cls: "hashi-suggestion-skip-hint",
			text: "Below the atomic-note threshold — kept as a light inbox block, not its own note.",
		});
		this.renderForceAtomic(card, suggestion, ctx);
	}

	private renderForceAtomic(card: HTMLElement, suggestion: SuggestionWire, ctx: TabContext): void {
		const label = card.createEl("label", { cls: "hashi-suggestion-force-atomic-label" });
		const checkbox = label.createEl("input", {
			cls: "hashi-suggestion-force-atomic",
			attr: { type: "checkbox" },
		});
		checkbox.checked = suggestion.force_atomic;
		label.createSpan({ text: "Force atomic note" });
		checkbox.addEventListener("change", () => {
			const checked = checkbox.checked;
			ctx.apply((model) => setForceAtomicFromSuggestion(model, suggestion.id, checked));
		});
	}

	// -- worthy: full note-editable surface --------------------------------

	private renderWorthy(card: HTMLElement, suggestion: SuggestionWire, ctx: TabContext): void {
		this.renderTitle(card, suggestion, ctx);
		this.renderTemplate(card, suggestion, ctx);
		this.renderLocation(card, suggestion, ctx);
		this.renderTags(card, suggestion, ctx);
		this.renderCandidateMocs(card, suggestion, ctx);
		this.renderKeepSource(card, suggestion, ctx);
		this.renderDecision(card, suggestion, ctx);
	}

	private renderTitle(card: HTMLElement, suggestion: SuggestionWire, ctx: TabContext): void {
		const input = card.createEl("input", {
			cls: "hashi-suggestion-title",
			attr: { type: "text", value: suggestion.title },
		});
		input.addEventListener("change", () => {
			const title = input.value;
			ctx.apply((model) => setTitle(model, suggestion.id, title));
		});
	}

	private renderTemplate(card: HTMLElement, suggestion: SuggestionWire, ctx: TabContext): void {
		const button = card.createEl("button", {
			cls: "hashi-suggestion-template",
			text: suggestion.template.length > 0 ? suggestion.template : "Choose template…",
			attr: { type: "button" },
		});
		button.addEventListener("click", () => {
			new TemplatePicker(ctx.app, (templatePath) => {
				ctx.apply((model) => setTemplate(model, suggestion.id, templatePath));
			}).open();
		});
	}

	private renderLocation(card: HTMLElement, suggestion: SuggestionWire, ctx: TabContext): void {
		const button = card.createEl("button", {
			cls: "hashi-suggestion-location",
			text: suggestion.location.length > 0 ? suggestion.location : "Choose location…",
			attr: { type: "button" },
		});
		button.addEventListener("click", () => {
			new LocationPicker(ctx.app, (folderPath) => {
				ctx.apply((model) => setLocation(model, suggestion.id, folderPath));
			}).open();
		});
	}

	private renderTags(card: HTMLElement, suggestion: SuggestionWire, ctx: TabContext): void {
		const tags = card.createDiv({ cls: "hashi-suggestion-tags" });
		for (const tag of suggestion.tags) {
			tags.createSpan({ cls: "hashi-suggestion-tag", text: tag });
		}
		const addTagButton = tags.createEl("button", {
			cls: "hashi-suggestion-add-tag",
			text: "+ Tag",
			attr: { type: "button" },
		});
		addTagButton.addEventListener("click", () => {
			new TagPicker(ctx.app, (tag) => {
				ctx.apply((model) => {
					const current = model.doc.suggestions.find((s) => s.id === suggestion.id);
					if (current === undefined || current.tags.includes(tag)) return model;
					return setTags(model, suggestion.id, [...current.tags, tag]);
				});
			}).open();
		});
	}

	private renderCandidateMocs(card: HTMLElement, suggestion: SuggestionWire, ctx: TabContext): void {
		const mocs = card.createDiv({ cls: "hashi-suggestion-mocs" });
		for (const candidate of suggestion.candidate_mocs) {
			this.renderCandidateMoc(mocs, suggestion, candidate, ctx);
		}
		const addMocButton = mocs.createEl("button", {
			cls: "hashi-suggestion-add-moc",
			text: "＋ Add MOC",
			attr: { type: "button" },
		});
		addMocButton.addEventListener("click", () => {
			new MocPicker(ctx.app, (path) => {
				ctx.apply((model) => addMoc(model, suggestion.id, path));
			}).open();
		});
	}

	private renderCandidateMoc(
		container: HTMLElement,
		suggestion: SuggestionWire,
		candidate: CandidateMocWire,
		ctx: TabContext,
	): void {
		const row = container.createDiv({
			cls: "hashi-suggestion-moc",
			attr: { "data-moc-path": candidate.path },
		});

		const radio = row.createEl("input", {
			cls: "hashi-suggestion-moc-select",
			attr: { type: "radio", name: `hashi-suggestion-moc-select-${suggestion.id}` },
		});
		radio.checked = candidate.selected;
		radio.addEventListener("change", () => {
			ctx.apply((model) => selectCandidateMoc(model, suggestion.id, candidate.path));
		});

		row.createSpan({ cls: "hashi-suggestion-moc-path", text: candidate.path });

		const spotButton = row.createEl("button", {
			cls: "hashi-suggestion-moc-spot",
			text: "Set spot…",
			attr: { type: "button" },
		});
		spotButton.addEventListener("click", () => {
			void readMocContent(ctx.app, candidate.path).then((content) => {
				new SpotPicker(ctx.app, {
					content,
					kind: "existing",
					onPick: (anchor) => {
						ctx.apply((model) =>
							setCandidateAnchor(model, suggestion.id, candidate.path, anchor),
						);
					},
				}).open();
			});
		});
	}

	private renderKeepSource(card: HTMLElement, suggestion: SuggestionWire, ctx: TabContext): void {
		const label = card.createEl("label", { cls: "hashi-suggestion-keep-source-label" });
		const checkbox = label.createEl("input", {
			cls: "hashi-suggestion-keep-source",
			attr: { type: "checkbox" },
		});
		checkbox.checked = suggestion.keep_source;
		label.createSpan({ text: "Keep source" });
		checkbox.addEventListener("change", () => {
			const checked = checkbox.checked;
			ctx.apply((model) => setKeepSource(model, suggestion.id, checked));
		});
	}

	private renderDecision(card: HTMLElement, suggestion: SuggestionWire, ctx: TabContext): void {
		const button = card.createEl("button", {
			cls: "hashi-suggestion-decision",
			text: suggestion.decision === "approve" ? "Approve" : "Skip",
			attr: { type: "button" },
		});
		button.addEventListener("click", () => {
			const next = suggestion.decision === "approve" ? "skip" : "approve";
			ctx.apply((model) => setDecision(model, suggestion.id, next));
		});
	}
}
