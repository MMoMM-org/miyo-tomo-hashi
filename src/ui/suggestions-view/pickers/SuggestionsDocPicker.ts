/**
 * Fuzzy picker over the vault's `*_suggestions.json` runs. Shown by the "Open
 * suggestions editor" command when no suggestions doc is the active file, so
 * the user can pick a run instead of being told to open one first (owner
 * pre-live UX refinement). Unlike the field pickers, its item list is passed
 * in (the command already gathers + sorts the paths) rather than derived from
 * the vault here — keeps the vault query in one place (`main.ts`).
 */

import type { App } from "obsidian";

import { FuzzyFieldPicker } from "./FuzzyFieldPicker.js";

export class SuggestionsDocPicker extends FuzzyFieldPicker {
	constructor(
		app: App,
		private readonly docs: readonly string[],
		onChoose: (docPath: string) => void,
	) {
		super(app, onChoose, "Choose a _suggestions.json run…");
	}

	getItems(): string[] {
		return [...this.docs];
	}
}
