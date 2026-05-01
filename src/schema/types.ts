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
	readonly supporting_items?: string | null;
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
	readonly line_to_add: string;
	readonly anchor: Anchor;
	readonly placement: "inside" | "after";
	readonly target_moc_path?: string | null;
	readonly source_note_title?: string | null;
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
	readonly actions: readonly Action[];
}
