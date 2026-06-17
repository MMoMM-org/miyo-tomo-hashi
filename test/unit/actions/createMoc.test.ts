import { describe, expect, it } from "vitest";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { createMoc } from "../../../src/actions/createMoc.js";
import type { CreateMocAction } from "../../../src/schema/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeAction = (overrides?: Partial<CreateMocAction>): CreateMocAction => ({
	action: "create_moc",
	id: "test-id-001",
	source: "Inbox/my-note.md",
	destination: "Atlas/MOC/my-note.md",
	title: "My Note",
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
// create_moc — idempotency matrix
// ---------------------------------------------------------------------------

describe("createMoc handler", () => {
	it("source present + target absent → applied; file at target; source absent", async () => {
		const vault = new FakeVaultFS();
		await seedFile(vault, "Inbox/my-note.md");
		const action = makeAction();
		const ctx = makeCtx(vault);

		const outcome = await createMoc(action, ctx);

		expect(outcome.kind).toBe("applied");
		expect(await vault.exists("Atlas/MOC/my-note.md")).toBe(true);
		expect(await vault.exists("Inbox/my-note.md")).toBe(false);
	});

	it("source absent + target present → skipped-already", async () => {
		const vault = new FakeVaultFS();
		await seedFile(vault, "Atlas/MOC/my-note.md");
		const action = makeAction();
		const ctx = makeCtx(vault);

		const outcome = await createMoc(action, ctx);

		expect(outcome.kind).toBe("skipped-already");
	});

	// F-43 collision-guard wording: when destination already exists, the
	// reason must explicitly reference the destination path so Tomo's
	// error_msg surfaces a clear filename collision to the user.
	it("both source AND target present → failed with destination-collision message", async () => {
		const vault = new FakeVaultFS();
		await seedFile(vault, "Inbox/my-note.md");
		await seedFile(vault, "Atlas/MOC/my-note.md");
		const action = makeAction();
		const ctx = makeCtx(vault);

		const outcome = await createMoc(action, ctx);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe(
				"destination already exists: Atlas/MOC/my-note.md",
			);
		}
	});

	it("destination folder missing → folder created before move → applied", async () => {
		const vault = new FakeVaultFS();
		await seedFile(vault, "Inbox/my-note.md");
		// "Atlas/MOC" folder does NOT exist yet
		const action = makeAction();
		const ctx = makeCtx(vault);

		const outcome = await createMoc(action, ctx);

		expect(outcome.kind).toBe("applied");
		expect(await vault.exists("Atlas/MOC/my-note.md")).toBe(true);
	});

	it("strips tomo: frontmatter block after move", async () => {
		const vault = new FakeVaultFS();
		const content = [
			"---",
			"title: PKM MOC",
			"tomo:",
			"  doc_type: source",
			"  state: captured",
			"---",
			"",
			"# MOC Body",
		].join("\n");
		await seedFile(vault, "Inbox/my-note.md", content);
		const action = makeAction();
		const ctx = makeCtx(vault);

		const outcome = await createMoc(action, ctx);

		expect(outcome.kind).toBe("applied");
		const result = await vault.read("Atlas/MOC/my-note.md");
		expect(result).not.toContain("tomo:");
		expect(result).toContain("title: PKM MOC");
	});

	// Reject-and-report: an illegal filename char in the destination must fail
	// THIS action with the path + culprit named (so the run log is diagnostic)
	// rather than letting Obsidian's renameFile throw and abort the whole run.
	it("destination with illegal char → failed naming the path; source untouched", async () => {
		const vault = new FakeVaultFS();
		await seedFile(vault, "Inbox/my-note.md");
		const action = makeAction({ destination: "Atlas/MOC/10:30 Standup.md" });
		const ctx = makeCtx(vault);

		const outcome = await createMoc(action, ctx);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe(
				"destination filename has illegal character(s) ':': Atlas/MOC/10:30 Standup.md",
			);
		}
		// No move happened — the source is still in place for the user to fix.
		expect(await vault.exists("Inbox/my-note.md")).toBe(true);
	});

	it("source absent + target absent → failed with source-missing message", async () => {
		const vault = new FakeVaultFS();
		const action = makeAction();
		const ctx = makeCtx(vault);

		const outcome = await createMoc(action, ctx);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe("Source missing — nothing to move");
		}
	});
});
