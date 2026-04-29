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
