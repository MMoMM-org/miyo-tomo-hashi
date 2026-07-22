/**
 * Unit tests for GardenAuditEditorView — spec-005 Phase 4: T4.1 lifecycle
 * (open→load→render, setState retarget, close-while-dirty) and T4.3 Save/
 * Revert/dirty affordance (incl. the concurrent-change identity guard).
 * Mirrors the relevant slices of
 * test/unit/ui/suggestions-view/SuggestionsEditorView.test.ts.
 *
 * Tier grouping / finding rendering is NOT exercised here — that's T4.2
 * (test/unit/ui/garden-audit-view/tabs/GardenAuditTab.test.ts).
 */

import "obsidian";
import { App, WorkspaceLeaf } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { DEFAULT_SEED, FakeGardenAuditDoc } from "../../../__mocks__/FakeGardenAuditDoc";
import type { GardenAuditModel } from "../../../../src/types/garden-audit";
import { VIEW_TYPE_GARDEN_AUDIT_EDITOR } from "../../../../src/ui/garden-audit-view/index";
import { GardenAuditEditorView } from "../../../../src/ui/garden-audit-view/GardenAuditEditorView";
import type { GardenAuditTabSpec } from "../../../../src/ui/garden-audit-view/tabContract";
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

function makeView(
	adapter: GardenAuditDoc,
	docPath = DOC_PATH,
	tab?: GardenAuditTabSpec,
): GardenAuditEditorView {
	const leaf = new WorkspaceLeaf();
	const view = new GardenAuditEditorView(leaf, { adapter, docPath, tab });
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

interface SpyAdapter extends GardenAuditDoc {
	load: Mock<(docPath: string) => Promise<GardenAuditModel>>;
	save: Mock<(model: GardenAuditModel) => Promise<void>>;
}

/** A spy adapter whose seed model's `dirty` flag is controllable, so Save/
 * Revert tests can start from either a clean or an already-dirty document. */
function makeSpyAdapter(seedDirty: boolean): SpyAdapter {
	return {
		load: vi.fn<(docPath: string) => Promise<GardenAuditModel>>(async () => ({
			doc: DEFAULT_SEED,
			dirty: seedDirty,
		})),
		save: vi.fn<(model: GardenAuditModel) => Promise<void>>(async () => {}),
	};
}

/** A single-tab override whose body renders one plain button; clicking it
 * dispatches a real dirtying transform through `ctx.apply` — exercises the
 * Save/dirty-badge wiring without needing a real GardenAuditTab's edit
 * surface (Phase 5). Mirrors SuggestionsEditorView.test.ts's DIRTYING_TAB. */
const DIRTYING_TAB: GardenAuditTabSpec = {
	count: () => 1,
	render: (container, _model, ctx) => {
		const btn = container.createEl("button", { text: "mark dirty" });
		btn.addEventListener("click", () => {
			ctx.apply((m) => ({ doc: m.doc, dirty: true }));
		});
	},
};

function dirtyBadge(view: GardenAuditEditorView): HTMLElement | null {
	return view.contentEl.querySelector(".hashi-se-dirty");
}

function findActionButton(view: GardenAuditEditorView, text: string): HTMLButtonElement {
	const btn = Array.from(leafActions(view)?.querySelectorAll("button") ?? []).find(
		(b) => b.textContent === text,
	);
	if (btn === undefined) throw new Error(`no action button with text "${text}"`);
	return btn as HTMLButtonElement;
}

function bodyEl(view: GardenAuditEditorView): HTMLElement | null {
	return view.contentEl.querySelector(".hashi-se-body");
}

/** Waits enough microtask ticks for a fire-and-forget async click handler
 * (`void this.handleSave()` / `void this.loadAndRender()`) to settle. */
async function flushAsyncHandler(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
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

describe("GardenAuditEditorView — zero-findings empty state (T4.4)", () => {
	it("renders a clean-vault empty state (not the tab body) when the run has zero findings", async () => {
		const adapter: GardenAuditDoc = {
			load: vi.fn(
				async (): Promise<GardenAuditModel> => ({
					doc: { ...DEFAULT_SEED, findings: [] },
					dirty: false,
				}),
			),
			save: vi.fn(async () => {}),
		};
		const view = makeView(adapter);

		await view.onOpen();

		expect(bodyEl(view)?.querySelector(".hashi-se-empty")?.textContent).toBe(
			"No findings — this vault is clean.",
		);
		// the leaf-head still renders (findings: 0), it's only the body that
		// swaps to the empty state — Save/Revert chrome is still present.
		expect(leafActions(view)).not.toBeNull();
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

describe("GardenAuditEditorView — Save affordance (T4.3)", () => {
	it("Save is disabled and no dirty badge shows on a clean freshly-loaded doc", async () => {
		const adapter = makeSpyAdapter(false);
		const view = makeView(adapter);

		await view.onOpen();

		expect(findActionButton(view, "Save").disabled).toBe(true);
		expect(dirtyBadge(view)).toBeNull();
	});

	it("after an edit, the dirty badge shows 'Edited' and Save becomes enabled", async () => {
		const adapter = makeSpyAdapter(false);
		const view = makeView(adapter, DOC_PATH, DIRTYING_TAB);
		await view.onOpen();

		expect(findActionButton(view, "Save").disabled).toBe(true);
		expect(dirtyBadge(view)).toBeNull();

		const markDirtyBtn = Array.from(bodyEl(view)?.querySelectorAll("button") ?? []).find(
			(b) => b.textContent === "mark dirty",
		);
		markDirtyBtn?.click();

		expect(dirtyBadge(view)?.textContent).toContain("Edited");
		expect(findActionButton(view, "Save").disabled).toBe(false);
	});

	it("clicking Save calls adapter.save with the current (dirty) model", async () => {
		const adapter = makeSpyAdapter(true);
		const view = makeView(adapter);
		await view.onOpen();

		findActionButton(view, "Save").click();
		await flushAsyncHandler();

		expect(adapter.save).toHaveBeenCalledTimes(1);
		expect(adapter.save).toHaveBeenCalledWith({ doc: DEFAULT_SEED, dirty: true });
	});

	it("after a successful save, the dirty badge disappears and Save disables", async () => {
		const adapter = makeSpyAdapter(true);
		const view = makeView(adapter);
		await view.onOpen();
		expect(dirtyBadge(view)).not.toBeNull();

		findActionButton(view, "Save").click();
		await flushAsyncHandler();

		expect(dirtyBadge(view)).toBeNull();
		expect(findActionButton(view, "Save").disabled).toBe(true);
	});

	it("a failed save leaves the dirty badge and Save enabled (adapter already surfaced its own Notice)", async () => {
		const adapter: SpyAdapter = {
			load: vi.fn<(docPath: string) => Promise<GardenAuditModel>>(async () => ({
				doc: DEFAULT_SEED,
				dirty: true,
			})),
			save: vi.fn<(model: GardenAuditModel) => Promise<void>>(async () => {
				throw new Error("disk full");
			}),
		};
		const view = makeView(adapter);
		await view.onOpen();

		findActionButton(view, "Save").click();
		await flushAsyncHandler();

		expect(adapter.save).toHaveBeenCalledTimes(1);
		expect(dirtyBadge(view)).not.toBeNull();
		expect(findActionButton(view, "Save").disabled).toBe(false);
	});
});

describe("GardenAuditEditorView — Revert affordance (T4.3)", () => {
	it("clicking Revert re-invokes adapter.load(docPath), discarding in-memory edits", async () => {
		const adapter = makeSpyAdapter(true);
		const view = makeView(adapter);
		await view.onOpen();
		expect(adapter.load).toHaveBeenCalledTimes(1);
		expect(dirtyBadge(view)).not.toBeNull();

		findActionButton(view, "Revert").click();
		await flushAsyncHandler();

		expect(adapter.load).toHaveBeenCalledTimes(2);
		expect(adapter.load).toHaveBeenLastCalledWith(DOC_PATH);
	});
});

describe("GardenAuditEditorView — Save/Revert race safety (T4.3 concurrent-change guard)", () => {
	it("an edit that lands while a save is in flight is NOT silently marked clean", async () => {
		let resolveSave: () => void = () => {};
		const pendingSave = new Promise<void>((resolve) => {
			resolveSave = resolve;
		});
		const adapter: SpyAdapter = {
			load: vi.fn<(docPath: string) => Promise<GardenAuditModel>>(async () => ({
				doc: DEFAULT_SEED,
				dirty: false,
			})),
			save: vi.fn<(model: GardenAuditModel) => Promise<void>>(() => pendingSave),
		};
		const view = makeView(adapter, DOC_PATH, DIRTYING_TAB);
		await view.onOpen();

		const clickMarkDirty = (): void => {
			const btn = Array.from(bodyEl(view)?.querySelectorAll("button") ?? []).find(
				(b) => b.textContent === "mark dirty",
			);
			btn?.click();
		};

		// Model A: dirty via a first edit, enabling Save.
		clickMarkDirty();
		expect(findActionButton(view, "Save").disabled).toBe(false);

		// Kick off Save — captures model A and awaits the still-pending
		// adapter.save(A).
		findActionButton(view, "Save").click();
		await Promise.resolve();
		expect(adapter.save).toHaveBeenCalledTimes(1);

		// While the save is in flight, BOTH Save and Revert must be
		// disabled — the `saving` UI guard closing the double-click/
		// Revert-during-save window (in addition to the reference-identity
		// guard in handleSave() that protects the case this test exercises).
		expect(findActionButton(view, "Save").disabled).toBe(true);
		expect(findActionButton(view, "Revert").disabled).toBe(true);

		// Model B lands WHILE the save above is still in flight — a second,
		// independent edit the in-flight save knows nothing about.
		clickMarkDirty();

		// Now let the stale save resolve.
		resolveSave();
		await flushAsyncHandler();

		// The in-flight window is over — Revert returns to its normal
		// (enabled) state, and Save reflects model B's REAL dirty state
		// (still dirty, since B's edits were never written).
		expect(findActionButton(view, "Revert").disabled).toBe(false);
		expect(dirtyBadge(view)).not.toBeNull();
		expect(dirtyBadge(view)?.textContent).toContain("Edited");
		expect(findActionButton(view, "Save").disabled).toBe(false);
	});
});
