/**
 * Shared base for the Suggestions Editor's string-valued fuzzy field pickers
 * (MOC / tag / template / location / parent — SDD §7 "Fuzzy pickers", PRD
 * F2/F6). Each concrete picker only supplies its vault-derived item list via
 * `getItems()`; this base wires the common `FuzzySuggestModal` contract
 * (`getItemText`/`onChooseItem`) so every concrete picker stays a one-line
 * override.
 *
 * Transform-agnostic by design: the constructor takes `onChoose(value)` and
 * nothing else. The owning tab decides what a chosen value MEANS (e.g.
 * `addMoc(model, suggestionId, path)`) — this base and its subclasses never
 * import a transform or touch `EditModel`.
 *
 * Idiom: `src/settings/InstancePickerModal.ts` (App-driven modal),
 * `src/settings/FolderSuggest.ts` (vault-path suggestion).
 */

import { type App, FuzzySuggestModal } from "obsidian";

export abstract class FuzzyFieldPicker extends FuzzySuggestModal<string> {
	constructor(
		app: App,
		private readonly onChoose: (value: string) => void,
		placeholder: string,
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getItemText(item: string): string {
		return item;
	}

	onChooseItem(item: string, _evt: MouseEvent | KeyboardEvent): void {
		this.onChoose(item);
	}
}
