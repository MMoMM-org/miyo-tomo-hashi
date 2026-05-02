/**
 * T4.2 — JsonAppliedWriter tests (RED phase)
 *
 * Covers:
 *   - Setting applied: true on a target action does NOT change other actions
 *   - JSON is reformatted with 2-space indent + trailing newline
 *   - Writer is atomic (concurrent writes serialize via vault.process)
 *   - Writer never sets applied: false
 *
 * [ref: PRD/F5; SDD/Atomic JSON Applied-Flag Write]
 */

import { describe, expect, it, vi } from "vitest";

import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import {
	markActionApplied,
	markActionsApplied,
} from "../../../src/executor/jsonAppliedWriter.js";
import type { InstructionSet, Action, CreateMocAction, MoveNoteAction } from "../../../src/schema/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInstructionSet(actions: Action[]): InstructionSet {
	return {
		schema_version: "1",
		type: "tomo-instructions",
		generated: "2026-04-28T10:00:00Z",
		profile: null,
		actions,
	};
}

function makeCreateMoc(id: string, applied?: boolean): CreateMocAction {
	return {
		action: "create_moc",
		id,
		source: `inbox/${id}.md`,
		destination: `moc/${id}.md`,
		title: `MOC ${id}`,
		...(applied !== undefined ? { applied } : {}),
	};
}

function makeMoveNote(id: string, applied?: boolean): MoveNoteAction {
	return {
		action: "move_note",
		id,
		source: `inbox/${id}.md`,
		destination: `notes/${id}.md`,
		title: `Note ${id}`,
		...(applied !== undefined ? { applied } : {}),
	};
}

async function seedFile(vault: FakeVaultFS, path: string, set: InstructionSet): Promise<void> {
	await vault.create(path, JSON.stringify(set, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// markActionApplied — non-mutation of other actions
// ---------------------------------------------------------------------------

describe("markActionApplied — non-mutation of other actions", () => {
	it("sets applied: true on the target action without changing other actions", async () => {
		const vault = new FakeVaultFS();
		const set = makeInstructionSet([
			makeCreateMoc("I01"),
			makeCreateMoc("I02"),
			makeCreateMoc("I03"),
		]);
		await seedFile(vault, "inbox/test_instructions.json", set);

		await markActionApplied(vault, "inbox/test_instructions.json", "I02");

		const updated = JSON.parse(await vault.read("inbox/test_instructions.json")) as InstructionSet;
		const i01 = updated.actions.find((a) => a.id === "I01");
		const i02 = updated.actions.find((a) => a.id === "I02");
		const i03 = updated.actions.find((a) => a.id === "I03");

		expect(i02?.applied).toBe(true);
		expect(i01?.applied).toBeUndefined();
		expect(i03?.applied).toBeUndefined();
	});

	it("does not alter action fields other than applied on the target action", async () => {
		const vault = new FakeVaultFS();
		const original = makeCreateMoc("I01");
		const set = makeInstructionSet([original]);
		await seedFile(vault, "inbox/test_instructions.json", set);

		await markActionApplied(vault, "inbox/test_instructions.json", "I01");

		const updated = JSON.parse(await vault.read("inbox/test_instructions.json")) as InstructionSet;
		const action = updated.actions[0] as CreateMocAction;

		expect(action.id).toBe(original.id);
		expect(action.action).toBe(original.action);
		expect(action.source).toBe(original.source);
		expect(action.destination).toBe(original.destination);
		expect(action.title).toBe(original.title);
	});

	it("preserves non-action fields on the instruction set", async () => {
		const vault = new FakeVaultFS();
		const set = makeInstructionSet([makeCreateMoc("I01")]);
		await seedFile(vault, "inbox/test_instructions.json", set);

		await markActionApplied(vault, "inbox/test_instructions.json", "I01");

		const updated = JSON.parse(await vault.read("inbox/test_instructions.json")) as InstructionSet;

		expect(updated.schema_version).toBe("1");
		expect(updated.type).toBe("tomo-instructions");
		expect(updated.generated).toBe("2026-04-28T10:00:00Z");
		expect(updated.profile).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// markActionApplied — JSON formatting
// ---------------------------------------------------------------------------

describe("markActionApplied — JSON formatting", () => {
	it("outputs 2-space indented JSON with a trailing newline", async () => {
		const vault = new FakeVaultFS();
		const set = makeInstructionSet([makeCreateMoc("I01")]);
		await seedFile(vault, "inbox/test_instructions.json", set);

		await markActionApplied(vault, "inbox/test_instructions.json", "I01");

		const raw = await vault.read("inbox/test_instructions.json");

		expect(raw.endsWith("\n")).toBe(true);
		// 2-space indent — second-level keys have exactly 2 spaces
		expect(raw).toContain('\n  "schema_version"');
	});
});

// ---------------------------------------------------------------------------
// markActionApplied — monotonicity (never sets applied: false)
// ---------------------------------------------------------------------------

describe("markActionApplied — monotonicity", () => {
	it("does not set applied: false on an action that already has applied: true", async () => {
		const vault = new FakeVaultFS();
		const set = makeInstructionSet([makeCreateMoc("I01", true)]);
		await seedFile(vault, "inbox/test_instructions.json", set);

		// Calling markActionApplied on an already-applied action should be idempotent
		await markActionApplied(vault, "inbox/test_instructions.json", "I01");

		const updated = JSON.parse(await vault.read("inbox/test_instructions.json")) as InstructionSet;
		expect(updated.actions[0]?.applied).toBe(true);
	});

	it("does not change applied: false on actions other than the target", async () => {
		const vault = new FakeVaultFS();
		const set = makeInstructionSet([
			makeCreateMoc("I01", false),
			makeCreateMoc("I02"),
		]);
		await seedFile(vault, "inbox/test_instructions.json", set);

		await markActionApplied(vault, "inbox/test_instructions.json", "I02");

		const updated = JSON.parse(await vault.read("inbox/test_instructions.json")) as InstructionSet;
		const i01 = updated.actions.find((a) => a.id === "I01");
		expect(i01?.applied).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// markActionApplied — atomicity
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// markActionsApplied — batch (H5)
// ---------------------------------------------------------------------------

describe("markActionsApplied — batch (H5)", () => {
	it("sets applied:true on every listed id in a single processJSON call", async () => {
		// Pre-fix code did N writes for N applied actions per source — N
		// read+parse+serialize+write cycles serialized through Obsidian's
		// per-path queue. Batch consolidates them.
		const vault = new FakeVaultFS();
		const set = makeInstructionSet([
			makeCreateMoc("I01"),
			makeCreateMoc("I02"),
			makeCreateMoc("I03"),
		]);
		await seedFile(vault, "inbox/batch_instructions.json", set);
		const spy = vi.spyOn(vault, "processJSON");

		await markActionsApplied(vault, "inbox/batch_instructions.json", [
			"I01",
			"I03",
		]);

		expect(spy).toHaveBeenCalledTimes(1);

		const updated = JSON.parse(
			await vault.read("inbox/batch_instructions.json"),
		) as InstructionSet;
		expect(updated.actions.find((a) => a.id === "I01")?.applied).toBe(true);
		expect(updated.actions.find((a) => a.id === "I02")?.applied).toBeUndefined();
		expect(updated.actions.find((a) => a.id === "I03")?.applied).toBe(true);
	});

	it("is a no-op when given an empty id list (no processJSON call)", async () => {
		const vault = new FakeVaultFS();
		const set = makeInstructionSet([makeCreateMoc("I01")]);
		await seedFile(vault, "inbox/batch_instructions.json", set);
		const spy = vi.spyOn(vault, "processJSON");

		await markActionsApplied(vault, "inbox/batch_instructions.json", []);

		expect(spy).not.toHaveBeenCalled();
	});

	it("preserves non-action fields and 2-space indent + trailing newline", async () => {
		const vault = new FakeVaultFS();
		const set = makeInstructionSet([makeCreateMoc("I01"), makeCreateMoc("I02")]);
		await seedFile(vault, "inbox/batch_instructions.json", set);

		await markActionsApplied(vault, "inbox/batch_instructions.json", [
			"I01",
			"I02",
		]);

		const raw = await vault.read("inbox/batch_instructions.json");
		expect(raw.endsWith("\n")).toBe(true);
		expect(raw).toContain('\n  "schema_version"');

		const updated = JSON.parse(raw) as InstructionSet;
		expect(updated.schema_version).toBe("1");
		expect(updated.type).toBe("tomo-instructions");
	});
});

describe("markActionApplied — atomicity", () => {
	it("concurrent writes on different actionIds both appear without overwriting each other", async () => {
		const vault = new FakeVaultFS();
		const set = makeInstructionSet([
			makeMoveNote("I01"),
			makeMoveNote("I02"),
		]);
		await seedFile(vault, "inbox/test_instructions.json", set);

		// Fire both concurrently — FakeVaultFS serializes via per-path Promise queue
		await Promise.all([
			markActionApplied(vault, "inbox/test_instructions.json", "I01"),
			markActionApplied(vault, "inbox/test_instructions.json", "I02"),
		]);

		const updated = JSON.parse(await vault.read("inbox/test_instructions.json")) as InstructionSet;
		const i01 = updated.actions.find((a) => a.id === "I01");
		const i02 = updated.actions.find((a) => a.id === "I02");

		expect(i01?.applied).toBe(true);
		expect(i02?.applied).toBe(true);
	});

	it("concurrent writes on the same actionId result in applied: true (idempotent)", async () => {
		const vault = new FakeVaultFS();
		const set = makeInstructionSet([makeCreateMoc("I01")]);
		await seedFile(vault, "inbox/test_instructions.json", set);

		await Promise.all([
			markActionApplied(vault, "inbox/test_instructions.json", "I01"),
			markActionApplied(vault, "inbox/test_instructions.json", "I01"),
		]);

		const updated = JSON.parse(await vault.read("inbox/test_instructions.json")) as InstructionSet;
		expect(updated.actions[0]?.applied).toBe(true);
	});
});
