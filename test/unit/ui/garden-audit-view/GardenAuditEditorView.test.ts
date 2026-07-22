/**
 * Direct unit tests for GardenAuditEditorView — the Phase-3 T3.3 PLACEHOLDER
 * leaf ItemView (spec-005). Deliberately MINIMAL and proportionate to a
 * placeholder: only the state-handling contract that persists into Phase 4
 * (view-type identity, docPath tracking via getState/setState, and
 * extractDocPath's malformed-input guards) is covered here — the real tab
 * UI (tier sections, finding cards, Save/Revert chrome) is Phase 4's job and
 * gets its own tests then. Mirrors the relevant slices of
 * test/unit/ui/suggestions-view/SuggestionsEditorView.test.ts.
 */

import "obsidian";
import { WorkspaceLeaf } from "obsidian";
import { describe, expect, it } from "vitest";

import type { GardenAuditDoc } from "../../../../src/vault/GardenAuditDoc";
import { GardenAuditEditorView } from "../../../../src/ui/garden-audit-view/GardenAuditEditorView";
import { VIEW_TYPE_GARDEN_AUDIT_EDITOR } from "../../../../src/ui/garden-audit-view/index";

// The adapter is unused by this Phase-3 placeholder (Phase 4 wires load/save
// through it) — a minimal stub is enough to satisfy the constructor.
const stubAdapter: GardenAuditDoc = {
	load: async () => {
		throw new Error("not implemented in this placeholder test");
	},
	save: async () => {},
};

function makeView(docPath?: string): GardenAuditEditorView {
	const leaf = new WorkspaceLeaf();
	return new GardenAuditEditorView(leaf, { adapter: stubAdapter, docPath });
}

function bodyText(view: GardenAuditEditorView): string {
	return view.contentEl.textContent ?? "";
}

describe("GardenAuditEditorView — view-type identity", () => {
	it("getViewType() returns VIEW_TYPE_GARDEN_AUDIT_EDITOR", () => {
		expect(makeView().getViewType()).toBe(VIEW_TYPE_GARDEN_AUDIT_EDITOR);
	});

	it("getDisplayText() and getIcon() are set", () => {
		const view = makeView();
		expect(view.getDisplayText()).toBe("Garden-audit editor");
		expect(view.getIcon()).toBe("list-checks");
	});
});

describe("GardenAuditEditorView — onOpen with no docPath", () => {
	it("renders the 'no document chosen' placeholder", async () => {
		const view = makeView();

		await view.onOpen();

		expect(bodyText(view)).toContain("No garden-audit document chosen yet.");
	});
});

describe("GardenAuditEditorView — setState", () => {
	it("updates getState() to carry the new docPath and re-renders showing it", async () => {
		const view = makeView();
		await view.onOpen();

		await view.setState({ docPath: "100 Inbox/run-editor-001_garden-audit.json" }, { history: false });

		expect(view.getState()).toEqual({
			docPath: "100 Inbox/run-editor-001_garden-audit.json",
		});
		expect(bodyText(view)).toContain("100 Inbox/run-editor-001_garden-audit.json");
	});

	it("tolerates null state without throwing — stays in the placeholder state", async () => {
		const view = makeView();
		await view.onOpen();

		await expect(view.setState(null, { history: false })).resolves.toBeUndefined();

		expect(view.getState()).toEqual({ docPath: "" });
		expect(bodyText(view)).toContain("No garden-audit document chosen yet.");
	});

	it("tolerates a non-object state without throwing — stays in the placeholder state", async () => {
		const view = makeView();
		await view.onOpen();

		await expect(view.setState("not an object", { history: false })).resolves.toBeUndefined();

		expect(view.getState()).toEqual({ docPath: "" });
	});

	it("tolerates a non-string docPath field without throwing — stays in the placeholder state", async () => {
		const view = makeView();
		await view.onOpen();

		await expect(view.setState({ docPath: 123 }, { history: false })).resolves.toBeUndefined();

		expect(view.getState()).toEqual({ docPath: "" });
	});
});
