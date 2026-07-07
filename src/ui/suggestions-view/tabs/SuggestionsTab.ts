/**
 * Suggestions tab (T3.2, SDD §6 Suggestions, PRD F2/F6/F7). Renders one card
 * per `SuggestionWire`, branching on `suggestion.suppressed`, to the
 * approved mockup (`docs/XDD/specs/004-suggestions-editor/mockups/
 * suggestions-editor.html`, `worthyCard`/`suppressedCard`) — DOM structure
 * and `hashi-se-*` classes below mirror that mockup verbatim so the vendored
 * `styles.css` rules apply unmodified.
 *
 * - **worthy** (`suppressed:false`) — the full note-editable surface: title
 *   (free text), a two-button Approve/Skip decision segment, template
 *   (`TemplatePicker`), location (`LocationPicker`), keep-source, tags (list
 *   + `TagPicker` add), candidate MOCs (single-select re-point + per-
 *   candidate `SpotPicker` + `＋ Add MOC` via `MocPicker`).
 * - **suppressed** (`suppressed:true`) — the title (editable — see bug fix
 *   below), a worthiness badge, a short "why skipped" hint, and the single
 *   Force-Atomic control (`setForceAtomicFromSuggestion`, which keeps the
 *   daily-log mirror in sync by stem — SDD §6 "Force-Atomic is one decision
 *   per source"). Tomo emits an empty `candidate_mocs` for suppressed
 *   suggestions, so there is no MOC UI to render here.
 *
 * Two confirmed bugs fixed against the prior implementation:
 *   1. Suppressed cards previously showed no title, only a worthiness
 *      percentage — the user couldn't tell WHICH note a suppressed card was
 *      about. Fixed: the suppressed card now renders the same editable
 *      `hashi-se-inp hashi-se-name` title field as the worthy card (labeled
 *      "Note ({id}) · not promoted"), wired to `setTitle`.
 *   2. The prior single-button decision toggle didn't show which state was
 *      current. Fixed: `hashi-se-decision` is now a two-button segmented
 *      control (Approve / Skip), and whichever button matches
 *      `suggestion.decision` gets an `is-active` class — the current state
 *      is visibly highlighted (green for approve, via CSS).
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

import { type App, setIcon, TFile } from "obsidian";

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
			cls: suggestion.suppressed ? ["hashi-se-card", "hashi-se-suppressed"] : ["hashi-se-card"],
			attr: { "data-suggestion-id": suggestion.id },
		});
		const top = card.createDiv({ cls: "hashi-se-card-top" });

		if (suggestion.suppressed) {
			this.renderSuppressed(top, suggestion, ctx);
			return;
		}
		this.renderWorthy(top, suggestion, ctx);
	}

	// -- worthy: full note-editable surface --------------------------------

	private renderWorthy(top: HTMLElement, suggestion: SuggestionWire, ctx: TabContext): void {
		this.renderWorthyRow1(top, suggestion, ctx);
		this.renderMetaRow(top, suggestion, ctx);
		this.renderTagsRow(top, suggestion, ctx);
		this.renderMocSection(top, suggestion, ctx);
	}

	private renderWorthyRow1(top: HTMLElement, suggestion: SuggestionWire, ctx: TabContext): void {
		const row = top.createDiv({ cls: "hashi-se-row1" });

		const titleField = row.createDiv({ cls: ["hashi-se-field", "hashi-se-spacer"] });
		titleField.createEl("label", { text: `Note (${suggestion.id})` });
		const input = titleField.createEl("input", {
			cls: ["hashi-se-inp", "hashi-se-name"],
			attr: { type: "text", value: suggestion.title },
		});
		input.addEventListener("change", () => {
			const title = input.value;
			ctx.apply((model) => setTitle(model, suggestion.id, title));
		});

		const decisionField = row.createDiv({ cls: "hashi-se-field" });
		decisionField.createEl("label", { text: "Create?" });
		this.renderDecisionControl(decisionField, suggestion, ctx);
	}

	/**
	 * Bug fix 2 — segmented Approve/Skip control, `is-active` (visual) AND
	 * `aria-pressed` (assistive-tech state) on the current decision. Matches
	 * TagHandlerTab's `setDecisionState` convention (`aria-pressed` mirrors
	 * `is-active` on both buttons, not just the active one) rather than
	 * inventing a second pattern for the same toggle-pair shape.
	 */
	private renderDecisionControl(
		container: HTMLElement,
		suggestion: SuggestionWire,
		ctx: TabContext,
	): void {
		const control = container.createDiv({ cls: "hashi-se-decision" });

		const approveActive = suggestion.decision === "approve";
		const approve = control.createEl("button", {
			cls: approveActive ? ["hashi-se-approve", "is-active"] : ["hashi-se-approve"],
			text: "Approve",
			attr: { type: "button", "aria-pressed": String(approveActive) },
		});
		approve.addEventListener("click", () => {
			ctx.apply((model) => setDecision(model, suggestion.id, "approve"));
		});

		const skipActive = suggestion.decision === "skip";
		const skip = control.createEl("button", {
			cls: skipActive ? ["hashi-se-skip", "is-active"] : ["hashi-se-skip"],
			text: "Skip",
			attr: { type: "button", "aria-pressed": String(skipActive) },
		});
		skip.addEventListener("click", () => {
			ctx.apply((model) => setDecision(model, suggestion.id, "skip"));
		});
	}

	private renderMetaRow(top: HTMLElement, suggestion: SuggestionWire, ctx: TabContext): void {
		const row = top.createDiv({ cls: ["hashi-se-row2", "hashi-se-meta"] });
		this.renderTemplateField(row, suggestion, ctx);
		this.renderLocationField(row, suggestion, ctx);
		this.renderKeepSourceField(row, suggestion, ctx);
	}

	private renderTemplateField(row: HTMLElement, suggestion: SuggestionWire, ctx: TabContext): void {
		const field = row.createDiv({ cls: "hashi-se-field" });
		field.createEl("label", { text: "Template" });
		const button = field.createEl("button", {
			cls: "hashi-se-mini-pick",
			text: suggestion.template,
			attr: { type: "button" },
		});
		button.addEventListener("click", () => {
			new TemplatePicker(ctx.app, (templatePath) => {
				ctx.apply((model) => setTemplate(model, suggestion.id, templatePath));
			}).open();
		});
	}

	private renderLocationField(row: HTMLElement, suggestion: SuggestionWire, ctx: TabContext): void {
		const field = row.createDiv({ cls: "hashi-se-field" });
		field.createEl("label", { text: "Location" });
		const button = field.createEl("button", {
			cls: "hashi-se-mini-pick",
			text: suggestion.location,
			attr: { type: "button" },
		});
		button.addEventListener("click", () => {
			new LocationPicker(ctx.app, (folderPath) => {
				ctx.apply((model) => setLocation(model, suggestion.id, folderPath));
			}).open();
		});
	}

	private renderKeepSourceField(
		row: HTMLElement,
		suggestion: SuggestionWire,
		ctx: TabContext,
	): void {
		const label = row.createEl("label", { cls: "hashi-se-cbx" });
		const checkbox = label.createEl("input", { attr: { type: "checkbox" } });
		checkbox.checked = suggestion.keep_source;
		label.createSpan({ text: "Keep source file" });
		checkbox.addEventListener("change", () => {
			const checked = checkbox.checked;
			ctx.apply((model) => setKeepSource(model, suggestion.id, checked));
		});
	}

	private renderTagsRow(top: HTMLElement, suggestion: SuggestionWire, ctx: TabContext): void {
		const tagsRow = top.createDiv({ cls: "hashi-se-tags" });
		tagsRow.createSpan({ cls: "hashi-se-tags-lbl", text: "Tags" });
		for (const tag of suggestion.tags) {
			tagsRow.createSpan({ cls: "hashi-se-tag", text: tag });
		}
		const addButton = tagsRow.createEl("button", {
			cls: ["hashi-se-tag", "hashi-se-add"],
			text: "＋ tag",
			attr: { type: "button" },
		});
		addButton.addEventListener("click", () => {
			new TagPicker(ctx.app, (tag) => {
				ctx.apply((model) => {
					const current = model.doc.suggestions.find((s) => s.id === suggestion.id);
					if (current === undefined || current.tags.includes(tag)) return model;
					return setTags(model, suggestion.id, [...current.tags, tag]);
				});
			}).open();
		});
	}

	private renderMocSection(top: HTMLElement, suggestion: SuggestionWire, ctx: TabContext): void {
		const label = top.createDiv({ cls: "hashi-se-sec-label", text: "Link to a MOC" });
		if (suggestion.candidate_mocs.length === 0) {
			label.createSpan({ cls: "hashi-se-muted", text: " — none proposed" });
		}
		for (const candidate of suggestion.candidate_mocs) {
			this.renderCandidateRow(top, suggestion, candidate, ctx);
		}
		this.renderAddMoc(top, suggestion, ctx);
	}

	private renderAddMoc(top: HTMLElement, suggestion: SuggestionWire, ctx: TabContext): void {
		const wrap = top.createDiv({ cls: "hashi-se-add-moc" });
		const button = wrap.createEl("button", { text: "＋ Add MOC…", attr: { type: "button" } });
		button.addEventListener("click", () => {
			new MocPicker(ctx.app, (path) => {
				ctx.apply((model) => addMoc(model, suggestion.id, path));
			}).open();
		});
		wrap.createSpan({ cls: "hashi-se-add-hint", text: "Tomo's matches + any vault note" });
	}

	private renderCandidateRow(
		top: HTMLElement,
		suggestion: SuggestionWire,
		candidate: CandidateMocWire,
		ctx: TabContext,
	): void {
		const row = top.createDiv({
			cls: ["hashi-se-cand", candidate.selected ? "hashi-se-on" : "hashi-se-off"],
			attr: { "data-moc-path": candidate.path },
		});
		this.renderCandidateCheck(row, suggestion, candidate, ctx);
		this.renderCandidateMain(row, suggestion, candidate, ctx);
	}

	private renderCandidateCheck(
		row: HTMLElement,
		suggestion: SuggestionWire,
		candidate: CandidateMocWire,
		ctx: TabContext,
	): void {
		const check = row.createDiv({
			cls: "hashi-se-check",
			attr: { role: "checkbox", "aria-checked": String(candidate.selected), tabindex: "0" },
		});
		setIcon(check, "check");

		const select = (): void => {
			ctx.apply((model) => selectCandidateMoc(model, suggestion.id, candidate.path));
		};
		check.addEventListener("click", select);
		check.addEventListener("keydown", (evt) => {
			if (evt.key !== "Enter" && evt.key !== " ") return;
			evt.preventDefault();
			select();
		});
	}

	private renderCandidateMain(
		row: HTMLElement,
		suggestion: SuggestionWire,
		candidate: CandidateMocWire,
		ctx: TabContext,
	): void {
		const main = row.createDiv({ cls: "hashi-se-cand-main" });
		this.renderCandidatePath(main, candidate, ctx);
		if (candidate.source === "user") {
			main.createSpan({ cls: "hashi-se-src-badge", text: "added" });
		}
		if (candidate.selected) {
			this.renderAnchorRow(main, suggestion, candidate, ctx);
		}
	}

	private renderCandidatePath(main: HTMLElement, candidate: CandidateMocWire, ctx: TabContext): void {
		const pathEl = main.createDiv({ cls: "hashi-se-cand-path" });
		const separator = candidate.path.lastIndexOf("/");
		if (separator >= 0) {
			pathEl.createSpan({ cls: "hashi-se-dir", text: candidate.path.slice(0, separator + 1) });
			pathEl.createSpan({ text: candidate.path.slice(separator + 1) });
		} else {
			pathEl.createSpan({ text: candidate.path });
		}
		pathEl.addEventListener("click", () => {
			void ctx.app.workspace.openLinkText(candidate.path, "", false);
		});
	}

	private renderAnchorRow(
		main: HTMLElement,
		suggestion: SuggestionWire,
		candidate: CandidateMocWire,
		ctx: TabContext,
	): void {
		const anchorRow = main.createDiv({ cls: "hashi-se-anchor-row" });
		const anchor = candidate.anchor ?? null;

		if (anchor === null) {
			const chip = anchorRow.createEl("button", {
				cls: ["hashi-se-anchor-chip", "hashi-se-empty"],
				text: "＋ set a spot",
				attr: { type: "button" },
			});
			chip.addEventListener("click", () => this.openSpotPicker(suggestion, candidate, ctx));
			return;
		}

		const chip = anchorRow.createEl("button", {
			cls: "hashi-se-anchor-chip",
			attr: { type: "button" },
		});
		chip.createSpan({ cls: "hashi-se-k", text: anchor.type });
		chip.createSpan({ text: ` · ${anchor.value ?? ""} · ${anchor.placement}` });
		chip.addEventListener("click", () => this.openSpotPicker(suggestion, candidate, ctx));
	}

	private openSpotPicker(
		suggestion: SuggestionWire,
		candidate: CandidateMocWire,
		ctx: TabContext,
	): void {
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
	}

	// -- suppressed: worthiness + hint + Force-Atomic, PLUS the title (bug fix 1) --

	private renderSuppressed(top: HTMLElement, suggestion: SuggestionWire, ctx: TabContext): void {
		this.renderSuppressedRow1(top, suggestion, ctx);
		top.createDiv({
			cls: "hashi-se-suppressed-note",
			text:
				"Below the 0.5 threshold — kept in inbox, not made an atomic note. Its content typically goes to the daily log instead.",
		});
		this.renderForceAtomic(top, suggestion, ctx);
	}

	/** Bug fix 1 — the suppressed card now shows an editable title, same as the worthy card. */
	private renderSuppressedRow1(top: HTMLElement, suggestion: SuggestionWire, ctx: TabContext): void {
		const row = top.createDiv({ cls: "hashi-se-row1" });

		const titleField = row.createDiv({ cls: ["hashi-se-field", "hashi-se-spacer"] });
		titleField.createEl("label", { text: `Note (${suggestion.id}) · not promoted` });
		const input = titleField.createEl("input", {
			cls: ["hashi-se-inp", "hashi-se-name"],
			attr: { type: "text", value: suggestion.title },
		});
		input.addEventListener("change", () => {
			const title = input.value;
			ctx.apply((model) => setTitle(model, suggestion.id, title));
		});

		const worthiness = Math.round((suggestion.worthiness ?? 0) * 100);
		const isLow = (suggestion.worthiness ?? 0) < 0.3;
		const worthinessEl = row.createDiv({
			cls: ["hashi-se-worthiness", isLow ? "hashi-se-low" : "hashi-se-mid"],
		});
		worthinessEl.createSpan({ cls: "hashi-se-wv", text: `${worthiness}%` });
		worthinessEl.createSpan({ cls: "hashi-se-wl", text: "worthiness" });
	}

	private renderForceAtomic(top: HTMLElement, suggestion: SuggestionWire, ctx: TabContext): void {
		const label = top.createEl("label", { cls: "hashi-se-force-atomic" });
		const checkbox = label.createEl("input", { attr: { type: "checkbox" } });
		checkbox.checked = suggestion.force_atomic;
		label.createEl("b", { text: "Force Atomic Note" });
		label.createSpan({ cls: "hashi-se-muted", text: "— create a standalone note anyway" });
		checkbox.addEventListener("change", () => {
			const checked = checkbox.checked;
			ctx.apply((model) => setForceAtomicFromSuggestion(model, suggestion.id, checked));
		});
	}
}
