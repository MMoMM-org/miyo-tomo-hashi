/**
 * processResolved tests (#180).
 *
 * The helper runs a handler's resolve-and-edit inside `vault.process`: new
 * content is written and reported `applied`; an outcome (`failed`,
 * `skipped-already`) aborts the write and is returned as is; any other error
 * propagates unchanged rather than turning into an outcome.
 */

import { describe, expect, it } from "vitest";

import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { processResolved } from "../../../src/actions/processResolved.js";

const PATH = "Notes/a.md";

async function vaultWith(content: string) {
	const vault = new FakeVaultFS();
	await vault.create(PATH, content);
	return vault;
}

describe("processResolved", () => {
	it("writes the edited content and reports applied", async () => {
		const vault = await vaultWith("old");

		const outcome = await processResolved(vault, PATH, (current) => `${current} + new`);

		expect(outcome).toEqual({ kind: "applied" });
		expect(await vault.read(PATH)).toBe("old + new");
	});

	it("hands the edit the content process() sees", async () => {
		const vault = await vaultWith("current");
		const seen: string[] = [];

		await processResolved(vault, PATH, (current) => {
			seen.push(current);
			return current;
		});

		expect(seen).toEqual(["current"]);
	});

	it("returns a failed outcome and writes nothing", async () => {
		const vault = await vaultWith("old");

		const outcome = await processResolved(vault, PATH, () => ({
			kind: "failed",
			reason: "anchor not found: X",
		}));

		expect(outcome).toEqual({ kind: "failed", reason: "anchor not found: X" });
		expect(await vault.read(PATH)).toBe("old");
	});

	it("returns skipped-already and writes nothing", async () => {
		const vault = await vaultWith("old");

		const outcome = await processResolved(vault, PATH, () => ({ kind: "skipped-already" }));

		expect(outcome).toEqual({ kind: "skipped-already" });
		expect(await vault.read(PATH)).toBe("old");
	});

	it("propagates any other error from the edit", async () => {
		const vault = await vaultWith("old");

		await expect(
			processResolved(vault, PATH, () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(await vault.read(PATH)).toBe("old");
	});
});
