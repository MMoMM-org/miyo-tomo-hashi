/**
 * Unit tests for GardenAuditEditorView — spec-005 Phase 4, T4.1 lifecycle
 * (open→load→render, setState retarget, close-while-dirty). Mirrors the
 * relevant slices of test/unit/ui/suggestions-view/SuggestionsEditorView.test.ts.
 *
 * Save/Revert/dirty chrome is NOT exercised here — that's T4.3. Tier
 * grouping / finding rendering is NOT exercised here — that's T4.2. This
 * file only covers the lifecycle contract that both later tasks build on.
 */

import "obsidian";
import { App, WorkspaceLeaf } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SEED, FakeGardenAuditDoc } from "../../../__mocks__/FakeGardenAuditDoc";
import type { GardenAuditModel } from "../../../../src/types/garden-audit";
import { VIEW_TYPE_GARDEN_AUDIT_EDITOR } from "../../../../src/ui/garden-audit-view/index";
import { GardenAuditEditorView } from "../../../../src/ui/garden-audit-view/GardenAuditEditorView";
import type { GardenAuditDoc } from "../../../../src/vault/GardenAuditDoc";

// --- ConfirmModal mock -------------------------------------------------------
// Mirrors SuggestionsEditorView.test.ts's pattern exactly: the real
// ConfirmModal is a thin Obsidian Modal wrapper already covered by its own
// unit tests — here we only need to observe THAT the view constructs one.

const confirmModalInstances: Array<{ title: string; message: string }> = [];

vi.mock("../../../../src/ui/ConfirmModal", () => ({
	ConfirmModal: vi.fn(function ConfirmModal(
		_app: unknown,
		title: string,
		message: string,
		_onConfirm: () => Promise<void>,
	) {
		const instance = { title, message, open: vi.fn() };
		confirmModalInstances.push(instance);
		return instance;
	}),
}));

// --- factories ---------------------------------------------------------------

const DOC_PATH = "100 Inbox/run-editor-001_garden-audit.json";

function makeView(adapter: GardenAuditDoc, docPath = DOC_PATH): GardenAuditEditorView {
	const leaf = new WorkspaceLeaf();
	const view = new GardenAuditEditorView(leaf, { adapter, docPath });
	view.app = new App();
	return view;
}

function leafMeta(view: GardenAuditEditorView): string | null {
	return view.contentEl.querySelector(".hashi-se-leaf-meta")?.textContent ?? null;
}

function leafActions(view: GardenAuditEditorView): HTMLElement | null {
	return view.contentEl.querySelector(".hashi-se-leaf-actions");
}

function bodyText(view: GardenAuditEditorView): string {
	return view.contentEl.textContent ?? "";
}

function makeFailingAdapter(error: Error): GardenAuditDoc {
	return {
		load: vi.fn(async () => {
			throw error;
		}),
		save: vi.fn(async () => {}),
	};
}

function makeDirtyAdapter(): GardenAuditDoc {
	return {
		load: vi.fn(
			async (): Promise<GardenAuditModel> => ({
				doc: DEFAULT_SEED,
				dirty: true,
			}),
		),
		save: vi.fn(async () => {}),
	};
}

describe("GardenAuditEditorView — identity", () => {
	it("getViewType() returns VIEW_TYPE_GARDEN_AUDIT_EDITOR", () => {
		expect(makeView(new FakeGardenAuditDoc()).getViewType()).toBe(
			VIEW_TYPE_GARDEN_AUDIT_EDITOR,
		);
	});

	it("getDisplayText() is 'Garden audit' and getIcon() is 'compass'", () => {
		const view = makeView(new FakeGardenAuditDoc());
		expect(view.getDisplayText()).toBe("Garden audit");
		expect(view.getIcon()).toBe("compass");
	});
});

describe("GardenAuditEditorView — onOpen with no docPath", () => {
	it("renders the 'open a doc first' placeholder without calling adapter.load", async () => {
		const adapter = new FakeGardenAuditDoc();
		const loadSpy = vi.spyOn(adapter, "load");
		const view = makeView(adapter, "");

		await view.onOpen();

		expect(bodyText(view)).toContain(
			"Open a Tomo _garden-audit.json (or its .md) first.",
		);
		expect(loadSpy).not.toHaveBeenCalled();
	});
});

describe("GardenAuditEditorView — onOpen with a docPath", () => {
	it("loads via the adapter and renders the leaf-head meta line", async () => {
		const view = makeView(new FakeGardenAuditDoc());

		await view.onOpen();

		expect(leafMeta(view)).toBe(
			`run ${DEFAULT_SEED.run_id} · profile ${DEFAULT_SEED.profile} · ${DEFAULT_SEED.findings.length} findings`,
		);
	});

	it("renders a load error and does NOT enter an editable state (no leaf-actions)", async () => {
		const adapter = makeFailingAdapter(new Error("schema version mismatch"));
		const view = makeView(adapter);

		await view.onOpen();

		expect(bodyText(view)).toContain(
			"Couldn't load garden audit: schema version mismatch",
		);
		expect(leafActions(view)).toBeNull();
	});
});

describe("GardenAuditEditorView — setState retarget", () => {
	it("re-loads and re-renders when retargeted to a different docPath after onOpen", async () => {
		const adapter = new FakeGardenAuditDoc();
		const loadSpy = vi.spyOn(adapter, "load");
		const view = makeView(adapter);
		await view.onOpen();
		loadSpy.mockClear();

		const otherPath = "100 Inbox/run-editor-002_garden-audit.json";
		await view.setState({ docPath: otherPath }, { history: false });

		expect(loadSpy).toHaveBeenCalledWith(otherPath);
		expect(view.getState()).toEqual({ docPath: otherPath });
	});

	it("tolerates malformed setState input (null / non-object / non-string docPath) without throwing", async () => {
		const view = makeView(new FakeGardenAuditDoc());
		await view.onOpen();

		await expect(view.setState(null, { history: false })).resolves.toBeUndefined();
		await expect(
			view.setState("not an object", { history: false }),
		).resolves.toBeUndefined();
		await expect(
			view.setState({ docPath: 123 }, { history: false }),
		).resolves.toBeUndefined();

		// docPath is untouched by any of the malformed calls above.
		expect(view.getState()).toEqual({ docPath: DOC_PATH });
	});
});

describe("GardenAuditEditorView — close-while-dirty", () => {
	beforeEach(() => {
		confirmModalInstances.length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("prompts a ConfirmModal when the model is dirty", async () => {
		const view = makeView(makeDirtyAdapter());
		await view.onOpen();

		await view.onClose();

		expect(confirmModalInstances).toHaveLength(1);
		expect(confirmModalInstances[0]?.title).toBe("Unsaved changes");
		expect(confirmModalInstances[0]?.message).toContain("garden-audit run");
		expect(confirmModalInstances[0]?.message).toContain("unsaved edits");
	});

	it("does NOT prompt when the model is clean", async () => {
		const view = makeView(new FakeGardenAuditDoc());
		await view.onOpen();

		await view.onClose();

		expect(confirmModalInstances).toHaveLength(0);
	});
});
