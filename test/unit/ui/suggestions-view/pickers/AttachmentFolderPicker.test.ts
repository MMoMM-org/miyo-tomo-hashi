/**
 * The attachment rename-target folder picker (#141): existing folders only,
 * without the vault root (Tomo's `blank`) and without the inbox subtree
 * (Tomo's `inside_inbox`).
 */

import { App, type TFolder } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { AttachmentFolderPicker } from "../../../../../src/ui/suggestions-view/pickers/AttachmentFolderPicker";

const folders = (...paths: string[]): TFolder[] => paths.map((path) => ({ path }) as unknown as TFolder);

function makePicker(vaultFolders: TFolder[], inboxFolder?: string): AttachmentFolderPicker {
	const app = new App();
	app.vault.getAllFolders = vi.fn(() => vaultFolders);
	return new AttachmentFolderPicker(app, () => {}, inboxFolder);
}

const VAULT = folders("", "100 Inbox", "100 Inbox/Scans", "100 Inboxes", "Atlas", "Atlas/290 Assets/296 Maps");

describe("AttachmentFolderPicker", () => {
	it("offers existing folders minus the root and the inbox subtree", () => {
		expect(makePicker(VAULT, "100 Inbox").getItems()).toEqual(["100 Inboxes", "Atlas", "Atlas/290 Assets/296 Maps"]);
	});

	it("treats a trailing slash on the inbox setting the same", () => {
		expect(makePicker(VAULT, "100 Inbox/").getItems()).not.toContain("100 Inbox/Scans");
	});

	it("excludes only the root when no inbox folder is configured", () => {
		expect(makePicker(VAULT, "").getItems()).toEqual(VAULT.map((f) => f.path).filter((p) => p !== ""));
	});

	it("tells the owner to create a missing folder in Obsidian", () => {
		expect(makePicker(VAULT).emptyStateText).toContain("Create it in Obsidian first");
	});
});
