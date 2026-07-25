import { describe, expect, expectTypeOf, it } from "vitest";

import type {
	CandidateWire,
	DecisionWire,
	FindingCheck,
	FindingTier,
	FindingWire,
	GardenAuditWire,
	TargetWire,
} from "../../../src/types/garden-audit";

// ---------------------------------------------------------------------------
// FindingCheck — 6-literal union (spec 005 SDD §Application Data Models)
// ---------------------------------------------------------------------------

describe("FindingCheck", () => {
	it("is the exact 6-element string-literal union", () => {
		expectTypeOf<FindingCheck>().toEqualTypeOf<
			| "unparented"
			| "orphan"
			| "broken_up"
			| "dead_link"
			| "duplicate_stem"
			| "stale_moc"
		>();
	});

	it("all 6 literals are assignable to FindingCheck", () => {
		const allChecks: FindingCheck[] = [
			"unparented",
			"orphan",
			"broken_up",
			"dead_link",
			"duplicate_stem",
			"stale_moc",
		];
		expect(allChecks).toHaveLength(6);
	});
});

// ---------------------------------------------------------------------------
// FindingTier — 3-literal union
// ---------------------------------------------------------------------------

describe("FindingTier", () => {
	it("is the exact 3-element string-literal union", () => {
		expectTypeOf<FindingTier>().toEqualTypeOf<
			"integrity" | "structure" | "advisory"
		>();
	});
});

// ---------------------------------------------------------------------------
// TargetWire — path + nullable stem
// ---------------------------------------------------------------------------

describe("TargetWire", () => {
	it("stem is string | null", () => {
		const t: TargetWire = { path: "Notes/Src.md", stem: null };
		expectTypeOf(t.stem).toEqualTypeOf<string | null>();
	});
});

// ---------------------------------------------------------------------------
// DecisionWire — per-check optional fields (replace/repoint/file_under),
// candidates as {stem,score}[], suggest_requested.
// ---------------------------------------------------------------------------

describe("DecisionWire", () => {
	it("accepts the dead_link shape (replace, no repoint/file_under)", () => {
		const d: DecisionWire = {
			selected: true,
			action: "edit_note_text",
			replace: "",
			candidates: [],
			suggest_requested: false,
		};
		expect(d.replace).toBe("");
		expectTypeOf(d.repoint).toEqualTypeOf<string | undefined>();
		expectTypeOf(d.file_under).toEqualTypeOf<string | undefined>();
	});

	it("accepts the broken_up shape (repoint, no replace/file_under)", () => {
		const d: DecisionWire = {
			selected: true,
			action: "add_relationship",
			repoint: "[[Correct MOC]]",
			candidates: [],
			suggest_requested: false,
		};
		expect(d.repoint).toBe("[[Correct MOC]]");
	});

	it("accepts the orphan/unparented shape (file_under, no replace/repoint)", () => {
		const d: DecisionWire = {
			selected: true,
			action: "link_to_moc",
			file_under: "[[000 Home MOC]]",
			candidates: [],
			suggest_requested: false,
		};
		expect(d.file_under).toBe("[[000 Home MOC]]");
	});

	it("action is nullable", () => {
		const d: DecisionWire = { selected: false, action: null };
		expectTypeOf(d.action).toEqualTypeOf<string | null>();
	});

	it("candidates is a readonly {stem,score}[] array", () => {
		const candidates: readonly CandidateWire[] = [{ stem: "Src", score: 0.9 }];
		const d: DecisionWire = { selected: true, action: null, candidates };
		expectTypeOf(d.candidates).toEqualTypeOf<readonly CandidateWire[] | undefined>();
	});
});

// ---------------------------------------------------------------------------
// FindingWire — decision present only on fixable findings (advisory omits it)
// ---------------------------------------------------------------------------

describe("FindingWire", () => {
	it("a fixable finding carries a decision block", () => {
		const f: FindingWire = {
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
		};
		expect(f.decision).toBeDefined();
	});

	it("an advisory finding type-checks with no decision field", () => {
		const f: FindingWire = {
			id: "F09",
			check: "stale_moc",
			tier: "advisory",
			fixable: false,
			target: { path: "MOCs/Old.md", stem: "Old" },
			detail: { mtime: "2026-01-01T00:00:00Z" },
		};
		expect(f.decision).toBeUndefined();
		expectTypeOf(f.decision).toEqualTypeOf<DecisionWire | undefined>();
	});

	it("detail is an opaque per-check object", () => {
		const f: FindingWire = {
			id: "F05",
			check: "duplicate_stem",
			tier: "advisory",
			fixable: false,
			target: { path: "Notes/Dup.md", stem: "Dup" },
			detail: { dupes: ["Notes/Dup.md", "Archive/Dup.md"] },
		};
		expectTypeOf(f.detail).toEqualTypeOf<Record<string, unknown>>();
	});
});

// ---------------------------------------------------------------------------
// GardenAuditWire — top-level shape (opaque emit_digest, optional approved)
// ---------------------------------------------------------------------------

describe("GardenAuditWire", () => {
	it("schema_version is typed as string literal '1', not number 1", () => {
		expectTypeOf<GardenAuditWire["schema_version"]>().toEqualTypeOf<"1">();
	});

	it("approved is optional boolean", () => {
		expectTypeOf<GardenAuditWire["approved"]>().toEqualTypeOf<
			boolean | undefined
		>();
	});

	it("emit_digest is an opaque passthrough string", () => {
		expectTypeOf<GardenAuditWire["emit_digest"]>().toEqualTypeOf<string>();
	});

	it("profile is nullable", () => {
		expectTypeOf<GardenAuditWire["profile"]>().toEqualTypeOf<string | null>();
	});

	it("findings is a readonly array of FindingWire", () => {
		expectTypeOf<GardenAuditWire["findings"]>().toEqualTypeOf<
			readonly FindingWire[]
		>();
	});

	it("accepts a minimal valid doc with no findings and approved omitted", () => {
		const doc: GardenAuditWire = {
			schema_version: "1",
			generated: "2026-07-22T12:00:00Z",
			run_id: "run-editor-001",
			profile: null,
			emit_digest: `sha256:${"0".repeat(64)}`,
			findings: [],
		};
		expect(doc.approved).toBeUndefined();
	});
});
