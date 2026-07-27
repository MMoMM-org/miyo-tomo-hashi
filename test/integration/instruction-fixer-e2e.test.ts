/**
 * Instruction Fixer end-to-end — the whole repair loop (spec-006 Phase 5,
 * T5.1; SDD Runtime View/Primary Flow, Acceptance Criteria; PRD F7/F8).
 *
 * Drives the real stack, no stubs on the path under test: the shipped
 * `InstructionExecutor` (real `HANDLERS`, real planner, real
 * `jsonAppliedWriter`, real `peerCheckboxSync`, real `RunLogWriter`) →
 * `ObsidianInstructionSetDoc` (the real adapter) → the real
 * `InstructionFixerView` leaf with the real `actionCardRenderer` and its real
 * `TargetControl` input → the real `resolveOutcomes`/`editGate`, all over
 * `FakeVaultFS` + the obsidian mock. Sibling shape: the Garden-Audit Editor's
 * `test/integration/garden-audit-e2e.test.ts`.
 *
 * What it proves that the Phase-3 suites do not:
 *   - the repair is committed through the REAL card widget (typed value +
 *     `change` event), not through `setTargetField` called directly;
 *   - the Save writes exactly ONE field of the whole document — every other
 *     action and every top-level key (`tomo.sources` included) is byte-equal,
 *     asserted as a computed JSON-path diff rather than a spot check;
 *   - the `.md` peer's ONLY change across the entire loop is the executor's
 *     own `- [x] Applied` ticks — asserted as a whole-file byte equality
 *     against the fixture with exactly those lines flipped;
 *   - an unedited round-trip performs ZERO vault writes, not "writes the
 *     same bytes".
 *
 * --- Fixtures: HAND-BUILT TO SHAPE, NOT CAPTURED ---------------------------
 *
 * `test/fixtures/instructions/repair-loop-set{.json,.md}` were written for
 * this test, NOT captured from a live Tomo run. Sibling MiYo repos are
 * `_outbox`-stub-only in this container, so a real Pass-2 emission was not
 * obtainable, and vendoring one would leak personal PKM into a public repo
 * (Constitution L1 Privacy; repo memory "Anonymize real-run fixtures before
 * committing"). Their SHAPE is taken from Tomo's own consumer contract —
 * `miyo-tomo:docs/instructions-json.md` (envelope keys, `md_peer`, the
 * `### I## — <kind>: <title>` + first-bullet `- [ ] Applied` peer layout) and
 * `miyo-tomo:tests/test_instruction_render_tomo_block.py` (the `tomo` block's
 * `doc_type`/`state`/`run_id`/`sources[{path,checksum}]`) — both read off
 * `main` while writing this file. Treat them as a faithful shape reference,
 * NOT as a Tomo↔Hashi drift guard: only a real captured run can be that
 * (repo memory "Real Tomo walks > synthetic fixtures for executor QA").
 *
 * The four actions are chosen so the loop has something to say:
 *   I01 create_moc     — `applied: true`, and its source does not exist, so it
 *                        would FAIL loudly if the re-run ever attempted it.
 *                        The monotonic-`applied` canary.
 *   I02 link_to_moc    — the failure the user came to fix: `target_moc_path`
 *                        points at `Reisen(MOC).md` (a missing space), so the
 *                        first run reports "MOC target missing".
 *   I03 edit_note_text — applies on the first run; a repair-field-BEARING kind
 *                        that must still render read-only once frozen.
 *   I04 skip           — applies on the first run; a view-only kind that must
 *                        render no repair control at all.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import "obsidian";
import { App, WorkspaceLeaf } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InstructionExecutor } from "../../src/executor/InstructionExecutor";
import type { RunCounts, RunState } from "../../src/executor/state";
import { ObsidianInstructionSetDoc } from "../../src/instruction-fixer/ObsidianInstructionSetDoc";
import type { InstructionSet } from "../../src/schema/types";
import { validate } from "../../src/schema/validator";
import { DEFAULT_SETTINGS } from "../../src/types/index";
import { actionCardRenderer } from "../../src/ui/instruction-fixer/cards/renderActionCard";
import { InstructionFixerView } from "../../src/ui/instruction-fixer/InstructionFixerView";
import { resolveOutcomes } from "../../src/ui/instruction-fixer/outcomeSource";
import { Store } from "../../src/util/store";
import { FakeVaultFS } from "../../src/vault/FakeVaultFS";

// ---------------------------------------------------------------------------
// Fixture bytes + vault layout
// ---------------------------------------------------------------------------

const INBOX = "100 Inbox";
const SET_PATH = `${INBOX}/2026-07-24_1432_instructions.json`;
const PEER_PATH = `${INBOX}/2026-07-24_1432_instructions.md`;

/** The MOC I02 was MEANT to target — the repaired value. */
const MOC_PATH = "Atlas/200 Maps/Reisen (MOC).md";
/** What the fixture actually carries: the same name minus a space. Missing. */
const BROKEN_MOC_PATH = "Atlas/200 Maps/Reisen(MOC).md";
const NOTE_PATH = "Atlas/202 Notes/Hokkaido im Winter.md";

/** Literal on-disk bytes — never re-derived through JSON.stringify. */
const SET_JSON = readFileSync(
	resolve(__dirname, "../fixtures/instructions/repair-loop-set.json"),
	"utf8",
);
const PEER_MD = readFileSync(
	resolve(__dirname, "../fixtures/instructions/repair-loop-set.md"),
	"utf8",
);

const MOC_MD = [
	"---",
	"type: moc",
	"---",
	"",
	"# Reisen (MOC)",
	"",
	"## Notizen",
	"",
	"- [[Sapporo im Sommer]]",
	"",
	"## Referenzen",
	"",
].join("\n");

const NOTE_MD = [
	"---",
	"type: note",
	"---",
	"",
	"# Hokkaido im Winter",
	"",
	"up:: [[Reise (MOC)]]",
	"",
	"Der Winter auf Hokkaido dauert von November bis April.",
	"",
].join("\n");

async function seedVault(): Promise<FakeVaultFS> {
	const vault = new FakeVaultFS();
	await vault.createFolder(INBOX);
	await vault.createFolder("Atlas/200 Maps");
	await vault.createFolder("Atlas/202 Notes");
	await vault.create(SET_PATH, SET_JSON);
	await vault.create(PEER_PATH, PEER_MD);
	await vault.create(MOC_PATH, MOC_MD);
	await vault.create(NOTE_PATH, NOTE_MD);
	return vault;
}

// ---------------------------------------------------------------------------
// Real collaborators
// ---------------------------------------------------------------------------

/**
 * The real executor. Only the hook runner is faked — user hooks are a separate
 * subsystem (spec-002 `HookRunner`, covered by its own suite) and this vault
 * has no `.tomo-hashi/hooks/` at all, so a real loader would resolve to the
 * same "no hook, proceed" on every call.
 */
function makeExecutor(vault: FakeVaultFS, store: Store<RunState>): InstructionExecutor {
	return new InstructionExecutor({
		vault,
		validator: { validate },
		hookRunner: {
			run: vi.fn().mockResolvedValue({ kind: "ok" }),
			preApprove: vi.fn().mockResolvedValue(undefined),
		},
		// auto-run: no modal to drive, and (unlike silent) the store keeps the
		// terminal `summary` that `resolveOutcomes` reads back as source 1.
		settings: {
			...DEFAULT_SETTINGS,
			tomoInboxFolder: INBOX,
			executionMode: "auto-run",
			runLogRetention: "always",
		},
		clock: { now: () => new Date("2026-07-24T14:40:00") },
		store,
		notify: vi.fn(),
	});
}

/**
 * The real leaf, wired exactly as `main.ts` wires it (real adapter, real
 * `resolveOutcomes` bound to its live deps, the real card renderer).
 *
 * ACCEPTED GAP: the view is constructed and `onOpen()`-ed directly rather than
 * through `workspace.getLeaf().setViewState(...)`. The obsidian mock's
 * `WorkspaceLeaf.setViewState` is a bare `vi.fn()` that never invokes the view
 * lifecycle, so the production `openInstructionFixer` entry point cannot drive
 * a real view under test at all — it is covered separately by
 * `test/unit/ui/instruction-fixer/*` and `test/unit/main.integration.test.ts`.
 * Everything downstream of "the leaf is open on this docPath" is real here.
 */
function makeView(
	vault: FakeVaultFS,
	runStore: Store<RunState>,
	rerun: (docPath: string) => Promise<void>,
): InstructionFixerView {
	const view = new InstructionFixerView(new WorkspaceLeaf(), {
		adapter: new ObsidianInstructionSetDoc(vault, vi.fn()),
		docPath: SET_PATH,
		resolveOutcomes: (set, docPath) =>
			resolveOutcomes(set, docPath, {
				vault,
				getRunState: () => runStore.get(),
				logFolder: INBOX,
			}),
		card: actionCardRenderer,
		rerun,
	});
	view.app = new App();
	return view;
}

// ---------------------------------------------------------------------------
// DOM helpers — every gesture is the one a real user makes
// ---------------------------------------------------------------------------

async function settle(): Promise<void> {
	for (let i = 0; i < 10; i++) await Promise.resolve();
	await new Promise<void>((done) => setTimeout(done, 0));
}

function cardEl(view: InstructionFixerView, id: string): HTMLElement {
	const card = view.contentEl.querySelector(`.hashi-if-card[data-action-id="${id}"]`);
	if (card === null) throw new Error(`no card for ${id}`);
	return card as HTMLElement;
}

function groupLabels(view: InstructionFixerView): string[] {
	return Array.from(view.contentEl.querySelectorAll(".hashi-if-group-label")).map(
		(el) => el.textContent ?? "",
	);
}

function button(view: InstructionFixerView, text: string): HTMLButtonElement {
	const btn = Array.from(view.contentEl.querySelectorAll("button")).find(
		(b) => b.textContent === text,
	);
	if (btn === undefined) throw new Error(`no button with text "${text}"`);
	return btn as HTMLButtonElement;
}

function click(view: InstructionFixerView, text: string): void {
	button(view, text).click();
}

/** The real `TargetControl` input for one repair field of one card. */
function fieldInput(view: InstructionFixerView, id: string, label: string): HTMLInputElement {
	const input = cardEl(view, id).querySelector(`input[aria-label="${label}"]`);
	if (input === null) throw new Error(`no "${label}" input on card ${id}`);
	return input as HTMLInputElement;
}

/** Commit a value the way a user does: type into the input, then blur/commit. */
function commitField(
	view: InstructionFixerView,
	id: string,
	label: string,
	value: string,
): void {
	const input = fieldInput(view, id, label);
	input.value = value;
	input.dispatchEvent(new Event("change"));
}

// ---------------------------------------------------------------------------
// Byte-level diff helpers — the invariants are about bytes, not shape
// ---------------------------------------------------------------------------

/**
 * Every JSON path at which two instruction sets differ, actions keyed by their
 * stable `id` rather than by index so a report reads `actions.I02.applied`.
 * An empty result means the two documents are structurally identical.
 */
function diffPaths(before: unknown, after: unknown, prefix = ""): string[] {
	if (Object.is(before, after)) return [];
	const bothObjects =
		typeof before === "object" &&
		typeof after === "object" &&
		before !== null &&
		after !== null &&
		Array.isArray(before) === Array.isArray(after);
	if (!bothObjects) return [prefix];

	const b = before as Record<string, unknown>;
	const a = after as Record<string, unknown>;
	const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
	const out: string[] = [];
	for (const key of keys) {
		const label = keyLabel(b[key], a[key], key);
		out.push(...diffPaths(b[key], a[key], prefix === "" ? label : `${prefix}.${label}`));
	}
	return out.sort();
}

/** Array members that look like actions are labelled by id, not index. */
function keyLabel(before: unknown, after: unknown, key: string): string {
	const id = actionId(before) ?? actionId(after);
	return id ?? key;
}

function actionId(value: unknown): string | null {
	if (typeof value !== "object" || value === null) return null;
	const id = (value as Record<string, unknown>).id;
	return typeof id === "string" && /^I\d+$/.test(id) ? id : null;
}

async function readSet(vault: FakeVaultFS): Promise<InstructionSet> {
	return JSON.parse(await vault.read(SET_PATH)) as InstructionSet;
}

/** `PEER_MD` with the `- [ ] Applied` bullet under each named id flipped. */
function peerWithTicks(...ids: readonly string[]): string {
	const lines = PEER_MD.split("\n");
	for (const id of ids) {
		const start = lines.findIndex((line) => line.startsWith(`### ${id} `));
		if (start === -1) throw new Error(`no ### ${id} heading in the peer fixture`);
		const at = lines.findIndex(
			(line, i) => i > start && line.trim() === "- [ ] Applied",
		);
		if (at === -1) throw new Error(`no unticked Applied bullet under ${id}`);
		lines[at] = "- [x] Applied";
	}
	return lines.join("\n");
}

// ---------------------------------------------------------------------------

describe("Instruction Fixer end-to-end — execute → repair → save → re-run → applied", () => {
	let vault: FakeVaultFS;
	let runStore: Store<RunState>;
	let executor: InstructionExecutor;
	let reruns: RunCounts[];

	beforeEach(async () => {
		// Spy every mutating VaultFS method, keeping the real implementation —
		// the vault under test stays fully functional, it just becomes
		// countable. Installed BEFORE the seed so every write is accounted for.
		for (const name of WRITE_METHODS) vi.spyOn(FakeVaultFS.prototype, name);
		vault = await seedVault();
		runStore = new Store<RunState>({ kind: "idle" });
		executor = makeExecutor(vault, runStore);
		reruns = [];
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function openFixer(): InstructionFixerView {
		return makeView(vault, runStore, async (docPath) => {
			reruns.push(await executor.execute({ kind: "single-file", sourcePath: docPath }));
		});
	}

	it("runs the full loop, changing exactly the repaired field and nothing else", async () => {
		// --- the run that produced the failure the user came to fix -----------
		const first = await executor.execute({ kind: "single-file", sourcePath: SET_PATH });
		expect(first.failed).toBe(1);
		expect(first.applied).toBe(2); // I03 + I04; I01 filtered by `applied: true`

		const afterRun1 = await readSet(vault);
		const peerAfterRun1 = await vault.read(PEER_PATH);
		// The executor's own peer sync ticked exactly the two actions it applied.
		expect(peerAfterRun1).toBe(peerWithTicks("I03", "I04"));

		// --- open the Fixer ---------------------------------------------------
		const view = openFixer();
		await view.onOpen();
		await settle();

		expect(groupLabels(view)).toEqual(["Needs repair", "Applied"]);

		// The failed action is the ONLY editable one, and it says why it failed.
		const i02 = cardEl(view, "I02");
		expect(i02.querySelector(".hashi-if-badge")?.textContent).toBe("failed");
		expect(i02.querySelector(".hashi-if-card-reason")?.textContent).toBe(
			"MOC target missing",
		);
		expect(i02.classList.contains("hashi-if-card--readonly")).toBe(false);
		expect(i02.querySelector(".hashi-if-card-tag")).toBeNull();
		// Real repair controls, one per whitelisted field of `link_to_moc`.
		expect(
			Array.from(i02.querySelectorAll("input")).map((el) => el.getAttribute("aria-label")),
		).toEqual(["Target MOC", "Target MOC path", "Anchor"]);

		// Applied actions are FROZEN: no input anywhere, values shown as text.
		for (const id of ["I01", "I03", "I04"]) {
			const card = cardEl(view, id);
			expect(card.querySelector(".hashi-if-card-tag")?.textContent).toBe("frozen");
			expect(card.querySelectorAll("input")).toHaveLength(0);
		}
		// I03 is a repair-field-BEARING kind — frozen still SHOWS its fields
		// (viewing is unrestricted), just as read-only spans.
		expect(
			Array.from(cardEl(view, "I03").querySelectorAll(".hashi-if-field-value")).map(
				(el) => el.textContent,
			),
		).toEqual([NOTE_PATH, "[[Reise (MOC)]]", "[[Reisen (MOC)]]"]);
		// I04 (`skip`) is view-only: no repair field of any kind.
		expect(cardEl(view, "I04").querySelectorAll(".hashi-if-field")).toHaveLength(0);

		// --- a re-commit of the value already on the wire is a true no-op -----
		const writesBeforeNoop = countWrites(vault);
		commitField(view, "I02", "Target MOC path", BROKEN_MOC_PATH);
		expect(button(view, "Save").disabled).toBe(true);
		expect(view.contentEl.querySelector(".hashi-se-dirty")).toBeNull();
		expect(countWrites(vault)).toEqual(writesBeforeNoop);

		// --- repoint the target field through the real widget -----------------
		commitField(view, "I02", "Target MOC path", MOC_PATH);
		expect(button(view, "Save").disabled).toBe(false);
		expect(view.contentEl.querySelector(".hashi-se-dirty")?.textContent).toBe("Edited");

		click(view, "Save");
		await settle();

		// --- PRD F8-AC1: the JSON differs in EXACTLY the repaired field -------
		const afterSave = await readSet(vault);
		expect(diffPaths(afterRun1, afterSave)).toEqual(["actions.I02.target_moc_path"]);
		expect(
			afterSave.actions.find((a) => a.id === "I02"),
		).toMatchObject({ target_moc_path: MOC_PATH });

		// --- PRD F8-AC2: Save touches the `.md` peer not at all ---------------
		expect(await vault.read(PEER_PATH)).toBe(peerAfterRun1);

		// --- re-run -----------------------------------------------------------
		click(view, "Re-run");
		await settle();

		// Only the repaired action ran. The canary (I01) was filtered by its
		// `applied` flag — had it been attempted it would have FAILED, because
		// its source does not exist.
		expect(reruns).toHaveLength(1);
		expect(reruns[0]?.applied).toBe(1);
		expect(reruns[0]?.failed).toBe(0);

		// --- refreshed in place (PRD F7-AC2) ----------------------------------
		expect(groupLabels(view)).toEqual(["Applied"]);
		const repaired = cardEl(view, "I02");
		expect(repaired.querySelector(".hashi-if-badge")?.textContent).toBe("applied");
		expect(repaired.querySelector(".hashi-if-card-tag")?.textContent).toBe("frozen");
		expect(repaired.querySelectorAll("input")).toHaveLength(0);

		// --- the repair actually landed in the vault --------------------------
		const moc = await vault.read(MOC_PATH);
		expect(moc).toBe(MOC_MD.replace("## Notizen\n", "## Notizen\n- [[Hokkaido im Winter]]\n"));
		// The canary's would-be destination was never created.
		expect(await vault.exists("Atlas/200 Maps/Kulinarik (MOC).md")).toBe(false);
		expect(await vault.exists(BROKEN_MOC_PATH)).toBe(false);

		// --- the JSON's only further change is the applied flag ---------------
		const afterRerun = await readSet(vault);
		expect(diffPaths(afterSave, afterRerun)).toEqual(["actions.I02.applied"]);
		// Across the WHOLE loop: one repaired field, and the three applied flags
		// the executor is entitled to flip. `tomo.sources` and every other
		// top-level key never appear here.
		const pristine = JSON.parse(SET_JSON) as InstructionSet;
		expect(diffPaths(pristine, afterRerun)).toEqual([
			"actions.I02.applied",
			"actions.I02.target_moc_path",
			"actions.I03.applied",
			"actions.I04.applied",
		]);

		// --- PRD F8-AC2, whole loop: the peer's ONLY diff is the ticks --------
		expect(await vault.read(PEER_PATH)).toBe(peerWithTicks("I02", "I03", "I04"));
	});

	it("an unedited round-trip writes nothing at all", async () => {
		await executor.execute({ kind: "single-file", sourcePath: SET_PATH });

		const view = openFixer();
		await view.onOpen();
		await settle();

		const setBefore = await vault.read(SET_PATH);
		const peerBefore = await vault.read(PEER_PATH);
		const writesBefore = countWrites(vault);

		// Open, look, revert, close — the reload path a user takes when they
		// decide the set is fine after all.
		click(view, "Revert");
		await settle();
		expect(button(view, "Save").disabled).toBe(true);
		await view.onClose();

		// Zero writes, not "the same bytes written back".
		expect(countWrites(vault)).toEqual(writesBefore);
		expect(await vault.read(SET_PATH)).toBe(setBefore);
		expect(await vault.read(PEER_PATH)).toBe(peerBefore);
	});
});

// ---------------------------------------------------------------------------
// Write accounting — proves "no-op" means no write reached the vault at all,
// which reading bytes back can never show (an identical rewrite is still a
// write, and still races the executor's own applied-flag flush, ADR-9).
// ---------------------------------------------------------------------------

interface WriteCounts {
	readonly process: number;
	readonly processJSON: number;
	readonly create: number;
	readonly rename: number;
	readonly trash: number;
}

const WRITE_METHODS = ["process", "processJSON", "create", "rename", "trash"] as const;

function countWrites(vault: FakeVaultFS): WriteCounts {
	const counts: Record<string, number> = {};
	for (const name of WRITE_METHODS) {
		const method = vault[name] as unknown;
		counts[name] = vi.isMockFunction(method) ? method.mock.calls.length : 0;
	}
	return counts as unknown as WriteCounts;
}
