/**
 * Hand-aligned TypeScript types for the vendored garden-audit wire schema
 * (src/schema/garden-audit-wire.schema.json, spec-005 SDD §Application Data
 * Models).
 *
 * Wire-vs-model naming decision (T1.1): these interfaces mirror the wire
 * JSON field-for-field, including its snake_case keys — same convention as
 * src/types/suggestions.ts (ADR-026 precedent) and src/schema/types.ts (the
 * executor's InstructionSet types). No json-schema-to-ts — hand-written.
 *
 * `emit_digest` is an OPAQUE passthrough: Hashi never reads or recomputes it
 * (it is a Tomo-side digest over the apply-decision fields only — see the
 * schema's own description). `decision` is present ONLY on fixable findings
 * and absent on advisory ones; `detail` is per-check and read-only, so it
 * stays a generic `Record<string, unknown>` rather than a per-check union —
 * the editor never inspects it beyond passthrough display.
 */

// ---------------------------------------------------------------------------
// Candidate — a scored LLM suggestion for repoint/replace/file_under.
// ---------------------------------------------------------------------------

export interface CandidateWire {
	/** Read-only — the suggested stem. */
	readonly stem: string;
	/** Read-only — suggestion score. */
	readonly score: number;
}

// ---------------------------------------------------------------------------
// Target — the primary note a finding points at.
// ---------------------------------------------------------------------------

export interface TargetWire {
	/** Read-only — vault-relative path. */
	readonly path: string;
	/** Read-only. */
	readonly stem: string | null;
}

// ---------------------------------------------------------------------------
// Decision — editable block, present ONLY on fixable findings.
// ---------------------------------------------------------------------------

export interface DecisionWire {
	/** Editable — true to apply the fix. */
	readonly selected: boolean;
	/** Read-only — proposed action name; null when not yet determined. */
	readonly action: string | null;
	/** Editable — dead_link only. Empty string = remove intent. */
	readonly replace?: string;
	/** Editable — broken_up only. Empty string = remove the broken line. */
	readonly repoint?: string;
	/** Editable — orphan/unparented only. Empty string = fall back to scan candidate. */
	readonly file_under?: string;
	/** Read-only — display-only scored candidates from `--suggest`. */
	readonly candidates?: readonly CandidateWire[];
	/** Editable — marks a finding that wants LLM candidates. */
	readonly suggest_requested?: boolean;
	/**
	 * Read-only Tomo ran-marker — set true by `--suggest` on every finding it
	 * processed; absent = never ran (or no longer requested). Excluded from
	 * emit_digest.
	 */
	readonly suggested?: boolean;
}

// ---------------------------------------------------------------------------
// Finding — one audit finding (F## id).
// ---------------------------------------------------------------------------

export type FindingCheck =
	| "unparented"
	| "orphan"
	| "broken_up"
	| "dead_link"
	| "duplicate_stem"
	| "stale_moc";

export type FindingTier = "integrity" | "structure" | "advisory";

export interface FindingWire {
	/** Read-only — stable finding id (e.g. F01). */
	readonly id: string;
	/** Read-only — which check produced this finding. */
	readonly check: FindingCheck;
	/** Read-only — severity tier. */
	readonly tier: FindingTier;
	/** Read-only — true for checks 1-4 (unparented,orphan,broken_up,dead_link). */
	readonly fixable: boolean;
	readonly target: TargetWire;
	/** Read-only — per-check detail, opaque to the editor. */
	readonly detail: Record<string, unknown>;
	/** Editable — present only when `fixable` is true; absent on advisory findings. */
	readonly decision?: DecisionWire;
}

// ---------------------------------------------------------------------------
// GardenAuditWire — top-level schema shape.
// ---------------------------------------------------------------------------

export interface GardenAuditWire {
	readonly schema_version: "1";
	readonly generated: string;
	readonly run_id: string;
	readonly profile: string | null;
	/** OPAQUE passthrough — never read or recomputed by Hashi. */
	readonly emit_digest: string;
	/** Editable — JSON-side approve gate (Q1); absent treated as false. */
	readonly approved?: boolean;
	readonly findings: readonly FindingWire[];
}

// ---------------------------------------------------------------------------
// GardenAuditValidationOutcome — returned by the schema validator (T1.2)
// ---------------------------------------------------------------------------

export type GardenAuditValidationOutcome =
	| { readonly ok: true; readonly data: GardenAuditWire }
	| { readonly ok: false; readonly message: string };

// ---------------------------------------------------------------------------
// GardenAuditModel — in-memory edit model the garden-audit editor operates on.
// ---------------------------------------------------------------------------

/**
 * Wraps the whole wire document plus Hashi's own `dirty` flag (mirrors
 * src/types/suggestions.ts's `EditModel` — "own the whole document" so no
 * field can be dropped by a lossy remap). `dirty` is in-memory UI state,
 * never serialized to the wire.
 */
export interface GardenAuditModel {
	doc: GardenAuditWire; // the whole wire object, incl. read-only + passthrough fields
	dirty: boolean; // in-memory only; every mutating transform sets this true
}
