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
import { App, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionOutcome } from "../../../../../src/executor/state";
import { TARGET_FIELD_WHITELIST } from "../../../../../src/instruction-fixer/transforms";
import type { Action, ActionKind, InstructionSet } from "../../../../../src/schema/types";
import {
	actionIntent,
	affectedNotePath,
	renderActionCard,
} from "../../../../../src/ui/instruction-fixer/cards/renderActionCard";
import {
	readTargetFieldValue,
	targetFieldsFor,
} from "../../../../../src/ui/instruction-fixer/cards/targetFields";
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

// --- target-note picker spies ------------------------------------------------
// Same idiom, one level lower: the modals are stubbed but `openSpotPicker` runs
// for real, so these tests also cover the resolve → read → derive-rows wiring.

/** Structurally the union of what both rosters emit — enough to assert on
 * without importing the production types into a spy. */
interface SpotRow {
	readonly value: string;
	readonly anchorType?: string;
	readonly placement?: string | null;
}

interface SpotPickerInstance {
	spots: readonly SpotRow[];
	onPick: (spot: never) => void;
	open: ReturnType<typeof vi.fn>;
}

const { anchorPickers, markerPickers } = vi.hoisted(() => ({
	anchorPickers: [] as SpotPickerInstance[],
	markerPickers: [] as SpotPickerInstance[],
}));

vi.mock("../../../../../src/ui/instruction-fixer/pickers/SpotPickers", () => ({
	AnchorSpotPicker: vi.fn(function AnchorSpotPicker(
		_app: unknown,
		spots: readonly SpotRow[],
		onPick: (spot: never) => void,
	) {
		const instance: SpotPickerInstance = { spots, onPick, open: vi.fn() };
		anchorPickers.push(instance);
		return instance;
	}),
	MarkerSpotPicker: vi.fn(function MarkerSpotPicker(
		_app: unknown,
		spots: readonly SpotRow[],
		onPick: (spot: never) => void,
	) {
		const instance: SpotPickerInstance = { spots, onPick, open: vi.fn() };
		markerPickers.push(instance);
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
	anchorPickers.length = 0;
	markerPickers.length = 0;
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

	/**
	 * `create_moc` has no repair field and its note link points at the
	 * destination, so the intent is the ONLY place its `source` can appear —
	 * and "Source missing — nothing to move" (createMoc.ts:64) names no path
	 * itself. Without this the failure's subject is unnameable on the card.
	 */
	it("names both paths of a create_moc — its most common failure names neither", () => {
		expect(actionIntent(SAMPLES.create_moc)).toBe(
			'Create MOC "Systems" at Atlas/200 Maps/Systems (MOC).md (from 100 Inbox/Kanban.md)',
		);
	});

	it("quotes literal match text and leaves paths and stems unquoted", () => {
		// `marker` is match text like an anchor, so it quotes; the MOC path does not.
		expect(actionIntent(SAMPLES.add_relationship)).toBe(
			'Add "- [[Kanban]]" under "down::" in Atlas/200 Maps/Systems (MOC).md',
		);
	});

	it("has an intent for every wire kind", () => {
		for (const action of Object.values(SAMPLES) as Action[]) {
			expect(actionIntent(action).length).toBeGreaterThan(0);
		}
	});

	/**
	 * The payload is the half the first version dropped: an intent naming only
	 * the target says where the write lands but not what lands there, so a
	 * `link_to_moc` read as "Link into Systems (MOC), after heading Tools" with
	 * no way to tell WHICH note was being linked in.
	 *
	 * Table-driven over the field the EXECUTOR writes, so the assertion fails if
	 * an intent ever swaps the payload for a friendlier sibling label —
	 * `source_note_title` here is "Kanban" while `line_to_add` is
	 * "- [[Kanban]]", which is exactly the substitution that would mislead a
	 * user repairing the action.
	 */
	it.each([
		["link_to_moc", SAMPLES.link_to_moc, SAMPLES.link_to_moc.line_to_add],
		["insert_under_marker", SAMPLES.insert_under_marker, SAMPLES.insert_under_marker.content],
		["replace_section", SAMPLES.replace_section, SAMPLES.replace_section.content],
		["add_relationship", SAMPLES.add_relationship, SAMPLES.add_relationship.line],
	] as const)("names the text %s writes, not just where it writes it", (_kind, action, payload) => {
		expect(actionIntent(action)).toContain(`"${payload}"`);
	});

	it("spells out the three payload-carrying intents in full", () => {
		expect(actionIntent(SAMPLES.link_to_moc)).toBe(
			'Link "- [[Kanban]]" into Systems (MOC), after heading "Tools"',
		);
		expect(actionIntent(SAMPLES.insert_under_marker)).toBe(
			'Insert "- [[Kanban]]" into Atlas/202 Notes/Board.md, inside callout "[!blocks] Key concepts"',
		);
		expect(actionIntent(SAMPLES.replace_section)).toBe(
			'Replace section "Summary" in Atlas/202 Notes/Board.md with "Rewritten body"',
		);
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
			// Drift guard: the card READS a field through `readTargetFieldValue`
			// and WRITES it through `setTargetField`, two independent handlers of
			// `anchor`'s nested shape. Reading back what the write landed proves
			// they still agree — for every whitelisted field, not just `anchor`.
			expect(readTargetFieldValue(edited, field.key)).toBe(`repaired-${field.key}`);
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

	/**
	 * The anchor field grew a picker (2026-07-27 follow-up) but NOT this one:
	 * its candidates are the target note's own headings, so offering "any note
	 * in the vault" there would commit a note path into a field the resolver
	 * matches as heading text. Pressing it must therefore never reach
	 * `TargetNotePicker`.
	 */
	it("an anchor field's picker is the target-note one, never the vault-note one", () => {
		const { body } = render(SAMPLES.replace_section);
		const anchorField = Array.from(body.querySelectorAll(".hashi-if-field")).find((field) =>
			(field.querySelector("label")?.textContent ?? "").toLowerCase().includes("section"),
		);
		const button = anchorField?.querySelector("button");

		expect(button?.getAttribute("aria-label")).toBe("Choose an anchor from the target note");

		button?.dispatchEvent(new MouseEvent("click"));
		expect(pickerInstances).toHaveLength(0);
	});

	it("a genuinely free-text field (edit_note_text.match) offers no picker at all", () => {
		const { body } = render(SAMPLES.edit_note_text);
		const matchField = Array.from(body.querySelectorAll(".hashi-if-field")).find(
			(field) => (field.querySelector("label")?.textContent ?? "") === "Match",
		);

		expect(matchField?.querySelector("button")).toBeNull();
	});
});

// --- target-note pickers (2026-07-27 follow-up, request b + c) ---------------

/** The field row whose label matches, and the picker button inside it. */
function pickButton(body: HTMLElement, label: string): HTMLButtonElement | undefined {
	const field = Array.from(body.querySelectorAll(".hashi-if-field")).find(
		(row) => (row.querySelector("label")?.textContent ?? "") === label,
	);
	return field?.querySelector("button") ?? undefined;
}

/** Points the app mock at a target note with `content`. */
function withTargetNote(app: App, content: string): void {
	vi.mocked(app.metadataCache.getFirstLinkpathDest).mockReturnValue(new TFile());
	vi.mocked(app.vault.cachedRead).mockResolvedValue(content);
}

const TARGET_NOTE = [
	"# Systems (MOC)",
	"",
	"> [!blocks] Key Concepts",
	"> - [[Kanban]]",
	"",
	"## Maintenance",
	"",
	"up:: [[Atlas (MOC)]]",
].join("\n");

describe("anchor picker", () => {
	it("offers the target note's own structure, read fresh from content", async () => {
		const { body, app } = render(SAMPLES.link_to_moc);
		withTargetNote(app, TARGET_NOTE);

		pickButton(body, "Anchor")?.dispatchEvent(new MouseEvent("click"));
		await vi.waitFor(() => expect(anchorPickers).toHaveLength(1));

		const values = anchorPickers[0]?.spots.map((s) => s.value) ?? [];
		expect(values).toContain("Maintenance");
		expect(values).toContain("[!blocks] Key Concepts");
		expect(anchorPickers[0]?.open).toHaveBeenCalled();
	});

	/**
	 * The point of the whole feature: one pick repairs the triple. A picker that
	 * committed only the value would leave `type: "heading"` on a callout choice
	 * and fail the re-run for a reason the user did not cause.
	 */
	it("commits anchor.type, anchor.value and placement from ONE pick", async () => {
		const { body, app, transforms } = render(SAMPLES.link_to_moc);
		withTargetNote(app, TARGET_NOTE);

		pickButton(body, "Anchor")?.dispatchEvent(new MouseEvent("click"));
		await vi.waitFor(() => expect(anchorPickers).toHaveLength(1));

		const picker = anchorPickers[0];
		if (picker === undefined) throw new Error("no picker constructed");
		const callout = picker.spots.find((s) => s.anchorType === "callout");
		picker.onPick(callout as never);

		const transform = transforms[0];
		if (transform === undefined) throw new Error("no transform");
		const edited = transform(modelOf(SAMPLES.link_to_moc)).doc.actions[0];

		expect(edited?.action === "link_to_moc" && edited.anchor).toEqual({
			type: "callout",
			value: "[!blocks] Key Concepts",
		});
		expect(edited?.action === "link_to_moc" && edited.placement).toBe(callout?.placement);
	});

	/**
	 * The target note being gone is the failure the user came here to repair, so
	 * it must be reported — an unopened picker with no message reads as a dead
	 * button, and an EMPTY picker would falsely imply the note has no structure.
	 */
	it("reports an unreadable target instead of opening an empty picker", async () => {
		const { body, app } = render(SAMPLES.link_to_moc);
		vi.mocked(app.metadataCache.getFirstLinkpathDest).mockReturnValue(null);

		pickButton(body, "Anchor")?.dispatchEvent(new MouseEvent("click"));
		await vi.waitFor(() => expect(vi.mocked(Notice)).toHaveBeenCalled());

		expect(anchorPickers).toHaveLength(0);
		expect(vi.mocked(Notice).mock.calls[0]?.[0]).toContain("Atlas/200 Maps/Systems (MOC).md");
	});

	it("offers replace_section headings only — its handler is heading-scoped", async () => {
		const { body, app } = render(SAMPLES.replace_section);
		withTargetNote(app, TARGET_NOTE);

		pickButton(body, "Section heading")?.dispatchEvent(new MouseEvent("click"));
		await vi.waitFor(() => expect(anchorPickers).toHaveLength(1));

		const spots = anchorPickers[0]?.spots ?? [];
		expect(spots.length).toBeGreaterThan(0);
		expect(spots.every((s) => s.anchorType === "heading")).toBe(true);
	});

	it("renders no picker button at all on a frozen card", () => {
		const { body } = render(SAMPLES.link_to_moc, "frozen-applied");

		expect(pickButton(body, "Anchor")).toBeUndefined();
	});
});

describe("marker picker", () => {
	it("offers the target MOC's field openers and commits the picked one", async () => {
		const { body, app, transforms } = render(SAMPLES.add_relationship);
		withTargetNote(app, TARGET_NOTE);

		pickButton(body, "Marker")?.dispatchEvent(new MouseEvent("click"));
		await vi.waitFor(() => expect(markerPickers).toHaveLength(1));

		const picker = markerPickers[0];
		if (picker === undefined) throw new Error("no picker constructed");
		expect(picker.spots.map((s) => s.value)).toContain("up::");

		picker.onPick({ value: "up::" } as never);
		const transform = transforms[0];
		if (transform === undefined) throw new Error("no transform");
		const edited = transform(modelOf(SAMPLES.add_relationship)).doc.actions[0];

		expect(edited?.action === "add_relationship" && edited.marker).toBe("up::");
	});

	/**
	 * `marker` says WHERE to write, `line` says WHAT relationship to establish
	 * there — repositioning to a new anchor (a template placeholder, say) must
	 * leave the relationship being written untouched, or nothing gets
	 * established at all. A version of this picker that also wrote `line` was
	 * reverted 2026-07-27 (user correction) for exactly this reason; this test
	 * guards against that regression.
	 */
	it("commits marker only — line stays whatever the user already set", async () => {
		const { body, app, transforms } = render(SAMPLES.add_relationship);
		withTargetNote(app, TARGET_NOTE);

		pickButton(body, "Marker")?.dispatchEvent(new MouseEvent("click"));
		await vi.waitFor(() => expect(markerPickers).toHaveLength(1));

		const picker = markerPickers[0];
		if (picker === undefined) throw new Error("no picker constructed");
		picker.onPick({ value: "up::" } as never);

		const transform = transforms[0];
		if (transform === undefined) throw new Error("no transform");
		const edited = transform(modelOf(SAMPLES.add_relationship)).doc.actions[0];

		expect(edited?.action === "add_relationship" && edited.marker).toBe("up::");
		expect(edited?.action === "add_relationship" && edited.line).toBe(SAMPLES.add_relationship.line);
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
	/**
	 * Every kind's expected link target, checked against the handler that
	 * actually performs it (`src/actions/*.ts`) — a `Record<ActionKind, …>` so
	 * a new wire kind cannot be added without stating what its card links to,
	 * and a swapped field in any of the 14 branches fails here.
	 */
	const EXPECTED_NOTE: Record<ActionKind, string | null> = {
		// createMoc.ts moves source → destination; the destination is the note
		// the action is trying to produce (the source is named in the intent).
		create_moc: "Atlas/200 Maps/Systems (MOC).md",
		move_note: "Atlas/202 Notes/Kanban.md",
		// linkToMoc.ts:60 resolves `target_moc_path ?? target_moc` — same order.
		link_to_moc: "Atlas/200 Maps/Systems (MOC).md",
		insert_under_marker: "Atlas/202 Notes/Board.md",
		replace_section: "Atlas/202 Notes/Board.md",
		// addRelationship.ts:43 reads/writes target_moc_path.
		add_relationship: "Atlas/200 Maps/Systems (MOC).md",
		edit_note_text: "Atlas/202 Notes/Existing.md",
		remove_up_link: "Atlas/202 Notes/Existing.md",
		resolve_dead_link: "Atlas/202 Notes/Existing.md",
		// The update_* kinds all write into the daily note, never the stem they
		// mention (updateLogLink.ts:32 — target_stem is link TEXT, not a target).
		update_tracker: "300 Journal/2026-07-26.md",
		update_log_entry: "300 Journal/2026-07-26.md",
		update_log_link: "300 Journal/2026-07-26.md",
		// deleteSource.ts:33 trashes source_path.
		delete_source: "100 Inbox/Kanban.md",
		skip: "100 Inbox/Unclear.md",
	};

	it.each(Object.keys(SAMPLES) as ActionKind[])(
		"%s links to the note that kind actually touches",
		(kind) => {
			expect(affectedNotePath(SAMPLES[kind])).toBe(EXPECTED_NOTE[kind]);
		},
	);

	it("carries no note target when `skip` names no source", () => {
		expect(affectedNotePath({ id: "I20", action: "skip", source_path: null })).toBeNull();
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
