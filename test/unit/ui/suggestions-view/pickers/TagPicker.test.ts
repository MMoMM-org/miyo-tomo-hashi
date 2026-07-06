/**
 * Unit tests for the tag fuzzy picker (SDD §7). Items come from
 * `metadataCache.getTags()` — an undocumented Obsidian API (not present in
 * `obsidian.d.ts` or `test/__mocks__/obsidian.ts`) that the SDD names
 * explicitly. Not in the mock, so each test attaches it directly to the
 * `App` instance's `metadataCache` before constructing the picker.
 */

import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { TagPicker } from "../../../../../src/ui/suggestions-view/pickers/TagPicker";

function makePicker(
	tags: Record<string, number>,
	onChoose: (tag: string) => void = () => {},
): TagPicker {
	const app = new App();
	// `getTags` is not declared on the mock's `metadataCache` object — attach
	// it per-test rather than editing the shared mock (see file header).
	Object.assign(app.metadataCache, { getTags: vi.fn(() => tags) });
	return new TagPicker(app, onChoose);
}

describe("TagPicker", () => {
	it("lists every vault tag from metadataCache.getTags()", () => {
		const picker = makePicker({ "#project": 3, "#area": 1 });

		expect(picker.getItems()).toEqual(["#project", "#area"]);
	});

	it("returns an empty list when the vault has no tags", () => {
		const picker = makePicker({});

		expect(picker.getItems()).toEqual([]);
	});

	it("uses the tag verbatim as the display text", () => {
		const picker = makePicker({ "#project": 3 });

		expect(picker.getItemText("#project")).toBe("#project");
	});

	it("invokes onChoose with the selected tag", () => {
		const onChoose = vi.fn();
		const picker = makePicker({ "#project": 3 }, onChoose);

		picker.onChooseItem("#project", new MouseEvent("click"));

		expect(onChoose).toHaveBeenCalledWith("#project");
	});
});
