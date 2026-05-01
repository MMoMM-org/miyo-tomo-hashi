/**
 * Shared callback shape passed from ExecutionModal into each subview.
 *
 * Subviews are pure DOM render functions — they only invoke the modal's
 * action handlers via these callbacks. The modal owns the meaning of each
 * action (e.g., during preview, Cancel does NOT call executor.cancel; during
 * running it does).
 *
 * [ref: SDD/ADR-5]
 */

export interface ModalCallbacks {
	onExecute?: () => void;
	onCancel?: () => void;
	onClose?: () => void;
	/**
	 * Fired when the user clicks "View errors" on the summary view. Receives
	 * the run log's vault-relative path (or null if retention is set to
	 * `only-after-failed-runs` AND the run had no failures — in practice the
	 * button is only rendered when failed > 0, but logFilePath can still be
	 * null in degraded scenarios).
	 */
	onViewErrors?: (logFilePath: string | null) => void;
}
