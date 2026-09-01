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

	// -------------------------------------------------------------------------
	// Note-only guard — move_note refuses attachments (they belong to
	// move_asset). The rejection matters more than it looks: the handler used
	// to run `vault.process` on whatever it moved, which reads the file as a
	// UTF-8 string and writes it back — silent binary corruption reported as
	// `applied`. These tests are that corruption guard.
	// -------------------------------------------------------------------------

	it("attachment destination → failed naming the path and the allowed set", async () => {
		const vault = new FakeVaultFS();
		await seedFile(vault, "Inbox/photo.png", "\x89PNG\r\n\x1a\n binary");
		const action = makeAction({
			source: "Inbox/photo.png",
			destination: "Assets/photo.png",
		});
		const ctx = makeCtx(vault);

		const outcome = await moveNote(action, ctx);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe(
				"move_note only handles note files ('.md', '.canvas', '.base'), got: Inbox/photo.png, Assets/photo.png — use move_asset for attachments",
			);
		}
	});

	it("attachment source is left byte-identical and unmoved", async () => {
		const vault = new FakeVaultFS();
		const bytes = "\x89PNG\r\n\x1a\n \xff\xfe not valid utf-8";
		await seedFile(vault, "Inbox/photo.png", bytes);
		const action = makeAction({
			source: "Inbox/photo.png",
			destination: "Assets/photo.png",
		});

		await moveNote(action, makeCtx(vault));

		expect(await vault.exists("Inbox/photo.png")).toBe(true);
		expect(await vault.exists("Assets/photo.png")).toBe(false);
		expect(await vault.read("Inbox/photo.png")).toBe(bytes);
	});

	it("rejects when only one endpoint is a note, naming just that endpoint", async () => {
		const vault = new FakeVaultFS();
		await seedFile(vault, "Inbox/raw-note.md");
		const action = makeAction({ destination: "Assets/raw-note.pdf" });

		const outcome = await moveNote(action, makeCtx(vault));

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toContain("got: Assets/raw-note.pdf");
			expect(outcome.reason).not.toContain("Inbox/raw-note.md");
		}
	});

	it.each([".canvas", ".base"])(
		"moves a %s file and leaves its bytes untouched (no frontmatter strip)",
		async (ext) => {
			const vault = new FakeVaultFS();
			// A .base is YAML and legitimately opens with `---`, which is exactly
			// what stripTomoFrontmatter keys on — running it here would eat the
			// document's own opening marker.
			const body = "---\ntomo: keep-me\nfilters: []\n---\nbody\n";
			await seedFile(vault, `Inbox/thing${ext}`, body);
			const action = makeAction({
				source: `Inbox/thing${ext}`,
				destination: `Notes/thing${ext}`,
			});

			const outcome = await moveNote(action, makeCtx(vault));

			expect(outcome.kind).toBe("applied");
			expect(await vault.read(`Notes/thing${ext}`)).toBe(body);
		},
	);

	it("still strips tomo frontmatter from a moved .md", async () => {
		const vault = new FakeVaultFS();
		await seedFile(vault, "Inbox/raw-note.md", "---\ntomo: drop-me\ntitle: Keep\n---\nbody\n");
		const action = makeAction();

		const outcome = await moveNote(action, makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		const moved = await vault.read("Notes/Projects/raw-note.md");
		expect(moved).not.toContain("tomo:");
		expect(moved).toContain("title: Keep");
	});

	it("accepts an uppercase extension (Obsidian preserves case)", async () => {
		const vault = new FakeVaultFS();
		await seedFile(vault, "Inbox/Raw-Note.MD");
		const action = makeAction({
			source: "Inbox/Raw-Note.MD",
			destination: "Notes/Raw-Note.MD",
		});

		expect((await moveNote(action, makeCtx(vault))).kind).toBe("applied");
	});
});
