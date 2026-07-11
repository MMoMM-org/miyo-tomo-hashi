/**
 * Unit tests for the instructions-doc fuzzy picker — shown by the "Execute
 * instructions document" command when the active file is not itself an
 * instructions doc. Its first entry is a synthetic "run whole inbox" batch
 * choice; the rest are the docs it was constructed with. Selection maps to the
 * `Invocation` the executor expects.
 */

import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { InstructionsDocPicker } from "../../../src/ui/InstructionsDocPicker";

describe("InstructionsDocPicker", () => {
	const DOCS = ["inbox/a_instructions.json", "inbox/b_instructions.json"];

	it("leads with a batch entry, then one entry per doc", () => {
		const picker = new InstructionsDocPicker(new App(), DOCS, () => {});

		expect(picker.getItems()).toEqual([
			{ kind: "batch" },
			{ kind: "doc", path: "inbox/a_instructions.json" },
			{ kind: "doc", path: "inbox/b_instructions.json" },
		]);
	});

	it("offers only the batch entry when there are no docs", () => {
		const picker = new InstructionsDocPicker(new App(), [], () => {});

		expect(picker.getItems()).toEqual([{ kind: "batch" }]);
	});

	it("labels the batch entry distinctly from the doc paths", () => {
		const picker = new InstructionsDocPicker(new App(), DOCS, () => {});

		expect(picker.getItemText({ kind: "batch" })).not.toBe("inbox/a_instructions.json");
		expect(picker.getItemText({ kind: "doc", path: "inbox/a_instructions.json" })).toBe(
			"inbox/a_instructions.json",
		);
	});

	it("maps the batch entry to a batch invocation", () => {
		const onPick = vi.fn();
		const picker = new InstructionsDocPicker(new App(), DOCS, onPick);

		picker.onChooseItem({ kind: "batch" }, new MouseEvent("click"));

		expect(onPick).toHaveBeenCalledWith({ kind: "batch" });
	});

	it("maps a doc entry to a single-file invocation with that path", () => {
		const onPick = vi.fn();
		const picker = new InstructionsDocPicker(new App(), DOCS, onPick);

		picker.onChooseItem({ kind: "doc", path: "inbox/a_instructions.json" }, new MouseEvent("click"));

		expect(onPick).toHaveBeenCalledWith({
			kind: "single-file",
			sourcePath: "inbox/a_instructions.json",
		});
	});
});
