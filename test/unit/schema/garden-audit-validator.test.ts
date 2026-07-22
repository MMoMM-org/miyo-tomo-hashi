import { describe, expect, it } from "vitest";
import { validate } from "../../../src/schema/garden-audit-validator.js";
import type { GardenAuditWire } from "../../../src/types/garden-audit.js";

// ---------------------------------------------------------------------------
// VALID_FIXTURE — the spec-005 SDD §2 example wire (a real Tomo emission;
// its emit_digest is verified against Tomo's compute — see T1.3's
// current-wire.json fixture, which reuses this same doc verbatim).
// ---------------------------------------------------------------------------

const VALID_FIXTURE: GardenAuditWire = {
	schema_version: "1",
	generated: "2026-07-22T12:00:00Z",
	run_id: "run-editor-001",
	profile: "miyo",
	approved: false,
	findings: [
		{
			id: "F01",
			check: "dead_link",
			tier: "integrity",
			fixable: true,
			target: { path: "Notes/Src.md", stem: "Src" },
			detail: { dead_target: "Missing Note", count: 1 },
			decision: {
				selected: true,
				action: "edit_note_text",
				replace: "",
				candidates: [],
				suggest_requested: false,
			},
		},
		{
			id: "F02",
			check: "broken_up",
			tier: "integrity",
			fixable: true,
			target: { path: "Notes/Child.md", stem: "Child" },
			detail: { up_target: "Deleted MOC" },
			decision: {
				selected: true,
				action: "edit_note_text",
				repoint: "",
				candidates: [],
				suggest_requested: false,
			},
		},
		{
			id: "F03",
			check: "orphan",
			tier: "structure",
			fixable: true,
			target: { path: "Notes/Orphan.md", stem: "Orphan" },
			detail: { candidate_mocs: [] },
			decision: {
				selected: true,
				action: "link_to_moc",
				file_under: "",
				candidates: [],
				suggest_requested: false,
			},
		},
		{
			id: "F09",
			check: "stale_moc",
			tier: "advisory",
			fixable: false,
			target: { path: "MOCs/Old.md", stem: "Old" },
			detail: { mtime: "2026-01-01T00:00:00Z" },
		},
	],
	emit_digest:
		"sha256:09b0019e1da79f06abcac28fffed58f586306009a9acaa53609b7cfe5efc127b",
};

describe("validate (garden-audit wire)", () => {
	it("accepts the SDD §2 example doc and returns a typed GardenAuditWire", () => {
		const result = validate(VALID_FIXTURE);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.schema_version).toBe("1");
			expect(result.data.findings).toHaveLength(4);
			expect(result.data.findings[3]?.decision).toBeUndefined();
		}
	});

	it("rejects a missing emit_digest, naming the field", () => {
		const fixture = { ...VALID_FIXTURE } as Record<string, unknown>;
		delete fixture.emit_digest;
		const result = validate(fixture);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain("emit_digest");
	});

	it("rejects schema_version '2' with the fail-loud version-mismatch message", () => {
		// Mirrors the suggestions-validator precedent: the literal
		// "Schema version mismatch — expected X, got Y" form is parsed
		// downstream to drive an "upgrade Hashi" prompt.
		const result = validate({ ...VALID_FIXTURE, schema_version: "2" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toBe(
				"Schema version mismatch — expected 1, got 2",
			);
		}
	});

	it("rejects a decision block carrying an unknown field (additionalProperties:false)", () => {
		const fixture = {
			...VALID_FIXTURE,
			findings: [
				{
					...VALID_FIXTURE.findings[0],
					decision: {
						...VALID_FIXTURE.findings[0]?.decision,
						unexpected_field: "should not be here",
					},
				},
				...VALID_FIXTURE.findings.slice(1),
			],
		};
		expect(validate(fixture).ok).toBe(false);
	});

	it("rejects a stale pre-spec-030 shape — a fixable finding missing the required decision.action", () => {
		const fixture = {
			...VALID_FIXTURE,
			findings: [
				{
					id: "F01",
					check: "dead_link",
					tier: "integrity",
					fixable: true,
					target: { path: "Notes/Src.md", stem: "Src" },
					detail: {},
					// pre-spec-030 wires only ever set `selected` — `action`
					// is required per the current schema and must fail loud
					// rather than silently defaulting.
					decision: { selected: true },
				},
			],
		};
		expect(validate(fixture).ok).toBe(false);
	});

	it("rejects an unknown top-level property (additionalProperties:false at root)", () => {
		const fixture = { ...VALID_FIXTURE, extra_root_field: true };
		expect(validate(fixture).ok).toBe(false);
	});

	it("rejects non-object input (number)", () => {
		expect(validate(42).ok).toBe(false);
	});

	it("rejects null input", () => {
		expect(validate(null).ok).toBe(false);
	});

	it("rejects array input", () => {
		expect(validate([]).ok).toBe(false);
	});

	it("validateGardenAuditWire raw export is still accessible from the module", async () => {
		const mod = await import("../../../src/schema/garden-audit-validator.js");
		expect(typeof mod.validateGardenAuditWire).toBe("function");
	});
});
