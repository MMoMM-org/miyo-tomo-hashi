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
	onViewErrors?: () => void;
}
