/**
 * Shared base for the two "any vault note is a valid target" fuzzy pickers
 * (`MocPicker`, `ParentPicker` — SDD §7). Both list every markdown file's
 * path; they differ only in placeholder copy and which field the owning tab
 * writes the chosen path into, so the item-listing logic lives here once.
 */

import { FuzzyFieldPicker } from "./FuzzyFieldPicker.js";

export abstract class VaultNotePicker extends FuzzyFieldPicker {
	getItems(): string[] {
		return this.app.vault.getMarkdownFiles().map((file) => file.path);
	}
}
