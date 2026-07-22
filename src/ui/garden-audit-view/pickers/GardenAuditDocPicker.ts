/**
 * Fuzzy picker over the vault's `*_garden-audit.json` runs (spec-005 Phase 3,
 * T3.2). Mirrors `src/ui/suggestions-view/pickers/SuggestionsDocPicker.ts` —
 * a one-line `FuzzyFieldPicker` subclass; the item list is supplied by the
 * caller rather than derived from the vault here.
 */

import type { App } from "obsidian";

import { FuzzyFieldPicker } from "../../suggestions-view/pickers/FuzzyFieldPicker.js";

export class GardenAuditDocPicker extends FuzzyFieldPicker {
	constructor(
		app: App,
		private readonly docs: readonly string[],
		onChoose: (docPath: string) => void,
	) {
		super(app, onChoose, "Choose a _garden-audit.json run…");
	}

	getItems(): string[] {
		return [...this.docs];
	}
}
