/**
 * Unit tests for SpotPicker — op 2 "choose the spot inside a MOC" (T3.3).
 *
 * Spec refs: spec-004 SDD §7 (SpotPicker); PRD F3; plan/phase-3.md T3.3.
 *
 * Coverage: the pure core (`computeSpotOptions`, `buildAnchorWire`,
 * `flattenSpotChoices`) is exercised directly — no extraction-for-testability
 * concern here since these ARE the public behavior the modal wraps — plus the
 * thin `SuggestModal` wrapper is driven the same way the obsidian mock's
 * other SuggestModal-based pickers are driven: `getSuggestions` /
 * `onChooseSuggestion` called directly rather than the real popover.
 */

import "obsidian";
import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import type { AnchorWire } from "../../../../../src/types/suggestions";
import {
	buildAnchorWire,
	computeSpotOptions,
	flattenSpotChoices,
	SpotPicker,
	type SpotChoice,
} from "../../../../../src/ui/suggestions-view/pickers/SpotPicker";

// --- factories ---------------------------------------------------------------

const HEADING_AND_CALLOUT_CONTENT = [
	"# Intro",
	"Some body text.",
	"",
	"> [!note] Reminder",
	"> body line",
	"",
	"## Details",
].join("\n");

const NO_STRUCTURE_CONTENT = ["Just a plain paragraph.", "Another line."].join("\n");

function makeApp(): App {
	return new App();
}

function findChoice(
	choices: readonly SpotChoice[],
	label: string,
	placement: string,
): SpotChoice | undefined {
	return choices.find(
		(c) => c.option.label === label && c.placement === placement,
	);
}

// --- computeSpotOptions ------------------------------------------------------

describe("computeSpotOptions", () => {
	it("offers before/after only for a heading anchor — never inside", () => {
		const options = computeSpotOptions(HEADING_AND_CALLOUT_CONTENT, "existing");
		const headingOptions = options.filter((o) => o.type === "heading");

		expect(headingOptions.length).toBeGreaterThan(0);
		for (const option of headingOptions) {
			expect(option.placements).toEqual(["before", "after"]);
			expect(option.placements).not.toContain("inside");
		}
	});

	it("finds both real headings from the note structure", () => {
		const options = computeSpotOptions(HEADING_AND_CALLOUT_CONTENT, "existing");
		const headingValues = options
			.filter((o) => o.type === "heading")
			.map((o) => o.value);

		expect(headingValues).toEqual(["Intro", "Details"]);
	});

	it("offers inside/before/after for a callout anchor", () => {
		const options = computeSpotOptions(HEADING_AND_CALLOUT_CONTENT, "existing");
		const calloutOptions = options.filter((o) => o.type === "callout");

		expect(calloutOptions).toHaveLength(1);
		expect(calloutOptions[0]?.placements).toEqual(["inside", "before", "after"]);
		expect(calloutOptions[0]?.value).toBe("[!note] Reminder");
	});

	it("returns no spot options for a proposed MOC (membership/ordering only)", () => {
		const options = computeSpotOptions(HEADING_AND_CALLOUT_CONTENT, "proposed");
		expect(options).toEqual([]);
	});

	it("still offers new_section + a line placement for a MOC with no headings/callouts", () => {
		const options = computeSpotOptions(NO_STRUCTURE_CONTENT, "existing");

		const newSectionOption = options.find((o) => o.isNewSection);
		expect(newSectionOption).toBeDefined();
		expect(newSectionOption?.placements).toEqual(["before", "after"]);
		expect(newSectionOption?.placements).not.toContain("inside");

		const lineOption = options.find(
			(o) => o.type === "line" && !o.isNewSection,
		);
		expect(lineOption).toBeDefined();
		expect(lineOption?.placements).toEqual(["before", "after"]);

		// No heading/callout options exist at all in this content.
		expect(options.some((o) => o.type === "heading")).toBe(false);
		expect(options.some((o) => o.type === "callout")).toBe(false);
	});

	it("skips callout-looking lines inside fenced code blocks", () => {
		const content = [
			"# Real Heading",
			"```",
			"> [!note] Not a real callout",
			"```",
			"> [!warning] Real callout",
		].join("\n");

		const options = computeSpotOptions(content, "existing");
		const calloutOptions = options.filter((o) => o.type === "callout");

		expect(calloutOptions).toHaveLength(1);
		expect(calloutOptions[0]?.value).toBe("[!warning] Real callout");
	});
});

// --- buildAnchorWire ---------------------------------------------------------

describe("buildAnchorWire", () => {
	it("builds a well-formed AnchorWire for a heading + before placement", () => {
		const options = computeSpotOptions(HEADING_AND_CALLOUT_CONTENT, "existing");
		const headingOption = options.find((o) => o.type === "heading");
		if (headingOption === undefined) throw new Error("expected a heading option");

		const anchor = buildAnchorWire({ option: headingOption, placement: "before" });

		expect(anchor).toEqual<AnchorWire>({
			type: "heading",
			value: headingOption.value,
			placement: "before",
			new_section: null,
		});
	});

	it("builds a well-formed AnchorWire for a callout + inside placement", () => {
		const options = computeSpotOptions(HEADING_AND_CALLOUT_CONTENT, "existing");
		const calloutOption = options.find((o) => o.type === "callout");
		if (calloutOption === undefined) throw new Error("expected a callout option");

		const anchor = buildAnchorWire({ option: calloutOption, placement: "inside" });

		expect(anchor.type).toBe("callout");
		expect(anchor.placement).toBe("inside");
		expect(anchor.value).toBe("[!note] Reminder");
	});

	it("rejects inside for a heading option — illegal placement never builds", () => {
		const options = computeSpotOptions(HEADING_AND_CALLOUT_CONTENT, "existing");
		const headingOption = options.find((o) => o.type === "heading");
		if (headingOption === undefined) throw new Error("expected a heading option");

		expect(() =>
			buildAnchorWire({
				option: headingOption,
				// Cast past the Placement type to prove the runtime guard rejects
				// a hand-crafted illegal placement, not just relying on TS.
				placement: "inside" as never,
			}),
		).toThrow(/not valid/);
	});

	it("rejects inside for a line option", () => {
		const options = computeSpotOptions(NO_STRUCTURE_CONTENT, "existing");
		const lineOption = options.find((o) => o.type === "line" && !o.isNewSection);
		if (lineOption === undefined) throw new Error("expected a line option");

		expect(() =>
			buildAnchorWire({ option: lineOption, placement: "inside" as never }),
		).toThrow(/not valid/);
	});

	it("names the new section from the given title, trimmed", () => {
		const options = computeSpotOptions(NO_STRUCTURE_CONTENT, "existing");
		const newSectionOption = options.find((o) => o.isNewSection);
		if (newSectionOption === undefined) {
			throw new Error("expected a new_section option");
		}

		const anchor = buildAnchorWire(
			{ option: newSectionOption, placement: "after" },
			"  Follow-ups  ",
		);

		expect(anchor.new_section).toBe("Follow-ups");
		expect(anchor.type).toBe("line");
		expect(anchor.placement).toBe("after");
	});

	it("falls back to a default new-section title when none is given", () => {
		const options = computeSpotOptions(NO_STRUCTURE_CONTENT, "existing");
		const newSectionOption = options.find((o) => o.isNewSection);
		if (newSectionOption === undefined) {
			throw new Error("expected a new_section option");
		}

		const anchor = buildAnchorWire({ option: newSectionOption, placement: "before" });

		expect(anchor.new_section).toBe("New section");
	});

	it("leaves new_section null for a non-new-section option", () => {
		const options = computeSpotOptions(HEADING_AND_CALLOUT_CONTENT, "existing");
		const headingOption = options.find((o) => o.type === "heading");
		if (headingOption === undefined) throw new Error("expected a heading option");

		const anchor = buildAnchorWire({ option: headingOption, placement: "after" });
		expect(anchor.new_section).toBeNull();
	});
});

// --- flattenSpotChoices -------------------------------------------------------

describe("flattenSpotChoices", () => {
	it("produces one row per option × offered placement", () => {
		const options = computeSpotOptions(HEADING_AND_CALLOUT_CONTENT, "existing");
		const choices = flattenSpotChoices(options);

		const headingRows = choices.filter((c) => c.option.type === "heading");
		const calloutRows = choices.filter((c) => c.option.type === "callout");

		// 2 headings x 2 placements = 4 rows; 1 callout x 3 placements = 3 rows.
		expect(headingRows).toHaveLength(4);
		expect(calloutRows).toHaveLength(3);
		expect(headingRows.every((r) => r.placement !== "inside")).toBe(true);
	});

	it("produces no rows for a proposed MOC", () => {
		const options = computeSpotOptions(HEADING_AND_CALLOUT_CONTENT, "proposed");
		expect(flattenSpotChoices(options)).toEqual([]);
	});
});

// --- SpotPicker (thin SuggestModal wrapper) ----------------------------------

describe("SpotPicker", () => {
	it("getSuggestions returns the flattened choices for an existing MOC", () => {
		const picker = new SpotPicker(makeApp(), {
			content: HEADING_AND_CALLOUT_CONTENT,
			kind: "existing",
			onPick: vi.fn(),
		});

		const suggestions = picker.getSuggestions("");
		expect(suggestions.length).toBeGreaterThan(0);
		expect(suggestions.some((c) => c.option.type === "callout")).toBe(true);
	});

	it("getSuggestions returns nothing for a proposed MOC", () => {
		const picker = new SpotPicker(makeApp(), {
			content: HEADING_AND_CALLOUT_CONTENT,
			kind: "proposed",
			onPick: vi.fn(),
		});

		expect(picker.getSuggestions("")).toEqual([]);
	});

	it("getSuggestions filters by the option's label", () => {
		const picker = new SpotPicker(makeApp(), {
			content: HEADING_AND_CALLOUT_CONTENT,
			kind: "existing",
			onPick: vi.fn(),
		});

		const suggestions = picker.getSuggestions("reminder");
		expect(suggestions.length).toBeGreaterThan(0);
		expect(suggestions.every((c) => c.option.label.includes("Reminder"))).toBe(true);
	});

	it("onChooseSuggestion calls onPick with a well-formed AnchorWire for a callout+inside choice", () => {
		const onPick = vi.fn();
		const picker = new SpotPicker(makeApp(), {
			content: HEADING_AND_CALLOUT_CONTENT,
			kind: "existing",
			onPick,
		});

		const choice = findChoice(picker.getSuggestions(""), "Callout: Reminder", "inside");
		if (choice === undefined) throw new Error("expected a callout+inside choice");

		picker.onChooseSuggestion(choice, new MouseEvent("click"));

		expect(onPick).toHaveBeenCalledTimes(1);
		expect(onPick).toHaveBeenCalledWith({
			type: "callout",
			value: "[!note] Reminder",
			placement: "inside",
			new_section: null,
		});
	});

	it("never produces an inside placement for a heading or line choice", () => {
		const picker = new SpotPicker(makeApp(), {
			content: HEADING_AND_CALLOUT_CONTENT,
			kind: "existing",
			onPick: vi.fn(),
		});

		const suggestions = picker.getSuggestions("");
		const headingOrLine = suggestions.filter(
			(c) => c.option.type === "heading" || c.option.type === "line",
		);

		expect(headingOrLine.length).toBeGreaterThan(0);
		for (const choice of headingOrLine) {
			expect(choice.placement).not.toBe("inside");

			const onPick = vi.fn();
			const p = new SpotPicker(makeApp(), {
				content: HEADING_AND_CALLOUT_CONTENT,
				kind: "existing",
				onPick,
			});
			p.onChooseSuggestion(choice, new MouseEvent("click"));
			const anchor = onPick.mock.calls[0]?.[0] as AnchorWire;
			expect(anchor.placement).not.toBe("inside");
		}
	});

	it("uses the current query text as the new-section title on choose", () => {
		const onPick = vi.fn();
		const picker = new SpotPicker(makeApp(), {
			content: NO_STRUCTURE_CONTENT,
			kind: "existing",
			onPick,
		});

		const choice = findChoice(picker.getSuggestions(""), "New section", "after");
		if (choice === undefined) throw new Error("expected a new-section+after choice");

		picker.inputEl.value = "Follow-ups";
		picker.onChooseSuggestion(choice, new MouseEvent("click"));

		expect(onPick).toHaveBeenCalledWith({
			type: "line",
			value: null,
			placement: "after",
			new_section: "Follow-ups",
		});
	});
});
