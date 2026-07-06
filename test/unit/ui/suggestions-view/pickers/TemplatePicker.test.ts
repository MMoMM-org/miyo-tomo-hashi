/**
 * Unit tests for the template fuzzy picker (SDD §7 / PRD F6). Prefers notes
 * under the conventional `Templates/` folder (per the suggestions-editor
 * mockup's `note:"Templates/"` hint); falls back to every markdown file when
 * no note lives there yet.
 */

import { App, type TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { TemplatePicker } from "../../../../../src/ui/suggestions-view/pickers/TemplatePicker";

const files = (...paths: string[]): TFile[] =>
	paths.map((path) => ({ path }) as unknown as TFile);

function makePicker(
	vaultFiles: TFile[],
	onChoose: (templatePath: string) => void = () => {},
): TemplatePicker {
	const app = new App();
	app.vault.getMarkdownFiles = vi.fn(() => vaultFiles);
	return new TemplatePicker(app, onChoose);
}

describe("TemplatePicker", () => {
	it("prefers notes under the conventional Templates/ folder when present", () => {
		const picker = makePicker(
			files("Templates/t_note.md", "Templates/t_zettel.md", "Inbox/note.md"),
		);

		expect(picker.getItems()).toEqual([
			"Templates/t_note.md",
			"Templates/t_zettel.md",
		]);
	});

	it("falls back to every markdown file when no Templates/ folder exists", () => {
		const picker = makePicker(files("Inbox/note.md", "Areas/Work.md"));

		expect(picker.getItems()).toEqual(["Inbox/note.md", "Areas/Work.md"]);
	});

	it("returns an empty list for an empty vault", () => {
		const picker = makePicker(files());

		expect(picker.getItems()).toEqual([]);
	});

	it("invokes onChoose with the selected template path", () => {
		const onChoose = vi.fn();
		const picker = makePicker(files("Templates/t_note.md"), onChoose);

		picker.onChooseItem("Templates/t_note.md", new MouseEvent("click"));

		expect(onChoose).toHaveBeenCalledWith("Templates/t_note.md");
	});
});
