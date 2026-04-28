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
	const message = formatErrors(errors);
	return { ok: false, message };
}

function formatErrors(errors: ErrorObject[]): string {
	if (errors.length === 0) return "schema validation failed";
	// Prefer the first error's instancePath + message. If multiple errors
	// share a common cause, joining them produces noise — keep it tight.
	const first = errors[0];
	if (!first) return "schema validation failed";
	const path = first.instancePath || "(root)";
	return `${path} ${first.message ?? "is invalid"}`;
}
