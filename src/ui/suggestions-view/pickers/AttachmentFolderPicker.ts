/**
 * Target-folder picker for an attachment-conflict Rename (#141, wire v4
 * `proposed_dir`). Owner ruling: folders are picked, never typed, and only
 * folders that already exist are offered — a user who needs a new one
 * creates it in Obsidian first. So nothing the editor writes can trip Tomo's
 * folder refusals except `inside_inbox`, which this list removes too.
 *
 * The vault root is left out: an empty `proposed_dir` is Tomo's `blank`
 * refusal. The Location picker's folder scope does not apply — attachments
 * and notes are different targets.
 */

import type { App } from "obsidian";

import { FuzzyFieldPicker } from "./FuzzyFieldPicker.js";
import { isUnderFolder } from "./folderScope.js";

export class AttachmentFolderPicker extends FuzzyFieldPicker {
	constructor(
		app: App,
		onChoose: (folderPath: string) => void,
		/** Tomo's inbox folder; "" (not configured) excludes nothing. */
		private readonly inboxFolder: string = "",
	) {
		super(app, onChoose, "Choose an existing folder (inbox excluded)…");
		this.emptyStateText = "No matching folder. Need a new one? Create it in Obsidian first.";
	}

	getItems(): string[] {
		return this.app.vault
			.getAllFolders(false)
			.map((folder) => folder.path)
			.filter((path) => path !== "" && !(this.inboxFolder !== "" && isUnderFolder(path, this.inboxFolder)));
	}
}
