/**
 * Template fuzzy picker (SDD §7, PRD F6). When the user has configured a
 * single template folder (`settings.suggestionsTemplateFolder`, passed as
 * `limitFolder`), the picker lists ONLY markdown under that folder. With no
 * limit configured it keeps the original behaviour: prefer notes under the
 * conventional `Templates/` folder (the mockup's `note:"Templates/"` hint),
 * falling back to every markdown file when none live there yet so a
 * template-less vault still offers useful choices.
 */

import type { App, TFile } from "obsidian";

import { FuzzyFieldPicker } from "./FuzzyFieldPicker.js";
import { isUnderFolder } from "./folderScope.js";

const TEMPLATES_FOLDER_PREFIX = "Templates/";

function isUnderTemplatesFolder(file: TFile): boolean {
	return file.path.startsWith(TEMPLATES_FOLDER_PREFIX);
}

export class TemplatePicker extends FuzzyFieldPicker {
	constructor(
		app: App,
		onChoose: (templatePath: string) => void,
		private readonly limitFolder: string = "",
	) {
		super(app, onChoose, "Choose a template…");
	}

	getItems(): string[] {
		const files = this.app.vault.getMarkdownFiles();
		if (this.limitFolder !== "") {
			return files
				.filter((file) => isUnderFolder(file.path, this.limitFolder))
				.map((file) => file.path);
		}
		const templates = files.filter(isUnderTemplatesFolder);
		const candidates = templates.length > 0 ? templates : files;
		return candidates.map((file) => file.path);
	}
}
