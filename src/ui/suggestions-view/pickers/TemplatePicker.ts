/**
 * Template fuzzy picker (SDD §7, PRD F6). Prefers notes under the
 * conventional `Templates/` folder (matches the suggestions-editor mockup's
 * `note:"Templates/"` hint — docs/XDD/specs/004-suggestions-editor/mockups);
 * falls back to every markdown file when no note lives there yet so a
 * template-less vault still offers useful choices.
 */

import type { App, TFile } from "obsidian";

import { FuzzyFieldPicker } from "./FuzzyFieldPicker.js";

const TEMPLATES_FOLDER_PREFIX = "Templates/";

function isUnderTemplatesFolder(file: TFile): boolean {
	return file.path.startsWith(TEMPLATES_FOLDER_PREFIX);
}

export class TemplatePicker extends FuzzyFieldPicker {
	constructor(app: App, onChoose: (templatePath: string) => void) {
		super(app, onChoose, "Choose a template…");
	}

	getItems(): string[] {
		const files = this.app.vault.getMarkdownFiles();
		const templates = files.filter(isUnderTemplatesFolder);
		const candidates = templates.length > 0 ? templates : files;
		return candidates.map((file) => file.path);
	}
}
