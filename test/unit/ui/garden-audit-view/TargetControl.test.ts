/**
 * Unit tests for `renderTargetControl` (spec-005 Phase 5, T5.1; SDD ADR-3) —
 * the composite text-input + picker-button widget for a fixable finding's
 * target field. Covers the three states ADR-3 exists for (pick / free-typed
 * / explicit-empty) plus the per-check-type empty label (README 2026-07-22
 * unlink decision: dead_link's empty state is "unlink", NOT "remove").
 *
 * `TargetNotePicker` is spied via `vi.mock` (mirrors SuggestionsTab.test.ts's
 * picker-instance-capture idiom) rather than driven through its real
 * popover — this file only asserts THAT the widget constructs the picker and
 * wires its callback, not the picker's own item-listing behavior (that's
 * `TargetNotePicker.test.ts`).
 */

import "obsidian";
import { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FindingCheck } from "../../../../src/types/garden-audit";
import { renderTargetControl } from "../../../../src/ui/garden-audit-view/TargetControl";

// --- picker spy ------------------------------------------------------------

interface PickerInstance {
	app: unknown;
	onChoose: (path: string) => void;
	open: ReturnType<typeof vi.fn>;
}

const { pickerInstances } = vi.hoisted(() => {
	return { pickerInstances: [] as PickerInstance[] };
});

vi.mock("../../../../src/ui/garden-audit-view/pickers/TargetNotePicker", () => ({
	TargetNotePicker: vi.fn(function TargetNotePicker(
		app: unknown,
		onChoose: (path: string) => void,
	) {
		const instance: PickerInstance = { app, onChoose, open: vi.fn() };
		pickerInstances.push(instance);
		return instance;
	}),
}));

// --- helpers ----------------------------------------------------------------

function render(
	check: FindingCheck,
	value: string | undefined,
	onChange: (value: string) => void = () => {},
): HTMLElement {
	const container = document.createElement("div");
	renderTargetControl(container, { app: new App(), check, value, onChange });
	return container;
}

function input(container: HTMLElement): HTMLInputElement {
	return container.querySelector("input") as HTMLInputElement;
}

function pickButton(container: HTMLElement): HTMLButtonElement {
	return container.querySelector("button") as HTMLButtonElement;
}

beforeEach(() => {
	pickerInstances.length = 0;
});

describe("renderTargetControl — current value / empty state", () => {
	it("shows the current value in the input when one is set", () => {
		const container = render("dead_link", "[[023 Sparks MOC]]");

		expect(input(container).value).toBe("[[023 Sparks MOC]]");
	});

	it("shows a blank input when the value is undefined (unconfigured/explicit-empty)", () => {
		const container = render("dead_link", undefined);

		expect(input(container).value).toBe("");
	});

	it("does not throw and renders a blank input for an explicitly empty string", () => {
		const container = render("broken_up", "");

		expect(input(container).value).toBe("");
	});
});

describe("renderTargetControl — free-typed values", () => {
	it("fires onChange with the typed value on change (not-yet-existing note allowed)", () => {
		const onChange = vi.fn();
		const container = render("dead_link", undefined, onChange);

		const inp = input(container);
		inp.value = "Not Yet Created";
		inp.dispatchEvent(new Event("change"));

		expect(onChange).toHaveBeenCalledWith("Not Yet Created");
	});

	it("also fires onChange on Enter (commit without requiring blur)", () => {
		const onChange = vi.fn();
		const container = render("broken_up", undefined, onChange);

		const inp = input(container);
		inp.value = "020 Active MOC";
		inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

		expect(onChange).toHaveBeenCalledWith("020 Active MOC");
	});

	it("fires onChange with an explicit empty string when the field is cleared", () => {
		const onChange = vi.fn();
		const container = render("dead_link", "[[023 Sparks MOC]]", onChange);

		const inp = input(container);
		inp.value = "";
		inp.dispatchEvent(new Event("change"));

		expect(onChange).toHaveBeenCalledWith("");
	});
});

describe("renderTargetControl — picker button", () => {
	it("opens a TargetNotePicker on click", () => {
		const container = render("orphan", undefined);

		pickButton(container).dispatchEvent(new MouseEvent("click", { bubbles: true }));

		expect(pickerInstances).toHaveLength(1);
		expect(pickerInstances[0]!.open).toHaveBeenCalledOnce();
	});

	it("populates the input AND fires onChange when a note is picked", () => {
		const onChange = vi.fn();
		const container = render("unparented", undefined, onChange);

		pickButton(container).dispatchEvent(new MouseEvent("click", { bubbles: true }));
		pickerInstances[0]!.onChoose("Areas/Work.md");

		expect(input(container).value).toBe("Areas/Work.md");
		expect(onChange).toHaveBeenCalledWith("Areas/Work.md");
	});

	it("is keyboard-accessible (a native <button>, focusable and Enter/Space-activatable)", () => {
		const container = render("orphan", undefined);

		expect(pickButton(container).tagName).toBe("BUTTON");
		expect(pickButton(container).getAttribute("type")).toBe("button");
	});
});

describe("renderTargetControl — per-check empty label (README 2026-07-22 unlink decision)", () => {
	it("labels dead_link's empty state 'unlink', NOT 'remove'", () => {
		const container = render("dead_link", undefined);

		expect(container.textContent).toContain("unlink");
		expect(container.textContent).not.toContain("remove");
	});

	it("labels broken_up's empty state 'remove'", () => {
		const container = render("broken_up", undefined);

		expect(container.textContent).toContain("remove");
	});

	it("labels orphan's empty state 'fallback'", () => {
		const container = render("orphan", undefined);

		expect(container.textContent).toContain("fallback");
	});

	it("labels unparented's empty state 'fallback' (same as orphan)", () => {
		const container = render("unparented", undefined);

		expect(container.textContent).toContain("fallback");
	});

	it("still shows the per-check empty label even when a value IS set (constant caption, not conditional)", () => {
		const container = render("dead_link", "[[023 Sparks MOC]]");

		expect(container.textContent).toContain("unlink");
	});
});
