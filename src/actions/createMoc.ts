/**
 * createMoc handler — move + rename a source file to its MOC destination.
 *
 * Delegates to vault.rename (which calls fileManager.renameFile in the
 * Obsidian adapter) so incoming links are preserved.
 *
 * Idempotency matrix:
 *   src ✓  dst ✗ → applied   (createFolder(dirOf(dst)) then rename)
 *   src ✗  dst ✓ → skipped-already
 *   src ✓  dst ✓ → failed    "destination already exists: <path>"
 *   src ✗  dst ✗ → failed    "Source missing — nothing to move"
 *
 * The src ✓ + dst ✓ branch is also F-43's destination-collision guard: a
 * pre-write existence check that fails with a clear message so dependent
 * link_to_moc / add_relationship actions cascade via the planner's
 * dependency graph (no partial application of a MOC and its links).
 *
 * [ref: PRD/F4; SDD/Obsidian API Mapping per Action Kind]
 */

import type { CreateMocAction } from "../schema/types.js";
import type { ActionOutcome } from "../executor/state.js";
import { dirOf, stripTomoFrontmatter, type HandlerContext } from "./types.js";

type MoveOutcome = Extract<ActionOutcome, { kind: "applied" | "skipped-already" | "failed" }>;

export async function createMoc(
	action: CreateMocAction,
	ctx: HandlerContext,
): Promise<MoveOutcome> {
	const { source, destination } = action;
	const { vault } = ctx;

	const [srcExists, dstExists] = await Promise.all([
		vault.exists(source),
		vault.exists(destination),
	]);

	if (srcExists && dstExists) {
		return { kind: "failed", reason: `destination already exists: ${destination}` };
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
