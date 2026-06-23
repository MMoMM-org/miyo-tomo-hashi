/**
 * Hand-aligned TypeScript types for the vendored Tomo instruction-set schema.
 *
 * Source of truth: src/schema/instructions.schema.json (ADR-2)
 * Deviation note: schema_version is typed as "1" (string literal), not 1 (number).
 *   The schema declares {"const": "1"} — a string. SDD code excerpt was incorrect.
 * Deviation note: Action discriminant field is `action` (matching schema $defs),
 *   not `kind`. Plan task wording "narrows on `kind`" was loose phrasing.
 *
 * No json-schema-to-ts — hand-written per ADR-1 v2. (ADR-1 revised 2026-04-25)
 */

// ---------------------------------------------------------------------------
// Action variant interfaces — all discriminated by field `action`
// ---------------------------------------------------------------------------

interface ActionBase {
	readonly id: string;
	readonly applied?: boolean;
}

export interface CreateMocAction extends ActionBase {
	readonly action: "create_moc";
	readonly source: string;
	readonly destination: string;
	readonly title: string;
	readonly rendered_file?: string;
	readonly parent_moc?: string | null;
	readonly template?: string | null;
	readonly tags?: string[];
	readonly supporting_items?: string | string[] | null;
}

export interface MoveNoteAction extends ActionBase {
	readonly action: "move_note";
	readonly source: string;
	readonly destination: string;
	readonly title: string;
	readonly rendered_file?: string;
	readonly origin_inbox_item?: string | null;
	readonly parent_mocs?: string[];
	readonly tags?: string[];
}

/**
 * Anchor — where in a target MOC to find the insertion point for a
 * `link_to_moc`. Three types:
 *   - `callout`: match the callout opening line (e.g., `[!blocks] Key Concepts`).
 *   - `heading`: match heading text without `#` prefix (any heading level).
 *   - `line`: match a body line by literal content (substring/exact).
 *
 * `value` is `null` only at emission time when the renderer cannot resolve
 * a concrete value yet — Hashi receiving null is a runtime fail.
 */
export interface Anchor {
	readonly type: "callout" | "heading" | "line";
	readonly value: string | null;
}

export interface LinkToMocAction extends ActionBase {
	readonly action: "link_to_moc";
	readonly target_moc: string;
	/**
	 * Text to insert. MAY contain embedded `\n` — every line is written as a
	 * block (blank lines preserved). Verbatim for `before`/`after`; each line
	 * gets a `> ` prefix for `inside` (callout body).
	 */
	readonly line_to_add: string;
	readonly anchor: Anchor;
	/**
	 * Where to write relative to the anchor:
	 *   - `inside` (callout-only): as the last line(s) of the callout body.
	 *   - `before`: immediately before the anchor's first line.
	 *   - `after`:  immediately after the anchor's terminal line.
	 */
	readonly placement: "inside" | "before" | "after";
	readonly target_moc_path?: string | null;
	readonly source_note_title?: string | null;
}

/**
 * InsertUnderMarkerAction — insert a multi-line block beneath a marker in an
 * ARBITRARY vault note. Generalises `link_to_moc`'s insert primitive: the only
 * deltas are `target_path` (any note, not a MOC stem) and `content` (multi-line,
 * not a single bullet). Reuses the same `Anchor` + `placement` semantics.
 *
 * Placement × marker type (see anchorResolver / sectionLocator):
 *   - `inside` + callout → appended to callout body (`> ` per line).
 *   - `inside` + heading → appended at the end of the heading's section
 *     (above the next heading of same-or-higher level, or EOF), verbatim.
 *   - `inside` + line   → unsupported (handler fails gracefully).
 *   - `before`/`after`  → verbatim, relative to the marker, any marker type.
 */
export interface InsertUnderMarkerAction extends ActionBase {
	readonly action: "insert_under_marker";
	readonly target_path: string;
	readonly anchor: Anchor;
	readonly placement: "inside" | "before" | "after";
	readonly content: string;
}

export interface AddRelationshipAction extends ActionBase {
	readonly action: "add_relationship";
	readonly target_moc_path: string;
	readonly marker: string;
	readonly line: string;
	readonly target_moc?: string | null;
	readonly source_note_title?: string | null;
}

export interface UpdateTrackerAction extends ActionBase {
	readonly action: "update_tracker";
	readonly daily_note_path: string;
	readonly date: string;
	readonly field: string;
	readonly value: string | number | boolean;
	readonly syntax: "inline_field" | "callout_body" | "checkbox";
	readonly section?: string | null;
	readonly source_stem?: string | null;
	readonly reason?: string | null;
}

export interface UpdateLogEntryAction extends ActionBase {
	readonly action: "update_log_entry";
	readonly daily_note_path: string;
	readonly date: string;
	readonly section: string;
	readonly position: "after_last_line" | "before_first_line" | "at_time";
	readonly content: string;
	readonly heading_level?: number;
	readonly time?: string | null;
	readonly source_stem?: string | null;
	readonly reason?: string | null;
}

export interface UpdateLogLinkAction extends ActionBase {
	readonly action: "update_log_link";
	readonly daily_note_path: string;
	readonly date: string;
	readonly section: string;
	readonly position: "after_last_line" | "before_first_line" | "at_time";
	readonly target_stem: string;
	readonly heading_level?: number;
	readonly time?: string | null;
	readonly reason?: string | null;
}

export interface DeleteSourceAction extends ActionBase {
	readonly action: "delete_source";
	readonly source_path: string;
	readonly reason: string;
}

export interface SkipAction extends ActionBase {
	readonly action: "skip";
	readonly source_path: string | null;
	readonly reason?: string | null;
}

// ---------------------------------------------------------------------------
// Action — discriminated union over `action` field
// ---------------------------------------------------------------------------

export type Action =
	| CreateMocAction
	| MoveNoteAction
	| LinkToMocAction
	| InsertUnderMarkerAction
	| AddRelationshipAction
	| UpdateTrackerAction
	| UpdateLogEntryAction
	| UpdateLogLinkAction
	| DeleteSourceAction
	| SkipAction;

// ---------------------------------------------------------------------------
// ActionKind — derived from Action["action"] so it cannot drift out of sync
// when a variant is added or removed.
// ---------------------------------------------------------------------------

export type ActionKind = Action["action"];

// ---------------------------------------------------------------------------
// Tomo provenance block — lifecycle/coverage metadata mirroring the .md
// frontmatter. Tomo-owned; Hashi ignores it for execution (it only runs
// `actions`). Permissive by contract so Tomo can evolve it without a
// coordinated round-trip (tomo-to-hashi handoff 2026-06-20, miyo-tomo#74).
// ---------------------------------------------------------------------------

export interface TomoSource {
	readonly path?: string;
	readonly checksum?: string;
	readonly [key: string]: unknown;
}

export interface TomoBlock {
	readonly doc_type?: string;
	readonly state?: string;
	readonly run_id?: string | null;
	readonly updated_at?: string;
	readonly sources?: readonly TomoSource[];
	readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// InstructionSet — top-level schema shape
// ---------------------------------------------------------------------------

export interface InstructionSet {
	readonly schema_version: "1";
	readonly type: "tomo-instructions";
	readonly generated: string;
	readonly profile: string | null;
	readonly source_suggestions?: string | null;
	readonly tomo_version?: string | null;
	readonly action_count?: number;
	readonly md_peer?: string;
	readonly tomo?: TomoBlock;
	readonly actions: readonly Action[];
}
