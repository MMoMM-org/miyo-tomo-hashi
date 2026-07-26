/**
 * JsonAppliedWriter — atomic, monotonic applied-flag writer.
 *
 * Writes `applied: true` for a single action in a _instructions.json file.
 * Also home to markActionFields (spec 006, T1.2) — the Instruction Fixer's
 * generic whitelisted-field patch writer, kept as a sibling so it reuses
 * the same atomic write path rather than racing this module's applied flush.
 * Uses vault.processJSON to ensure:
 *   - Atomic read-transform-write (concurrent calls serialize via per-path queue)
 *   - 2-space indent + trailing newline on output
 *   - Monotonic: the transform only sets `true`, never unsets it
 *
 * No import 'obsidian' — pure TypeScript on VaultFS port + schema types.
 *
 * [ref: PRD/F5; SDD/Atomic JSON Applied-Flag Write]
 */

import type { Action, InstructionSet } from "../schema/types.js";
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

/**
 * Sibling atomic writer for the Instruction Fixer (spec 006, T1.2): patch
 * arbitrary whitelisted fields on the action identified by `actionId`,
 * reusing this module's single processJSON transform + serialization so the
 * fixer never races the executor's own applied-flag flush (ADR-9).
 *
 * Monotonic like markActionApplied/markActionsApplied: if the target action
 * already has `applied: true`, the patch is not allowed to move it off
 * `true` — not to `false`, and not to `undefined` (which drops the key
 * entirely on serialization; exactOptionalPropertyTypes is off in this
 * repo, so `{ applied: undefined }` is a legal Partial<Action> value with
 * the key present). Other patched fields in the same call still apply.
 *
 * Other actions in the set, and non-action fields on the instruction set,
 * are left untouched.
 */
export async function markActionFields(
	vault: VaultFS,
	sourcePath: string,
	actionId: string,
	patch: Partial<Action>,
): Promise<void> {
	await vault.processJSON<InstructionSet>(sourcePath, (set) => ({
		...set,
		actions: set.actions.map((a): Action => {
			if (a.id !== actionId) return a;
			// `patch` only carries the fields the caller intends to change
			// (id/applied always shared across variants; other keys are
			// only valid when they belong to `a`'s own variant) — the cast
			// documents that this stays within the same Action variant.
			const patched = { ...a, ...patch } as Action;
			if (a.applied === true && patched.applied !== true) {
				return { ...patched, applied: true };
			}
			return patched;
		}),
	}));
}
