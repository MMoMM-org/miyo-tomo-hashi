/**
 * Unit tests for the member fuzzy picker — the Proposed MOCs tab's "＋ note"
 * control (#84). Displays each candidate note by its title but returns its
 * stable S## id to onChoose.
 */

import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { MemberPicker } from "../../../../../src/ui/suggestions-view/pickers/MemberPicker";

const OPTIONS = [
	{ id: "S03", title: "Kyoto temples" },
	{ id: "S07", title: "Osaka street food" },
];

describe("MemberPicker", () => {
	it("lists exactly the options it was constructed with", () => {
		const picker = new MemberPicker(new App(), OPTIONS, () => {});

		expect(picker.getItems()).toEqual(OPTIONS);
	});

	it("displays each option by its title", () => {
		const picker = new MemberPicker(new App(), OPTIONS, () => {});

		expect(picker.getItemText(OPTIONS[0]!)).toBe("Kyoto temples");
	});

	it("invokes onChoose with the chosen option's id (not its title)", () => {
		const onChoose = vi.fn();
		const picker = new MemberPicker(new App(), OPTIONS, onChoose);

		picker.onChooseItem(OPTIONS[1]!, new MouseEvent("click"));

		expect(onChoose).toHaveBeenCalledWith("S07");
	});
});
