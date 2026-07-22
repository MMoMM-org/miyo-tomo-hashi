/**
 * Public surface of the garden-audit-view module — the registered view-type
 * id, the (Phase-3 placeholder) view class, the opener, and the pickers.
 * Mirrors src/ui/suggestions-view/index.ts's re-export shape.
 */

export const VIEW_TYPE_GARDEN_AUDIT_EDITOR = "miyo-garden-audit-editor";

export {
	GardenAuditEditorView,
	type GardenAuditEditorViewDeps,
} from "./GardenAuditEditorView.js";
export { openGardenAuditEditor } from "./openGardenAuditEditor.js";
export { GardenAuditDocPicker } from "./pickers/GardenAuditDocPicker.js";
export { TomoEditorDocPicker } from "./pickers/TomoEditorDocPicker.js";
