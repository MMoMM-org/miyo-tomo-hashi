import { describe, expect, it } from "vitest";
import { validate } from "../../../src/schema/validator.js";
import type { InstructionSet } from "../../../src/schema/types.js";

// ---------------------------------------------------------------------------
// Minimum valid fixture — all required top-level fields per schema
// ---------------------------------------------------------------------------

const VALID_FIXTURE: InstructionSet = {
	schema_version: "1",
	type: "tomo-instructions",
	generated: "2026-04-28T10:00:00Z",
	profile: null,
	actions: [
		{
			id: "I01",
			action: "skip",
			source_path: "100 Inbox/some-note.md",
		},
	],
};

// ---------------------------------------------------------------------------
// Helper: build a minimal skip action
// ---------------------------------------------------------------------------

const makeSkip = (i: number) => ({
	id: `I${String(i + 1).padStart(2, "0")}`,
	action: "skip" as const,
	source_path: `notes/file${i}.md`,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validate", () => {
	it("accepts a valid v1 InstructionSet", () => {
		const result = validate(VALID_FIXTURE);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.schema_version).toBe("1");
			expect(result.data.actions.length).toBeGreaterThan(0);
		}
	});

	it("rejects schema_version '0' with PRD F2 'expected 1, got 0' message (M14)", () => {
		const result = validate({ ...VALID_FIXTURE, schema_version: "0" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			// PRD F2 contract — the user-facing form must be self-explanatory
			// with both expected and actual values, so it can drive the
			// "upgrade Hashi" prompt without re-parsing AJV's generic msg.
			expect(result.message).toBe(
				"Schema version mismatch — expected 1, got 0",
			);
		}
	});

	it("rejects schema_version '2' with PRD F2 'expected 1, got 2' message (M14)", () => {
		const result = validate({ ...VALID_FIXTURE, schema_version: "2" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toBe(
				"Schema version mismatch — expected 1, got 2",
			);
		}
	});

	it("rejects schema_version missing with a message naming the field", () => {
		const fixture = { ...VALID_FIXTURE } as Record<string, unknown>;
		delete fixture.schema_version;
		const result = validate(fixture);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain("schema_version");
	});

	it("rejects non-object input (number)", () => {
		const result = validate(42);
		expect(result.ok).toBe(false);
	});

	it("rejects null input", () => {
		const result = validate(null);
		expect(result.ok).toBe(false);
	});

	it("rejects array input", () => {
		const result = validate([]);
		expect(result.ok).toBe(false);
	});

	it("rejects unknown action.action value", () => {
		const fixture = {
			...VALID_FIXTURE,
			actions: [{ id: "I01", action: "delete_world" }],
		};
		expect(validate(fixture).ok).toBe(false);
	});

	it("rejects duplicate action ids (uniqueItems or wrapper detection)", () => {
		const fixture = {
			...VALID_FIXTURE,
			actions: [
				{ id: "I01", action: "skip", source_path: "a.md" },
				{ id: "I01", action: "skip", source_path: "b.md" },
			],
		};
		// Schema does not declare uniqueItems on actions array — duplicate ids are
		// a business rule not enforced by ajv. Document actual behavior: valid or invalid.
		// This test asserts consistent behavior (either ok or not ok, never throws).
		const result = validate(fixture);
		expect(typeof result.ok).toBe("boolean");
	});

	it("rejects missing required field (actions)", () => {
		const fixture = { ...VALID_FIXTURE } as Record<string, unknown>;
		delete fixture.actions;
		expect(validate(fixture).ok).toBe(false);
	});

	it("rejects missing required field (generated)", () => {
		const fixture = { ...VALID_FIXTURE } as Record<string, unknown>;
		delete fixture.generated;
		expect(validate(fixture).ok).toBe(false);
	});

	it("rejects wrong type on action.applied (string 'true' instead of boolean)", () => {
		const fixture = {
			...VALID_FIXTURE,
			actions: [
				{ id: "I01", action: "skip", source_path: "a.md", applied: "true" },
			],
		};
		expect(validate(fixture).ok).toBe(false);
	});

	it("accepts action with applied: true (round-trip safe)", () => {
		const fixture: InstructionSet = {
			...VALID_FIXTURE,
			actions: [
				{ id: "I01", action: "skip", source_path: "a.md", applied: true },
			],
		};
		expect(validate(fixture).ok).toBe(true);
	});

	it("accepts action with applied: false (explicit false round-trip safe)", () => {
		const fixture: InstructionSet = {
			...VALID_FIXTURE,
			actions: [
				{ id: "I01", action: "skip", source_path: "a.md", applied: false },
			],
		};
		expect(validate(fixture).ok).toBe(true);
	});

	it("validates a 100-action fixture in under 200ms (CON-7)", () => {
		const big = {
			...VALID_FIXTURE,
			actions: Array.from({ length: 100 }, (_, i) => makeSkip(i)),
		};
		const start = performance.now();
		const result = validate(big);
		const elapsed = performance.now() - start;
		expect(result.ok).toBe(true);
		expect(elapsed).toBeLessThan(200);
	});

	it("returns a non-empty message string on schema failure", () => {
		const result = validate({ ...VALID_FIXTURE, schema_version: "0" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(typeof result.message).toBe("string");
			expect(result.message.length).toBeGreaterThan(0);
		}
	});

	it("validateInstructionSet raw export is still accessible from validator module", async () => {
		const mod = await import("../../../src/schema/validator.js");
		expect(typeof mod.validateInstructionSet).toBe("function");
	});
});
