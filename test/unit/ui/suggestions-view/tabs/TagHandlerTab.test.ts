/**
 * Unit tests for TagHandlerTab (T3.7) — the Tag-Handler tab's per-group card
 * rebuilt to the approved mockup: read-only Tomo capture context
 * (handler/target_path/marker/source_paths count/preview) plus the
 * Approve/Skip segmented control and the Keep-source checkbox.
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

const NS = "hashi-se";

// ---------------------------------------------------------------------------

describe("TagHandlerTab", () => {
	describe("count", () => {
		it("returns the number of tag_handler_groups", () => {
			expect(new TagHandlerTab().count(getMockModel([getMockGroup(), getMockGroup({ group_id: "th-2" })]))).toBe(2);
			expect(new TagHandlerTab().count(getMockModel([]))).toBe(0);
		});
	});

	describe("render — card structure", () => {
		it("renders a hashi-se-card hashi-se-tagh card per group", () => {
			const container = renderTab(getMockModel([getMockGroup()]), getMockContext());

			const card = container.querySelector(`.${NS}-card.${NS}-tagh`);
			expect(card).not.toBeNull();
			expect(card?.getAttribute("data-group-id")).toBe("th-sample-project-log-md");
		});
	});

	describe("render — read-only context", () => {
		it("renders target_path and marker as text in the title", () => {
			const container = renderTab(getMockModel([getMockGroup()]), getMockContext());

			const title = container.querySelector(`.${NS}-th-title`);
			expect(title?.querySelector(`.${NS}-wlink`)?.textContent).toBe("Efforts/Project Log.md");
			expect(title?.querySelector(`.${NS}-th-marker`)?.textContent).toBe("## Captures");
		});

		it("renders a read-only context note explaining the wire-carried data", () => {
			const container = renderTab(getMockModel([getMockGroup()]), getMockContext());

			const note = container.querySelector(`.${NS}-ctx-note`);
			expect(note).not.toBeNull();
			expect(note?.textContent).toMatch(/read-only/i);
		});

		it("renders handler (in <code>) and the source_paths count in the context row", () => {
			const container = renderTab(
				getMockModel([
					getMockGroup({
						handler: "sample-handler",
						source_paths: ["100 Inbox/a.md", "100 Inbox/b.md"],
					}),
				]),
				getMockContext(),
			);

			const row = container.querySelector(`.${NS}-th-row`);
			expect(row?.querySelector("code")?.textContent).toBe("sample-handler");
			expect(row?.textContent).toContain("Sources 2");
		});

		it("renders the preview block as text content", () => {
			const preview = "| 2026-06-29 | feature | Sample capture entry for the project log |";
			const container = renderTab(getMockModel([getMockGroup({ preview })]), getMockContext());

			const previewEl = container.querySelector(`.${NS}-th-preview`);
			expect(previewEl).not.toBeNull();
			expect(previewEl?.textContent).toBe(preview);
		});

		it("does not render the read-only context as interactive elements", () => {
			const container = renderTab(getMockModel([getMockGroup()]), getMockContext());

			const context = container.querySelector(`.${NS}-th-ctx`);
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

			const previewEl = container.querySelector(`.${NS}-th-preview`);
			expect(previewEl?.textContent).toBe(maliciousPreview);
			// If it had been injected via innerHTML, these would parse into real elements.
			expect(previewEl?.querySelector("b")).toBeNull();
			expect(previewEl?.querySelector("script")).toBeNull();
		});
	});

	describe("render — decision segmented control", () => {
		it("marks Approve active when the group is approved", () => {
			const container = renderTab(getMockModel([getMockGroup({ approved: true })]), getMockContext());

			const approve = container.querySelector(`.${NS}-decision button.${NS}-approve`);
			const skip = container.querySelector(`.${NS}-decision button.${NS}-skip`);
			expect(approve?.classList.contains("is-active")).toBe(true);
			expect(skip?.classList.contains("is-active")).toBe(false);
		});

		it("marks Skip active when the group is not approved", () => {
			const container = renderTab(getMockModel([getMockGroup({ approved: false })]), getMockContext());

			const approve = container.querySelector(`.${NS}-decision button.${NS}-approve`);
			const skip = container.querySelector(`.${NS}-decision button.${NS}-skip`);
			expect(approve?.classList.contains("is-active")).toBe(false);
			expect(skip?.classList.contains("is-active")).toBe(true);
		});

		it("clicking Approve dispatches a transform that sets approved to true", () => {
			const ctx = getMockContext();
			const model = getMockModel([getMockGroup({ approved: false, keep_source: false })]);
			const container = renderTab(model, ctx);

			const approve = container.querySelector<HTMLButtonElement>(`.${NS}-decision button.${NS}-approve`);
			expect(approve).not.toBeNull();
			approve!.dispatchEvent(new Event("click"));

			expect(ctx.apply).toHaveBeenCalledOnce();
			const transform = ctx.apply.mock.calls[0]?.[0] as (m: EditModel) => EditModel;
			const next = transform(model);
			expect(next.doc.tag_handler_groups[0]?.approved).toBe(true);
			expect(next.doc.tag_handler_groups[0]?.keep_source).toBe(false);
		});

		it("clicking Skip dispatches a transform that sets approved to false", () => {
			const ctx = getMockContext();
			const model = getMockModel([getMockGroup({ approved: true, keep_source: false })]);
			const container = renderTab(model, ctx);

			const skip = container.querySelector<HTMLButtonElement>(`.${NS}-decision button.${NS}-skip`);
			expect(skip).not.toBeNull();
			skip!.dispatchEvent(new Event("click"));

			expect(ctx.apply).toHaveBeenCalledOnce();
			const transform = ctx.apply.mock.calls[0]?.[0] as (m: EditModel) => EditModel;
			const next = transform(model);
			expect(next.doc.tag_handler_groups[0]?.approved).toBe(false);
			expect(next.doc.tag_handler_groups[0]?.keep_source).toBe(false);
		});

		it("only mutates the toggled group's decision when multiple groups are rendered", () => {
			const ctx = getMockContext();
			const model = getMockModel([
				getMockGroup({ group_id: "th-a", approved: true }),
				getMockGroup({ group_id: "th-b", approved: true }),
			]);
			const container = renderTab(model, ctx);

			const cards = container.querySelectorAll(`.${NS}-card`);
			expect(cards).toHaveLength(2);
			const secondSkip = cards[1]?.querySelector<HTMLButtonElement>(`.${NS}-decision button.${NS}-skip`);
			secondSkip!.dispatchEvent(new Event("click"));

			const transform = ctx.apply.mock.calls[0]?.[0] as (m: EditModel) => EditModel;
			const next = transform(model);
			expect(next.doc.tag_handler_groups.find((g) => g.group_id === "th-a")?.approved).toBe(true);
			expect(next.doc.tag_handler_groups.find((g) => g.group_id === "th-b")?.approved).toBe(false);
		});
	});

	describe("render — keep-source checkbox", () => {
		it("reflects the group's keep_source flag as checkbox state", () => {
			const container = renderTab(getMockModel([getMockGroup({ keep_source: true })]), getMockContext());

			const keepSource = container.querySelector<HTMLInputElement>(`.${NS}-cbx input`);
			expect(keepSource?.checked).toBe(true);
		});

		it("renders the 'Keep source files' label text", () => {
			const container = renderTab(getMockModel([getMockGroup()]), getMockContext());

			expect(container.querySelector(`.${NS}-cbx`)?.textContent).toContain("Keep source files");
		});

		it("toggling the checkbox dispatches a transform that flips only keep_source", () => {
			const ctx = getMockContext();
			const model = getMockModel([getMockGroup({ approved: true, keep_source: false })]);
			const container = renderTab(model, ctx);

			const keepSource = container.querySelector<HTMLInputElement>(`.${NS}-cbx input`);
			expect(keepSource).not.toBeNull();
			keepSource!.checked = true;
			keepSource!.dispatchEvent(new Event("change"));

			expect(ctx.apply).toHaveBeenCalledOnce();
			const transform = ctx.apply.mock.calls[0]?.[0] as (m: EditModel) => EditModel;
			const next = transform(model);
			expect(next.doc.tag_handler_groups[0]?.keep_source).toBe(true);
			expect(next.doc.tag_handler_groups[0]?.approved).toBe(true);
		});
	});

	describe("render — against the real 1115 fixture", () => {
		it("renders one card matching the vendored tag_handler_groups entry", () => {
			const model: EditModel = { doc: DEFAULT_SEED, dirty: false };
			const container = renderTab(model, getMockContext());

			expect(container.querySelectorAll(`.${NS}-card.${NS}-tagh`)).toHaveLength(1);
			expect(container.textContent).toContain("sample-handler");
			expect(container.textContent).toContain("Efforts/Project Log.md");
		});
	});
});
