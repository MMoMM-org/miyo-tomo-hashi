/**
 * Unit tests for `renderActionCard` — the Instruction Fixer's per-kind card
 * body (spec-006 Phase 3, T3.2; SDD ADR-5, PRD F2/F3/F4/F6).
 *
 * What this file owns is exactly what the T3.1 seam delegates: the plain-text
 * intent line, the per-kind target-field controls, and the note link. The card
 * SHELL (header, outcome badge, frozen/read-only tag, failure reason) belongs
 * to `InstructionFixerView` and is covered by its own test file — except for
 * the one wiring test at the bottom, which drives the real view with the real
 * card renderer to prove failed-first ordering + editable-only-where-the-gate-
 * says-so end to end.
 *
 * Both non-editable gate states are asserted, not just one: `frozen-applied`
 * and `read-only-no-signal` are separate branches of the fail-closed gate and
 * a regression could plausibly unlock either alone (Constitution Testing L1 —
 * prove authorization AND rejection).
 */

import "obsidian";
import { App, WorkspaceLeaf } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionOutcome } from "../../../../../src/executor/state";
import { TARGET_FIELD_WHITELIST } from "../../../../../src/instruction-fixer/transforms";
import type { Action, InstructionSet } from "../../../../../src/schema/types";
import {
	actionIntent,
	affectedNotePath,
	renderActionCard,
} from "../../../../../src/ui/instruction-fixer/cards/renderActionCard";
import { targetFieldsFor } from "../../../../../src/ui/instruction-fixer/cards/targetFields";
import type { FixerCardContext } from "../../../../../src/ui/instruction-fixer/fixerContract";
import { InstructionFixerView } from "../../../../../src/ui/instruction-fixer/InstructionFixerView";
import type { EditGateResult } from "../../../../../src/ui/instruction-fixer/outcomeSource";
import type {
	InstructionFixerModel,
	InstructionSetDoc,
} from "../../../../../src/vault/InstructionSetDoc";

import { SAMPLES, VIEW_ONLY_KINDS, makeSet, repairKinds } from "./helpers";

// --- picker spy --------------------------------------------------------------
// Same idiom as TargetControl.test.ts: capture the constructed picker and fire
// its callback by hand rather than driving the real popover.

interface PickerInstance {
	app: unknown;
	onChoose: (path: string) => void;
	open: ReturnType<typeof vi.fn>;
}

const { pickerInstances } = vi.hoisted(() => ({ pickerInstances: [] as PickerInstance[] }));

vi.mock("../../../../../src/ui/garden-audit-view/pickers/TargetNotePicker", () => ({
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

interface Rendered {
	readonly body: HTMLElement;
	readonly transforms: Array<(model: InstructionFixerModel) => InstructionFixerModel>;
	readonly app: App;
}

function render(
	action: Action,
	gate: EditGateResult = "editable",
	outcome: ActionOutcome | null = null,
	reason: string | null = null,
): Rendered {
	const body = document.createElement("div");
	const transforms: Array<(model: InstructionFixerModel) => InstructionFixerModel> = [];
	const app = new App();
	const ctx: FixerCardContext = {
		app,
		gate,
		outcome,
		reason,
		apply: (transform) => {
			transforms.push(transform);
		},
	};
	renderActionCard(body, action, ctx);
	return { body, transforms, app };
}

/** The card body's own children, by their leading class — the rendered order. */
function bodyOrder(body: HTMLElement): string[] {
	return Array.from(body.children).map((el) => el.classList.item(0) ?? "");
}

function inputs(body: HTMLElement): HTMLInputElement[] {
	return Array.from(body.querySelectorAll("input"));
}

function labels(body: HTMLElement): string[] {
	return Array.from(body.querySelectorAll(".hashi-if-field label")).map(
		(el) => el.textContent ?? "",
	);
}

function readOnlyValues(body: HTMLElement): string[] {
	return Array.from(body.querySelectorAll(".hashi-if-field-value")).map(
		(el) => el.textContent ?? "",
	);
}

function intentText(body: HTMLElement): string {
	return body.querySelector(".hashi-if-intent")?.textContent ?? "";
}

function modelOf(action: Action): InstructionFixerModel {
	return { doc: makeSet([action]), dirty: false };
}

beforeEach(() => {
	pickerInstances.length = 0;
});

// --- intent line -------------------------------------------------------------

describe("intent line (PRD F2-AC1, F2-AC4)", () => {
	it("renders a plain-language intent naming the action's own target", () => {
		const { body } = render(SAMPLES.link_to_moc);

		expect(intentText(body)).toContain("Systems (MOC)");
		expect(intentText(body)).toContain("Tools");
	});

	it("renders the intent as PLAIN TEXT — no link element, even when it embeds [[wikilinks]]", () => {
		const nested: Action = {
			...SAMPLES.link_to_moc,
			anchor: { type: "heading", value: "[[Systems (MOC)]] · [[Tools]]" },
		};

		const { body } = render(nested);
		const intent = body.querySelector(".hashi-if-intent");

		expect(intent?.textContent).toContain("[[Systems (MOC)]] · [[Tools]]");
		expect(intent?.querySelector("a")).toBeNull();
		expect(intent?.querySelector(".hashi-se-wlink")).toBeNull();
	});

	it("has an intent for every wire kind", () => {
		for (const action of Object.values(SAMPLES) as Action[]) {
			expect(actionIntent(action).length).toBeGreaterThan(0);
		}
	});
});

// --- body order --------------------------------------------------------------

describe("card body order (binding layout: intent → reason → fields → note)", () => {
	it("renders the failure reason directly under the intent it explains", () => {
		const { body } = render(
			SAMPLES.link_to_moc,
			"editable",
			{ kind: "failed", reason: "anchor not found: ## Tools" },
			"anchor not found: ## Tools",
		);

		expect(bodyOrder(body)).toEqual([
			"hashi-if-intent",
			"hashi-if-card-reason",
			"hashi-if-fields",
			"hashi-if-note",
		]);
		expect(body.querySelector(".hashi-if-card-reason")?.textContent).toBe(
			"anchor not found: ## Tools",
		);
	});

	it("renders no reason line when the outcome has nothing to explain", () => {
		const { body } = render(SAMPLES.link_to_moc, "frozen-applied", { kind: "applied" }, null);

		expect(body.querySelector(".hashi-if-card-reason")).toBeNull();
		expect(bodyOrder(body)).toEqual(["hashi-if-intent", "hashi-if-fields", "hashi-if-note"]);
	});

	it("keeps the reason in place on a read-only card too", () => {
		const { body } = render(
			SAMPLES.move_note,
			"read-only-no-signal",
			null,
			"depends on I03",
		);

		expect(bodyOrder(body)).toEqual([
			"hashi-if-intent",
			"hashi-if-card-reason",
			"hashi-if-note",
		]);
	});
});

// --- target fields, per kind -------------------------------------------------

describe("target fields — the 7 repair kinds, driven off TARGET_FIELD_WHITELIST", () => {
	it.each(repairKinds())("%s renders one control per whitelisted field", (kind) => {
		const action = SAMPLES[kind];
		const whitelist: readonly string[] = TARGET_FIELD_WHITELIST[kind];

		const { body } = render(action);

		expect(inputs(body)).toHaveLength(whitelist.length);
		expect(labels(body)).toHaveLength(whitelist.length);
		expect(inputs(body).map((input) => input.value)).toEqual(
			targetFieldsFor(action).map((field) => field.value),
		);
	});

	it.each(repairKinds())("%s commits each field's edit through setTargetField", (kind) => {
		const action = SAMPLES[kind];
		const fields = targetFieldsFor(action);

		const { body, transforms } = render(action);
		const rendered = inputs(body);

		fields.forEach((field, index) => {
			const input = rendered[index];
			if (input === undefined) throw new Error(`no input for ${field.key}`);
			input.value = `repaired-${field.key}`;
			input.dispatchEvent(new Event("change"));
		});

		expect(transforms).toHaveLength(fields.length);
		fields.forEach((field, index) => {
			const transform = transforms[index];
			if (transform === undefined) throw new Error(`no transform for ${field.key}`);
			const next = transform(modelOf(action));
			expect(next.dirty).toBe(true);
			const edited = next.doc.actions[0];
			if (edited === undefined) throw new Error("action vanished");
			expect(
				field.key === "anchor"
					? (edited as { anchor: { value: string | null } }).anchor.value
					: (edited as unknown as Record<string, unknown>)[field.key],
			).toBe(`repaired-${field.key}`);
		});
	});

	it("commits an Enter keypress as well as a blur/change", () => {
		const { body, transforms } = render(SAMPLES.remove_up_link);
		const first = inputs(body)[0];
		if (first === undefined) throw new Error("no input");

		first.value = "Atlas/202 Notes/Moved.md";
		first.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

		expect(transforms).toHaveLength(1);
	});

	it("a same-value re-commit is a no-op — the transform returns the SAME model reference", () => {
		const action = SAMPLES.edit_note_text;
		const { body, transforms } = render(action);
		const first = inputs(body)[0];
		if (first === undefined) throw new Error("no input");

		// Re-commit the value already on the wire.
		first.dispatchEvent(new Event("change"));

		const model = modelOf(action);
		const transform = transforms[0];
		if (transform === undefined) throw new Error("no transform");
		expect(transform(model)).toBe(model);
	});

	it("a note-path field's picker commits the full vault path", () => {
		const { body, transforms } = render(SAMPLES.edit_note_text);
		const pick = body.querySelector("button");
		pick?.dispatchEvent(new MouseEvent("click"));

		const picker = pickerInstances[0];
		if (picker === undefined) throw new Error("no picker constructed");
		picker.onChoose("Atlas/202 Notes/Moved.md");

		const transform = transforms[0];
		if (transform === undefined) throw new Error("no transform");
		const edited = transform(modelOf(SAMPLES.edit_note_text)).doc.actions[0];
		expect((edited as { path: string }).path).toBe("Atlas/202 Notes/Moved.md");
	});

	it("a MOC-stem field's picker commits a bare stem, not a path", () => {
		const { body, transforms } = render(SAMPLES.link_to_moc);
		const pick = body.querySelector("button");
		pick?.dispatchEvent(new MouseEvent("click"));

		const picker = pickerInstances[0];
		if (picker === undefined) throw new Error("no picker constructed");
		picker.onChoose("Atlas/200 Maps/Other (MOC).md");

		const transform = transforms[0];
		if (transform === undefined) throw new Error("no transform");
		const edited = transform(modelOf(SAMPLES.link_to_moc)).doc.actions[0];
		expect((edited as { target_moc: string }).target_moc).toBe("Other (MOC)");
	});

	it("a free-text field (anchor) offers no note picker", () => {
		const { body } = render(SAMPLES.replace_section);
		const anchorField = Array.from(body.querySelectorAll(".hashi-if-field")).find((field) =>
			(field.querySelector("label")?.textContent ?? "").toLowerCase().includes("section"),
		);

		expect(anchorField?.querySelector("button")).toBeNull();
	});
});

// --- view-only kinds ---------------------------------------------------------

describe("view-only kinds (PRD F4-AC4)", () => {
	it.each(VIEW_ONLY_KINDS)("%s renders no editable control at all", (kind) => {
		const { body } = render(SAMPLES[kind]);

		expect(inputs(body)).toHaveLength(0);
		expect(body.querySelectorAll("button")).toHaveLength(0);
		expect(intentText(body).length).toBeGreaterThan(0);
	});
});

// --- the fail-closed gate ----------------------------------------------------

describe("edit gate (PRD F3)", () => {
	it.each(["frozen-applied", "read-only-no-signal"] as const)(
		"%s exposes no editable control — values render as read-only text",
		(gate) => {
			const { body } = render(SAMPLES.link_to_moc, gate);

			expect(inputs(body)).toHaveLength(0);
			expect(body.querySelectorAll("button")).toHaveLength(0);
			expect(readOnlyValues(body)).toEqual(
				targetFieldsFor(SAMPLES.link_to_moc).map((field) => field.value || "(empty)"),
			);
		},
	);

	it.each(["frozen-applied", "read-only-no-signal"] as const)(
		"%s still shows the intent and the note link (viewing is unrestricted)",
		(gate) => {
			const { body } = render(SAMPLES.link_to_moc, gate);

			expect(intentText(body).length).toBeGreaterThan(0);
			expect(body.querySelector(".hashi-if-note .hashi-se-wlink")).not.toBeNull();
		},
	);

	it("editable is the only gate that renders a control", () => {
		expect(inputs(render(SAMPLES.link_to_moc, "editable").body).length).toBeGreaterThan(0);
	});
});

// --- note navigation ---------------------------------------------------------

describe("note link (PRD F6)", () => {
	it("names the note each kind actually touches", () => {
		expect(affectedNotePath(SAMPLES.edit_note_text)).toBe("Atlas/202 Notes/Existing.md");
		expect(affectedNotePath(SAMPLES.link_to_moc)).toBe("Atlas/200 Maps/Systems (MOC).md");
		expect(affectedNotePath(SAMPLES.move_note)).toBe("Atlas/202 Notes/Kanban.md");
		expect(affectedNotePath(SAMPLES.update_log_entry)).toBe("300 Journal/2026-07-26.md");
	});

	it("opens the note BESIDE the editor on click", () => {
		const { body, app } = render(SAMPLES.edit_note_text);

		body.querySelector(".hashi-if-note .hashi-se-wlink")?.dispatchEvent(
			new MouseEvent("click", { bubbles: true }),
		);

		expect(app.workspace.openLinkText).toHaveBeenCalledWith(
			"Atlas/202 Notes/Existing.md",
			"",
			"split",
		);
	});

	it("offers Obsidian's page preview on hover", () => {
		const { body, app } = render(SAMPLES.edit_note_text);

		body.querySelector(".hashi-if-note .hashi-se-wlink")?.dispatchEvent(
			new MouseEvent("mouseover", { bubbles: true }),
		);

		expect(app.workspace.trigger).toHaveBeenCalledWith(
			"hover-link",
			expect.objectContaining({ source: "miyo-tomo-hashi" }),
		);
	});

	it("degrades to inert '(note not found)' text when the target no longer resolves", () => {
		const body = document.createElement("div");
		const app = new App();
		vi.mocked(app.metadataCache.getFirstLinkpathDest).mockReturnValue(null);
		renderActionCard(body, SAMPLES.edit_note_text, {
			app,
			gate: "editable",
			outcome: null,
			reason: null,
			apply: () => {},
		});

		const note = body.querySelector(".hashi-if-note");
		expect(note?.textContent).toContain("(note not found)");
		expect(note?.querySelector(".hashi-se-wlink")).toBeNull();
		note?.querySelector(".hashi-ga-note-missing")?.dispatchEvent(
			new MouseEvent("click", { bubbles: true }),
		);
		expect(app.workspace.openLinkText).not.toHaveBeenCalled();
	});

	it("renders no link row for an action with no note target", () => {
		const { body } = render({ id: "I20", action: "skip", source_path: null });

		expect(body.querySelector(".hashi-if-note")).toBeNull();
	});
});

// --- wired into the real view ------------------------------------------------

describe("wired into InstructionFixerView", () => {
	const DOC_PATH = "100 Inbox/2026-07-26_1015_instructions.json";

	const FAILED: Action = { ...SAMPLES.link_to_moc, id: "I07", applied: false };
	const APPLIED: Action = { ...SAMPLES.edit_note_text, id: "I09", applied: true };
	const NEVER_RUN: Action = { ...SAMPLES.move_note, id: "I12", applied: false };

	function outcomes(): ReadonlyMap<string, ActionOutcome> {
		return new Map<string, ActionOutcome>([
			["I07", { kind: "failed", reason: "anchor not found: ## Tools" }],
			["I09", { kind: "applied" }],
		]);
	}

	async function openView(): Promise<InstructionFixerView> {
		const set: InstructionSet = makeSet([APPLIED, NEVER_RUN, FAILED]);
		const adapter: InstructionSetDoc = {
			load: async () => ({ doc: set, dirty: false }),
			save: async () => {},
		};
		const view = new InstructionFixerView(new WorkspaceLeaf(), {
			adapter,
			docPath: DOC_PATH,
			resolveOutcomes: async () => outcomes(),
			card: { render: renderActionCard },
		});
		view.app = new App();
		await view.onOpen();
		return view;
	}

	it("orders the failed action first and gives only it editable controls", async () => {
		const view = await openView();

		const groupLabels = Array.from(
			view.contentEl.querySelectorAll(".hashi-if-group-label"),
		).map((el) => el.textContent);
		expect(groupLabels).toEqual(["Needs repair", "Applied", "Not attempted"]);

		const failedCard = view.contentEl.querySelector('.hashi-if-card[data-action-id="I07"]');
		const appliedCard = view.contentEl.querySelector('.hashi-if-card[data-action-id="I09"]');
		const pendingCard = view.contentEl.querySelector('.hashi-if-card[data-action-id="I12"]');

		expect(failedCard?.querySelectorAll("input").length).toBeGreaterThan(0);
		expect(appliedCard?.querySelectorAll("input")).toHaveLength(0);
		expect(pendingCard?.querySelectorAll("input")).toHaveLength(0);
	});

	it("places the view-derived failure reason under the intent, not above it", async () => {
		const view = await openView();
		const failedBody = view.contentEl.querySelector(
			'.hashi-if-card[data-action-id="I07"] .hashi-if-card-body',
		);

		expect(
			Array.from(failedBody?.children ?? []).map((el) => el.classList.item(0)),
		).toEqual([
			"hashi-if-intent",
			"hashi-if-card-reason",
			"hashi-if-fields",
			"hashi-if-note",
		]);
		// …and the shell no longer renders a second copy of it as a sibling.
		expect(
			view.contentEl.querySelectorAll(
				'.hashi-if-card[data-action-id="I07"] > .hashi-if-card-reason',
			),
		).toHaveLength(0);
	});

	it("activates Save when a target-field edit is committed on the failed card", async () => {
		const view = await openView();
		const failedCard = view.contentEl.querySelector('.hashi-if-card[data-action-id="I07"]');
		const input = failedCard?.querySelector("input");
		if (input === undefined || input === null) throw new Error("no editable input");

		input.value = "Repaired (MOC)";
		input.dispatchEvent(new Event("change"));

		const save = Array.from(
			view.contentEl.querySelectorAll(".hashi-se-leaf-actions button"),
		).find((btn) => btn.textContent === "Save");
		expect((save as HTMLButtonElement | undefined)?.disabled).toBe(false);
		expect(view.contentEl.querySelector(".hashi-se-dirty")).not.toBeNull();
	});
});
