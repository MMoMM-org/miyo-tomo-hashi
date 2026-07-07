/**
 * The tab contract for the Suggestions Editor's four tabs (Suggestions,
 * Proposed MOCs, Daily, Tag-Handler). `SuggestionsEditorView` (T3.1) owns
 * the tab-bar chrome, count computation, and the generic empty-state
 * fallback; each `EditorTab` implementation (T3.2/T3.5/T3.6/T3.7) owns only
 * its non-empty render body. Keeping this surface small is deliberate — the
 * later tab tasks can each replace ONE stub without touching the others or
 * the view.
 *
 * Spec refs: spec-004 SDD §3 (ADR-S1 tabbed surface), §6 (per-tab editable
 * surface), §7 (pickers use `TabContext.app`); plan/phase-3.md T3.1.
 */

import type { App } from "obsidian";

import type { EditModel } from "../../types/suggestions.js";

/**
 * Optional user-configured scopes narrowing the Suggestions Editor's fuzzy
 * pickers (owner pre-live refinement). Empty string / empty array on a field
 * means "no limit" — the picker keeps its default behaviour. Sourced from
 * `PluginSettings.suggestions*` via the view's `getPickerScopes` dep.
 */
export interface PickerScopes {
	/** Single folder the template picker is limited to ("" = no limit). */
	readonly templateFolder: string;
	/** Folders the location picker is limited to ([] = no limit). */
	readonly locationFolders: readonly string[];
	/** Tag prefixes the tag picker is limited to ([] = no limit). */
	readonly tagFilters: readonly string[];
}

/** Per-render context handed to a tab's `render()`. */
export interface TabContext {
	/** For pickers — `SuggestModal`/`FuzzySuggestModal` instances need an App. */
	readonly app: App;
	/**
	 * User-configured picker scopes (Template / Location / Tag). Absent in
	 * tests and older wiring — pickers treat an absent scope as "no limit".
	 */
	readonly pickerScopes?: PickerScopes;
	/**
	 * Dispatches a domain transform through the view's `SuggestionsStore`.
	 * A transform that returns the SAME `EditModel` reference is a no-op
	 * (store convention — see src/suggestions/store.ts): no re-render, no
	 * dirty flip.
	 */
	apply(transform: (model: EditModel) => EditModel): void;
}

/** One of the four Suggestions Editor tabs. */
export interface EditorTab {
	/** Stable id — "suggestions" | "proposed" | "daily" | "tag-handler". */
	readonly id: string;
	/** Tab-bar label, e.g. "Suggestions" — the view appends " (count)". */
	readonly label: string;
	/**
	 * Item count for this tab's section of the model. Drives both the
	 * tab-bar count badge and whether the view renders this tab's `render()`
	 * output or its own generic empty state (count === 0).
	 */
	count(model: EditModel): number;
	/**
	 * Renders this tab's non-empty content into `container`. The view only
	 * calls this when `count(model) > 0` — a zero count renders the view's
	 * generic empty state instead, so implementations never need to handle
	 * the empty case themselves.
	 */
	render(container: HTMLElement, model: EditModel, ctx: TabContext): void;
}
