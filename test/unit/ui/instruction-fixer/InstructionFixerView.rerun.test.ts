/**
 * Instruction Fixer re-run, end to end (spec-006 Phase 3, T3.3; SDD ADR-9).
 *
 * The companion unit tests in `InstructionFixerView.test.ts` drive the re-run
 * bridge through a stub. This file drives the REAL collaborators — the shipped
 * `InstructionExecutor`, the real `ObsidianInstructionSetDoc` adapter, the real
 * `resolveOutcomes` — over a `FakeVaultFS`, because the claims T3.3 has to make
 * are claims about their INTERACTION and a stub cannot make them:
 *
 *   - already-`applied` actions are skipped (monotonic `applied` ⇒ idempotent
 *     re-run) — proven by an action that WOULD fail if it ran;
 *   - the repaired action applies on the re-run;
 *   - the JSON is written through the executor's own atomic path — the Fixer
 *     adds no second writer (repo lesson: real material over synthetic fixtures);
 *   - the `.md` peer's `- [x] Applied` tick still happens, and NOTHING else in
 *     the `.md` — frontmatter `tomo.sources` included — is touched (PRD F8-AC2).
 */

import "obsidian";
import { App, WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { InstructionExecutor } from "../../../../src/executor/InstructionExecutor";
import { markActionsApplied } from "../../../../src/executor/jsonAppliedWriter";
import type { RunCounts, RunState } from "../../../../src/executor/state";
import { ObsidianInstructionSetDoc } from "../../../../src/instruction-fixer/ObsidianInstructionSetDoc";
import { setTargetField } from "../../../../src/instruction-fixer/transforms";
import type { Action, InstructionSet } from "../../../../src/schema/types";
import { validate } from "../../../../src/schema/validator";
import { DEFAULT_SETTINGS } from "../../../../src/types/index";
import type { FixerCardRenderer } from "../../../../src/ui/instruction-fixer/fixerContract";
import { InstructionFixerView } from "../../../../src/ui/instruction-fixer/InstructionFixerView";
import { resolveOutcomes } from "../../../../src/ui/instruction-fixer/outcomeSource";
import { Store } from "../../../../src/util/store";
import { FakeVaultFS } from "../../../../src/vault/FakeVaultFS";

// --- fixtures ----------------------------------------------------------------

const INBOX = "tomo-inbox";
const SET_PATH = `${INBOX}/2026-07-20_1015_instructions.json`;
const PEER_PATH = `${INBOX}/2026-07-20_1015_instructions.md`;
const MOC_PATH = "Atlas/Systems (MOC).md";

/** Frontmatter the Fixer must never touch — `tomo.sources` is Tomo's (ADR-7). */
const PEER_FRONTMATTER = [
	"---",
	"doc_type: tomo-instructions",
	"state: executed",
	"run_id: 2026-07-20_1015",
	"tomo:",
	"  sources:",
	'    - "100 Inbox/Kanban.md"',
	"---",
	"",
].join("\n");

const PEER_MD = `${PEER_FRONTMATTER}${[
	"## Actions",
	"",
	"### I01 — link_to_moc",
	"- [ ] Applied",
	"",
	"### I02 — link_to_moc",
	"- [ ] Applied",
	"",
].join("\n")}`;

const MOC_MD = ["# Systems", "", "## Maps", "", "- [[Existing]]", ""].join("\n");

/**
 * I01 is ALREADY applied and its anchor does not exist in the MOC — so if the
 * re-run ever attempted it, it would fail loudly instead of quietly skipping.
 * That is the point: it is the monotonic-`applied` canary.
 */
const I01: Action = {
	action: "link_to_moc",
	id: "I01",
	target_moc: "Systems (MOC)",
	target_moc_path: MOC_PATH,
	line_to_add: "- [[Ghost]]",
	anchor: { type: "heading", value: "Nonexistent" },
	placement: "after",
	applied: true,
};

/** Fails on the first run ("anchor not found: Tools"); repaired to "Maps". */
const I02: Action = {
	action: "link_to_moc",
	id: "I02",
	target_moc: "Systems (MOC)",
	target_moc_path: MOC_PATH,
	line_to_add: "- [[Kanban]]",
	anchor: { type: "heading", value: "Tools" },
	placement: "after",
	applied: false,
};

function makeSet(): InstructionSet {
	return {
		schema_version: "2",
		type: "tomo-instructions",
		generated: "2026-07-20T10:15:00Z",
		profile: "default",
		actions: [I01, I02],
	};
}

async function seedVault(): Promise<FakeVaultFS> {
	const vault = new FakeVaultFS();
	await vault.createFolder(INBOX);
	await vault.createFolder("Atlas");
	await vault.create(SET_PATH, `${JSON.stringify(makeSet(), null, 2)}\n`);
	await vault.create(PEER_PATH, PEER_MD);
	await vault.create(MOC_PATH, MOC_MD);
	return vault;
}

function makeExecutor(
	vault: FakeVaultFS,
	store: Store<RunState>,
): InstructionExecutor {
	return new InstructionExecutor({
		vault,
		validator: { validate },
		hookRunner: {
			run: vi.fn().mockResolvedValue({ kind: "ok" }),
			preApprove: vi.fn().mockResolvedValue(undefined),
		},
		// auto-run: no modal to drive, and (unlike silent) the store keeps the
		// terminal `summary` the outcome resolver reads back.
		settings: {
			...DEFAULT_SETTINGS,
			tomoInboxFolder: INBOX,
			executionMode: "auto-run",
			runLogRetention: "always",
		},
		clock: { now: () => new Date("2026-07-20T10:20:00") },
		store,
		notify: vi.fn(),
	});
}

/**
 * Card seam that repairs I02's anchor through the real Phase-1 transform.
 * Stands in for T3.2's `actionCardRenderer` (whose real `TargetControl` widgets
 * are exercised in `cards/*`); it renders the reason the same way, so the
 * executor-outcome → `resolveOutcomes` → `ctx.reason` pipeline stays asserted.
 */
const REPAIR_CARD: FixerCardRenderer = {
	render(body, action, ctx) {
		if (ctx.reason !== null) {
			body.createDiv({ cls: "hashi-if-card-reason", text: ctx.reason });
		}
		if (action.id !== "I02") return;
		const btn = body.createEl("button", { text: "repair" });
		btn.addEventListener("click", () => {
			ctx.apply((model) => setTargetField(model, "I02", "anchor", "Maps"));
		});
	},
};

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
		card: REPAIR_CARD,
		rerun,
	});
	view.app = new App();
	return view;
}

function clickButton(view: InstructionFixerView, text: string): void {
	const btn = Array.from(view.contentEl.querySelectorAll("button")).find(
		(b) => b.textContent === text,
	);
	if (btn === undefined) throw new Error(`no button with text "${text}"`);
	btn.click();
}

async function settle(): Promise<void> {
	for (let i = 0; i < 10; i++) await Promise.resolve();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function groupLabels(view: InstructionFixerView): string[] {
	return Array.from(view.contentEl.querySelectorAll(".hashi-if-group-label")).map(
		(el) => el.textContent ?? "",
	);
}

function cardEl(view: InstructionFixerView, id: string): HTMLElement | null {
	return view.contentEl.querySelector(`.hashi-if-card[data-action-id="${id}"]`);
}

/** The `- [x] Applied` / `- [ ] Applied` state under `### <id>` in the peer. */
function peerTicked(peer: string, id: string): boolean {
	const lines = peer.split("\n");
	const start = lines.findIndex((line) => line.startsWith(`### ${id}`));
	if (start === -1) throw new Error(`no ### ${id} heading in the peer`);
	for (let i = start + 1; i < lines.length && !lines[i]?.startsWith("###"); i++) {
		if (lines[i]?.trim() === "- [x] Applied") return true;
	}
	return false;
}

// --- test --------------------------------------------------------------------

describe("Instruction Fixer — repair, re-run, refresh (end to end)", () => {
	it("skips the already-applied action, applies the repaired one, and refreshes in place", async () => {
		const vault = await seedVault();
		const runStore = new Store<RunState>({ kind: "idle" });
		const executor = makeExecutor(vault, runStore);

		// --- the run that produced the failure the user came to fix -----------
		const first = await executor.execute({ kind: "single-file", sourcePath: SET_PATH });
		expect(first.failed).toBe(1);
		expect(first.applied).toBe(0);

		const runs: RunCounts[] = [];
		const view = makeView(vault, runStore, async (docPath) => {
			runs.push(await executor.execute({ kind: "single-file", sourcePath: docPath }));
		});

		await view.onOpen();

		// The failed action is the one offered for repair; the applied one is frozen.
		expect(groupLabels(view)).toEqual(["Needs repair", "Applied"]);
		expect(cardEl(view, "I02")?.querySelector(".hashi-if-badge")?.textContent).toBe("failed");
		expect(
			cardEl(view, "I02")?.querySelector(".hashi-if-card-reason")?.textContent,
		).toContain("anchor not found: Tools");

		// --- repair + save + re-run -------------------------------------------
		clickButton(view, "repair");
		clickButton(view, "Save");
		await settle();

		clickButton(view, "Re-run");
		await settle();

		// Only the repaired action ran: I01 was filtered out by its `applied`
		// flag, and it would have FAILED had it been attempted.
		expect(runs[0]?.applied).toBe(1);
		expect(runs[0]?.failed).toBe(0);

		// --- outcomes refreshed in place --------------------------------------
		expect(groupLabels(view)).toEqual(["Applied"]);
		expect(cardEl(view, "I02")?.querySelector(".hashi-if-badge")?.textContent).toBe("applied");
		expect(cardEl(view, "I02")?.querySelector(".hashi-if-card-tag")?.textContent).toBe("frozen");

		// --- the JSON channel, written through the executor's atomic path -----
		const onDisk = await vault.readJSON<InstructionSet>(SET_PATH);
		const i02 = onDisk.actions.find((a) => a.id === "I02");
		expect(i02?.applied).toBe(true);
		expect(i02).toMatchObject({ anchor: { type: "heading", value: "Maps" } });
		// The canary never ran and never regressed.
		expect(onDisk.actions.find((a) => a.id === "I01")).toEqual(I01);

		// The insert landed once, from the repaired action only.
		const moc = await vault.read(MOC_PATH);
		expect(moc).toContain("- [[Kanban]]");
		expect(moc).not.toContain("- [[Ghost]]");

		// --- the .md peer: the tick, and nothing else (PRD F8-AC2) ------------
		const peer = await vault.read(PEER_PATH);
		expect(peerTicked(peer, "I02")).toBe(true);
		// I01 never ran on either pass, so its checkbox stays untouched.
		expect(peerTicked(peer, "I01")).toBe(false);
		// Frontmatter — `tomo.sources` included — survives byte for byte, and the
		// only line that differs anywhere in the peer is I02's checkbox.
		expect(peer.startsWith(PEER_FRONTMATTER)).toBe(true);
		expect(peer).toBe(PEER_MD.replace("### I02 — link_to_moc\n- [ ] Applied", "### I02 — link_to_moc\n- [x] Applied"));
	});

	it("reloads after a run that threw AFTER writing, showing the error and the new state", async () => {
		// A rejected run is NOT a promise that nothing landed: the executor's
		// applied-flag flush and the peer-checkbox tick are separate awaited
		// steps of one try block, and a batch's earlier files flush before a
		// later one can throw. So the stub below does what that leaves behind —
		// it drives the flag through the executor's OWN writer (no second
		// writer), then aborts. A view that kept its pre-run model would go on
		// offering I02 for repair when it is already applied on disk.
		const vault = await seedVault();
		const runStore = new Store<RunState>({ kind: "idle" });
		const executor = makeExecutor(vault, runStore);
		await executor.execute({ kind: "single-file", sourcePath: SET_PATH });

		const view = makeView(vault, runStore, async (docPath) => {
			await markActionsApplied(vault, docPath, ["I02"]);
			throw new Error("run aborted: peer checkbox write failed");
		});
		await view.onOpen();
		expect(groupLabels(view)).toEqual(["Needs repair", "Applied"]);

		clickButton(view, "Re-run");
		await settle();

		// Both facts, together: why the run failed …
		expect(view.contentEl.querySelector(".hashi-if-rerun-error")?.textContent).toContain(
			"run aborted: peer checkbox write failed",
		);
		// … and what the set actually looks like now. I02 is no longer offered
		// for repair, because the flag that landed says it was applied.
		expect(groupLabels(view)).toEqual(["Applied"]);
		expect(cardEl(view, "I02")?.querySelector(".hashi-if-card-tag")?.textContent).toBe("frozen");
		expect((await vault.readJSON<InstructionSet>(SET_PATH)).actions[1]?.applied).toBe(true);
	});
});
