/**
 * Public surface of the garden-audit-view module — the registered view-type
 * id, the view class, the tab contract Phase 5 builds to, the opener, and
 * the picker. Mirrors src/ui/suggestions-view/index.ts's re-export shape.
 */

export const VIEW_TYPE_GARDEN_AUDIT_EDITOR = "miyo-garden-audit-editor";

export {
	GardenAuditEditorView,
	type GardenAuditEditorViewDeps,
} from "./GardenAuditEditorView.js";
export type { GardenAuditTabContext, GardenAuditTabSpec } from "./tabContract.js";
export { GardenAuditTab } from "./tabs/GardenAuditTab.js";
export { openGardenAuditEditor } from "./openGardenAuditEditor.js";
export { HOVER_LINK_SOURCE } from "./noteNavigation.js";
export { TomoEditorDocPicker } from "./pickers/TomoEditorDocPicker.js";
