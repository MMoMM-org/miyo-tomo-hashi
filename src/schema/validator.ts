import Ajv2020 from "ajv/dist/2020";
import type { ErrorObject } from "ajv";
import schema from "./instructions.schema.json";
import type { InstructionSet } from "./types.js";
import type { ValidationOutcome } from "../executor/state.js";

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });

/** Compiled ajv validator for the vendored Tomo instruction-set schema (ADR-1, ADR-2). */
export const validateInstructionSet = ajv.compile(schema);

// ---------------------------------------------------------------------------
// Known action kinds — derived from the schema's actions/items/oneOf refs,
// each resolved to its $def's `action.const`. Used to give a clear message
// when an instruction set carries an action kind this Hashi build doesn't
// know (e.g. it targets a newer Tomo schema) — Ajv's own error for that case
// picks an arbitrary oneOf branch (usually the first) and reports a missing
// field belonging to THAT branch, which is misleading (see formatErrors).
// ---------------------------------------------------------------------------

interface ActionDefRef {
	readonly $ref: string;
}

interface SchemaShape {
	readonly properties: {
		readonly actions: {
			readonly items: {
				readonly oneOf: readonly ActionDefRef[];
			};
		};
	};
	readonly $defs: Record<string, { properties?: { action?: { const?: string } } }>;
}

function buildKnownActionKinds(schemaShape: SchemaShape): ReadonlySet<string> {
	const kinds = new Set<string>();
	for (const ref of schemaShape.properties.actions.items.oneOf) {
		const defName = ref.$ref.replace("#/$defs/", "");
		const kind = schemaShape.$defs[defName]?.properties?.action?.const;
		if (typeof kind === "string") kinds.add(kind);
	}
	return kinds;
}

const KNOWN_ACTION_KINDS = buildKnownActionKinds(schema as unknown as SchemaShape);

/**
 * Scan the raw (pre-validation) input for the earliest action whose `action`
 * field is a string not present in KNOWN_ACTION_KINDS. Returns null when
 * `raw` isn't shaped like `{ actions: [...] }` or every action kind present
 * is known (the failure is for some other reason — missing field, wrong
 * type, etc. — on a known action kind).
 */
function findUnknownActionKind(raw: unknown): { index: number; kind: string } | null {
	if (raw === null || typeof raw !== "object") return null;
	const actions = (raw as { actions?: unknown }).actions;
	if (!Array.isArray(actions)) return null;

	for (let i = 0; i < actions.length; i++) {
		const entry: unknown = actions[i];
		if (entry === null || typeof entry !== "object") continue;
		const kind = (entry as { action?: unknown }).action;
		if (typeof kind === "string" && !KNOWN_ACTION_KINDS.has(kind)) {
			return { index: i, kind };
		}
	}
	return null;
}

/**
 * Validates a parsed JSON value against the bundled Tomo instruction-set
 * schema. Returns a discriminated outcome with the validated InstructionSet
 * on success, or a single human-readable message on failure.
 *
 * Per ADR-1 v2 (2026-04-25): no Diagnostic[] array, no discriminated failure
 * union — every failure mode (version mismatch, structure diagnostic, unknown
 * action, missing field, wrong type) collapses to a single string. The
 * orchestrator never branches on a sub-kind; the modal header and run log
 * just show the message.
 *
 * Safe to call on any JSON-parsed value (object, array, primitive, null).
 * Caller is responsible for catching JSON.parse errors upstream.
 */
export function validate(raw: unknown): ValidationOutcome {
	if (validateInstructionSet(raw)) {
		return { ok: true, data: raw as unknown as InstructionSet };
	}
	const errors = validateInstructionSet.errors ?? [];
	const message = formatErrors(errors, raw);
	return { ok: false, message };
}

function formatErrors(errors: ErrorObject[], raw: unknown): string {
	if (errors.length === 0) return "schema validation failed";
	const first = errors[0];
	if (!first) return "schema validation failed";

	// M14: PRD F2 contract. Schema-version mismatch is the one failure
	// mode that has prescribed user-facing wording — it drives the
	// "upgrade Hashi" prompt downstream, so callers parse the literal
	// "Schema version mismatch — expected X, got Y" form. AJV's generic
	// "must be equal to constant" doesn't carry the actual value.
	if (first.keyword === "const" && first.instancePath === "/schema_version") {
		const expected = stringifyScalar(
			(first.params as { allowedValue?: unknown }).allowedValue,
			"1",
		);
		const actualRaw = (raw as { schema_version?: unknown } | null)
			?.schema_version;
		const actual = stringifyScalar(actualRaw, "undefined");
		return `Schema version mismatch — expected ${expected}, got ${actual}`;
	}

	// Unknown action kind: Ajv's oneOf reports a sub-error against an
	// arbitrary (usually the first) branch — e.g. "/actions/0 must have
	// required property 'source'" for a kind that isn't move_note/create_moc
	// at all. Give the earliest genuinely-unknown kind a clear message
	// instead of surfacing that misleading sub-schema diagnostic.
	const unknownKind = findUnknownActionKind(raw);
	if (unknownKind !== null) {
		return `/actions/${unknownKind.index}: unknown action kind '${unknownKind.kind}' — the instruction set may target a newer Tomo schema than this Hashi build`;
	}

	const path = first.instancePath || "(root)";
	return `${path} ${first.message ?? "is invalid"}`;
}

// Format a primitive value safely; objects/arrays return JSON.stringify
// rather than the default `[object Object]`. Keeps error messages
// useful without tripping no-base-to-string.
function stringifyScalar(value: unknown, fallback: string): string {
	if (value === undefined) return fallback;
	if (value === null) return "null";
	if (typeof value === "string") return value;
	if (typeof value === "number") return Number.prototype.toString.call(value);
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "bigint") return BigInt.prototype.toString.call(value);
	try {
		return JSON.stringify(value);
	} catch {
		return fallback;
	}
}
