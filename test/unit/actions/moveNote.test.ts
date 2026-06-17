import { describe, expect, it } from "vitest";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { moveNote } from "../../../src/actions/moveNote.js";
import type { MoveNoteAction } from "../../../src/schema/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeAction = (overrides?: Partial<MoveNoteAction>): MoveNoteAction => ({
	action: "move_note",
	id: "test-id-002",
	source: "Inbox/raw-note.md",
	destination: "Notes/Projects/raw-note.md",
	title: "Raw Note",
	...overrides,
});

const makeCtx = (vault: FakeVaultFS) => ({
	vault,
	clock: { now: () => new Date("2026-04-28T10:00:00Z") },
});

const seedFile = async (vault: FakeVaultFS, path: string, content = "# content") => {
	await vault.create(path, content);
};

// ---------------------------------------------------------------------------
// move_note — idempotency matrix
// ---------------------------------------------------------------------------

describe("moveNote handler", () => {
	it("source present + target absent → applied; file at target; source absent", async () => {
		const vault = new FakeVaultFS();
		await seedFile(vault, "Inbox/raw-note.md");
		const action = makeAction();
		const ctx = makeCtx(vault);

		const outcome = await moveNote(action, ctx);

		expect(outcome.kind).toBe("applied");
		expect(await vault.exists("Notes/Projects/raw-note.md")).toBe(true);
		expect(await vault.exists("Inbox/raw-note.md")).toBe(false);
	});

	it("source absent + target present → skipped-already", async () => {
		const vault = new FakeVaultFS();
		await seedFile(vault, "Notes/Projects/raw-note.md");
		const action = makeAction();
		const ctx = makeCtx(vault);

		const outcome = await moveNote(action, ctx);

		expect(outcome.kind).toBe("skipped-already");
	});

	it("both source AND target present → failed with inconsistent-state message", async () => {
		const vault = new FakeVaultFS();
		await seedFile(vault, "Inbox/raw-note.md");
		await seedFile(vault, "Notes/Projects/raw-note.md");
		const action = makeAction();
		const ctx = makeCtx(vault);

		const outcome = await moveNote(action, ctx);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe(
				"Inconsistent state — both source and destination present",
			);
		}
	});

	it("destination folder missing → folder created before move → applied", async () => {
		const vault = new FakeVaultFS();
		await seedFile(vault, "Inbox/raw-note.md");
		// "Notes/Projects" folder does NOT exist yet
		const action = makeAction();
		const ctx = makeCtx(vault);

		const outcome = await moveNote(action, ctx);

		expect(outcome.kind).toBe("applied");
		expect(await vault.exists("Notes/Projects/raw-note.md")).toBe(true);
	});

	it("strips tomo: frontmatter block after move", async () => {
		const vault = new FakeVaultFS();
		const content = [
			"---",
			"title: Test Note",
			"tomo:",
			"  doc_type: source",
			"  state: captured",
			"  run_id: abc-123",
			"tags:",
			"  - topic/test",
			"---",
			"",
			"# Body",
		].join("\n");
		await seedFile(vault, "Inbox/raw-note.md", content);
		const action = makeAction();
		const ctx = makeCtx(vault);

		const outcome = await moveNote(action, ctx);

		expect(outcome.kind).toBe("applied");
		const result = await vault.read("Notes/Projects/raw-note.md");
		expect(result).not.toContain("tomo:");
		expect(result).not.toContain("doc_type");
		expect(result).toContain("title: Test Note");
		expect(result).toContain("tags:");
	});

	// Reject-and-report: an illegal filename char in the destination must fail
	// THIS action with the path + culprit named rather than letting Obsidian's
	// renameFile throw and abort the whole run.
	it("destination with illegal char → failed naming the path; source untouched", async () => {
		const vault = new FakeVaultFS();
		await seedFile(vault, "Inbox/raw-note.md");
		const action = makeAction({ destination: "Notes/bad?name.md" });
		const ctx = makeCtx(vault);

		const outcome = await moveNote(action, ctx);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe(
				"destination filename has illegal character(s) '?': Notes/bad?name.md — producer must emit Obsidian-safe names",
			);
		}
		expect(await vault.exists("Inbox/raw-note.md")).toBe(true);
	});

	it("source absent + target absent → failed with source-missing message", async () => {
		const vault = new FakeVaultFS();
		const action = makeAction();
		const ctx = makeCtx(vault);

		const outcome = await moveNote(action, ctx);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe("Source missing — nothing to move");
		}
	});
});
