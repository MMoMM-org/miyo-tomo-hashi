/**
 * GardenAuditDoc port — the adapter seam for the garden-audit editor
 * (spec-005 SDD, ADR-2/ADR-6).
 *
 * Mirrors `src/vault/SuggestionsDoc.ts`'s role exactly: the ONE wire-aware
 * seam for the garden-audit wire file, where `_garden-audit.json` is parsed
 * into the in-memory `GardenAuditModel` and where an edited model is written
 * back out. Every other garden-audit-editor piece (store, transforms, views)
 * operates purely on `GardenAuditModel` and never touches JSON or the
 * Obsidian vault directly.
 *
 * "Own the whole document": `load`/`save` operate on the WHOLE wire
 * document, including fields the editor UI never renders (`detail`,
 * `candidates`, `emit_digest`, ...) — nothing may be dropped on a
 * round-trip. See `GardenAuditModel`'s doc comment (src/types/garden-audit.ts).
 *
 * ADR-6 divergence from SuggestionsDoc: there is NO courtesy `.md` write in
 * v1 — `save` persists the JSON wire only. `save` writes `model.doc`
 * VERBATIM (ADR-2 — the adapter is dumb): the top-level approval gate
 * (`approved` / `suggest_pending`, PRD F7) is owned by the caller
 * (`GardenAuditEditorView.handleSave` via `applyApprovalGate`), not set here.
 * `emit_digest` rides along inside `doc` and is serialized untouched — Hashi
 * never recomputes it.
 */

import type { GardenAuditModel } from "../types/garden-audit.js";

export interface GardenAuditDoc {
	/** Parse the WHOLE `_garden-audit.json` at `docPath` into a clean (dirty:false) GardenAuditModel. */
	load(docPath: string): Promise<GardenAuditModel>;

	/**
	 * Persist the WHOLE model as JSON only (ADR-6 — no sibling `.md` write).
	 * Dirty-gated: a no-op when `model.dirty` is false. Writes `model.doc`
	 * VERBATIM (ADR-2) — the caller owns the top-level approval gate
	 * (`approved` / `suggest_pending`, PRD F7); `emit_digest` is never recomputed.
	 */
	save(model: GardenAuditModel): Promise<void>;
}
