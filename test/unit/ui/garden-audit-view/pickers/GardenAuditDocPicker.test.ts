/**
 * Unit tests for the garden-audit-doc fuzzy picker (spec-005 Phase 3, T3.2) —
 * mirrors test/unit/ui/suggestions-view/pickers/SuggestionsDocPicker.test.ts.
 * Its item list is supplied by the caller (not derived from the vault here),
 * and choosing an item passes the path straight to onChoose.
 */

import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { GardenAuditDocPicker } from "../../../../../src/ui/garden-audit-view/pickers/GardenAuditDocPicker";

describe("GardenAuditDocPicker", () => {
	it("lists exactly the docs it was constructed with", () => {
		const docs = ["100 Inbox/a_garden-audit.json", "100 Inbox/b_garden-audit.json"];
		const picker = new GardenAuditDocPicker(new App(), docs, () => {});

		expect(picker.getItems()).toEqual(docs);
	});

	it("returns an empty list when constructed with none", () => {
		const picker = new GardenAuditDocPicker(new App(), [], () => {});

		expect(picker.getItems()).toEqual([]);
	});

	it("invokes onChoose with the selected doc path", () => {
		const onChoose = vi.fn();
		const picker = new GardenAuditDocPicker(new App(), ["x_garden-audit.json"], onChoose);

		picker.onChooseItem("x_garden-audit.json", new MouseEvent("click"));

		expect(onChoose).toHaveBeenCalledWith("x_garden-audit.json");
	});
});
