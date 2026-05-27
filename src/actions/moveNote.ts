/**
 * moveNote handler — move a note from its source to its destination path.
 *
 * Delegates to vault.rename (which calls fileManager.renameFile in the
 * Obsidian adapter) so incoming links are preserved.
 *
 * Idempotency matrix:
 *   src ✓  dst ✗ → applied   (createFolder(dirOf(dst)) then rename)
 *   src ✗  dst ✓ → skipped-already
 *   src ✓  dst ✓ → failed    "Inconsistent state — both source and destination present"
 *   src ✗  dst ✗ → failed    "Source missing — nothing to move"
 *
 * [ref: PRD/F4; SDD/Obsidian API Mapping per Action Kind]
 */

import type { MoveNoteAction } from "../schema/types.js";
import type { ActionOutcome } from "../executor/state.js";
import { dirOf, stripTomoFrontmatter, type HandlerContext } from "./types.js";

type MoveOutcome = Extract<ActionOutcome, { kind: "applied" | "skipped-already" | "failed" }>;

export async function moveNote(
	action: MoveNoteAction,
	ctx: HandlerContext,
): Promise<MoveOutcome> {
	const { source, destination } = action;
	const { vault } = ctx;

	const [srcExists, dstExists] = await Promise.all([
		vault.exists(source),
		vault.exists(destination),
	]);

	if (srcExists && dstExists) {
		return { kind: "failed", reason: "Inconsistent state — both source and destination present" };
	}

	if (!srcExists && dstExists) {
		return { kind: "skipped-already" };
	}

	if (!srcExists) {
		return { kind: "failed", reason: "Source missing — nothing to move" };
	}

	const dir = dirOf(destination);
	if (dir !== "") await vault.createFolder(dir);
	await vault.rename(source, destination);
	await vault.process(destination, stripTomoFrontmatter);
	return { kind: "applied" };
}
