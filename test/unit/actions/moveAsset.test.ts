import { describe, expect, it, vi } from "vitest";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { moveAsset } from "../../../src/actions/moveAsset.js";
import type { MoveAssetAction } from "../../../src/schema/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeAction = (overrides?: Partial<MoveAssetAction>): MoveAssetAction => ({
	action: "move_asset",
	id: "I15",
	source: "100 Inbox/foto.png",
	destination: "Atlas/900 Assets/foto.png",
	...overrides,
});

const makeCtx = (vault: FakeVaultFS) => ({
	vault,
	clock: { now: () => new Date("2026-09-01T10:00:00Z") },
});

/** Bytes no UTF-8 decoder round-trips cleanly — a PNG magic number plus a lone
 * 0xFF/0xFE pair. If anything ever reads this file as a string, it changes. */
const BINARY = "\x89PNG\r\n\x1a\n \xff\xfe\x00 raw";

const seed = async (vault: FakeVaultFS, path: string, content = BINARY) => {
	await vault.create(path, content);
};

// ---------------------------------------------------------------------------
// move_asset — idempotency matrix (mirrors move_note)
// ---------------------------------------------------------------------------

describe("moveAsset handler", () => {
	it("source present + target absent → applied; file at target; source absent", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, "100 Inbox/foto.png");

		const outcome = await moveAsset(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		expect(await vault.exists("Atlas/900 Assets/foto.png")).toBe(true);
		expect(await vault.exists("100 Inbox/foto.png")).toBe(false);
	});

	it("source absent + target present → skipped-already (previous run moved it)", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, "Atlas/900 Assets/foto.png");

		expect((await moveAsset(makeAction(), makeCtx(vault))).kind).toBe("skipped-already");
	});

	it("both present → failed; Hashi refuses to choose", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, "100 Inbox/foto.png");
		await seed(vault, "Atlas/900 Assets/foto.png");

		const outcome = await moveAsset(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe(
				"Inconsistent state — both source and destination present",
			);
		}
	});

	it("both absent → failed with source-missing message", async () => {
		const vault = new FakeVaultFS();

		const outcome = await moveAsset(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe("Source missing — nothing to move");
		}
	});

	// -------------------------------------------------------------------------
	// The point of the kind: bytes are never read
	// -------------------------------------------------------------------------

	it("never reads the file — content survives the move byte-identical", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, "100 Inbox/foto.png");
		const processSpy = vi.spyOn(vault, "process");
		const readSpy = vi.spyOn(vault, "read");

		await moveAsset(makeAction(), makeCtx(vault));

		// This is the whole reason move_asset exists as its own kind: move_note
		// strips frontmatter after its rename, which round-trips the content
		// through a UTF-8 string and corrupts binaries.
		expect(processSpy).not.toHaveBeenCalled();
		expect(readSpy).not.toHaveBeenCalled();
		expect(await vault.read("Atlas/900 Assets/foto.png")).toBe(BINARY);
	});

	it("creates the destination folder when it does not exist", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, "foto.png");

		const outcome = await moveAsset(
			makeAction({ source: "foto.png", destination: "Deep/Nested/Path/foto.png" }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		expect(await vault.exists("Deep/Nested/Path/foto.png")).toBe(true);
	});

	// -------------------------------------------------------------------------
	// Attachment-only guard — the other half of move_note's partition
	// -------------------------------------------------------------------------

	it.each([".md", ".canvas", ".base"])("rejects a %s destination", async (ext) => {
		const vault = new FakeVaultFS();
		await seed(vault, "100 Inbox/foto.png");

		const outcome = await moveAsset(
			makeAction({ destination: `Atlas/note${ext}` }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe(
				`move_asset does not handle note files ('.md', '.canvas', '.base'), got: Atlas/note${ext} — use move_note for notes`,
			);
		}
		expect(await vault.exists("100 Inbox/foto.png")).toBe(true);
	});

	it("rejects a note source and leaves it in place", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, "100 Inbox/note.md", "# a real note");

		const outcome = await moveAsset(
			makeAction({ source: "100 Inbox/note.md", destination: "Atlas/note.png" }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toContain("got: 100 Inbox/note.md");
		}
		expect(await vault.read("100 Inbox/note.md")).toBe("# a real note");
	});

	it("names both endpoints when both are notes", async () => {
		const vault = new FakeVaultFS();

		const outcome = await moveAsset(
			makeAction({ source: "a.md", destination: "b.canvas" }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toContain("got: a.md, b.canvas");
		}
	});

	// -------------------------------------------------------------------------
	// Filename safety — same producer contract as move_note
	// -------------------------------------------------------------------------

	it("destination with an illegal char → failed naming the path; source untouched", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, "100 Inbox/foto.png");

		const outcome = await moveAsset(
			makeAction({ destination: "Assets/bad?name.png" }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe(
				"destination filename has illegal character(s) '?': Assets/bad?name.png — producer must emit Obsidian-safe names",
			);
		}
		expect(await vault.exists("100 Inbox/foto.png")).toBe(true);
	});

	it("checks the filename before the extension, so a bad name is reported as such", async () => {
		// Ordering matters for diagnostics: an illegal char in a note-extension
		// path should still name the character, not send the producer chasing
		// the wrong guard.
		const vault = new FakeVaultFS();

		const outcome = await moveAsset(
			makeAction({ destination: "Atlas/bad?name.md" }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toContain("illegal character(s) '?'");
		}
	});
});
