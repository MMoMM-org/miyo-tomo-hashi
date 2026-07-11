/**
 * SuggestionsDoc port — the adapter seam for the Suggestions Editor
 * (spec-004 SDD §9, ADR-S5).
 *
 * This is the ONLY wire-aware file family in the Suggestions Editor: it is
 * where `_suggestions.json` gets parsed into the in-memory `EditModel` and
 * where an edited `EditModel` gets written back out (JSON + re-rendered
 * markdown). Every other piece of the editor — the store, the field
 * transforms, the views — operates purely on `EditModel` and never touches
 * JSON or the Obsidian vault directly.
 *
 * Why a port at all (Constitution L1 — pure core testable without an AI or
 * a host framework in the loop): keeping this interface free of any
 * `obsidian` import lets the domain core (store + transforms, T1.3-T1.9)
 * be built and tested against `FakeSuggestionsDoc` (test/__mocks__), with
 * zero Obsidian runtime in the loop. The real implementation
 * (`ObsidianSuggestionsDoc`, a later phase) adapts this same interface to
 * `app.vault`/`app.fileManager` — mirrors the existing `VaultFS` port
 * pattern (src/vault/VaultFS.ts).
 *
 * "Own the whole document" (ADR-S4): `load`/`save` operate on the WHOLE
 * wire document, including fields the editor UI never renders
 * (`daily_updates`, `tag_handler_groups`, `emit_digest`, ...). Nothing may
 * be dropped on a round-trip — see EditModel's doc comment
 * (src/types/suggestions.ts) for why that is structurally guaranteed here
 * rather than left to adapter discipline.
 */

import type { EditModel } from "../types/suggestions.js";

export interface SuggestionsDoc {
	/** Parse the WHOLE `_suggestions.json` at `docPath` into a clean (dirty:false) EditModel. */
	load(docPath: string): Promise<EditModel>;

	/**
	 * Persist the WHOLE model: JSON (verbatim `emit_digest` unless the
	 * caller edited it) + a re-rendered `_suggestions.md`.
	 */
	save(model: EditModel): Promise<void>;
}
