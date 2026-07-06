/**
 * Unit tests for TagHandlerTab (T3.7) — the Tag-Handler tab's per-group card:
 * read-only Tomo capture context (handler/target_path/marker/source_paths/
 * preview) plus the Approve and Keep-source toggles.
 *
 * Spec refs: spec-004 SDD §6 Tag-Handler, PRD F9; plan/phase-3.md T3.7.
 */

import "obsidian";
import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { DEFAULT_SEED } from "../../../../__mocks__/FakeSuggestionsDoc";
import type { EditModel, TagGroupWire } from "../../../../../src/types/suggestions";
import type { TabContext } from "../../../../../src/ui/suggestions-view/tabContract";
import { TagHandlerTab } from "../../../../../src/ui/suggestions-view/tabs/TagHandlerTab";

// vitest v4's `vi.fn()` no longer infers a concrete call signature from
// context alone — pin it explicitly so `ctx.apply` is assignable to
// `TabContext["apply"]` (see docs/ai/memory/tools.md, vitest v4 mock typing).
type ApplyFn = (transform: (model: EditModel) => EditModel) => void;

// --- factories ---------------------------------------------------------------

function getMockGroup(overrides?: Partial<TagGroupWire>): TagGroupWire {
	return {
		group_id: "th-sample-project-log-md",
		approved: true,
		keep_source: false,
		handler: "sample-handler",
		target_path: "Efforts/Project Log.md",
		marker: "## Captures",
		source_paths: ["100 Inbox/202606291658_sample-capture.md"],
		preview: "| 2026-06-29 | feature | Sample capture entry for the project log |",
		...overrides,
	};
}

function getMockModel(groups: readonly TagGroupWire[]): EditModel {
	return {
		doc: { ...DEFAULT_SEED, tag_handler_groups: groups },
		dirty: false,
	};
}

function getMockContext(): TabContext & { apply: Mock<ApplyFn> } {
	return {
		app: new App(),
		apply: vi.fn<ApplyFn>(),
	};
}

function renderTab(model: EditModel, ctx: TabContext): HTMLElement {
	const container = document.createElement("div");
	new TagHandlerTab().render(container, model, ctx);
	return container;
}

const NS = "hashi-suggestions-editor-tag-handler";

// ---------------------------------------------------------------------------

describe("TagHandlerTab", () => {
	describe("count", () => {
		it("returns the number of tag_handler_groups", () => {
			expect(new TagHandlerTab().count(getMockModel([getMockGroup(), getMockGroup({ group_id: "th-2" })]))).toBe(2);
			expect(new TagHandlerTab().count(getMockModel([]))).toBe(0);
		});
	});

	describe("render — read-only context", () => {
		it("renders handler, target_path, and marker as text", () => {
			const container = renderTab(getMockModel([getMockGroup()]), getMockContext());

			const values = Array.from(container.querySelectorAll(`.${NS}-field-value`)).map(
				(el) => el.textContent,
			);
			expect(values).toContain("sample-handler");
			expect(values).toContain("Efforts/Project Log.md");
			expect(values).toContain("## Captures");
		});

		it("renders each source_paths entry as a list item", () => {
			const container = renderTab(
				getMockModel([
					getMockGroup({
						source_paths: ["100 Inbox/a.md", "100 Inbox/b.md"],
					}),
				]),
				getMockContext(),
			);

			const items = Array.from(
				container.querySelectorAll(`.${NS}-source-paths li`),
			).map((el) => el.textContent);
			expect(items).toEqual(["100 Inbox/a.md", "100 Inbox/b.md"]);
		});

		it("renders the preview block as text content", () => {
			const preview = "| 2026-06-29 | feature | Sample capture entry for the project log |";
			const container = renderTab(getMockModel([getMockGroup({ preview })]), getMockContext());

			const pre = container.querySelector(`pre.${NS}-preview`);
			expect(pre).not.toBeNull();
			expect(pre?.textContent).toBe(preview);
		});

		it("does not render the read-only context as interactive elements", () => {
			const container = renderTab(getMockModel([getMockGroup()]), getMockContext());

			const context = container.querySelector(`.${NS}-context`);
			expect(context).not.toBeNull();
			expect(context?.querySelector("input")).toBeNull();
			expect(context?.querySelector("button")).toBeNull();
		});

		it("never injects the preview as HTML — HTML-like content stays literal text", () => {
			const maliciousPreview = "<b>injected</b><script>window.pwned = true;</script>";
			const container = renderTab(
				getMockModel([getMockGroup({ preview: maliciousPreview })]),
				getMockContext(),
			);

			const pre = container.querySelector(`pre.${NS}-preview`);
			expect(pre?.textContent).toBe(maliciousPreview);
			// If it had been injected via innerHTML, these would parse into real elements.
			expect(pre?.querySelector("b")).toBeNull();
			expect(pre?.querySelector("script")).toBeNull();
		});
	});

	describe("render — toggles", () => {
		it("reflects the group's approved and keep_source flags as checkbox state", () => {
			const container = renderTab(
				getMockModel([getMockGroup({ approved: true, keep_source: false })]),
				getMockContext(),
			);

			const approve = container.querySelector<HTMLInputElement>(`input.${NS}-approve`);
			const keepSource = container.querySelector<HTMLInputElement>(`input.${NS}-keep-source`);
			expect(approve?.checked).toBe(true);
			expect(keepSource?.checked).toBe(false);
		});

		it("toggling Approve dispatches a transform that flips only `approved`", () => {
			const ctx = getMockContext();
			const model = getMockModel([getMockGroup({ approved: true, keep_source: false })]);
			const container = renderTab(model, ctx);

			const approve = container.querySelector<HTMLInputElement>(`input.${NS}-approve`);
			expect(approve).not.toBeNull();
			approve!.checked = false;
			approve!.dispatchEvent(new Event("change"));

			expect(ctx.apply).toHaveBeenCalledOnce();
			const transform = ctx.apply.mock.calls[0]?.[0] as (m: EditModel) => EditModel;
			const next = transform(model);
			expect(next.doc.tag_handler_groups[0]?.approved).toBe(false);
			expect(next.doc.tag_handler_groups[0]?.keep_source).toBe(false);
		});

		it("toggling Keep-source dispatches a transform that flips only `keep_source`", () => {
			const ctx = getMockContext();
			const model = getMockModel([getMockGroup({ approved: true, keep_source: false })]);
			const container = renderTab(model, ctx);

			const keepSource = container.querySelector<HTMLInputElement>(`input.${NS}-keep-source`);
			expect(keepSource).not.toBeNull();
			keepSource!.checked = true;
			keepSource!.dispatchEvent(new Event("change"));

			expect(ctx.apply).toHaveBeenCalledOnce();
			const transform = ctx.apply.mock.calls[0]?.[0] as (m: EditModel) => EditModel;
			const next = transform(model);
			expect(next.doc.tag_handler_groups[0]?.keep_source).toBe(true);
			expect(next.doc.tag_handler_groups[0]?.approved).toBe(true);
		});

		it("only mutates the toggled group when multiple groups are rendered", () => {
			const ctx = getMockContext();
			const model = getMockModel([
				getMockGroup({ group_id: "th-a", approved: true }),
				getMockGroup({ group_id: "th-b", approved: true }),
			]);
			const container = renderTab(model, ctx);

			const cards = container.querySelectorAll(`.${NS}-card`);
			expect(cards).toHaveLength(2);
			const secondApprove = cards[1]?.querySelector<HTMLInputElement>(`input.${NS}-approve`);
			secondApprove!.checked = false;
			secondApprove!.dispatchEvent(new Event("change"));

			const transform = ctx.apply.mock.calls[0]?.[0] as (m: EditModel) => EditModel;
			const next = transform(model);
			expect(next.doc.tag_handler_groups.find((g) => g.group_id === "th-a")?.approved).toBe(true);
			expect(next.doc.tag_handler_groups.find((g) => g.group_id === "th-b")?.approved).toBe(false);
		});
	});

	describe("render — against the real 1115 fixture", () => {
		it("renders one card matching the vendored tag_handler_groups entry", () => {
			const model: EditModel = { doc: DEFAULT_SEED, dirty: false };
			const container = renderTab(model, getMockContext());

			expect(container.querySelectorAll(`.${NS}-card`)).toHaveLength(1);
			expect(container.textContent).toContain("sample-handler");
			expect(container.textContent).toContain("Efforts/Project Log.md");
		});
	});
});
