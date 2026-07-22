/**
 * Unit tests for the combined Tomo-editor fuzzy picker (spec-005 Phase 3,
 * T3.2) — shown by the unified "Open Tomo editor" command (ADR-6) when
 * neither a garden-audit nor a suggestions doc is the active file. Content-
 * agnostic like its siblings (SuggestionsDocPicker/GardenAuditDocPicker):
 * the merged, sorted doc list is supplied by the command dispatcher, which
 * also owns routing the chosen path back to the right opener by suffix.
 */

import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { TomoEditorDocPicker } from "../../../../../src/ui/garden-audit-view/pickers/TomoEditorDocPicker";

describe("TomoEditorDocPicker", () => {
	it("lists exactly the docs it was constructed with, regardless of doc family", () => {
		const docs = ["100 Inbox/a_garden-audit.json", "100 Inbox/b_suggestions.json"];
		const picker = new TomoEditorDocPicker(new App(), docs, () => {});

		expect(picker.getItems()).toEqual(docs);
	});

	it("returns an empty list when constructed with none", () => {
		const picker = new TomoEditorDocPicker(new App(), [], () => {});

		expect(picker.getItems()).toEqual([]);
	});

	it("invokes onChoose with the selected doc path", () => {
		const onChoose = vi.fn();
		const picker = new TomoEditorDocPicker(new App(), ["x_suggestions.json"], onChoose);

		picker.onChooseItem("x_suggestions.json", new MouseEvent("click"));

		expect(onChoose).toHaveBeenCalledWith("x_suggestions.json");
	});
});
