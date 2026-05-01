import { describe, expect, it } from "vitest";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { skip } from "../../../src/actions/skip.js";
import type { SkipAction } from "../../../src/schema/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeAction = (overrides?: Partial<SkipAction>): SkipAction => ({
	action: "skip",
	id: "test-id-sk-001",
	source_path: "Inbox/some-note.md",
	reason: "not relevant",
	...overrides,
});

const makeCtx = (vault: FakeVaultFS) => ({
	vault,
	clock: { now: () => new Date("2026-04-28T10:00:00Z") },
});

// ---------------------------------------------------------------------------
// skip handler
// ---------------------------------------------------------------------------

describe("skip handler", () => {
	it("always returns { kind: 'applied' }", async () => {
		const vault = new FakeVaultFS();
		const action = makeAction();
		const ctx = makeCtx(vault);

		const outcome = await skip(action, ctx);

		expect(outcome.kind).toBe("applied");
	});

	it("null source_path → still returns applied", async () => {
		const vault = new FakeVaultFS();
		const action = makeAction({ source_path: null });
		const ctx = makeCtx(vault);

		const outcome = await skip(action, ctx);

		expect(outcome.kind).toBe("applied");
	});

	it("makes no vault writes — pre-existing file is unchanged after skip", async () => {
		const vault = new FakeVaultFS();
		await vault.create("Inbox/some-note.md", "# original content");
		const action = makeAction();
		const ctx = makeCtx(vault);

		await skip(action, ctx);

		// File must still exist with unchanged content
		expect(await vault.exists("Inbox/some-note.md")).toBe(true);
		expect(await vault.read("Inbox/some-note.md")).toBe("# original content");
	});

	it("makes no vault writes — vault with no files has no files after skip", async () => {
		const vault = new FakeVaultFS();
		const action = makeAction({ source_path: null, reason: null });
		const ctx = makeCtx(vault);

		await skip(action, ctx);

		// Vault remains empty (source_path is null so nothing should have been touched)
		expect(await vault.exists("Inbox/some-note.md")).toBe(false);
	});
});
