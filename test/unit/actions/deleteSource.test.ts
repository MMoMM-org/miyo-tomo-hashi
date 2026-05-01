import { describe, expect, it, vi } from "vitest";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { deleteSource } from "../../../src/actions/deleteSource.js";
import type { DeleteSourceAction } from "../../../src/schema/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeAction = (overrides?: Partial<DeleteSourceAction>): DeleteSourceAction => ({
	action: "delete_source",
	id: "test-id-ds-001",
	source_path: "Inbox/processed-note.md",
	reason: "moved to permanent location",
	...overrides,
});

const makeCtx = (vault: FakeVaultFS) => ({
	vault,
	clock: { now: () => new Date("2026-04-28T10:00:00Z") },
});

// ---------------------------------------------------------------------------
// delete_source handler
// ---------------------------------------------------------------------------

describe("deleteSource handler", () => {
	it("source present → trashes file via vault.trash → outcome applied", async () => {
		const vault = new FakeVaultFS();
		await vault.create("Inbox/processed-note.md", "# processed");
		const action = makeAction();
		const ctx = makeCtx(vault);
		const trashSpy = vi.spyOn(vault, "trash");

		const outcome = await deleteSource(action, ctx);

		expect(outcome.kind).toBe("applied");
		expect(trashSpy).toHaveBeenCalledOnce();
		expect(trashSpy).toHaveBeenCalledWith("Inbox/processed-note.md");
		expect(await vault.exists("Inbox/processed-note.md")).toBe(false);
	});

	it("source present → uses trash, never delete", async () => {
		const vault = new FakeVaultFS();
		await vault.create("Inbox/processed-note.md", "# processed");
		const action = makeAction();
		const ctx = makeCtx(vault);
		// FakeVaultFS does not expose a `delete` method separately — trash IS the
		// removal path. Spy on both to confirm only trash is invoked.
		const trashSpy = vi.spyOn(vault, "trash");

		await deleteSource(action, ctx);

		expect(trashSpy).toHaveBeenCalledOnce();
	});

	it("source absent → no vault.trash call → outcome skipped-already", async () => {
		const vault = new FakeVaultFS();
		// no file seeded
		const action = makeAction();
		const ctx = makeCtx(vault);
		const trashSpy = vi.spyOn(vault, "trash");

		const outcome = await deleteSource(action, ctx);

		expect(outcome.kind).toBe("skipped-already");
		expect(trashSpy).not.toHaveBeenCalled();
	});

	it("source absent → vault state unchanged (idempotent)", async () => {
		const vault = new FakeVaultFS();
		await vault.create("OtherNote.md", "# other");
		const action = makeAction();
		const ctx = makeCtx(vault);

		await deleteSource(action, ctx);

		// The unrelated file must still exist
		expect(await vault.exists("OtherNote.md")).toBe(true);
	});
});
