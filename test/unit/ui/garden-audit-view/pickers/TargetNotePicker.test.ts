/**
 * Unit tests for the fix-target fuzzy picker (SDD ADR-3). Item source
 * mirrors `MocPicker`/`ParentPicker` (any vault note is a valid pick target)
 * — `TargetControl`'s own wiring of the chosen path is covered in
 * `TargetControl.test.ts`, not here.
 */

import { App, type TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { TargetNotePicker } from "../../../../../src/ui/garden-audit-view/pickers/TargetNotePicker";

const files = (...paths: string[]): TFile[] =>
	paths.map((path) => ({ path }) as unknown as TFile);

function makePicker(
	vaultFiles: TFile[],
	onChoose: (path: string) => void = () => {},
): TargetNotePicker {
	const app = new App();
	app.vault.getMarkdownFiles = vi.fn(() => vaultFiles);
	return new TargetNotePicker(app, onChoose);
}

describe("TargetNotePicker", () => {
	it("lists every vault note path as a candidate target", () => {
		const picker = makePicker(files("Areas/Work.md", "Inbox/note.md"));

		expect(picker.getItems()).toEqual(["Areas/Work.md", "Inbox/note.md"]);
	});

	it("returns an empty list for an empty vault", () => {
		const picker = makePicker(files());

		expect(picker.getItems()).toEqual([]);
	});

	it("invokes onChoose with the selected path", () => {
		const onChoose = vi.fn();
		const picker = makePicker(files("Areas/Work.md"), onChoose);

		picker.onChooseItem("Areas/Work.md", new MouseEvent("click"));

		expect(onChoose).toHaveBeenCalledWith("Areas/Work.md");
	});
});
