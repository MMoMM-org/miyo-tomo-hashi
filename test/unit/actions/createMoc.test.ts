import { describe, expect, it, vi } from "vitest";
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
				"destination filename has illegal character(s) ':': Atlas/MOC/10:30 Standup.md — producer must emit Obsidian-safe names",
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

// ---------------------------------------------------------------------------
// Partial vault-write failure (#24, review M23)
//
// The destination folder is created BEFORE the rename. If the rename then
// throws, the folder stays behind: v0.1 has no cleanup or rollback. That is
// pinned here as the intended behaviour — the leftover folder is empty, the
// source is untouched, and the next run retries cleanly (createFolder is
// idempotent), so the leak is harmless.
// ---------------------------------------------------------------------------

describe("createMoc — rename fails after the destination folder was created", () => {
	const SRC = "Inbox/my-note.md";
	const DST = "Atlas/MOC/my-note.md";
	const DST_FOLDER = "Atlas/MOC";

	it("throws, leaves the new folder behind, and keeps the source in place", async () => {
		const vault = new FakeVaultFS();
		await seedFile(vault, SRC);
		vi.spyOn(vault, "rename").mockRejectedValueOnce(new Error("disk full"));

		await expect(createMoc(makeAction({ source: SRC, destination: DST }), makeCtx(vault))).rejects.toThrow("disk full");

		expect(await vault.exists(DST_FOLDER)).toBe(true);
		expect(await vault.list(DST_FOLDER)).toEqual([]);
		expect(await vault.exists(SRC)).toBe(true);
		expect(await vault.exists(DST)).toBe(false);
	});

	it("applies on the next run, reusing the leftover folder", async () => {
		const vault = new FakeVaultFS();
		await seedFile(vault, SRC);
		vi.spyOn(vault, "rename").mockRejectedValueOnce(new Error("disk full"));
		const action = makeAction({ source: SRC, destination: DST });
		await expect(createMoc(action, makeCtx(vault))).rejects.toThrow();

		const outcome = await createMoc(action, makeCtx(vault));

		expect(outcome).toEqual({ kind: "applied" });
		expect(await vault.exists(DST)).toBe(true);
		expect(await vault.exists(SRC)).toBe(false);
	});
});
