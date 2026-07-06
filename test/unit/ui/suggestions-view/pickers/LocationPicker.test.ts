/**
 * Unit tests for the note-location fuzzy picker (SDD §7 / PRD F6). Reuses
 * the `vault.getAllFolders(true)` idiom from `FolderSuggest` (includes the
 * vault root, path `""`).
 */

import { App, type TFolder } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { LocationPicker } from "../../../../../src/ui/suggestions-view/pickers/LocationPicker";

const folders = (...paths: string[]): TFolder[] =>
	paths.map((path) => ({ path }) as unknown as TFolder);

function makePicker(
	vaultFolders: TFolder[],
	onChoose: (folderPath: string) => void = () => {},
): LocationPicker {
	const app = new App();
	app.vault.getAllFolders = vi.fn(() => vaultFolders);
	return new LocationPicker(app, onChoose);
}

describe("LocationPicker", () => {
	it("lists every vault folder as a candidate location", () => {
		const picker = makePicker(folders("", "Inbox", "Areas/Work"));

		expect(picker.getItems()).toEqual(["", "Inbox", "Areas/Work"]);
	});

	it("returns an empty list when the vault has no folders", () => {
		const picker = makePicker(folders());

		expect(picker.getItems()).toEqual([]);
	});

	it("displays the vault root path as / instead of an empty string", () => {
		const picker = makePicker(folders(""));

		expect(picker.getItemText("")).toBe("/");
	});

	it("displays a non-root path verbatim", () => {
		const picker = makePicker(folders("Inbox"));

		expect(picker.getItemText("Inbox")).toBe("Inbox");
	});

	it("invokes onChoose with the raw (unformatted) folder path, including root", () => {
		const onChoose = vi.fn();
		const picker = makePicker(folders(""), onChoose);

		picker.onChooseItem("", new MouseEvent("click"));

		expect(onChoose).toHaveBeenCalledWith("");
	});
});
