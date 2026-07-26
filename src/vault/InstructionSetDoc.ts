/**
 * InstructionSetDoc port — the adapter seam for the Instruction Fixer editor
 * (spec-006 SDD, ADR-1/ADR-2).
 *
 * Mirrors `src/vault/GardenAuditDoc.ts`'s role exactly: the ONE wire-aware
 * seam for the `_instructions.json` wire file, where the JSON is parsed into
 * the in-memory `InstructionFixerModel` and where an edited model is written
 * back out. Every other Instruction Fixer piece (store, transforms, view)
 * operates purely on `InstructionFixerModel` and never touches JSON or the
 * Obsidian vault directly.
 *
 * ADR-1: this reuses the EXISTING instruction wire (`src/schema/types.ts`'s
 * `InstructionSet` + `src/schema/validator.ts`'s `validate`) — no new editor
 * wire, no `schema_version` bump. The schema sets `additionalProperties:false`
 * on every action and at the top level, so "own the whole document" is not
 * optional: `load`/`save` must round-trip every field verbatim, including
 * ones the Fixer UI never renders (`tomo`, `md_peer`, `applied`, ...) — a
 * dropped field fails re-validation on the next load. See `InstructionFixerModel`'s
 * doc comment below.
 *
 * ADR-7 — no courtesy `.md` write: `save` persists the JSON wire only, and
 * never touches the `.md` peer or its `tomo.sources` frontmatter block.
 */

import type { InstructionSet } from "../schema/types.js";

// ---------------------------------------------------------------------------
// InstructionFixerModel — editor-only model wrapping the wire (no wire
// fields added). Shared Phase-1 model type: exported from here so
// `src/instruction-fixer/transforms.ts` (T1.3) and the adapter (T1.3's
// sibling `ObsidianInstructionSetDoc`) both import the single definition.
// ---------------------------------------------------------------------------

/**
 * Wraps the whole wire document plus Hashi's own `dirty` flag (mirrors
 * `GardenAuditModel` — "own the whole document" so no field can be dropped
 * by a lossy remap). `dirty` is in-memory UI state, never persisted.
 *
 * NOTE: outcomes + the fail-closed edit gate (ADR-4) are DERIVED per render
 * (not stored on the model), so a re-run refresh recomputes them; the model
 * persists only `doc` + `dirty`.
 */
export interface InstructionFixerModel {
	doc: InstructionSet; // the whole wire object, incl. read-only + passthrough fields
	dirty: boolean; // in-memory only; every mutating transform sets this true
}

export interface InstructionSetDoc {
	/**
	 * Parse the WHOLE `_instructions.json` at `docPath` into a clean
	 * (dirty:false) InstructionFixerModel. Throws with the validator's
	 * message on a corrupt or schema-invalid document (Constitution L1
	 * denial path).
	 */
	load(docPath: string): Promise<{ doc: InstructionSet; dirty: false }>;

	/**
	 * Persist the model as JSON only (ADR-7 — no sibling `.md` write,
	 * `tomo.sources` untouched). Dirty-gated: a no-op when `model.dirty` is
	 * false.
	 *
	 * ADR-9 — NOT a whole-document write: the implementation validates the
	 * whole edited document, then derives per-action field patches (edited
	 * model vs. the load-time state) and merges each onto whatever is
	 * CURRENTLY on disk, through the executor's own atomic write path. So
	 * fields the user didn't touch — including an `applied: true` the executor
	 * flushed since `load()` — are preserved by construction rather than
	 * replayed from a possibly-stale in-memory snapshot. Rejects (writing
	 * nothing) when the edited document fails schema validation, and when a
	 * change can't be expressed as a per-action field patch. See the ADR-9
	 * block comment in `src/instruction-fixer/ObsidianInstructionSetDoc.ts`.
	 */
	save(model: InstructionFixerModel): Promise<void>;
}
