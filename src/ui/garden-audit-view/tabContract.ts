/**
 * The (single) tab contract for the Garden-Audit Editor (spec-005 Phase 4).
 * Mirrors src/ui/suggestions-view/tabContract.ts's `EditorTab`/`TabContext`
 * idiom, narrowed to what this view actually needs:
 *
 *   - ADR-1: garden-audit is ONE tier-grouped surface, not a multi-tab bar
 *     (contrast the Suggestions Editor's 4 tabs) — so there is no `id`/
 *     `label` here, and the view never renders a subtab strip. `count()`
 *     still exists because the view uses it for the same empty-state gate
 *     `SuggestionsEditorView` uses (`count(model) === 0` → generic empty
 *     state instead of calling `render()`).
 *   - No `pickerScopes` yet — Phase 4 has no pickers (TargetControl/
 *     MocPicker/VaultNotePicker are Phase 5). Added there if needed.
 *   - (Phase 6, T6.1) `deadLinkContext` — the view owns the
 *     `DeadLinkContextExtractor` instance, rebuilt once per DOC LOAD (not
 *     per-render — see `GardenAuditEditorView`'s class-doc item 4) so its
 *     per-note cache survives across re-renders within one load but never
 *     serves stale/cross-document context after a retarget or Revert; the
 *     tab only ever sees the bound `extract` function, never the extractor
 *     itself.
 */

import type { App } from "obsidian";

import type { DeadLinkContextResult } from "../../garden-audit/deadLinkContext.js";
import type { GardenAuditModel } from "../../types/garden-audit.js";

/** Per-render context handed to the tab's `render()`. */
export interface GardenAuditTabContext {
	/** For pickers — Phase 5 will need this for MocPicker/VaultNotePicker. */
	readonly app: App;
	/**
	 * Dispatches a domain transform through the view's `Store<GardenAuditModel>`.
	 * A transform that returns the SAME `GardenAuditModel` reference is a
	 * no-op (store convention — see src/util/store.ts / src/garden-audit/
	 * transforms.ts): no re-render, no dirty flip.
	 */
	apply(transform: (model: GardenAuditModel) => GardenAuditModel): void;
	/**
	 * Extracts a dead_link finding's surrounding body context (occurrence
	 * line(s) + nearest heading), async and cached per note path (SDD ADR-4).
	 * Only the `dead_link` card calls this — every other check renders
	 * without it.
	 */
	readonly deadLinkContext: (
		notePath: string,
		deadTarget: string,
	) => Promise<DeadLinkContextResult>;
}

/**
 * The Garden-Audit Editor's single-tab contract. Named distinctly from the
 * concrete `GardenAuditTab` class (tabs/GardenAuditTab.ts) — unlike the
 * Suggestions Editor's `EditorTab`/`SuggestionsTab` pair, garden-audit has
 * exactly one tab, so the natural name for both the contract and its sole
 * implementation would otherwise collide.
 */
export interface GardenAuditTabSpec {
	/**
	 * Total finding count. Drives the view's empty-state gate — count === 0
	 * renders the view's own "clean vault" empty state instead of calling
	 * `render()` (mirrors `EditorTab.count`).
	 */
	count(model: GardenAuditModel): number;
	/**
	 * Renders the tier-grouped findings into `container`. The view only
	 * calls this when `count(model) > 0`.
	 */
	render(container: HTMLElement, model: GardenAuditModel, ctx: GardenAuditTabContext): void;
}
