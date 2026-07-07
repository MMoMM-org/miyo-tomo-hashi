/**
 * Note-location fuzzy picker (SDD §7, PRD F6). Reuses the
 * `vault.getAllFolders(true)` idiom from `src/settings/FolderSuggest.ts`,
 * which includes the vault root (path `""`).
 */

import type { App } from "obsidian";

import { FuzzyFieldPicker } from "./FuzzyFieldPicker.js";
import { isUnderAnyFolder } from "./folderScope.js";

const ROOT_LABEL = "/";

export class LocationPicker extends FuzzyFieldPicker {
	constructor(
		app: App,
		onChoose: (folderPath: string) => void,
		private readonly limitFolders: readonly string[] = [],
	) {
		super(app, onChoose, "Choose a location…");
	}

	getItems(): string[] {
		const folders = this.app.vault.getAllFolders(true).map((folder) => folder.path);
		if (this.limitFolders.length === 0) return folders;
		return folders.filter((path) => isUnderAnyFolder(path, this.limitFolders));
	}

	// Root folder's path is "" — display it as "/" but keep onChooseItem
	// (inherited from FuzzyFieldPicker) reporting the raw item, so the value
	// handed to onChoose round-trips through the same vault-relative-path
	// handling as every other location value.
	override getItemText(item: string): string {
		return item === "" ? ROOT_LABEL : item;
	}
}
