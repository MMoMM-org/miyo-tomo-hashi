/**
 * Unit tests for the op-1 "＋ Add MOC" fuzzy picker (SDD §7). Any vault note
 * is a valid MOC target — the picker only reports the chosen path; the tab
 * (not tested here) wires `onChoose` to `addMoc(model, suggestionId, path)`.
 */

import { App, type TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { MocPicker } from "../../../../../src/ui/suggestions-view/pickers/MocPicker";

const files = (...paths: string[]): TFile[] =>
	paths.map((path) => ({ path }) as unknown as TFile);

function makePicker(
	vaultFiles: TFile[],
	onChoose: (path: string) => void = () => {},
): MocPicker {
	const app = new App();
	app.vault.getMarkdownFiles = vi.fn(() => vaultFiles);
	return new MocPicker(app, onChoose);
}

describe("MocPicker", () => {
	it("lists every vault note path as a candidate MOC", () => {
		const picker = makePicker(files("Areas/Work.md", "Inbox/note.md"));

		expect(picker.getItems()).toEqual(["Areas/Work.md", "Inbox/note.md"]);
	});

	it("returns an empty list for an empty vault", () => {
		const picker = makePicker(files());

		expect(picker.getItems()).toEqual([]);
	});

	it("uses the path verbatim as the display text", () => {
		const picker = makePicker(files("Areas/Work.md"));

		expect(picker.getItemText("Areas/Work.md")).toBe("Areas/Work.md");
	});

	it("invokes onChoose with the selected path", () => {
		const onChoose = vi.fn();
		const picker = makePicker(files("Areas/Work.md"), onChoose);

		picker.onChooseItem("Areas/Work.md", new MouseEvent("click"));

		expect(onChoose).toHaveBeenCalledWith("Areas/Work.md");
	});
});
