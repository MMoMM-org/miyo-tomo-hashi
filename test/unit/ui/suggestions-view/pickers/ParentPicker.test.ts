/**
 * Unit tests for the proposed-MOC "parent" fuzzy picker (SDD §7). Item
 * source mirrors `MocPicker` (any vault note/MOC path) — the tab wires
 * `onChoose` to the proposed-MOC parent field, not tested here.
 */

import { App, type TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { ParentPicker } from "../../../../../src/ui/suggestions-view/pickers/ParentPicker";

const files = (...paths: string[]): TFile[] =>
	paths.map((path) => ({ path }) as unknown as TFile);

function makePicker(
	vaultFiles: TFile[],
	onChoose: (path: string) => void = () => {},
): ParentPicker {
	const app = new App();
	app.vault.getMarkdownFiles = vi.fn(() => vaultFiles);
	return new ParentPicker(app, onChoose);
}

describe("ParentPicker", () => {
	it("lists every vault note/MOC path as a candidate parent", () => {
		const picker = makePicker(files("MOCs/Projects.md", "MOCs/Areas.md"));

		expect(picker.getItems()).toEqual(["MOCs/Projects.md", "MOCs/Areas.md"]);
	});

	it("returns an empty list for an empty vault", () => {
		const picker = makePicker(files());

		expect(picker.getItems()).toEqual([]);
	});

	it("invokes onChoose with the selected parent path", () => {
		const onChoose = vi.fn();
		const picker = makePicker(files("MOCs/Projects.md"), onChoose);

		picker.onChooseItem("MOCs/Projects.md", new MouseEvent("click"));

		expect(onChoose).toHaveBeenCalledWith("MOCs/Projects.md");
	});
});
