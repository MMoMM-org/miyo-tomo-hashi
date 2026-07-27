/**
 * Unit tests for `renderTargetControlCore` — the generalized widget core the
 * Instruction Fixer's repair fields share with garden-audit's target field
 * (spec-006 T3.2).
 *
 * A sibling of `TargetControl.test.ts`, which keeps covering the garden-audit
 * wrapper (`FindingCheck` → `(empty=…)` caption) unchanged. This file covers
 * only what the generalization ADDED: the caller-supplied caption/placeholder/
 * aria-label, the three pick modes, and the empty-caption branch — none of
 * which garden-audit can reach, since its wrapper always passes a non-empty
 * caption and `pick: "stem"`.
 */

import "obsidian";
import { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderTargetControlCore } from "../../../../src/ui/garden-audit-view/TargetControl";

// --- picker spy --------------------------------------------------------------

interface PickerInstance {
	app: unknown;
	onChoose: (path: string) => void;
	open: ReturnType<typeof vi.fn>;
}

const { pickerInstances } = vi.hoisted(() => ({ pickerInstances: [] as PickerInstance[] }));

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

// --- harness -----------------------------------------------------------------

function render(
	overrides: Partial<Parameters<typeof renderTargetControlCore>[1]> = {},
): { container: HTMLElement; committed: string[] } {
	const container = document.createElement("div");
	const committed: string[] = [];
	renderTargetControlCore(container, {
		app: new App(),
		value: "current",
		onChange: (next) => committed.push(next),
		caption: "path",
		captionTooltip: "Vault-relative path.",
		placeholder: "Type or pick a note…",
		ariaLabel: "Note",
		pick: "path",
		...overrides,
	});
	return { container, committed };
}

beforeEach(() => {
	pickerInstances.length = 0;
});

describe("renderTargetControlCore — caller-supplied strings", () => {
	it("renders the caller's caption, placeholder and aria-label", () => {
		const { container } = render();
		const input = container.querySelector("input");

		expect(container.querySelector(".hashi-ga-target-hint")?.textContent).toBe("path");
		expect(container.querySelector(".hashi-ga-target-hint")?.getAttribute("aria-label")).toBe(
			"Vault-relative path.",
		);
		expect(input?.getAttribute("placeholder")).toBe("Type or pick a note…");
		expect(input?.getAttribute("aria-label")).toBe("Note");
	});

	it("renders NO caption span at all when the caption is empty", () => {
		const { container } = render({ caption: "" });

		expect(container.querySelector(".hashi-ga-target-hint")).toBeNull();
		expect(container.querySelector("input")).not.toBeNull();
	});
});

describe("renderTargetControlCore — pick modes", () => {
	it("`none` renders no picker button (free-text field)", () => {
		const { container } = render({ pick: "none" });

		expect(container.querySelector("button")).toBeNull();
	});

	it("`path` commits the picked vault path verbatim", () => {
		const { container, committed } = render({ pick: "path" });
		container.querySelector("button")?.dispatchEvent(new MouseEvent("click"));
		pickerInstances[0]?.onChoose("Atlas/202 Notes/Moved.md");

		expect(committed).toEqual(["Atlas/202 Notes/Moved.md"]);
		expect(container.querySelector("input")?.value).toBe("Atlas/202 Notes/Moved.md");
	});

	it("`stem` commits the basename minus .md", () => {
		const { container, committed } = render({ pick: "stem" });
		container.querySelector("button")?.dispatchEvent(new MouseEvent("click"));
		pickerInstances[0]?.onChoose("Atlas/202 Notes/Moved.md");

		expect(committed).toEqual(["Moved"]);
	});
});

describe("renderTargetControlCore — commits", () => {
	it("commits a free-typed value verbatim on change", () => {
		const { container, committed } = render();
		const input = container.querySelector("input");
		if (input === null) throw new Error("no input");

		input.value = "  spaced value  ";
		input.dispatchEvent(new Event("change"));

		expect(committed).toEqual(["  spaced value  "]);
	});
});
