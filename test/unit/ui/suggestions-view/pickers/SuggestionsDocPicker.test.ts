/**
 * Unit tests for the suggestions-doc fuzzy picker — shown by the "Open
 * suggestions editor" command when no run is the active file. Its item list
 * is supplied by the caller (not derived from the vault here), and choosing
 * an item passes the path straight to onChoose.
 */

import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { SuggestionsDocPicker } from "../../../../../src/ui/suggestions-view/pickers/SuggestionsDocPicker";

describe("SuggestionsDocPicker", () => {
	it("lists exactly the docs it was constructed with", () => {
		const docs = ["100 Inbox/a_suggestions.json", "100 Inbox/b_suggestions.json"];
		const picker = new SuggestionsDocPicker(new App(), docs, () => {});

		expect(picker.getItems()).toEqual(docs);
	});

	it("returns an empty list when constructed with none", () => {
		const picker = new SuggestionsDocPicker(new App(), [], () => {});

		expect(picker.getItems()).toEqual([]);
	});

	it("invokes onChoose with the selected doc path", () => {
		const onChoose = vi.fn();
		const picker = new SuggestionsDocPicker(new App(), ["x_suggestions.json"], onChoose);

		picker.onChooseItem("x_suggestions.json", new MouseEvent("click"));

		expect(onChoose).toHaveBeenCalledWith("x_suggestions.json");
	});
});
