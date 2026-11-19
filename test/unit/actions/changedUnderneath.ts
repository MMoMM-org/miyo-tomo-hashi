/**
 * Race-test helper for the content-editing handlers (#180, #183).
 *
 * Builds a FakeVaultFS whose `process()` hands the transform `mutate(current)`,
 * as if the note changed after any earlier read (editor open, sync, another
 * plugin). A handler that resolves on that earlier read lands its edit at the
 * wrong line; one that resolves inside process() does not.
 */

import { vi } from "vitest";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";

export async function changedUnderneath(
	path: string,
	initial: string,
	mutate: (current: string) => string,
): Promise<FakeVaultFS> {
	const vault = new FakeVaultFS();
	await vault.create(path, initial);
	const realProcess = vault.process.bind(vault);
	vi.spyOn(vault, "process").mockImplementation(async (p, transform) => {
		await realProcess(p, (current) => transform(mutate(current)));
	});
	return vault;
}
