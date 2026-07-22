import Ajv2020 from "ajv/dist/2020";
import type { ErrorObject } from "ajv";
import schema from "./garden-audit-wire.schema.json";
import type {
	GardenAuditValidationOutcome,
	GardenAuditWire,
} from "../types/garden-audit.js";

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });

/** Compiled ajv validator for the vendored garden-audit wire schema (spec-005). */
export const validateGardenAuditWire = ajv.compile(schema);

/**
 * Validates a parsed JSON value against the bundled garden-audit wire schema
 * (spec-005 SDD, Tomo ADR-4/ADR-026). Returns a discriminated outcome with
 * the validated GardenAuditWire on success, or a single human-readable
 * message on failure — mirrors src/schema/suggestions-validator.ts's
 * contract exactly (same precedent as src/schema/validator.ts M14): every
 * failure mode collapses to one string, and a schema_version mismatch gets
 * the prescribed fail-loud wording so it can drive an "upgrade Hashi"
 * prompt without the caller branching on a sub-kind.
 *
 * Safe to call on any JSON-parsed value (object, array, primitive, null).
 * Caller is responsible for catching JSON.parse errors upstream.
 */
export function validate(raw: unknown): GardenAuditValidationOutcome {
	if (validateGardenAuditWire(raw)) {
		return { ok: true, data: raw as unknown as GardenAuditWire };
	}
	const errors = validateGardenAuditWire.errors ?? [];
	const message = formatErrors(errors, raw);
	return { ok: false, message };
}

function formatErrors(errors: ErrorObject[], raw: unknown): string {
	if (errors.length === 0) return "schema validation failed";
	const first = errors[0];
	if (!first) return "schema validation failed";

	// Schema-version mismatch is the one failure mode with prescribed
	// user-facing wording (mirrors src/schema/validator.ts M14) — it drives
	// the "upgrade Hashi" prompt downstream, so callers parse the literal
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
// rather than the default `[object Object]`. Duplicated from
// src/schema/suggestions-validator.ts (no shared error-formatting util
// exists yet — a candidate for extraction if a third schema validator shows
// up) — keeps error messages useful without tripping no-base-to-string.
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
