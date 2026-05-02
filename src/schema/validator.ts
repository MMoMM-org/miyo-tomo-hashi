import Ajv2020 from "ajv/dist/2020";
import type { ErrorObject } from "ajv";
import schema from "./instructions.schema.json";
import type { InstructionSet } from "./types.js";
import type { ValidationOutcome } from "../executor/state.js";

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });

/** Compiled ajv validator for the vendored Tomo instruction-set schema (ADR-1, ADR-2). */
export const validateInstructionSet = ajv.compile(schema);

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
