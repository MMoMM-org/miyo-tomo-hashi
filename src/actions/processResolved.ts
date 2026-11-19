/**
 * processResolved — run a content edit inside `vault.process`, resolving the
 * edit on the content process() hands over, and write nothing when it does
 * not resolve (#180).
 *
 * Why it exists: a handler that computes line indexes on an earlier read
 * (`cachedRead`) and splices them into `current` inside process() lands its
 * block at the wrong place, or overwrites the user's lines, when the note
 * changed in between (editor open, sync, a plugin stamping the note). Doing
 * the whole resolve-and-edit in the transform closes that gap. When the edit
 * has an outcome instead of new content (`failed`, `skipped-already`), the
 * transform throws a sentinel, so both Obsidian's process() and FakeVaultFS
 * write nothing.
 *
 * Shared by `insert_under_marker`, `replace_section` and
 * `replace_between_markers`.
 */

import type { ActionOutcome } from "../executor/state.js";
import type { VaultFS } from "../vault/VaultFS.js";

export type EditOutcome = Extract<ActionOutcome, { kind: "applied" | "skipped-already" | "failed" }>;

/** The rewritten content, or the outcome to report without writing. */
export type ResolvedEdit = string | Exclude<EditOutcome, { kind: "applied" }>;

/** Thrown inside the process() callback to abort the write with an outcome. */
class Abort extends Error {
	constructor(readonly outcome: EditOutcome) {
		super(outcome.kind);
	}
}

export async function processResolved(
	vault: Pick<VaultFS, "process">,
	path: string,
	edit: (current: string) => ResolvedEdit,
): Promise<EditOutcome> {
	try {
		await vault.process(path, (current) => {
			const result = edit(current);
			if (typeof result !== "string") throw new Abort(result);
			return result;
		});
	} catch (err) {
		if (err instanceof Abort) return err.outcome;
		throw err;
	}
	return { kind: "applied" };
}
