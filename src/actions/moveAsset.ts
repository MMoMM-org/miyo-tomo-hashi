/**
 * moveAsset handler — move an attachment (image, PDF, audio, …) from its
 * source to its destination path.
 *
 * Delegates to vault.rename (which calls fileManager.renameFile in the
 * Obsidian adapter) so embeds and links following the file are rewritten.
 *
 * The one thing this handler does NOT do is read the file. `move_note` strips
 * Tomo's frontmatter after its rename, and that step round-trips the content
 * through a UTF-8 string — which silently replaces invalid byte sequences with
 * U+FFFD on binary content. There is no frontmatter on an attachment to strip,
 * so the bytes are never touched at all.
 *
 * Attachments only: the two move kinds are a strict partition. This handler
 * rejects note paths ('.md', '.canvas', '.base') exactly as move_note rejects
 * attachments, so a producer routing a file to the wrong kind fails loudly in
 * either direction rather than half-working.
 *
 * Idempotency matrix (identical to move_note):
 *   src ✓  dst ✗ → applied   (createFolder(dirOf(dst)) then rename)
 *   src ✗  dst ✓ → skipped-already
 *   src ✓  dst ✓ → failed    "Inconsistent state — both source and destination present"
 *   src ✗  dst ✗ → failed    "Source missing — nothing to move"
 *
 * [ref: PRD/F4; SDD/Obsidian API Mapping per Action Kind]
 */

import type { MoveAssetAction } from "../schema/types.js";
import type { ActionOutcome } from "../executor/state.js";
import {
	findIllegalFilenameChars,
	formatIllegalChars,
	formatNoteExtensions,
	isNotePath,
} from "../util/paths.js";
import { dirOf, type HandlerContext } from "./types.js";

type MoveOutcome = Extract<ActionOutcome, { kind: "applied" | "skipped-already" | "failed" }>;

export async function moveAsset(
	action: MoveAssetAction,
	ctx: HandlerContext,
): Promise<MoveOutcome> {
	const { source, destination } = action;
	const { vault } = ctx;

	// Guard before any vault op: Obsidian's renameFile throws on illegal
	// filename chars (\ / : …), which would otherwise abort the whole run.
	// Same producer contract as move_note — validate and REJECT, never repair,
	// so the verbatim references Tomo emits for this file are never orphaned.
	const illegal = findIllegalFilenameChars(destination);
	if (illegal.length > 0) {
		return {
			kind: "failed",
			reason: `destination filename has illegal character(s) ${formatIllegalChars(illegal)}: ${destination} — producer must emit Obsidian-safe names`,
		};
	}

	// Attachments only — the other half of move_note's partition.
	const notePaths = [source, destination].filter((p) => isNotePath(p));
	if (notePaths.length > 0) {
		return {
			kind: "failed",
			reason: `move_asset does not handle note files (${formatNoteExtensions()}), got: ${notePaths.join(", ")} — use move_note for notes`,
		};
	}

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
	return { kind: "applied" };
}
