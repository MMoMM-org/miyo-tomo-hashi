/**
 * Hand-aligned TypeScript types for the vendored suggestions wire schema
 * (src/schema/suggestions-wire.schema.json, ADR-026 / spec-004 SDD §5).
 *
 * Wire-vs-model naming decision (T1.1): these interfaces mirror the wire
 * JSON field-for-field, including its snake_case keys — they are NOT the
 * SDD §5 camelCase `EditModel`. This matches the existing precedent in
 * src/schema/types.ts (the executor's InstructionSet types), which also
 * stays wire-shaped rather than translating field names. Reasons:
 *   1. It lets the ajv version gate (src/schema/suggestions-validator.ts)
 *      validate raw parsed JSON directly against these types with no
 *      intermediate mapping step.
 *   2. It keeps a single wire<->model translation seam: the T1.2 adapter
 *      owns turning `SuggestionsWire` into the SDD §5 camelCase `EditModel`
 *      (and back), so this file never has to reconcile two naming
 *      conventions at once.
 * The top-level SDD interface groups schema/generated/run_id/... under a
 * nested `meta` object; the wire schema itself is flat at the root, so
 * `SuggestionsWire` is flat here too — `meta` is an adapter-side grouping,
 * not a wire concept.
 *
 * No json-schema-to-ts — hand-written, matching src/schema/types.ts's
 * convention (ADR-1 v2 precedent carried over from the instruction-set
 * schema).
 */

// ---------------------------------------------------------------------------
// Anchor — placement of a candidate MOC link (spec 022/023 shape, reused
// here verbatim per the wire schema's `candidate_mocs[].anchor`).
// ---------------------------------------------------------------------------

export interface AnchorWire {
	readonly type: "heading" | "callout" | "line";
	readonly value?: string | null;
	readonly placement: "before" | "after" | "inside";
	readonly new_section?: string | null;
	readonly alt_headings?: readonly string[];
	/** Read-only advisory — lives on the anchor per schema, not the candidate. */
	readonly fit_confidence?: number | null;
}

// ---------------------------------------------------------------------------
// Suggestion — one atomic-note suggestion (S## id).
// ---------------------------------------------------------------------------

export interface CandidateMocWire {
	/** Read-only key — vault-relative MOC path. */
	readonly path: string;
	/** Editable — true ⇒ link this MOC. */
	readonly selected: boolean;
	/** Read-only; defaults to "tomo" when absent. */
	readonly source?: "tomo" | "user";
	/** Editable via the anchor picker; null when no anchor was resolved. */
	readonly anchor?: AnchorWire | null;
}

export interface SuggestionWire {
	/** Read-only — stable S## id. */
	readonly id: string;
	/** Read-only — source note stem. */
	readonly stem: string;
	/** Editable — the note name; the filename derives from it. */
	readonly title: string;
	/** Editable — template wikilink target. */
	readonly template: string;
	/** Editable — destination folder. */
	readonly location: string;
	/** Editable — tags to add. */
	readonly tags: readonly string[];
	/** Read-only — audio peer basename, when the source is an audio+transcript pair. */
	readonly audio_peer?: string | null;
	/** Editable — create the note (approve) or not (skip). */
	readonly decision: "approve" | "skip";
	/** Editable — when approved, keep the origin inbox note instead of deleting it. */
	readonly keep_source: boolean;
	/** Editable — explicitly delete the origin. */
	readonly delete_source: boolean;
	/** Editable — promote a suppressed (sub-worthy) atomic. */
	readonly force_atomic: boolean;
	/** Read-only render hint — kept in the inbox as a light block. */
	readonly suppressed: boolean;
	/** Read-only — atomic-note worthiness 0..1. */
	readonly worthiness?: number | null;
	readonly candidate_mocs: readonly CandidateMocWire[];
}

// ---------------------------------------------------------------------------
// ProposedMoc — a new MOC proposal (M## id).
// ---------------------------------------------------------------------------

export interface ProposedMocWire {
	/** Read-only — stable M## id. */
	readonly id: string;
	/** Read-only. */
	readonly topic: string;
	/** Editable — rename here. */
	readonly name: string;
	/** Editable — reparent here (fuzzy). */
	readonly parent: string;
	/** Editable — merge/move member notes by S## id. */
	readonly member_ids: readonly string[];
	/** Editable. */
	readonly tags?: readonly string[];
	/** Read-only. */
	readonly reason?: string;
	/** Editable — create the MOC (approve) or not (skip); default skip. */
	readonly decision: "approve" | "skip";
}

// ---------------------------------------------------------------------------
// TagGroup — a tag-handler group approval toggle.
// ---------------------------------------------------------------------------

export interface TagGroupWire {
	readonly group_id: string;
	/** Editable — include this group's capture. */
	readonly approved: boolean;
	/** Editable — leave the captured inbox notes in place. */
	readonly keep_source: boolean;
	/** Read-only display — the tag-handler that claimed the items. */
	readonly handler?: string;
	/** Read-only display — the note the capture is written to. */
	readonly target_path?: string | null;
	/** Read-only display — the anchor/marker in the target note. */
	readonly marker?: string;
	/** Read-only display — the inbox notes captured into this group. */
	readonly source_paths?: readonly string[];
	/** Read-only display — the composed block that will be inserted. */
	readonly preview?: string;
}

// ---------------------------------------------------------------------------
// Daily updates — full ADR-026 mirror (SDD §6), schema-pinned (not opaque).
// ---------------------------------------------------------------------------

export interface DailyTrackerWire {
	readonly field: string;
	readonly value: string;
	readonly reason: string;
	readonly source_stem: string;
	/** Editable — accept toggle. */
	readonly accepted: boolean;
}

export interface DailyLogEntryWire {
	/** Editable — HH:MM, only meaningful when position == "at_time"; null otherwise. */
	readonly time: string | null;
	/** Editable — placement in the daily log. */
	readonly position: "at_time" | "after_last_line" | "before_first_line";
	/** Editable — the log-entry text. */
	readonly content: string;
	readonly reason: string;
	readonly source_stem: string;
	/** Editable — accept toggle. */
	readonly accepted: boolean;
	/** Editable — kept in sync per source-stem with suggestions[].force_atomic. */
	readonly force_atomic_note: boolean;
}

export interface DailyLogLinkWire {
	/** Read-only — the atomic note the log links to. */
	readonly target_stem: string;
	readonly time: string | null;
	readonly position: "at_time" | "after_last_line" | "before_first_line";
	readonly reason: string;
	/** Editable — accept toggle. */
	readonly accepted: boolean;
}

export interface DailyUpdateWire {
	/** Read-only — daily-note date stem (e.g. 2026-07-06). */
	readonly date: string;
	readonly trackers: readonly DailyTrackerWire[];
	readonly log_entries: readonly DailyLogEntryWire[];
	readonly log_links: readonly DailyLogLinkWire[];
}

// ---------------------------------------------------------------------------
// SuggestionsWire — top-level schema shape (flat; see file header re: `meta`).
// ---------------------------------------------------------------------------

export interface SuggestionsWire {
	readonly schema_version: "1";
	readonly generated: string;
	readonly run_id: string;
	readonly profile: string;
	readonly source_items: number;
	/** `^sha256:[a-f0-9]{64}$` — canonical digest over the editable payload. */
	readonly emit_digest: string;
	readonly suggestions: readonly SuggestionWire[];
	readonly proposed_mocs: readonly ProposedMocWire[];
	readonly daily_updates: readonly DailyUpdateWire[];
	readonly tag_handler_groups: readonly TagGroupWire[];
}

// ---------------------------------------------------------------------------
// SuggestionsValidationOutcome — returned by the schema validator (T1.1)
// ---------------------------------------------------------------------------

export type SuggestionsValidationOutcome =
	| { readonly ok: true; readonly data: SuggestionsWire }
	| { readonly ok: false; readonly message: string };

// ---------------------------------------------------------------------------
// EditModel — in-memory edit model the Suggestions Editor operates on.
// ---------------------------------------------------------------------------

/**
 * In-memory edit model. Wraps the whole wire document plus Hashi's own
 * `dirty` flag (SDD §4: dirty is UI state, NEVER serialized to the wire).
 * Wrapping the wire doc verbatim (rather than remapping to a camelCase
 * shape) is what makes ADR-S4 "own the whole document" free: the adapter
 * parses JSON straight into `doc` and writes `doc` straight back, so no
 * field can be dropped by a lossy remap. Supersedes SDD §5's illustrative
 * camelCase `EditModel`/nested-`meta` sketch (impl-wins-over-lagging-SDD).
 */
export interface EditModel {
	doc: SuggestionsWire; // the whole wire object, incl. read-only + passthrough fields
	dirty: boolean; // in-memory only; every mutating transform sets this true
}
