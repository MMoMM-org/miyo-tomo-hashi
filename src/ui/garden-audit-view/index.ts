/**
 * Public surface of the garden-audit-view module (spec-005 Phase 3, T3.2).
 * Mirrors src/ui/suggestions-view/index.ts's re-export shape.
 *
 * `VIEW_TYPE_GARDEN_AUDIT_EDITOR` is exported here first (Phase 3, T3.2)
 * because `openGardenAuditEditor` needs it to address the leaf; the view
 * class itself is a Phase-3 T3.3 placeholder (body filled in Phase 4) and is
 * re-exported here once it exists.
 */

export const VIEW_TYPE_GARDEN_AUDIT_EDITOR = "miyo-garden-audit-editor";

export { openGardenAuditEditor } from "./openGardenAuditEditor.js";
export { GardenAuditDocPicker } from "./pickers/GardenAuditDocPicker.js";
export { TomoEditorDocPicker } from "./pickers/TomoEditorDocPicker.js";
