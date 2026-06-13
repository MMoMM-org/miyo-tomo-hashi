/**
 * permanentDeleteWarning — one-shot safety net for `delete_source`.
 *
 * Spec 002 F4 originally guaranteed source files were "never hard-deleted".
 * That guarantee was amended (Kokoro decision 2026-06-12) when the trash
 * call switched to `FileManager.trashFile`, which honors the user's Obsidian
 * "Files & Links → Deleted files" preference — including "Permanently delete".
 *
 * To preserve the spirit of the lost guarantee without overriding the user's
 * explicit deletion preference, Hashi surfaces a ONE-TIME warning the first
 * time a run that contains `delete_source` actions executes while that
 * preference is set to permanent (non-recoverable) deletion. This is a notice,
 * NOT a per-execution prompt and NOT an approval gate — approval already
 * happened upstream in Tomo's instruction-set review step.
 *
 * The gate is a pure decision function: it takes everything it needs as
 * injected callbacks so it is testable without Obsidian or the executor.
 *
 * [ref: Kokoro decision 2026-06-12; Spec 002 F4 trash-semantics amendment]
 */

export const PERMANENT_DELETE_WARNING =
	"Hashi: your Obsidian “Files & Links → Deleted files” preference is set to " +
	"“Permanently delete”. delete_source actions will permanently (non-recoverably) " +
	"delete source files — they will NOT go to the trash. This warning is shown once.";

export interface PermanentDeleteWarningDeps {
	/** True iff the user's "Deleted files" preference is permanent deletion. */
	isPermanent(): boolean;
	/** True iff the one-time warning has already been shown (persisted flag). */
	hasWarned(): boolean;
	/** Persist the one-shot flag so the warning never shows again. */
	markWarned(): Promise<void>;
	/** Surface the warning to the user (Obsidian Notice channel). */
	notify(message: string): void;
}

/**
 * One-shot permanent-delete warning gate.
 *
 * Fires the warning (and persists the one-shot flag) iff ALL hold:
 *   - the run contains at least one `delete_source` action, AND
 *   - the user's "Deleted files" preference is permanent deletion, AND
 *   - the warning has not been shown before.
 *
 * @returns true iff the warning was actually shown this call.
 */
export async function maybeWarnPermanentDelete(
	hasDeleteSource: boolean,
	deps: PermanentDeleteWarningDeps,
): Promise<boolean> {
	if (!hasDeleteSource) return false;
	if (deps.hasWarned()) return false;
	if (!deps.isPermanent()) return false;

	deps.notify(PERMANENT_DELETE_WARNING);
	await deps.markWarned();
	return true;
}
