import { describe, expect, it } from "vitest";
import { validate } from "../../../src/schema/garden-audit-validator.js";
import type { GardenAuditWire } from "../../../src/types/garden-audit.js";

// ---------------------------------------------------------------------------
// VALID_FIXTURE — the spec-005 SDD §2 example wire (a real Tomo emission).
// Its emit_digest is a syntactically valid sha256 passthrough value
// (matches ^sha256:[a-f0-9]{64}$); Hashi never recomputes it — Tomo
// re-stamps it. See T1.3's current-wire.json fixture, which reuses this
// same doc verbatim.
// ---------------------------------------------------------------------------

const VALID_FIXTURE: GardenAuditWire = {
	schema_version: "2",
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
			expect(result.data.schema_version).toBe("2");
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

	// -----------------------------------------------------------------------
	// Tomo spec 035 release (handoff 2026-09-11). Two disclosures, opposite
	// consequences — worth separate tests because the difference is the whole
	// lesson: an open node absorbs a new field silently, a closed enum does not.
	// -----------------------------------------------------------------------

	it("accepts the parent_not_moc check (closed enum — rejected before this release)", () => {
		const fixture = {
			...VALID_FIXTURE,
			findings: [{ ...VALID_FIXTURE.findings[0], check: "parent_not_moc" }],
		};
		const result = validate(fixture);
		expect(result.ok, result.ok ? "" : result.message).toBe(true);
	});

	it("still rejects a check outside the enum", () => {
		const fixture = {
			...VALID_FIXTURE,
			findings: [{ ...VALID_FIXTURE.findings[0], check: "not_a_real_check" }],
		};
		expect(validate(fixture).ok).toBe(false);
	});

	it("accepts up_source / up_value on detail — and would have before, since detail is open", () => {
		// These rode in undisclosed since Tomo specs 032/033. The test records
		// that the open node is WHY nothing broke, so closing detail later is
		// a decision someone has to make deliberately rather than discover.
		const fixture = {
			...VALID_FIXTURE,
			findings: [{
				...VALID_FIXTURE.findings[0],
				detail: { dead_target: "x", count: 1, up_source: "frontmatter", up_value: "[[A MOC]]" },
			}],
		};
		const result = validate(fixture);
		expect(result.ok, result.ok ? "" : result.message).toBe(true);
	});

	it("rejects schema_version '3' with the fail-loud version-mismatch message", () => {
		// Mirrors the suggestions-validator precedent: the literal
		// "Schema version mismatch — expected X, got Y" form is parsed
		// downstream to drive an "upgrade Hashi" prompt.
		const result = validate({ ...VALID_FIXTURE, schema_version: "3" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toBe(
				"Schema version mismatch — expected 2, got 3",
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

	it("accepts a wire carrying top-level suggest_pending:true (spec-005 Phase 6 suggest_pending gate)", () => {
		const result = validate({ ...VALID_FIXTURE, suggest_pending: true });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.data.suggest_pending).toBe(true);
	});

	it("accepts a decision carrying suggested:true (ADR-7 re-vendor proof — fails against the pre-re-vendor schema's additionalProperties:false)", () => {
		const fixture = {
			...VALID_FIXTURE,
			findings: [
				{
					...VALID_FIXTURE.findings[0],
					decision: {
						...VALID_FIXTURE.findings[0]?.decision,
						suggested: true,
					},
				},
				...VALID_FIXTURE.findings.slice(1),
			],
		};
		expect(validate(fixture).ok).toBe(true);
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
