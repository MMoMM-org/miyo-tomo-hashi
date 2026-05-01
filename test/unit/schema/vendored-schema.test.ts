import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface SchemaRoot {
	schema_version: string;
	$defs: Record<string, unknown>;
	properties: {
		actions: {
			items: {
				oneOf: Array<{ $ref: string }>;
			};
		};
	};
}

function loadSchema(): SchemaRoot {
	const schemaPath = resolve(__dirname, "../../../src/schema/instructions.schema.json");
	return JSON.parse(readFileSync(schemaPath, "utf-8")) as SchemaRoot;
}

describe("src/schema/instructions.schema.json — vendored Tomo schema (ADR-2)", () => {
	it("schema_version const equals '1' (Tomo canonical value)", () => {
		const schema = loadSchema();
		const versionDef = (schema.properties as Record<string, unknown>)["schema_version"] as {
			const: string;
		};
		expect(versionDef.const).toBe("1");
	});

	it("$defs/applied_field is present (Tomo v0.7.0+ structural marker)", () => {
		const schema = loadSchema();
		expect(schema.$defs).toHaveProperty("applied_field");
	});

	it("every action variant under oneOf references $defs/applied_field", () => {
		const schema = loadSchema();
		const oneOf = schema.properties.actions.items.oneOf;
		// Each oneOf entry is a $ref to a $def; each $def must have applied: { $ref: applied_field }
		for (const ref of oneOf) {
			const defName = ref.$ref.replace("#/$defs/", "");
			const def = schema.$defs[defName] as {
				properties?: Record<string, { $ref?: string }>;
			};
			expect(def, `$defs/${defName} must exist`).toBeDefined();
			const appliedProp = def.properties?.["applied"];
			expect(
				appliedProp,
				`$defs/${defName}.properties.applied must exist and reference $defs/applied_field`,
			).toMatchObject({ $ref: "#/$defs/applied_field" });
		}
	});
});

describe("src/schema/validator.ts — ajv compiles at module load (ADR-1 revised 2026-04-25)", () => {
	it("validator module imports cleanly and exposes a compiled ajv validator (not a lazy factory)", async () => {
		const mod = await import("../../../src/schema/validator.js");
		expect(typeof mod.validateInstructionSet).toBe("function");
		// ajv v8 compiled validators carry the source schema on .schema —
		// load-bearing for CON-2: proves compilation already happened at import
		// time, would not be true of a deferred-compile factory.
		expect(mod.validateInstructionSet).toHaveProperty("schema");
	});
});
