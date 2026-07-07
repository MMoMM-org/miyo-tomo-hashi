/**
 * Unit tests for the merge-target fuzzy picker — the Proposed MOCs tab's
 * "Merge into…" control. Displays each candidate proposal's name but returns
 * its stable id to onChoose.
 */

import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { MergeTargetPicker } from "../../../../../src/ui/suggestions-view/pickers/MergeTargetPicker";

const OPTIONS = [
	{ id: "M02", name: "Cooking (MOC)" },
	{ id: "M03", name: "Knowledge and Memory (MOC)" },
];

describe("MergeTargetPicker", () => {
	it("lists exactly the options it was constructed with", () => {
		const picker = new MergeTargetPicker(new App(), OPTIONS, () => {});

		expect(picker.getItems()).toEqual(OPTIONS);
	});

	it("displays each option by its name", () => {
		const picker = new MergeTargetPicker(new App(), OPTIONS, () => {});

		expect(picker.getItemText(OPTIONS[0]!)).toBe("Cooking (MOC)");
	});

	it("invokes onChoose with the chosen option's id (not its name)", () => {
		const onChoose = vi.fn();
		const picker = new MergeTargetPicker(new App(), OPTIONS, onChoose);

		picker.onChooseItem(OPTIONS[1]!, new MouseEvent("click"));

		expect(onChoose).toHaveBeenCalledWith("M03");
	});
});
