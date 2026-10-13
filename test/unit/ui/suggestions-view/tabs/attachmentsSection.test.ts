/**
 * The Attachments section and its conflict control on suggestion cards
 * (#141), rendered through SuggestionsTab against Tomo's v4 release run:
 * Dresden (S01) embeds karte.png, Leipzig (S02) embeds karte.png and
 * plan.png, and both attachments have a conflict — so karte.png's conflict is
 * shared by two cards.
 *
 * `ctx.apply` records the transform instead of re-rendering (SuggestionsTab
 * test convention); tests apply it to the model and re-render where the
 * resulting state matters.
 */

import { App, TFile } from "obsidian";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { TabContext } from "../../../../../src/ui/suggestions-view/tabContract.js";
import { SuggestionsTab } from "../../../../../src/ui/suggestions-view/tabs/SuggestionsTab.js";
import type { EditModel, SuggestionsWire, SuggestionWire } from "../../../../../src/types/suggestions.js";
import emitted from "../../../../fixtures/suggestions/v4-two-conflict-run.json";

interface FolderPickerInstance {
	onChoose: (value: string) => void;
	inboxFolder: string;
	open: ReturnType<typeof vi.fn>;
}

const { folderPickerInstances } = vi.hoisted(() => ({ folderPickerInstances: [] as FolderPickerInstance[] }));

vi.mock("../../../../../src/ui/suggestions-view/pickers/AttachmentFolderPicker", () => ({
	AttachmentFolderPicker: vi.fn(function AttachmentFolderPicker(
		_app: unknown,
		onChoose: (value: string) => void,
		inboxFolder: string,
	) {
		const instance: FolderPickerInstance = { onChoose, inboxFolder, open: vi.fn() };
		folderPickerInstances.push(instance);
		return instance;
	}),
}));

const KARTE = "100 Inbox/Scans/karte.png";
const PLAN = "100 Inbox/Scans/plan.png";

const model = (edit?: (doc: SuggestionsWire) => SuggestionsWire): EditModel => {
	const doc = structuredClone(emitted) as SuggestionsWire;
	return { doc: edit ? edit(doc) : doc, dirty: false };
};

const withSuggestion = (id: string, over: Partial<SuggestionWire>) => (doc: SuggestionsWire): SuggestionsWire => ({
	...doc,
	suggestions: doc.suggestions.map((s) => (s.id === id ? { ...s, ...over } : s)),
});

function makeCtx(app = new App()): { ctx: TabContext; applyCalls: Array<(m: EditModel) => EditModel> } {
	const applyCalls: Array<(m: EditModel) => EditModel> = [];
	const ctx: TabContext = {
		app,
		pickerScopes: { templateFolder: "", locationFolders: [], tagFilters: [], inboxFolder: "100 Inbox" },
		apply: vi.fn((t: (m: EditModel) => EditModel) => {
			applyCalls.push(t);
		}),
	};
	return { ctx, applyCalls };
}

function render(m: EditModel, ctx: TabContext): HTMLElement {
	const container = document.createElement("div");
	new SuggestionsTab().render(container, m, ctx);
	return container;
}

const rowOf = (root: HTMLElement, cardId: string, source: string): HTMLElement => {
	const row = root.querySelector(`[data-suggestion-id="${cardId}"] [data-attachment="${source}"]`);
	if (row === null) throw new Error(`no row for ${source} on ${cardId}`);
	return row as HTMLElement;
};

const buttonText = (root: HTMLElement, text: string): HTMLButtonElement => {
	const button = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);
	if (button === undefined) throw new Error(`no button "${text}"`);
	return button;
};

beforeEach(() => {
	folderPickerInstances.length = 0;
});

describe("Attachments section", () => {
	it("lists every attachment on every card that embeds it, with a count", () => {
		const root = render(model(), makeCtx().ctx);

		const labels = Array.from(root.querySelectorAll(".hashi-se-attachments .hashi-se-sec-label")).map((l) => l.textContent);
		expect(labels).toEqual(["Attachments · 1", "Attachments · 2"]);
		expect(rowOf(root, "S01", KARTE).textContent).toContain("karte.png");
		expect(rowOf(root, "S02", PLAN).textContent).toContain("plan.png");
	});

	it("says 'none' for a card without attachments", () => {
		const root = render(model(withSuggestion("S01", { attachments: [] })), makeCtx().ctx);
		const label = root.querySelector('[data-suggestion-id="S01"] .hashi-se-attachments .hashi-se-sec-label');
		expect(label?.textContent).toBe("Attachments — none");
	});

	it("names both owners in the shared badge's hover text", () => {
		const badge = rowOf(render(model(), makeCtx().ctx), "S01", KARTE).querySelector(".hashi-se-badge-shared");
		expect(badge?.textContent).toBe("shared by 2 notes");
		expect(badge?.getAttribute("title")).toBe("S01 · Dresden\nS02 · Leipzig");
	});

	it("shows no shared badge on a conflict with one owner", () => {
		expect(rowOf(render(model(), makeCtx().ctx), "S02", PLAN).querySelector(".hashi-se-badge-shared")).toBeNull();
	});
});

describe("conflict control", () => {
	it("marks the current remedy and dispatches setConflictRemedy on click", () => {
		const { ctx, applyCalls } = makeCtx();
		const row = rowOf(render(model(), ctx), "S01", KARTE);

		expect(buttonText(row, "Rename").getAttribute("aria-pressed")).toBe("true");
		buttonText(row, "Ignore").click();

		const after = applyCalls[0]!(model());
		expect(after.doc.attachment_conflicts.find((c) => c.source === KARTE)?.remedy).toBe("ignore");
	});

	it("hides folder and name outside Rename", () => {
		const m = model((doc) => ({
			...doc,
			attachment_conflicts: doc.attachment_conflicts.map((c) => (c.source === KARTE ? { ...c, remedy: "keep_in_inbox" as const } : c)),
		}));
		const row = rowOf(render(m, makeCtx().ctx), "S01", KARTE);
		expect(row.querySelector("input")).toBeNull();
		expect(row.querySelector(".hashi-se-mini-pick")).toBeNull();
	});

	it("opens the folder picker with the inbox to exclude and writes the pick through setConflictDir", () => {
		const { ctx, applyCalls } = makeCtx();
		const row = rowOf(render(model(), ctx), "S01", KARTE);

		const folder = row.querySelector<HTMLButtonElement>(".hashi-se-mini-pick");
		expect(folder?.textContent).toBe("Atlas/290 Assets/295 Attachments");
		folder?.click();

		const picker = folderPickerInstances[0]!;
		expect(picker.open).toHaveBeenCalled();
		expect(picker.inboxFolder).toBe("100 Inbox");
		picker.onChoose("Atlas/290 Assets/296 Maps");
		expect(applyCalls[0]!(model()).doc.attachment_conflicts[0]?.proposed_dir).toBe("Atlas/290 Assets/296 Maps");
	});

	it("commits the typed name on change, sanitised", () => {
		const { ctx, applyCalls } = makeCtx();
		const input = rowOf(render(model(), ctx), "S01", KARTE).querySelector("input")!;

		input.value = "karte [alt].png";
		input.dispatchEvent(new Event("change"));

		expect(applyCalls[0]!(model()).doc.attachment_conflicts[0]?.proposed_name).toBe("karte -alt-.png");
	});
});

describe("name feedback while typing", () => {
	const typeInto = (row: HTMLElement, value: string): HTMLElement => {
		const input = row.querySelector("input")!;
		input.value = value;
		input.dispatchEvent(new Event("input"));
		return row.querySelector(".hashi-se-feedback") as HTMLElement;
	};

	it("refuses blank inline, without dispatching anything", () => {
		const { ctx } = makeCtx();
		const row = rowOf(render(model(), ctx), "S01", KARTE);
		const feedback = typeInto(row, "  ");

		expect(feedback.classList.contains("is-error")).toBe(true);
		expect(row.querySelector("input")?.classList.contains("is-invalid")).toBe(true);
		expect(ctx.apply).not.toHaveBeenCalled();
	});

	it("shows what the sanitiser will save", () => {
		const feedback = typeInto(rowOf(render(model(), makeCtx().ctx), "S01", KARTE), "goerlitz [luftbild].png");
		expect(feedback.classList.contains("is-info")).toBe(true);
		expect(feedback.textContent).toContain("Will be saved as goerlitz -luftbild-.png");
	});

	it("warns when the target is already taken", () => {
		const app = new App();
		vi.mocked(app.vault.getAbstractFileByPath).mockImplementation((path: string) =>
			path === "Atlas/290 Assets/295 Attachments/karte.png" ? new TFile() : null,
		);
		const feedback = typeInto(rowOf(render(model(), makeCtx(app).ctx), "S01", KARTE), "karte.png");
		expect(feedback.classList.contains("is-warning")).toBe(true);
	});

	it("says the embed carries a path when the basename exists elsewhere — not counting the moving source", () => {
		const app = new App();
		const file = (path: string): TFile => Object.assign(new TFile(), { path, name: path.split("/").pop() });
		vi.mocked(app.vault.getAbstractFileByPath).mockReturnValue(null);
		vi.mocked(app.vault.getFiles).mockReturnValue([file(KARTE), file("Atlas/290 Assets/297 Scans/karte (2).png")]);

		const feedback = typeInto(rowOf(render(model(), makeCtx(app).ctx), "S01", KARTE), "karte (2).png");
		expect(feedback.textContent).toContain("also exists elsewhere (Atlas/290 Assets/297 Scans/karte (2).png)");

		const own = typeInto(rowOf(render(model(), makeCtx(app).ctx), "S01", KARTE), "karte.png");
		expect(own.textContent).not.toContain("also exists elsewhere");
	});
});

describe("inert conflict", () => {
	const allSkipped = withSuggestion("S01", { decision: "skip" });
	const bothSkipped = (doc: SuggestionsWire) => withSuggestion("S02", { decision: "skip" })(allSkipped(doc));

	it("greys out every control when no owning note is filed", () => {
		const row = rowOf(render(model(bothSkipped), makeCtx().ctx), "S01", KARTE);

		expect(row.querySelector(".hashi-se-conflict-box")?.classList.contains("is-inert")).toBe(true);
		const controls = Array.from(row.querySelectorAll<HTMLButtonElement | HTMLInputElement>(".hashi-se-conflict-box button, .hashi-se-conflict-box input"));
		expect(controls.length).toBeGreaterThan(0);
		expect(controls.every((c) => c.disabled)).toBe(true);
		expect(row.textContent).toContain("stays in inbox with the note");
	});

	it("stays live while any one owner is filed", () => {
		const row = rowOf(render(model(allSkipped), makeCtx().ctx), "S01", KARTE);
		expect(row.querySelector(".hashi-se-conflict-box")?.classList.contains("is-inert")).toBe(false);
	});

	it("comes alive for a suppressed owner once Force Atomic is ticked", () => {
		const suppressed = (force: boolean) => (doc: SuggestionsWire) =>
			withSuggestion("S02", { suppressed: true, force_atomic: force })(withSuggestion("S01", { suppressed: true, force_atomic: false })(doc));

		expect(rowOf(render(model(suppressed(false)), makeCtx().ctx), "S02", PLAN).querySelector(".is-inert")).not.toBeNull();
		expect(rowOf(render(model(suppressed(true)), makeCtx().ctx), "S02", PLAN).querySelector(".is-inert")).toBeNull();
	});
});
