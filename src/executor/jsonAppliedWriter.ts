/**
 * JsonAppliedWriter — atomic, monotonic applied-flag writer.
 *
 * Writes `applied: true` for a single action in a _instructions.json file.
 * Uses vault.processJSON to ensure:
 *   - Atomic read-transform-write (concurrent calls serialize via per-path queue)
 *   - 2-space indent + trailing newline on output
 *   - Monotonic: the transform only sets `true`, never unsets it
 *
 * No import 'obsidian' — pure TypeScript on VaultFS port + schema types.
 *
 * [ref: PRD/F5; SDD/Atomic JSON Applied-Flag Write]
 */

import type { InstructionSet } from "../schema/types.js";
import type { VaultFS } from "../vault/VaultFS.js";

/**
 * Set `applied: true` on the action identified by `actionId` in the
 * instruction set at `sourcePath`. The write is atomic and monotonic —
 * other actions are untouched and the flag is never set back to `false`.
 */
export async function markActionApplied(
	vault: VaultFS,
	sourcePath: string,
	actionId: string,
): Promise<void> {
	await vault.processJSON<InstructionSet>(sourcePath, (set) => ({
		...set,
		actions: set.actions.map((a) =>
			a.id === actionId ? { ...a, applied: true } : a,
		),
	}));
}

/**
 * Batched variant: set `applied: true` on every action whose id is in
 * `actionIds`, all in a single atomic processJSON cycle (review H5).
 *
 * Per-action invocation of markActionApplied serializes through Obsidian's
 * per-path queue — N applied actions = N read+parse+serialize+write cycles.
 * The InstructionExecutor accumulates ids during the run and flushes them
 * here once per source after the action loop.
 *
 * No-op when `actionIds` is empty.
 */
export async function markActionsApplied(
	vault: VaultFS,
	sourcePath: string,
	actionIds: ReadonlyArray<string>,
): Promise<void> {
	if (actionIds.length === 0) return;
	const ids = new Set(actionIds);
	await vault.processJSON<InstructionSet>(sourcePath, (set) => ({
		...set,
		actions: set.actions.map((a) =>
			ids.has(a.id) ? { ...a, applied: true } : a,
		),
	}));
}
