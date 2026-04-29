/**
 * T4.1 — Planner tests (RED phase)
 *
 * Covers:
 *   - resolveSingle: .md peer → sibling _instructions.json; .json → itself; unrelated → null; .md with no sibling → null
 *   - resolveBatch: alphabetical list; empty folder → empty array; missing folder → InboxNotFoundError
 *   - computeRemaining: canonical order within file; monotonic I## within kind; applied filter; fileId/summary populated
 *   - DependencyEdge: in-set link_to_moc → create_moc edge; cross-set NOT built
 *
 * [ref: PRD/F1, F6; SDD/Runtime View; Primary Flow]
 */

import { describe, expect, it } from "vitest";

import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import {
	InboxNotFoundError,
	computeRemaining,
	resolveBatch,
	resolveSingle,
} from "../../../src/executor/planner.js";
import type { ResolvedSource } from "../../../src/executor/state.js";
import type {
	Action,
	CreateMocAction,
	InstructionSet,
	LinkToMocAction,
	MoveNoteAction,
} from "../../../src/schema/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInstructionSet(actions: Action[] = []): InstructionSet {
	return {
		schema_version: "1",
		type: "tomo-instructions",
		generated: "2026-04-28T10:00:00Z",
		profile: null,
		actions,
	};
}

function makeResolvedSource(
	fileId: string,
	sourcePath: string,
	actions: Action[] = [],
): ResolvedSource {
	return {
		fileId,
		sourcePath,
		instructionSet: makeInstructionSet(actions),
	};
}

function makeCreateMoc(id: string, source: string, destination: string, applied?: boolean): CreateMocAction {
	return {
		action: "create_moc",
		id,
		source,
		destination,
		title: `MOC for ${id}`,
		...(applied !== undefined ? { applied } : {}),
	};
}

function makeMoveNote(id: string, source: string, destination: string, applied?: boolean): MoveNoteAction {
	return {
		action: "move_note",
		id,
		source,
		destination,
		title: `Note ${id}`,
		...(applied !== undefined ? { applied } : {}),
	};
}

function makeLinkToMoc(id: string, targetMoc: string, lineToAdd: string, targetMocPath?: string, applied?: boolean): LinkToMocAction {
	return {
		action: "link_to_moc",
		id,
		target_moc: targetMoc,
		line_to_add: lineToAdd,
		...(targetMocPath !== undefined ? { target_moc_path: targetMocPath } : {}),
		...(applied !== undefined ? { applied } : {}),
	};
}

async function seedInstructionSet(
	vault: FakeVaultFS,
	path: string,
	actions: Action[] = [],
): Promise<void> {
	await vault.create(path, JSON.stringify(makeInstructionSet(actions), null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// resolveSingle
// ---------------------------------------------------------------------------

describe("resolveSingle", () => {
	it("given an .md peer whose sibling _instructions.json exists, returns the json path", async () => {
		const vault = new FakeVaultFS();
		await seedInstructionSet(vault, "inbox/2026-04-28_instructions.json");
		await vault.create("inbox/2026-04-28_instructions.md", "# peer");

		const result = await resolveSingle(vault, "inbox/2026-04-28_instructions.md");

		expect(result).toBe("inbox/2026-04-28_instructions.json");
	});

	it("given a _instructions.json path that exists, returns it directly", async () => {
		const vault = new FakeVaultFS();
		await seedInstructionSet(vault, "inbox/2026-04-28_instructions.json");

		const result = await resolveSingle(vault, "inbox/2026-04-28_instructions.json");

		expect(result).toBe("inbox/2026-04-28_instructions.json");
	});

	it("given an unrelated file path, returns null", async () => {
		const vault = new FakeVaultFS();
		await vault.create("Notes/some-note.md", "# random note");

		const result = await resolveSingle(vault, "Notes/some-note.md");

		expect(result).toBeNull();
	});

	it("given an .md peer whose sibling _instructions.json does not exist, returns null", async () => {
		const vault = new FakeVaultFS();
		await vault.create("inbox/2026-04-28_instructions.md", "# peer without json sibling");
		// deliberately NOT creating the .json sibling

		const result = await resolveSingle(vault, "inbox/2026-04-28_instructions.md");

		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// resolveBatch
// ---------------------------------------------------------------------------

describe("resolveBatch", () => {
	it("returns all _instructions.json files in alphabetical order", async () => {
		const vault = new FakeVaultFS();
		await seedInstructionSet(vault, "inbox/2026-04-28_instructions.json");
		await seedInstructionSet(vault, "inbox/2026-04-22_instructions.json");
		await seedInstructionSet(vault, "inbox/2026-04-25_instructions.json");
		// non-instructions files should be excluded
		await vault.create("inbox/notes.md", "# not instructions");
		await vault.create("inbox/2026-04-27_other.json", '{"not": "instructions"}');

		const result = await resolveBatch(vault, "inbox");

		expect(result).toEqual([
			"inbox/2026-04-22_instructions.json",
			"inbox/2026-04-25_instructions.json",
			"inbox/2026-04-28_instructions.json",
		]);
	});

	it("returns empty array when inbox folder exists but contains no _instructions.json files", async () => {
		const vault = new FakeVaultFS();
		await vault.create("inbox/some-log.md", "# log");
		await vault.create("inbox/notes.json", '{"not": "instructions"}');

		const result = await resolveBatch(vault, "inbox");

		expect(result).toEqual([]);
	});

	it("throws InboxNotFoundError when the folder does not exist", async () => {
		const vault = new FakeVaultFS();

		await expect(resolveBatch(vault, "non-existent-inbox")).rejects.toThrow(
			InboxNotFoundError,
		);
	});

	it("InboxNotFoundError carries the folder path", async () => {
		const vault = new FakeVaultFS();

		try {
			await resolveBatch(vault, "missing/folder");
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(InboxNotFoundError);
			expect((err as InboxNotFoundError).folder).toBe("missing/folder");
		}
	});
});

// ---------------------------------------------------------------------------
// computeRemaining — canonical order
// ---------------------------------------------------------------------------

describe("computeRemaining — canonical order", () => {
	it("applies canonical order: create_moc → move_note → link_to_moc across actions in a file", () => {
		const actions: Action[] = [
			makeLinkToMoc("I03", "moc/MyMOC.md", "- [[note]]"),
			makeCreateMoc("I01", "inbox/note.md", "moc/MyMOC.md"),
			makeMoveNote("I02", "inbox/note2.md", "notes/note2.md"),
		];
		const sources = [makeResolvedSource("file.json", "inbox/file.json", actions)];

		const { records } = computeRemaining(sources);

		const kinds = records.map((r) => r.kind);
		expect(kinds).toEqual(["create_moc", "move_note", "link_to_moc"]);
	});

	it("preserves monotonic I## order within each kind", () => {
		const actions: Action[] = [
			makeCreateMoc("I03", "inbox/note3.md", "moc/C.md"),
			makeCreateMoc("I01", "inbox/note1.md", "moc/A.md"),
			makeCreateMoc("I02", "inbox/note2.md", "moc/B.md"),
		];
		const sources = [makeResolvedSource("file.json", "inbox/file.json", actions)];

		const { records } = computeRemaining(sources);

		const ids = records.map((r) => r.id);
		expect(ids).toEqual(["I01", "I02", "I03"]);
	});

	it("filters out actions with applied: true from the execution list", () => {
		const actions: Action[] = [
			makeCreateMoc("I01", "inbox/note1.md", "moc/A.md", true),
			makeCreateMoc("I02", "inbox/note2.md", "moc/B.md", false),
			makeCreateMoc("I03", "inbox/note3.md", "moc/C.md"),
		];
		const sources = [makeResolvedSource("file.json", "inbox/file.json", actions)];

		const { records } = computeRemaining(sources);

		expect(records).toHaveLength(2);
		expect(records.map((r) => r.id)).toEqual(["I02", "I03"]);
	});

	it("populates fileId on each ActionRecord", () => {
		const actions: Action[] = [makeCreateMoc("I01", "inbox/note1.md", "moc/A.md")];
		const sources = [makeResolvedSource("my-file.json", "inbox/my-file.json", actions)];

		const { records } = computeRemaining(sources);

		expect(records[0]?.fileId).toBe("my-file.json");
	});

	it("populates summary on each ActionRecord with a non-empty string", () => {
		const actions: Action[] = [makeCreateMoc("I01", "inbox/note1.md", "moc/A.md")];
		const sources = [makeResolvedSource("file.json", "inbox/file.json", actions)];

		const { records } = computeRemaining(sources);

		expect(typeof records[0]?.summary).toBe("string");
		expect(records[0]!.summary.length).toBeGreaterThan(0);
	});

	it("sets outcome to null on new records", () => {
		const actions: Action[] = [makeCreateMoc("I01", "inbox/note1.md", "moc/A.md")];
		const sources = [makeResolvedSource("file.json", "inbox/file.json", actions)];

		const { records } = computeRemaining(sources);

		expect(records[0]?.outcome).toBeNull();
	});

	it("returns empty records when all actions are applied", () => {
		const actions: Action[] = [
			makeCreateMoc("I01", "inbox/note1.md", "moc/A.md", true),
			makeMoveNote("I02", "inbox/note2.md", "notes/note2.md", true),
		];
		const sources = [makeResolvedSource("file.json", "inbox/file.json", actions)];

		const { records } = computeRemaining(sources);

		expect(records).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// computeRemaining — batch (multiple files)
// ---------------------------------------------------------------------------

describe("computeRemaining — batch file ordering", () => {
	it("processes files in alphabetical order by fileId, canonical order within each file", () => {
		const actionsA: Action[] = [makeMoveNote("I01", "inbox/n1.md", "notes/n1.md")];
		const actionsB: Action[] = [makeCreateMoc("I01", "inbox/n2.md", "moc/B.md")];
		// b-file comes before a-file alphabetically → a-file actions first since "a" < "b"
		const sources = [
			makeResolvedSource("b-file.json", "inbox/b-file.json", actionsB),
			makeResolvedSource("a-file.json", "inbox/a-file.json", actionsA),
		];

		const { records } = computeRemaining(sources);

		// a-file processed first (alphabetical), b-file second
		// a-file has move_note; b-file has create_moc
		// Within each file canonical order is applied, but files themselves are alphabetical
		expect(records[0]?.fileId).toBe("a-file.json");
		expect(records[1]?.fileId).toBe("b-file.json");
	});

	it("returns records across multiple files with correct fileIds", () => {
		const actionsA: Action[] = [makeCreateMoc("I01", "inbox/n1.md", "moc/A.md")];
		const actionsB: Action[] = [makeMoveNote("I01", "inbox/n2.md", "notes/n2.md")];
		const sources = [
			makeResolvedSource("a-file.json", "inbox/a-file.json", actionsA),
			makeResolvedSource("b-file.json", "inbox/b-file.json", actionsB),
		];

		const { records } = computeRemaining(sources);

		expect(records).toHaveLength(2);
		expect(records.map((r) => r.fileId)).toEqual(["a-file.json", "b-file.json"]);
	});
});

// ---------------------------------------------------------------------------
// computeRemaining — summary strings
// ---------------------------------------------------------------------------

describe("computeRemaining — summary strings", () => {
	it("create_moc summary contains source and destination", () => {
		const actions: Action[] = [makeCreateMoc("I01", "inbox/note.md", "moc/MyMOC.md")];
		const sources = [makeResolvedSource("file.json", "inbox/file.json", actions)];

		const { records } = computeRemaining(sources);

		expect(records[0]?.summary).toContain("inbox/note.md");
		expect(records[0]?.summary).toContain("moc/MyMOC.md");
	});

	it("move_note summary contains source and destination", () => {
		const actions: Action[] = [makeMoveNote("I01", "inbox/note.md", "notes/note.md")];
		const sources = [makeResolvedSource("file.json", "inbox/file.json", actions)];

		const { records } = computeRemaining(sources);

		expect(records[0]?.summary).toContain("inbox/note.md");
		expect(records[0]?.summary).toContain("notes/note.md");
	});

	it("link_to_moc summary contains target_moc and line_to_add", () => {
		const actions: Action[] = [makeLinkToMoc("I01", "moc/MyMOC.md", "- [[note]]")];
		const sources = [makeResolvedSource("file.json", "inbox/file.json", actions)];

		const { records } = computeRemaining(sources);

		expect(records[0]?.summary).toContain("moc/MyMOC.md");
		expect(records[0]?.summary).toContain("- [[note]]");
	});
});

// ---------------------------------------------------------------------------
// computeRemaining — dependency graph
// ---------------------------------------------------------------------------

describe("computeRemaining — dependency graph", () => {
	it("builds an in-set dependency edge when link_to_moc target matches create_moc destination", () => {
		const actions: Action[] = [
			makeCreateMoc("I01", "inbox/note.md", "moc/MyMOC.md"),
			makeLinkToMoc("I02", "MyMOC", "- [[note]]", "moc/MyMOC.md"),
		];
		const sources = [makeResolvedSource("file.json", "inbox/file.json", actions)];

		const { dependencies } = computeRemaining(sources);

		expect(dependencies).toHaveLength(1);
		expect(dependencies[0]?.dependent).toBe("I02");
		expect(dependencies[0]?.dependsOn).toBe("I01");
	});

	it("uses target_moc_path (preferred) over target_moc for dependency matching", () => {
		const actions: Action[] = [
			makeCreateMoc("I01", "inbox/note.md", "moc/MyMOC.md"),
			// target_moc_path matches destination → dependency edge formed
			makeLinkToMoc("I02", "SomeOtherName", "- [[note]]", "moc/MyMOC.md"),
		];
		const sources = [makeResolvedSource("file.json", "inbox/file.json", actions)];

		const { dependencies } = computeRemaining(sources);

		expect(dependencies).toHaveLength(1);
		expect(dependencies[0]?.dependent).toBe("I02");
	});

	it("falls back to target_moc when target_moc_path is absent and destination matches", () => {
		const actions: Action[] = [
			makeCreateMoc("I01", "inbox/note.md", "moc/MyMOC.md"),
			makeLinkToMoc("I02", "moc/MyMOC.md", "- [[note]]"),
		];
		const sources = [makeResolvedSource("file.json", "inbox/file.json", actions)];

		const { dependencies } = computeRemaining(sources);

		expect(dependencies).toHaveLength(1);
		expect(dependencies[0]?.dependent).toBe("I02");
		expect(dependencies[0]?.dependsOn).toBe("I01");
	});

	it("does NOT build a dependency edge when MOC paths do not match", () => {
		const actions: Action[] = [
			makeCreateMoc("I01", "inbox/note.md", "moc/DifferentMOC.md"),
			makeLinkToMoc("I02", "moc/MyMOC.md", "- [[note]]", "moc/MyMOC.md"),
		];
		const sources = [makeResolvedSource("file.json", "inbox/file.json", actions)];

		const { dependencies } = computeRemaining(sources);

		expect(dependencies).toHaveLength(0);
	});

	it("does NOT build cross-file dependency edges", () => {
		// create_moc in file A, link_to_moc in file B — cross-set, NOT a dependency
		const actionsA: Action[] = [makeCreateMoc("I01", "inbox/note.md", "moc/MyMOC.md")];
		const actionsB: Action[] = [makeLinkToMoc("I01", "moc/MyMOC.md", "- [[note]]", "moc/MyMOC.md")];
		const sources = [
			makeResolvedSource("a-file.json", "inbox/a-file.json", actionsA),
			makeResolvedSource("b-file.json", "inbox/b-file.json", actionsB),
		];

		const { dependencies } = computeRemaining(sources);

		expect(dependencies).toHaveLength(0);
	});

	it("returns empty dependencies when no link_to_moc matches any create_moc", () => {
		const actions: Action[] = [
			makeCreateMoc("I01", "inbox/note.md", "moc/A.md"),
			makeLinkToMoc("I02", "moc/UnrelatedMOC.md", "- [[note]]", "moc/UnrelatedMOC.md"),
		];
		const sources = [makeResolvedSource("file.json", "inbox/file.json", actions)];

		const { dependencies } = computeRemaining(sources);

		expect(dependencies).toHaveLength(0);
	});

	it("builds multiple dependency edges when multiple link_to_moc actions reference the same create_moc", () => {
		const actions: Action[] = [
			makeCreateMoc("I01", "inbox/note.md", "moc/MyMOC.md"),
			makeLinkToMoc("I02", "moc/MyMOC.md", "- [[note1]]", "moc/MyMOC.md"),
			makeLinkToMoc("I03", "moc/MyMOC.md", "- [[note2]]", "moc/MyMOC.md"),
		];
		const sources = [makeResolvedSource("file.json", "inbox/file.json", actions)];

		const { dependencies } = computeRemaining(sources);

		expect(dependencies).toHaveLength(2);
		const dependents = dependencies.map((d) => d.dependent).sort();
		expect(dependents).toEqual(["I02", "I03"]);
		expect(dependencies.every((d) => d.dependsOn === "I01")).toBe(true);
	});
});
