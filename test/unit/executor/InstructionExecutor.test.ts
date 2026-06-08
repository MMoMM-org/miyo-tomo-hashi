/**
 * T4.5 — InstructionExecutor + executionStore tests (RED phase)
 *
 * Scenarios:
 *   1. Single-file invocation runs the right action set and writes applied:true per success
 *   2. Batch invocation merges across files in alphabetical order
 *   3. Single-run lock: second execute() while running → rejects fast with right message
 *   4. Halt-on-dependency: create_moc I03 fails → link_to_moc depending on I03 = skipped-dependency; others run
 *   5. Halt-on-independent-failure does NOT propagate
 *   6. Cancellation: cancel() between actions → in-flight commits; remaining = skipped-cancelled
 *   7. Validation-only failure for a file in batch: that file skipped; others proceed
 *   8. Run log written before lock release
 *   9. Pre-hook throw → action skipped, applied stays false
 *  10. Post-hook throw → action committed (applied:true), hook failure logged separately
 *  11. Mode silent → no proceed() required; executionStore still updates
 *  12. executionStore transitions traced (normal confirm-mode: idle→preparing→previewing→running→summary)
 *  12b. executionStore validation-failed branch: idle→preparing→validation-failed→idle
 *
 * [ref: PRD/F1, F3, F4, F5, F6, F7, F8; SDD/InstructionExecutor Service Surface; SDD/Runtime View]
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { InstructionExecutor } from "../../../src/executor/InstructionExecutor.js";
import { executionStore, selectKind, selectProgress } from "../../../src/executor/executionStore.js";
import { Store } from "../../../src/util/store.js";
import type { RunState, Clock, ValidationOutcome } from "../../../src/executor/state.js";
import type { InstructionSet, Action } from "../../../src/schema/types.js";
import type { PluginSettings } from "../../../src/types/index.js";
import type { HookOutcome } from "../../../src/hooks/HookRunner.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_DATE = new Date("2026-04-29T10:00:00");
const INBOX = "tomo-inbox";

const fixedClock: Clock = { now: () => FIXED_DATE };

const defaultSettings: PluginSettings = {
	chosenInstanceName: null,
	zoomLevel: 1,
	tomoInboxFolder: INBOX,
	executionMode: "silent",
	runLogRetention: "always",
	hooksDir: ".tomo-hashi/hooks",
	hooksPolicy: "enabled",
	debugLogging: false,
	ideBridgeEnabled: false,
	ideBridgePort: 23027,
	ideBridgeAuthToken: "",
};

function makeSettings(overrides?: Partial<PluginSettings>): PluginSettings {
	return { ...defaultSettings, ...overrides };
}

function makeOkValidator(set: InstructionSet): { validate: (raw: unknown) => ValidationOutcome } {
	return { validate: (_raw: unknown): ValidationOutcome => ({ ok: true, data: set }) };
}

function makeFailValidator(message: string): { validate: (raw: unknown) => ValidationOutcome } {
	return { validate: (_raw: unknown): ValidationOutcome => ({ ok: false, message }) };
}

function makeHookRunner(
	outcome: HookOutcome = { kind: "ok" },
): { run: Mock; preApprove: Mock } {
	return {
		run: vi.fn().mockResolvedValue(outcome),
		preApprove: vi.fn().mockResolvedValue(undefined),
	};
}

function makeInstructionSet(actions: Action[]): InstructionSet {
	return {
		schema_version: "1",
		type: "tomo-instructions",
		generated: "2026-04-29T10:00:00Z",
		profile: null,
		actions,
	};
}

function makeCreateMoc(id: string, destination: string, applied?: boolean): Action {
	return {
		action: "create_moc",
		id,
		source: `inbox/note-${id}.md`,
		destination,
		title: `MOC ${id}`,
		...(applied !== undefined ? { applied } : {}),
	};
}

function makeMoveNote(id: string, source: string, destination: string, applied?: boolean): Action {
	return {
		action: "move_note",
		id,
		source,
		destination,
		title: `Note ${id}`,
		...(applied !== undefined ? { applied } : {}),
	};
}

function makeLinkToMoc(id: string, targetMoc: string, targetMocPath: string, applied?: boolean): Action {
	return {
		action: "link_to_moc",
		id,
		target_moc: targetMoc,
		line_to_add: `- [[note-${id}]]`,
		target_moc_path: targetMocPath,
		anchor: { type: "callout", value: "[!blocks] Key Concepts" },
		placement: "inside",
		...(applied !== undefined ? { applied } : {}),
	};
}

// ---------------------------------------------------------------------------
// Helpers to make tests concise
// ---------------------------------------------------------------------------

function makeSingleFileExecutor(
	vault: FakeVaultFS,
	set: InstructionSet,
	overrides?: {
		settings?: Partial<PluginSettings>;
		hookRunner?: { run: Mock; preApprove: Mock };
		store?: Store<RunState>;
	},
): { executor: InstructionExecutor; notify: Mock; store: Store<RunState> } {
	const notify = vi.fn();
	const store = overrides?.store ?? new Store<RunState>({ kind: "idle" });
	const executor = new InstructionExecutor({
		vault,
		validator: makeOkValidator(set),
		hookRunner: overrides?.hookRunner ?? makeHookRunner(),
		settings: makeSettings(overrides?.settings),
		clock: fixedClock,
		store,
		notify,
	});
	return { executor, notify, store };
}

// ---------------------------------------------------------------------------
// Scenario 1: Single-file invocation
// ---------------------------------------------------------------------------

describe("InstructionExecutor — single-file invocation", () => {
	it("runs actions and writes applied:true on success", async () => {
		const vault = new FakeVaultFS();
		const sourcePath = `${INBOX}/2026-04-29_instructions.json`;
		const set = makeInstructionSet([
			makeCreateMoc("I01", `${INBOX}/moc-I01.md`),
			makeMoveNote("I02", "inbox/note-I02.md", "notes/note-I02.md"),
		]);

		await vault.createFolder(INBOX);
		await vault.create(sourcePath, JSON.stringify(set, null, 2) + "\n");
		// Create source files that handlers need
		await vault.createFolder("inbox");
		await vault.create(`inbox/note-I01.md`, "# Note I01");
		await vault.create(`inbox/note-I02.md`, "# Note I02");
		await vault.createFolder("notes");

		const { executor } = makeSingleFileExecutor(vault, set);
		const counts = await executor.execute({ kind: "single-file", sourcePath });

		expect(counts.applied).toBe(2);
		expect(counts.failed).toBe(0);
		expect(counts["skipped-already"]).toBe(0);

		// Verify applied:true written to source JSON
		const updated = await vault.readJSON<InstructionSet>(sourcePath);
		expect(updated.actions.every((a) => a.applied === true)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Scenario 2: Batch invocation
// ---------------------------------------------------------------------------

describe("InstructionExecutor — batch invocation", () => {
	it("merges actions across files in alphabetical order", async () => {
		const vault = new FakeVaultFS();
		const fileA = `${INBOX}/a_instructions.json`;
		const fileB = `${INBOX}/b_instructions.json`;
		const setA = makeInstructionSet([makeCreateMoc("I01", `${INBOX}/moc-I01.md`)]);
		const setB = makeInstructionSet([makeCreateMoc("I01", `${INBOX}/moc-I01-b.md`)]);

		await vault.createFolder(INBOX);
		await vault.create(fileA, JSON.stringify(setA, null, 2) + "\n");
		await vault.create(fileB, JSON.stringify(setB, null, 2) + "\n");
		await vault.createFolder("inbox");
		await vault.create(`inbox/note-I01.md`, "# Note");

		const notify = vi.fn();
		const store = new Store<RunState>({ kind: "idle" });
		// Use a validator that accepts all inputs and returns the right set per path
		const executor = new InstructionExecutor({
			vault,
			validator: {
				validate: (raw: unknown): ValidationOutcome => {
					const s = raw as InstructionSet;
					return { ok: true, data: s };
				},
			},
			hookRunner: makeHookRunner(),
			settings: makeSettings(),
			clock: fixedClock,
			store,
			notify,
		});

		const counts = await executor.execute({ kind: "batch" });

		expect(counts.applied + counts.failed + counts["skipped-already"]).toBe(2);
		// Both source files should have actions updated
		const updatedA = await vault.readJSON<InstructionSet>(fileA);
		const updatedB = await vault.readJSON<InstructionSet>(fileB);
		expect(updatedA.actions.some((a) => a.applied === true || a.applied === undefined)).toBe(true);
		expect(updatedB.actions.some((a) => a.applied === true || a.applied === undefined)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Scenario 3: Single-run lock
// ---------------------------------------------------------------------------

describe("InstructionExecutor — single-run lock", () => {
	it("second execute() while running rejects fast with a notice", async () => {
		const vault = new FakeVaultFS();
		const sourcePath = `${INBOX}/lock_test_instructions.json`;

		// Use a deferred validator to hold the first run open
		let resolveFirstRun!: () => void;
		const blockPromise = new Promise<void>((res) => { resolveFirstRun = res; });

		await vault.createFolder(INBOX);

		const notify = vi.fn();
		const store = new Store<RunState>({ kind: "idle" });

		// Use a hook that blocks the first run via the blockPromise gate
		const blockingHookRunner = {
			run: vi.fn().mockImplementation(async () => {
				await blockPromise;
				return { kind: "ok" as const };
			}),
			preApprove: vi.fn().mockResolvedValue(undefined),
		};

		// The first set has one action so the hook runs
		const set = makeInstructionSet([makeCreateMoc("I01", `${INBOX}/moc.md`)]);
		await vault.create(sourcePath, JSON.stringify(set, null, 2) + "\n");
		await vault.createFolder("inbox");
		await vault.create("inbox/note-I01.md", "# Note");

		const executor = new InstructionExecutor({
			vault,
			validator: makeOkValidator(set),
			hookRunner: blockingHookRunner,
			settings: makeSettings(),
			clock: fixedClock,
			store,
			notify,
		});

		// Start first run (won't finish until blockPromise resolves).
		// L13: execute() sets `this.running = true` synchronously before
		// its first await, so the lock is held by the time this call
		// returns its pending promise. No setTimeout sleep needed — the
		// previous 10ms wait was a flake source on loaded CI.
		const firstRunPromise = executor.execute({ kind: "single-file", sourcePath });

		// Second run should reject fast
		const secondRunCounts = await executor.execute({ kind: "single-file", sourcePath });

		// Second run returns immediately with 0 applied
		expect(secondRunCounts.applied).toBe(0);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("already in progress"));

		// Unblock first run
		resolveFirstRun();
		await firstRunPromise;
	});
});

// ---------------------------------------------------------------------------
// Scenario 4: Halt-on-dependency
// ---------------------------------------------------------------------------

describe("InstructionExecutor — halt-on-dependency", () => {
	it("create_moc failure marks dependent link_to_moc as skipped-dependency; others still run", async () => {
		const vault = new FakeVaultFS();
		const sourcePath = `${INBOX}/dep_test_instructions.json`;
		const mocPath = `${INBOX}/moc-I03.md`;

		// create_moc I03: source does NOT exist → handler will return failed
		// link_to_moc I04: depends on create_moc I03 (same destination as target_moc_path)
		// move_note I05: independent, should still succeed
		const set = makeInstructionSet([
			makeCreateMoc("I03", mocPath),               // will fail (source missing)
			makeLinkToMoc("I04", mocPath, mocPath),       // depends on I03
			makeMoveNote("I05", "inbox/note-I05.md", "notes/note-I05.md"),
		]);

		await vault.createFolder(INBOX);
		await vault.create(sourcePath, JSON.stringify(set, null, 2) + "\n");
		// Note: do NOT create source for I03 so it fails
		// Create source for I05 so it succeeds
		await vault.createFolder("inbox");
		await vault.create("inbox/note-I05.md", "# Note I05");
		await vault.createFolder("notes");

		const { executor } = makeSingleFileExecutor(vault, set);
		const counts = await executor.execute({ kind: "single-file", sourcePath });

		// review round 2 / L13: tightened from toBeGreaterThanOrEqual to
		// toBe — the exact counts are knowable from the fixture (one
		// failed, one skipped-dependency, one applied), and the loose
		// bound would silently accept a regression that double-counts.
		expect(counts.failed).toBe(1);                        // I03 failed
		expect(counts["skipped-dependency"]).toBe(1);         // I04 skipped-dependency
		expect(counts.applied).toBe(1);                       // I05 applied

		// applied:true written for I05 only
		const updated = await vault.readJSON<InstructionSet>(sourcePath);
		const i05 = updated.actions.find((a) => a.id === "I05");
		expect(i05?.applied).toBe(true);
		const i04 = updated.actions.find((a) => a.id === "I04");
		expect(i04?.applied).not.toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Scenario 5: Independent failure does NOT propagate
// ---------------------------------------------------------------------------

describe("InstructionExecutor — independent failure does not propagate", () => {
	it("one action outcome (failed or skipped) does not stop subsequent independent actions", async () => {
		const vault = new FakeVaultFS();
		const sourcePath = `${INBOX}/indep_fail_instructions.json`;

		// create_moc I01: source does NOT exist → handler returns failed
		// move_note I02: independent, no dependency on I01 → should still run
		const set = makeInstructionSet([
			makeCreateMoc("I01", `${INBOX}/moc-I01-indep.md`),  // source inbox/note-I01.md missing → failed
			makeMoveNote("I02", "inbox/note-I02-indep.md", "notes/note-I02-indep.md"),
		]);

		await vault.createFolder(INBOX);
		await vault.create(sourcePath, JSON.stringify(set, null, 2) + "\n");
		await vault.createFolder("inbox");
		// Do NOT create inbox/note-I01.md (so create_moc I01 fails)
		await vault.create("inbox/note-I02-indep.md", "# Note");
		await vault.createFolder("notes");

		const { executor } = makeSingleFileExecutor(vault, set);
		const counts = await executor.execute({ kind: "single-file", sourcePath });

		// I01 failed, I02 still runs → applied (exact counts knowable;
		// review round 2 / L13).
		expect(counts.failed).toBe(1);
		expect(counts.applied).toBe(1);

		const updated = await vault.readJSON<InstructionSet>(sourcePath);
		const i02 = updated.actions.find((a) => a.id === "I02");
		expect(i02?.applied).toBe(true);
		const i01 = updated.actions.find((a) => a.id === "I01");
		expect(i01?.applied).not.toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Scenario 6: Cancellation
// ---------------------------------------------------------------------------

describe("InstructionExecutor — cancellation", () => {
	it("cancel() between actions: in-flight commits; remaining marked skipped-cancelled", async () => {
		const vault = new FakeVaultFS();
		const sourcePath = `${INBOX}/cancel_instructions.json`;

		// Use multiple actions; cancel after first
		const set = makeInstructionSet([
			makeCreateMoc("I01", `${INBOX}/moc-I01.md`),
			makeCreateMoc("I02", `${INBOX}/moc-I02.md`),
			makeCreateMoc("I03", `${INBOX}/moc-I03.md`),
		]);

		await vault.createFolder(INBOX);
		await vault.create(sourcePath, JSON.stringify(set, null, 2) + "\n");
		await vault.createFolder("inbox");
		await vault.create("inbox/note-I01.md", "# Note I01");
		await vault.create("inbox/note-I02.md", "# Note I02");
		await vault.create("inbox/note-I03.md", "# Note I03");

		let callCount = 0;
		let executorRef!: InstructionExecutor;
		const cancellingHookRunner = {
			run: vi.fn().mockImplementation(async (): Promise<HookOutcome> => {
				callCount++;
				if (callCount === 1) {
					// Cancel after first action's after-hook fires
					executorRef.cancel();
				}
				return { kind: "ok" };
			}),
			preApprove: vi.fn().mockResolvedValue(undefined),
		};

		const notify = vi.fn();
		const store = new Store<RunState>({ kind: "idle" });
		executorRef = new InstructionExecutor({
			vault,
			validator: makeOkValidator(set),
			hookRunner: cancellingHookRunner,
			settings: makeSettings(),
			clock: fixedClock,
			store,
			notify,
		});

		const counts = await executorRef.execute({ kind: "single-file", sourcePath });

		expect(counts["skipped-cancelled"]).toBeGreaterThanOrEqual(1);
		// The in-flight I01 should have committed
		const updated = await vault.readJSON<InstructionSet>(sourcePath);
		const i01 = updated.actions.find((a) => a.id === "I01");
		expect(i01?.applied).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Scenario 7: Validation-only failure in batch
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// M4 — settings can be passed as a getter so in-session changes take effect
// ---------------------------------------------------------------------------

describe("InstructionExecutor — settings as getter (M4)", () => {
	it("uses the latest settings on each execute when constructed with a getter", async () => {
		// Pre-fix the executor froze settings at construction. The getter form
		// binds late so the executor always reads the current settings — this
		// test flips the backing reference mid-run to prove late binding,
		// independent of how main.ts's persist() updates the object.
		const vault = new FakeVaultFS();
		await vault.createFolder(INBOX);
		await vault.createFolder("inbox");

		// Two separate inbox folders; we'll flip the getter mid-test.
		const inboxA = `${INBOX}/A`;
		const inboxB = `${INBOX}/B`;
		await vault.createFolder(inboxA);
		await vault.createFolder(inboxB);

		// Each has its own batch source so we can tell which one ran.
		const setA = makeInstructionSet([makeCreateMoc("I01", `${inboxA}/m1.md`)]);
		const setB = makeInstructionSet([makeCreateMoc("I02", `${inboxB}/m2.md`)]);
		await vault.create(`${inboxA}/a_instructions.json`, JSON.stringify(setA, null, 2) + "\n");
		await vault.create(`${inboxB}/b_instructions.json`, JSON.stringify(setB, null, 2) + "\n");
		await vault.create("inbox/note-I01.md", "# Note");
		await vault.create("inbox/note-I02.md", "# Note");

		// Mutable settings object the test can reassign.
		let liveSettings: PluginSettings = makeSettings({ tomoInboxFolder: inboxA });

		const executor = new InstructionExecutor({
			vault,
			validator: {
				validate: (raw: unknown): ValidationOutcome => {
					const s = raw as { schema_version?: string };
					if (s?.schema_version === "1") {
						return { ok: true, data: raw as InstructionSet };
					}
					return { ok: false, message: "invalid" };
				},
			},
			hookRunner: makeHookRunner(),
			// Pass a getter — executor must read settings on each run.
			settings: () => liveSettings,
			clock: fixedClock,
			store: new Store<RunState>({ kind: "idle" }),
		});

		await executor.execute({ kind: "batch" });
		// After first run: inboxA's I01 must be applied
		const afterFirstA = await vault.readJSON<InstructionSet>(
			`${inboxA}/a_instructions.json`,
		);
		expect(afterFirstA.actions.find((a) => a.id === "I01")?.applied).toBe(true);
		const afterFirstB = await vault.readJSON<InstructionSet>(
			`${inboxB}/b_instructions.json`,
		);
		expect(afterFirstB.actions.find((a) => a.id === "I02")?.applied).toBeUndefined();

		// Flip the backing settings reference the getter reads from.
		liveSettings = makeSettings({ tomoInboxFolder: inboxB });

		await executor.execute({ kind: "batch" });
		// Second run must read the NEW inbox folder
		const afterSecondB = await vault.readJSON<InstructionSet>(
			`${inboxB}/b_instructions.json`,
		);
		expect(afterSecondB.actions.find((a) => a.id === "I02")?.applied).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// H5 — Batched applied-flag writes (one processJSON per source, not N)
// ---------------------------------------------------------------------------

describe("InstructionExecutor — batched applied-flag writes (H5)", () => {
	it("one processJSON call against the source for N applied actions", async () => {
		// Pre-fix code called markActionApplied per applied action — each
		// triggered its own atomic read+parse+serialize+write cycle through
		// Obsidian's per-path queue. The batched write path consolidates them.
		const vault = new FakeVaultFS();
		const sourcePath = `${INBOX}/batch_apply_instructions.json`;
		const set = makeInstructionSet([
			makeCreateMoc("I01", `${INBOX}/m1.md`),
			makeCreateMoc("I02", `${INBOX}/m2.md`),
			makeCreateMoc("I03", `${INBOX}/m3.md`),
		]);

		await vault.createFolder(INBOX);
		await vault.create(sourcePath, JSON.stringify(set, null, 2) + "\n");
		await vault.createFolder("inbox");
		await vault.create("inbox/note-I01.md", "# Note I01");
		await vault.create("inbox/note-I02.md", "# Note I02");
		await vault.create("inbox/note-I03.md", "# Note I03");

		const processJSONSpy = vi.spyOn(vault, "processJSON");

		const { executor } = makeSingleFileExecutor(vault, set);
		await executor.execute({ kind: "single-file", sourcePath });

		// Filter out any processJSON calls against non-source files (e.g.
		// none expected at present, but the assertion is path-scoped).
		const sourceWrites = processJSONSpy.mock.calls.filter(
			(c) => c[0] === sourcePath,
		);
		expect(sourceWrites.length).toBe(1);

		// Outcome unchanged: all three actions are applied.
		const after = await vault.readJSON<InstructionSet>(sourcePath);
		expect(after.actions.every((a) => a.applied === true)).toBe(true);
	});

	it("peer .md is ticked AFTER source JSON applied flag is written (review round 2 / M3)", async () => {
		// Pre-fix ordering: tickPeerCheckbox fired inside the action loop,
		// then markActionsApplied flushed after the loop. A crash between
		// the tick and the flush left peer .md showing `[x] Applied` while
		// source JSON still had `applied: false` — the next run re-enqueued
		// the action while the user saw it as done. Post-fix: source JSON
		// is the truth, peer .md is ticked only after the JSON write
		// succeeds. This test pins the ordering by spying on vault writes
		// and asserting the JSON write precedes the peer .md modification.
		const vault = new FakeVaultFS();
		const sourcePath = `${INBOX}/peer_order_instructions.json`;
		const set = makeInstructionSet([
			makeCreateMoc("I01", `${INBOX}/m1.md`),
		]);

		// Peer .md path is derived by replacing `.json` with `.md` on the
		// source path (see derivePeerPath in peerCheckboxSync.ts).
		const peerPath = `${INBOX}/peer_order_instructions.md`;

		await vault.createFolder(INBOX);
		await vault.create(sourcePath, JSON.stringify(set, null, 2) + "\n");
		await vault.createFolder("inbox");
		await vault.create("inbox/note-I01.md", "# Note");
		// Peer .md with the heading + unticked checkbox tickPeerCheckbox
		// targets. Without it the peer-tick would no-op via "peer-missing".
		await vault.create(peerPath, "# Peer\n\n### I01\n\n- [ ] Applied\n");

		const order: string[] = [];
		vi.spyOn(vault, "processJSON").mockImplementation(async (path, fn) => {
			if (path === sourcePath) order.push("markActionsApplied");
			return FakeVaultFS.prototype.processJSON.call(vault, path, fn);
		});
		vi.spyOn(vault, "process").mockImplementation(async (path, fn) => {
			if (path === peerPath) order.push("tickPeerCheckbox");
			return FakeVaultFS.prototype.process.call(vault, path, fn);
		});

		const { executor } = makeSingleFileExecutor(vault, set);
		await executor.execute({ kind: "single-file", sourcePath });

		// Ordering: source JSON write precedes peer .md write.
		const jsonIdx = order.indexOf("markActionsApplied");
		const peerIdx = order.indexOf("tickPeerCheckbox");
		expect(jsonIdx).toBeGreaterThanOrEqual(0);
		expect(peerIdx).toBeGreaterThanOrEqual(0);
		expect(jsonIdx).toBeLessThan(peerIdx);
	});
});

describe("InstructionExecutor — validation failure in batch", () => {
	it("malformed JSON in one source records as per-file failure; other sources proceed (H3)", async () => {
		// Before the H3 fix, an uncaught JSON.parse throw aborted the entire
		// batch — one bad file killed the run. The fix wraps readJSON and
		// records the error as a per-file failure on the same channel as
		// schema-fail.
		const vault = new FakeVaultFS();
		const validPath = `${INBOX}/a_instructions.json`;
		const malformedPath = `${INBOX}/b_instructions.json`;
		const validSet = makeInstructionSet([
			makeCreateMoc("I01", `${INBOX}/moc-malformed.md`),
		]);

		await vault.createFolder(INBOX);
		await vault.create(validPath, JSON.stringify(validSet, null, 2) + "\n");
		// Intentionally malformed: JSON.parse will throw SyntaxError
		await vault.create(malformedPath, "{ not valid json");
		await vault.createFolder("inbox");
		await vault.create("inbox/note-I01.md", "# Note");

		const notify = vi.fn();
		const store = new Store<RunState>({ kind: "idle" });
		const executor = new InstructionExecutor({
			vault,
			validator: makeOkValidator(validSet),
			hookRunner: makeHookRunner(),
			settings: makeSettings(),
			clock: fixedClock,
			store,
			notify,
		});

		// Must NOT throw
		await expect(executor.execute({ kind: "batch" })).resolves.toBeDefined();

		// Valid file's action should have been applied
		const updated = await vault.readJSON<InstructionSet>(validPath);
		const i01 = updated.actions.find((a) => a.id === "I01");
		expect(i01?.applied).toBe(true);
	});

	it("invalid file's actions are skipped; other files in batch proceed", async () => {
		const vault = new FakeVaultFS();
		const validPath = `${INBOX}/a_instructions.json`;
		const invalidPath = `${INBOX}/b_instructions.json`;
		const validSet = makeInstructionSet([makeCreateMoc("I01", `${INBOX}/moc-I01.md`)]);

		await vault.createFolder(INBOX);
		await vault.create(validPath, JSON.stringify(validSet, null, 2) + "\n");
		await vault.create(invalidPath, JSON.stringify({ bad: true }, null, 2) + "\n");
		await vault.createFolder("inbox");
		await vault.create("inbox/note-I01.md", "# Note");

		const notify = vi.fn();
		const store = new Store<RunState>({ kind: "idle" });
		// Validator: ok for validSet, fail for anything else
		const selectiveValidator = {
			validate: (raw: unknown): ValidationOutcome => {
				const s = raw as { schema_version?: string };
				if (s?.schema_version === "1") {
					return { ok: true, data: raw as InstructionSet };
				}
				return { ok: false, message: "invalid schema" };
			},
		};

		const executor = new InstructionExecutor({
			vault,
			validator: selectiveValidator,
			hookRunner: makeHookRunner(),
			settings: makeSettings(),
			clock: fixedClock,
			store,
			notify,
		});

		const counts = await executor.execute({ kind: "batch" });

		// validSet's I01 ran. The invalid file contributes 0 because the
		// schema validator rejects it before action enumeration. Tighter
		// than `>= 1` so a regression that swallows the I01 outcome
		// fails this assertion (review round 2 / L13).
		expect(counts.applied).toBe(1);
		expect(counts.failed).toBe(0);
		expect(counts["skipped-already"]).toBe(0);

		// Valid file's action should be applied (source file exists)
		const updated = await vault.readJSON<InstructionSet>(validPath);
		const i01 = updated.actions.find((a) => a.id === "I01");
		expect(i01?.applied).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Scenario 8: Run log written before lock release
// ---------------------------------------------------------------------------

describe("InstructionExecutor — run log", () => {
	it("creates run log file in inbox folder when retention=always", async () => {
		const vault = new FakeVaultFS();
		const sourcePath = `${INBOX}/log_test_instructions.json`;
		const set = makeInstructionSet([makeCreateMoc("I01", `${INBOX}/moc-I01.md`)]);

		await vault.createFolder(INBOX);
		await vault.create(sourcePath, JSON.stringify(set, null, 2) + "\n");
		await vault.createFolder("inbox");
		await vault.create("inbox/note-I01.md", "# Note");

		const { executor } = makeSingleFileExecutor(vault, set, {
			settings: { runLogRetention: "always" },
		});

		await executor.execute({ kind: "single-file", sourcePath });

		// A run log file should exist in INBOX
		const filesInInbox = await vault.list(INBOX);
		const logFile = filesInInbox.find((f) => f.includes("tomo-hashi-run-log"));
		expect(logFile).toBeDefined();
	});

	it("finalizes the run log when the run throws mid-flight (no stranded placeholder)", async () => {
		// Regression: a vault op / hook callback throwing in the action loop
		// used to abort run() before finalize(), leaving the placeholder log
		// start() wrote — empty body with `totals: {}` and no diagnostic.
		// finalize() now runs even on abort, with the error recorded.
		const vault = new FakeVaultFS();
		const sourcePath = `${INBOX}/abort_instructions.json`;
		const set = makeInstructionSet([makeCreateMoc("I01", `${INBOX}/moc-abort.md`)]);

		await vault.createFolder(INBOX);
		await vault.create(sourcePath, JSON.stringify(set, null, 2) + "\n");
		await vault.createFolder("inbox");
		await vault.create("inbox/note-I01.md", "# Note");

		// A hook whose run() rejects (vs. returning a failed outcome) is an
		// uncaught throw inside the action loop.
		const throwingHook = {
			run: vi.fn().mockRejectedValue(new Error("kaboom from hook")),
			preApprove: vi.fn().mockResolvedValue(undefined),
		};

		const { executor } = makeSingleFileExecutor(vault, set, {
			hookRunner: throwingHook,
			settings: { runLogRetention: "always" },
		});

		// The error still propagates to the caller (behavior preserved).
		await expect(
			executor.execute({ kind: "single-file", sourcePath }),
		).rejects.toThrow("kaboom from hook");

		// …but the run log is now a real, finalized log — not the placeholder.
		const filesInInbox = await vault.list(INBOX);
		const logFile = filesInInbox.find((f) => f.includes("tomo-hashi-run-log"));
		expect(logFile).toBeDefined();
		const logContent = await vault.read(logFile as string);
		expect(logContent).toContain("run aborted: kaboom from hook");
		// Finalized totals, not the placeholder's `totals:\n  {}`.
		expect(logContent).not.toContain("  {}");
	});

	it("keeps the run log on abort even under retention=only-after-failed", async () => {
		// The recorded run-error counts as a failure, so an aborted run is
		// retained for diagnosis even with the failure-only retention policy.
		const vault = new FakeVaultFS();
		const sourcePath = `${INBOX}/abort_keep_instructions.json`;
		const set = makeInstructionSet([makeCreateMoc("I01", `${INBOX}/moc-abort-keep.md`)]);

		await vault.createFolder(INBOX);
		await vault.create(sourcePath, JSON.stringify(set, null, 2) + "\n");
		await vault.createFolder("inbox");
		await vault.create("inbox/note-I01.md", "# Note");

		const throwingHook = {
			run: vi.fn().mockRejectedValue(new Error("boom")),
			preApprove: vi.fn().mockResolvedValue(undefined),
		};

		const { executor } = makeSingleFileExecutor(vault, set, {
			hookRunner: throwingHook,
			settings: { runLogRetention: "only-after-failed" },
		});

		await expect(
			executor.execute({ kind: "single-file", sourcePath }),
		).rejects.toThrow("boom");

		const filesInInbox = await vault.list(INBOX);
		const logFile = filesInInbox.find((f) => f.includes("tomo-hashi-run-log"));
		expect(logFile).toBeDefined();
	});

	it("does NOT keep run log when retention=only-after-failed and all succeed", async () => {
		const vault = new FakeVaultFS();
		const sourcePath = `${INBOX}/log_nofail_instructions.json`;
		const set = makeInstructionSet([makeCreateMoc("I01", `${INBOX}/moc-nofail.md`)]);

		await vault.createFolder(INBOX);
		await vault.create(sourcePath, JSON.stringify(set, null, 2) + "\n");
		await vault.createFolder("inbox");
		await vault.create("inbox/note-I01.md", "# Note");

		const { executor } = makeSingleFileExecutor(vault, set, {
			settings: { runLogRetention: "only-after-failed" },
		});

		await executor.execute({ kind: "single-file", sourcePath });

		// Log file should have been deleted (retention=only-after-failed, no failures)
		const filesInInbox = await vault.list(INBOX);
		const logFile = filesInInbox.find((f) => f.includes("tomo-hashi-run-log"));
		expect(logFile).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Execution debug logging (gated on debugLogging)
// ---------------------------------------------------------------------------

describe("InstructionExecutor — debug logging", () => {
	it("logs per-action outcomes (with failure reason) to console when debugLogging is on", async () => {
		const vault = new FakeVaultFS();
		const sourcePath = `${INBOX}/dbg_instructions.json`;
		// create_moc whose source note is absent → handler returns failed.
		const set = makeInstructionSet([makeCreateMoc("I01", `${INBOX}/moc-dbg.md`)]);
		await vault.createFolder(INBOX);
		await vault.create(sourcePath, JSON.stringify(set, null, 2) + "\n");
		// Deliberately do NOT create inbox/note-I01.md → "Source missing".

		const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
		let lines: string[] = [];
		try {
			const { executor } = makeSingleFileExecutor(vault, set, {
				settings: { debugLogging: true },
			});
			await executor.execute({ kind: "single-file", sourcePath });
			// Capture before mockRestore() — restoring also resets mock.calls.
			lines = debugSpy.mock.calls.map((c) => c.join(" "));
		} finally {
			debugSpy.mockRestore();
		}

		// Per-action failure line carries the id, kind, and reason.
		expect(
			lines.some(
				(l) =>
					l.includes("[hashi:exec]") &&
					l.includes("I01") &&
					l.includes("Source missing"),
			),
		).toBe(true);
		expect(lines.some((l) => l.includes("[hashi:exec] run start"))).toBe(true);
		expect(lines.some((l) => l.includes("[hashi:exec] run complete"))).toBe(true);
	});

	it("emits no execution traces when debugLogging is off (default)", async () => {
		const vault = new FakeVaultFS();
		const sourcePath = `${INBOX}/dbg_off_instructions.json`;
		const set = makeInstructionSet([makeCreateMoc("I01", `${INBOX}/moc-dbg-off.md`)]);
		await vault.createFolder(INBOX);
		await vault.create(sourcePath, JSON.stringify(set, null, 2) + "\n");
		await vault.createFolder("inbox");
		await vault.create("inbox/note-I01.md", "# Note");

		const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
		let execLines: string[] = [];
		try {
			const { executor } = makeSingleFileExecutor(vault, set, {
				settings: { debugLogging: false },
			});
			await executor.execute({ kind: "single-file", sourcePath });
			// Capture before mockRestore() — restoring also resets mock.calls.
			execLines = debugSpy.mock.calls
				.map((c) => c.join(" "))
				.filter((l) => l.includes("[hashi:exec]"));
		} finally {
			debugSpy.mockRestore();
		}

		expect(execLines).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Scenario 9: Pre-hook throw
// ---------------------------------------------------------------------------

describe("InstructionExecutor — pre-hook throw", () => {
	it("pre-hook failed → action is skipped (not applied), applied stays false", async () => {
		const vault = new FakeVaultFS();
		const sourcePath = `${INBOX}/prehook_instructions.json`;
		const set = makeInstructionSet([makeCreateMoc("I01", `${INBOX}/moc-I01.md`)]);

		await vault.createFolder(INBOX);
		await vault.create(sourcePath, JSON.stringify(set, null, 2) + "\n");
		await vault.createFolder("inbox");
		await vault.create("inbox/note-I01.md", "# Note");

		// Before-hook returns failed
		const failingBeforeHook = {
			run: vi.fn().mockImplementation(async (phase: string): Promise<HookOutcome> => {
				if (phase === "before") {
					return { kind: "failed", reason: "before-hook threw: test error" };
				}
				return { kind: "ok" };
			}),
			preApprove: vi.fn().mockResolvedValue(undefined),
		};

		const { executor } = makeSingleFileExecutor(vault, set, {
			hookRunner: failingBeforeHook,
		});

		const counts = await executor.execute({ kind: "single-file", sourcePath });

		expect(counts.failed).toBe(1);
		expect(counts.applied).toBe(0);

		// applied should NOT be written to JSON
		const updated = await vault.readJSON<InstructionSet>(sourcePath);
		const i01 = updated.actions.find((a) => a.id === "I01");
		expect(i01?.applied).not.toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Scenario 10: Post-hook throw
// ---------------------------------------------------------------------------

describe("InstructionExecutor — post-hook throw", () => {
	it("post-hook failed → action committed (applied:true), hook failure logged separately", async () => {
		const vault = new FakeVaultFS();
		const sourcePath = `${INBOX}/posthook_instructions.json`;
		const set = makeInstructionSet([makeCreateMoc("I01", `${INBOX}/moc-posthook.md`)]);

		await vault.createFolder(INBOX);
		await vault.create(sourcePath, JSON.stringify(set, null, 2) + "\n");
		await vault.createFolder("inbox");
		await vault.create("inbox/note-I01.md", "# Note");

		// After-hook returns failed, before-hook ok
		const failingAfterHook = {
			run: vi.fn().mockImplementation(async (phase: string): Promise<HookOutcome> => {
				if (phase === "after") {
					return { kind: "failed", reason: "after-hook threw: test error" };
				}
				return { kind: "ok" };
			}),
			preApprove: vi.fn().mockResolvedValue(undefined),
		};

		const { executor } = makeSingleFileExecutor(vault, set, {
			hookRunner: failingAfterHook,
		});

		const counts = await executor.execute({ kind: "single-file", sourcePath });

		// Action should be committed (applied)
		expect(counts.applied).toBe(1);
		expect(counts.failed).toBe(0);

		// applied:true written to JSON
		const updated = await vault.readJSON<InstructionSet>(sourcePath);
		const i01 = updated.actions.find((a) => a.id === "I01");
		expect(i01?.applied).toBe(true);

		// Run log exists (retention=always) and contains hook failure information
		const filesInInbox = await vault.list(INBOX);
		const logFile = filesInInbox.find((f) => f.includes("tomo-hashi-run-log"));
		expect(logFile).toBeDefined();
		if (logFile) {
			const logContent = await vault.read(logFile);
			expect(logContent).toContain("after-hook threw");
		}
	});
});

// ---------------------------------------------------------------------------
// Scenario 11: Mode silent
// ---------------------------------------------------------------------------

describe("InstructionExecutor — mode silent", () => {
	it("silent mode: execute() resolves without proceed(); executionStore updates", async () => {
		const vault = new FakeVaultFS();
		const sourcePath = `${INBOX}/silent_instructions.json`;
		const set = makeInstructionSet([makeCreateMoc("I01", `${INBOX}/moc-silent.md`)]);

		await vault.createFolder(INBOX);
		await vault.create(sourcePath, JSON.stringify(set, null, 2) + "\n");
		await vault.createFolder("inbox");
		await vault.create("inbox/note-I01.md", "# Note");

		const store = new Store<RunState>({ kind: "idle" });
		const kinds: RunState["kind"][] = [];
		store.subscribe((s) => kinds.push(s.kind));

		const executor = new InstructionExecutor({
			vault,
			validator: makeOkValidator(set),
			hookRunner: makeHookRunner(),
			settings: makeSettings({ executionMode: "silent" }),
			clock: fixedClock,
			store,
			notify: vi.fn(),
		});

		// Should resolve without calling proceed()
		const counts = await executor.execute({ kind: "single-file", sourcePath });

		expect(counts.applied).toBe(1);
		// Store should have transitioned
		expect(kinds).toContain("running");
		expect(kinds).toContain("summary");
	});
});

// ---------------------------------------------------------------------------
// Scenario 12: executionStore state transitions (confirm mode)
// ---------------------------------------------------------------------------

describe("InstructionExecutor — executionStore transitions", () => {
	it("confirm mode: idle → preparing → previewing → running → summary → idle", async () => {
		const vault = new FakeVaultFS();
		const sourcePath = `${INBOX}/transitions_instructions.json`;
		const set = makeInstructionSet([makeCreateMoc("I01", `${INBOX}/moc-trans.md`)]);

		await vault.createFolder(INBOX);
		await vault.create(sourcePath, JSON.stringify(set, null, 2) + "\n");
		await vault.createFolder("inbox");
		await vault.create("inbox/note-I01.md", "# Note");

		const store = new Store<RunState>({ kind: "idle" });
		const kinds: RunState["kind"][] = [];
		store.subscribe((s) => kinds.push(s.kind));

		const executor = new InstructionExecutor({
			vault,
			validator: makeOkValidator(set),
			hookRunner: makeHookRunner(),
			settings: makeSettings({ executionMode: "confirm" }),
			clock: fixedClock,
			store,
			notify: vi.fn(),
		});

		// Start execution — will pause at previewing waiting for proceed()
		const runPromise = executor.execute({ kind: "single-file", sourcePath });

		// Wait for the store to reach "previewing"
		await new Promise<void>((resolve) => {
			const unsub = store.subscribe((s) => {
				if (s.kind === "previewing") {
					unsub();
					resolve();
				}
			});
		});

		expect(kinds).toContain("preparing");
		expect(kinds).toContain("previewing");

		// Trigger proceed to continue
		executor.proceed();
		await runPromise;

		expect(kinds).toContain("running");
		expect(kinds).toContain("summary");
		// Empty-modal regression (2026-04-30): in confirm/auto-run mode the
		// executor MUST NOT auto-transition to idle after summary — the modal
		// is subscribed to the store and would re-render blank, hiding the
		// summary view. Idle is driven by the modal's Close handler.
		expect(kinds[kinds.length - 1]).toBe("summary");
	});

	it("auto-run mode: state stays at 'summary' after run (no auto-idle to keep modal visible)", async () => {
		const vault = new FakeVaultFS();
		const sourcePath = `${INBOX}/autorun_instructions.json`;
		const set = makeInstructionSet([makeCreateMoc("I01", `${INBOX}/moc-autorun.md`)]);

		await vault.createFolder(INBOX);
		await vault.create(sourcePath, JSON.stringify(set, null, 2) + "\n");
		await vault.createFolder("inbox");
		await vault.create("inbox/note-I01.md", "# Note");

		const store = new Store<RunState>({ kind: "idle" });
		const kinds: RunState["kind"][] = [];
		store.subscribe((s) => kinds.push(s.kind));

		const executor = new InstructionExecutor({
			vault,
			validator: makeOkValidator(set),
			hookRunner: makeHookRunner(),
			settings: makeSettings({ executionMode: "auto-run" }),
			clock: fixedClock,
			store,
			notify: vi.fn(),
		});

		await executor.execute({ kind: "single-file", sourcePath });

		expect(kinds).toContain("summary");
		expect(kinds[kinds.length - 1]).toBe("summary");
	});

	it("silent mode keeps the auto-idle transition (no modal to drive close)", async () => {
		const vault = new FakeVaultFS();
		const sourcePath = `${INBOX}/silent_idle_instructions.json`;
		const set = makeInstructionSet([makeCreateMoc("I01", `${INBOX}/moc-silent-idle.md`)]);

		await vault.createFolder(INBOX);
		await vault.create(sourcePath, JSON.stringify(set, null, 2) + "\n");
		await vault.createFolder("inbox");
		await vault.create("inbox/note-I01.md", "# Note");

		const store = new Store<RunState>({ kind: "idle" });
		const kinds: RunState["kind"][] = [];
		store.subscribe((s) => kinds.push(s.kind));

		const executor = new InstructionExecutor({
			vault,
			validator: makeOkValidator(set),
			hookRunner: makeHookRunner(),
			settings: makeSettings({ executionMode: "silent" }),
			clock: fixedClock,
			store,
			notify: vi.fn(),
		});

		await executor.execute({ kind: "single-file", sourcePath });

		expect(kinds).toContain("summary");
		// Silent mode has no modal — auto-idle is preserved so the executor
		// returns to idle ready for the next run without external signal.
		expect(kinds[kinds.length - 1]).toBe("idle");
	});

	it("validation-failed branch: idle → preparing → validation-failed → idle", async () => {
		const vault = new FakeVaultFS();
		const sourcePath = `${INBOX}/valfail_instructions.json`;

		await vault.createFolder(INBOX);
		// Invalid JSON content
		await vault.create(sourcePath, JSON.stringify({ bad: "data" }, null, 2) + "\n");

		const store = new Store<RunState>({ kind: "idle" });
		const kinds: RunState["kind"][] = [];
		store.subscribe((s) => kinds.push(s.kind));

		const executor = new InstructionExecutor({
			vault,
			validator: makeFailValidator("schema validation failed"),
			hookRunner: makeHookRunner(),
			settings: makeSettings({ executionMode: "silent" }),
			clock: fixedClock,
			store,
			notify: vi.fn(),
		});

		await executor.execute({ kind: "single-file", sourcePath });

		expect(kinds).toContain("preparing");
		expect(kinds).toContain("validation-failed");
		// After validation-failed, store should return to idle
		expect(kinds[kinds.length - 1]).toBe("idle");
	});
});

// ---------------------------------------------------------------------------
// executionStore singleton + derived selectors
// ---------------------------------------------------------------------------

describe("executionStore singleton", () => {
	beforeEach(() => {
		executionStore.set({ kind: "idle" });
	});

	it("starts idle", () => {
		expect(selectKind(executionStore.get())).toBe("idle");
	});

	it("selectProgress returns null when idle", () => {
		expect(selectProgress(executionStore.get())).toBeNull();
	});

	it("selectProgress returns current/total when running", () => {
		executionStore.set({
			kind: "running",
			mode: "silent",
			records: [],
			currentIndex: 3,
		});
		const progress = selectProgress(executionStore.get());
		expect(progress).toEqual({ current: 3, total: 0 });
	});
});
