/**
 * Unit tests for `renderNavigableNoteLink` (spec-005 Phase 6, T6.2; PRD F9) —
 * side-split open, hover-preview trigger, and the "note not found" degrade
 * for a target that no longer resolves. Exercised directly here (in addition
 * to the `GardenAuditTab` call-site coverage) since this module is the seam
 * the F9 navigation contract actually lives in.
 */

import "obsidian";
import { App, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { renderNavigableNoteLink } from "../../../../src/ui/garden-audit-view/noteNavigation";

describe("renderNavigableNoteLink — existing target", () => {
	it("renders a clickable .hashi-se-wlink with the given text", () => {
		const app = new App();
		const parent = document.createElement("div");

		const el = renderNavigableNoteLink(parent, app, "Target", "Display Text");

		expect(el.classList.contains("hashi-se-wlink")).toBe(true);
		expect(el.textContent).toBe("Display Text");
		expect(el.getAttribute("role")).toBe("link");
		expect(el.getAttribute("tabindex")).toBe("0");
	});

	it("defaults the visible text to linktext when no separate text is given", () => {
		const app = new App();
		const parent = document.createElement("div");

		const el = renderNavigableNoteLink(parent, app, "Bare Stem");

		expect(el.textContent).toBe("Bare Stem");
	});

	it("click opens the note in a side-split leaf (not replacing the active leaf)", () => {
		const app = new App();
		const parent = document.createElement("div");
		const el = renderNavigableNoteLink(parent, app, "Target");

		el.dispatchEvent(new MouseEvent("click", { bubbles: true }));

		expect(app.workspace.openLinkText).toHaveBeenCalledWith("Target", "", "split");
	});

	it("Enter/Space also open the note beside (keyboard-accessible)", () => {
		const app = new App();
		const parent = document.createElement("div");
		const el = renderNavigableNoteLink(parent, app, "Target");

		el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

		expect(app.workspace.openLinkText).toHaveBeenCalledWith("Target", "", "split");
	});

	it("hover fires hover-link with the linktext and targetEl so Obsidian's preview is available", () => {
		const app = new App();
		const parent = document.createElement("div");
		const el = renderNavigableNoteLink(parent, app, "Target");

		el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

		expect(app.workspace.trigger).toHaveBeenCalledWith(
			"hover-link",
			expect.objectContaining({
				source: "miyo-tomo-hashi",
				linktext: "Target",
				targetEl: el,
			}),
		);
	});
});

describe("renderNavigableNoteLink — missing target", () => {
	it("renders plain text + 'note not found' instead of a link, and does not throw", () => {
		const app = new App();
		vi.mocked(app.metadataCache.getFirstLinkpathDest).mockReturnValue(null);
		const parent = document.createElement("div");

		let el: HTMLElement | undefined;
		expect(() => {
			el = renderNavigableNoteLink(parent, app, "Ghost");
		}).not.toThrow();

		expect(el?.classList.contains("hashi-se-wlink")).toBe(false);
		expect(el?.getAttribute("role")).not.toBe("link");
		expect(el?.textContent).toBe("Ghost (note not found)");
	});

	it("clicking the missing-target element does nothing (no navigation call, no throw)", () => {
		const app = new App();
		vi.mocked(app.metadataCache.getFirstLinkpathDest).mockReturnValue(null);
		const parent = document.createElement("div");

		const el = renderNavigableNoteLink(parent, app, "Ghost");
		expect(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true }))).not.toThrow();

		expect(app.workspace.openLinkText).not.toHaveBeenCalled();
	});

	it("hovering the missing-target element does nothing (no hover-preview trigger, no throw)", () => {
		const app = new App();
		vi.mocked(app.metadataCache.getFirstLinkpathDest).mockReturnValue(null);
		const parent = document.createElement("div");

		const el = renderNavigableNoteLink(parent, app, "Ghost");
		expect(() => el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))).not.toThrow();

		expect(app.workspace.trigger).not.toHaveBeenCalled();
	});

	it("degrades to 'note not found' when metadataCache lacks getFirstLinkpathDest", () => {
		const app = new App();
		// Simulate a host/mock missing the API — guard-by-typeof path.
		(app.metadataCache as { getFirstLinkpathDest?: unknown }).getFirstLinkpathDest = undefined;
		const parent = document.createElement("div");

		const el = renderNavigableNoteLink(parent, app, "Ghost");

		expect(el.textContent).toBe("Ghost (note not found)");
	});
});

describe("renderNavigableNoteLink — resolution", () => {
	it("resolves via metadataCache.getFirstLinkpathDest against the note-relative sourcePath", () => {
		const app = new App();
		const parent = document.createElement("div");

		renderNavigableNoteLink(parent, app, "Target");

		expect(app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith("Target", "");
	});

	it("treats a resolved TFile as an existing target", () => {
		const app = new App();
		vi.mocked(app.metadataCache.getFirstLinkpathDest).mockReturnValue(new TFile());
		const parent = document.createElement("div");

		const el = renderNavigableNoteLink(parent, app, "Target");

		expect(el.classList.contains("hashi-se-wlink")).toBe(true);
	});
});
