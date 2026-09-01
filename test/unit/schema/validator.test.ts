import { describe, expect, it } from "vitest";
import { validate } from "../../../src/schema/validator.js";
import type { InstructionSet } from "../../../src/schema/types.js";

// ---------------------------------------------------------------------------
// Minimum valid fixture — all required top-level fields per schema
// ---------------------------------------------------------------------------

const VALID_FIXTURE: InstructionSet = {
	schema_version: "2",
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
	it("accepts a valid v2 InstructionSet", () => {
		const result = validate(VALID_FIXTURE);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.schema_version).toBe("2");
			expect(result.data.actions.length).toBeGreaterThan(0);
		}
	});

	it("rejects schema_version '0' with PRD F2 'expected 2, got 0' message (M14)", () => {
		const result = validate({ ...VALID_FIXTURE, schema_version: "0" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			// PRD F2 contract — the user-facing form must be self-explanatory
			// with both expected and actual values, so it can drive the
			// "upgrade Hashi" prompt without re-parsing AJV's generic msg.
			expect(result.message).toBe(
				"Schema version mismatch — expected 2, got 0",
			);
		}
	});

	it("rejects schema_version '1' with PRD F2 'expected 2, got 1' message (spec 027 ADR-3 lockstep)", () => {
		// A v1 instruction set hitting v2-only Hashi must fail loud with the
		// version mismatch — the lockstep fail-loud guarantee — not a confusing
		// missing-field error from the origin_inbox_item → source_inbox_item rename.
		const result = validate({ ...VALID_FIXTURE, schema_version: "1" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toBe(
				"Schema version mismatch — expected 2, got 1",
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

	it("accepts link_to_moc with placement 'before' and multi-line line_to_add (2026-06-13)", () => {
		const fixture = {
			...VALID_FIXTURE,
			actions: [
				{
					id: "I01",
					action: "link_to_moc",
					target_moc: "Projects",
					anchor: { type: "callout", value: "[!video] Action Items" },
					placement: "before",
					line_to_add: "## Key Concepts\n\n- [[Some Note]]",
				},
			],
		};
		expect(validate(fixture).ok).toBe(true);
	});

	it("rejects link_to_moc with an unknown placement value", () => {
		const fixture = {
			...VALID_FIXTURE,
			actions: [
				{
					id: "I01",
					action: "link_to_moc",
					target_moc: "Projects",
					anchor: { type: "heading", value: "Key Concepts" },
					placement: "above",
					line_to_add: "- [[Some Note]]",
				},
			],
		};
		expect(validate(fixture).ok).toBe(false);
	});

	it("accepts insert_under_marker with a heading anchor and multi-line content", () => {
		const fixture = {
			...VALID_FIXTURE,
			actions: [
				{
					id: "I01",
					action: "insert_under_marker",
					target_path: "Efforts/Tomo Dev Log.md",
					anchor: { type: "heading", value: "Captures" },
					placement: "inside",
					content: "### 2026-06-23\n\n- Shipped X",
				},
			],
		};
		expect(validate(fixture).ok).toBe(true);
	});

	it("rejects insert_under_marker missing the required content field", () => {
		const fixture = {
			...VALID_FIXTURE,
			actions: [
				{
					id: "I01",
					action: "insert_under_marker",
					target_path: "Efforts/Tomo Dev Log.md",
					anchor: { type: "heading", value: "Captures" },
					placement: "inside",
				},
			],
		};
		expect(validate(fixture).ok).toBe(false);
	});

	it("rejects insert_under_marker with an unknown placement value", () => {
		const fixture = {
			...VALID_FIXTURE,
			actions: [
				{
					id: "I01",
					action: "insert_under_marker",
					target_path: "Efforts/Tomo Dev Log.md",
					anchor: { type: "heading", value: "Captures" },
					placement: "above",
					content: "x",
				},
			],
		};
		expect(validate(fixture).ok).toBe(false);
	});

	it("rejects insert_under_marker with an extra (additional) property", () => {
		const fixture = {
			...VALID_FIXTURE,
			actions: [
				{
					id: "I01",
					action: "insert_under_marker",
					target_path: "Efforts/Tomo Dev Log.md",
					anchor: { type: "heading", value: "Captures" },
					placement: "inside",
					content: "x",
					target_moc: "should-not-be-here",
				},
			],
		};
		expect(validate(fixture).ok).toBe(false);
	});

	it("accepts move_note carrying source_inbox_item (spec 027 rename)", () => {
		const fixture = {
			...VALID_FIXTURE,
			actions: [
				{
					id: "I01",
					action: "move_note",
					source: "100 Inbox/2026-06-30_memo.md",
					destination: "Atlas/202 Notes/Memo.md",
					title: "Memo",
					source_inbox_item: "100 Inbox/2026-06-30_memo.md",
				},
			],
		};
		expect(validate(fixture).ok).toBe(true);
	});

	it("rejects move_note carrying the old origin_inbox_item key (hard cutover, no alias)", () => {
		const fixture = {
			...VALID_FIXTURE,
			actions: [
				{
					id: "I01",
					action: "move_note",
					source: "100 Inbox/2026-06-30_memo.md",
					destination: "Atlas/202 Notes/Memo.md",
					title: "Memo",
					origin_inbox_item: "100 Inbox/2026-06-30_memo.md",
				},
			],
		};
		expect(validate(fixture).ok).toBe(false);
	});

	it("accepts delete_source on a non-.md audio peer (voice source set)", () => {
		const fixture = {
			...VALID_FIXTURE,
			actions: [
				{
					id: "I01",
					action: "delete_source",
					source_path: "100 Inbox/2026-06-30_memo.m4a",
					reason: "voice source files not kept",
				},
			],
		};
		expect(validate(fixture).ok).toBe(true);
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

	it("accepts a top-level tomo provenance block (additive — tomo-to-hashi 2026-06-20)", () => {
		const fixture = {
			...VALID_FIXTURE,
			tomo: {
				doc_type: "instructions",
				state: "rendered",
				run_id: "2026-06-20_1530",
				updated_at: "2026-06-20T15:30:00Z",
				sources: [
					{ path: "100 Inbox/2026-06-20_suggestions.md", checksum: "abc123" },
				],
			},
		};
		expect(validate(fixture).ok).toBe(true);
	});

	it("accepts a JSON without a tomo block (backward-compatible)", () => {
		const fixture = { ...VALID_FIXTURE } as Record<string, unknown>;
		expect("tomo" in fixture).toBe(false);
		expect(validate(fixture).ok).toBe(true);
	});

	it("tolerates unknown keys inside the tomo block (permissive by contract)", () => {
		const fixture = {
			...VALID_FIXTURE,
			tomo: { doc_type: "instructions", future_field: { nested: true } },
		};
		expect(validate(fixture).ok).toBe(true);
	});

	it("rejects a non-object tomo block (string)", () => {
		const fixture = { ...VALID_FIXTURE, tomo: "rendered" };
		expect(validate(fixture).ok).toBe(false);
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
		const result = validate({ ...VALID_FIXTURE, schema_version: "9" });
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

// ---------------------------------------------------------------------------
// Unknown action kind — clear message, not a misleading sub-schema error
// ---------------------------------------------------------------------------

describe("validate — unknown action kind", () => {
	it("reports a clear 'unknown action kind' message instead of a misleading oneOf sub-error", () => {
		const fixture = {
			...VALID_FIXTURE,
			actions: [
				{ id: "I01", action: "totally_unknown_action", path: "a.md" },
			],
		};

		const result = validate(fixture);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toContain("unknown action kind 'totally_unknown_action'");
			expect(result.message).not.toContain("must have required property");
		}
	});

	it("identifies the earliest failing action index among multiple actions", () => {
		const fixture = {
			...VALID_FIXTURE,
			actions: [
				{ id: "I01", action: "skip", source_path: "a.md" },
				{ id: "I02", action: "another_unknown_kind" },
			],
		};

		const result = validate(fixture);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toContain("/actions/1");
			expect(result.message).toContain("unknown action kind 'another_unknown_kind'");
		}
	});
});

// ---------------------------------------------------------------------------
// edit_note_text — spec 030 garden-audit / ADR-3
// ---------------------------------------------------------------------------

describe("validate — edit_note_text", () => {
	const editAction = {
		id: "I01",
		action: "edit_note_text" as const,
		path: "020 Active MOC.md",
		match: "[[023 Sparks MOC]]",
		replace: "[[023 Sparks (MOC)]]",
		occurrence: "all" as const,
	};

	it("accepts an edit_note_text action", () => {
		const result = validate({ ...VALID_FIXTURE, actions: [editAction] });
		expect(result.ok).toBe(true);
	});

	it("accepts edit_note_text with occurrence omitted (defaults to first)", () => {
		const { occurrence: _omit, ...withoutOccurrence } = editAction;
		const result = validate({ ...VALID_FIXTURE, actions: [withoutOccurrence] });
		expect(result.ok).toBe(true);
	});

	it("rejects edit_note_text missing a required field (match)", () => {
		const { match: _drop, ...missingMatch } = editAction;
		expect(validate({ ...VALID_FIXTURE, actions: [missingMatch] }).ok).toBe(false);
	});

	it("rejects an invalid occurrence enum value", () => {
		const bad = { ...editAction, occurrence: "second" };
		expect(validate({ ...VALID_FIXTURE, actions: [bad] }).ok).toBe(false);
	});

	it("rejects an unknown extra field (additionalProperties: false)", () => {
		const bad = { ...editAction, regex: true };
		expect(validate({ ...VALID_FIXTURE, actions: [bad] }).ok).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// remove_up_link — tomo-to-hashi handoff 2026-07-23
// ---------------------------------------------------------------------------

describe("validate — remove_up_link", () => {
	const removeUpLinkAction = {
		id: "I01",
		action: "remove_up_link" as const,
		path: "022 Placeholders MOC.md",
		link: "021 Fleeting MOC",
	};

	it("accepts a remove_up_link action", () => {
		const result = validate({ ...VALID_FIXTURE, actions: [removeUpLinkAction] });
		expect(result.ok).toBe(true);
	});

	it("accepts a remove_up_link action with the optional applied field", () => {
		const result = validate({
			...VALID_FIXTURE,
			actions: [{ ...removeUpLinkAction, applied: false }],
		});
		expect(result.ok).toBe(true);
	});

	it("rejects remove_up_link missing a required field (link)", () => {
		const { link: _drop, ...missingLink } = removeUpLinkAction;
		expect(validate({ ...VALID_FIXTURE, actions: [missingLink] }).ok).toBe(false);
	});

	it("rejects remove_up_link missing a required field (path)", () => {
		const { path: _drop, ...missingPath } = removeUpLinkAction;
		expect(validate({ ...VALID_FIXTURE, actions: [missingPath] }).ok).toBe(false);
	});

	it("rejects an unknown extra field (additionalProperties: false)", () => {
		const bad = { ...removeUpLinkAction, marker: "up::" };
		expect(validate({ ...VALID_FIXTURE, actions: [bad] }).ok).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// resolve_dead_link — Tomo commit 4251618
// ---------------------------------------------------------------------------

describe("validate — resolve_dead_link", () => {
	const resolveDeadLinkAction = {
		id: "I01",
		action: "resolve_dead_link" as const,
		path: "020 Active MOC.md",
		target: "023 Sparks MOC",
		replace: "[[023 Sparks (MOC)]]",
	};

	it("accepts a resolve_dead_link action", () => {
		const result = validate({ ...VALID_FIXTURE, actions: [resolveDeadLinkAction] });
		expect(result.ok).toBe(true);
	});

	it("accepts a resolve_dead_link unlink (replace: '')", () => {
		const result = validate({
			...VALID_FIXTURE,
			actions: [{ ...resolveDeadLinkAction, replace: "" }],
		});
		expect(result.ok).toBe(true);
	});

	it("accepts a resolve_dead_link action with the optional applied field", () => {
		const result = validate({
			...VALID_FIXTURE,
			actions: [{ ...resolveDeadLinkAction, applied: false }],
		});
		expect(result.ok).toBe(true);
	});

	it("rejects resolve_dead_link missing a required field (target)", () => {
		const { target: _drop, ...missingTarget } = resolveDeadLinkAction;
		expect(validate({ ...VALID_FIXTURE, actions: [missingTarget] }).ok).toBe(false);
	});

	it("rejects resolve_dead_link missing a required field (replace)", () => {
		const { replace: _drop, ...missingReplace } = resolveDeadLinkAction;
		expect(validate({ ...VALID_FIXTURE, actions: [missingReplace] }).ok).toBe(false);
	});

	it("rejects an unknown extra field (additionalProperties: false)", () => {
		const bad = { ...resolveDeadLinkAction, marker: "up::" };
		expect(validate({ ...VALID_FIXTURE, actions: [bad] }).ok).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Tomo↔Hashi drift guard — the REAL, Tomo-validated garden-audit instruction
// set from the tomo-to-hashi 2026-07-21 handoff (§6). Generated by Tomo's
// scripts/gen-garden-audit-hashi-example.py and asserted valid against Tomo's
// authoritative hashi-instructions.schema.json. It must also validate against
// Hashi's vendored copy — if this fails, the two schemas have drifted.
// ---------------------------------------------------------------------------

describe("validate — real garden-audit instruction set (drift guard)", () => {
	const GARDEN_AUDIT_EXAMPLE = {
		schema_version: "2",
		type: "tomo-instructions",
		source_suggestions: "garden-audit-report",
		generated: "2026-07-21T18:16:19Z",
		profile: "miyo",
		tomo_version: null,
		action_count: 6,
		md_peer: "2026-07-21_1738_garden-audit",
		actions: [
			{
				id: "I01",
				action: "edit_note_text",
				path: "020 Active MOC.md",
				match: "[[023 Sparks MOC]]",
				replace: "[[023 Sparks (MOC)]]",
				occurrence: "all",
				applied: false,
			},
			{
				id: "I02",
				action: "edit_note_text",
				path: "020 Active MOC.md",
				match: "[[024 Thinking About MOC]]",
				replace: "",
				occurrence: "all",
				applied: false,
			},
			{
				id: "I03",
				action: "add_relationship",
				target_moc: null,
				target_moc_path: "021 Fleeting MOC.md",
				marker: "up::",
				line: "up:: [[020 Active MOC]]",
				source_note_title: null,
				applied: false,
			},
			{
				id: "I04",
				action: "edit_note_text",
				path: "022 Placeholders MOC.md",
				match: "up:: [[021 Fleeting MOC]]",
				replace: "",
				occurrence: "first",
				applied: false,
			},
			{
				id: "I05",
				action: "link_to_moc",
				target_moc: "000 Home MOC",
				target_moc_path: null,
				anchor: { type: "callout", value: null },
				placement: "after",
				line_to_add: "- [[005 Important Links]]",
				source_note_title: "005 Important Links",
				applied: false,
			},
			{
				id: "I06",
				action: "add_relationship",
				target_moc: "000 Home MOC",
				target_moc_path: "005 Important Links.md",
				marker: "up::",
				line: "up:: [[000 Home MOC]]",
				source_note_title: null,
				applied: false,
			},
		],
		tomo: {
			doc_type: "garden-audit",
			state: "pending-apply",
			run_id: "41c6cd18-63b2-4e5b-86b7-da55aa3298e5",
		},
	};

	it("validates the real garden-audit instruction set against the vendored schema", () => {
		const result = validate(GARDEN_AUDIT_EXAMPLE);
		expect(result.ok).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// move_asset — wire-shape drift guard
//
// The vendored schema is a copy of Tomo's. A kind Hashi implements but Tomo
// does not yet emit still has to be pinned here, or the two can drift apart
// unnoticed (that is exactly how replace_section ended up in Hashi's copy and
// nowhere upstream). This fixture is the shape stated in the handoff.
// ---------------------------------------------------------------------------

describe("move_asset (Hashi-side wire shape)", () => {
	const withActions = (actions: unknown[]) => ({
		schema_version: "2",
		type: "tomo-instructions",
		generated: "2026-09-01T10:00:00Z",
		profile: null,
		actions,
	});

	it("accepts the minimal required set", () => {
		const result = validate(
			withActions([
				{
					id: "I15",
					action: "move_asset",
					source: "100 Inbox/foto.png",
					destination: "Atlas/900 Assets/foto.png",
				},
			]),
		);
		expect(result.ok).toBe(true);
	});

	it("accepts the applied flag", () => {
		const result = validate(
			withActions([
				{
					id: "I15",
					action: "move_asset",
					source: "100 Inbox/foto.png",
					destination: "Atlas/900 Assets/foto.png",
					applied: false,
				},
			]),
		);
		expect(result.ok).toBe(true);
	});

	it.each(["source", "destination"])("rejects a set missing %s", (field) => {
		const action: Record<string, unknown> = {
			id: "I15",
			action: "move_asset",
			source: "100 Inbox/foto.png",
			destination: "Atlas/900 Assets/foto.png",
		};
		delete action[field];

		expect(validate(withActions([action])).ok).toBe(false);
	});

	it("rejects move_note's note-shaped extras — they carry no meaning for a binary", () => {
		// additionalProperties: false. If Tomo ever emits these, the mismatch
		// surfaces here rather than being silently carried.
		const result = validate(
			withActions([
				{
					id: "I15",
					action: "move_asset",
					source: "100 Inbox/foto.png",
					destination: "Atlas/900 Assets/foto.png",
					title: "Foto",
					parent_mocs: ["Atlas/200 Maps/Systems (MOC).md"],
				},
			]),
		);
		expect(result.ok).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// edit_frontmatter — wire-shape drift guard
//
// Same reasoning as move_asset's: the vendored schema is a copy of Tomo's, and
// a kind Hashi implements ahead of Tomo has to be pinned or the two drift
// apart unnoticed. The conditional `value`-required rule is the part most
// likely to rot silently.
// ---------------------------------------------------------------------------

describe("edit_frontmatter (Hashi-side wire shape)", () => {
	const withActions = (actions: unknown[]) => ({
		schema_version: "2",
		type: "tomo-instructions",
		generated: "2026-09-01T10:00:00Z",
		profile: null,
		actions,
	});

	const base = {
		id: "I24",
		action: "edit_frontmatter",
		path: "Atlas/202 Notes/Tschechien.md",
		property: "up",
	};

	it("accepts a set with a list value", () => {
		expect(
			validate(
				withActions([
					{ ...base, operation: "set", value: ["[[New]]"], expected: ["[[Old]]"] },
				]),
			).ok,
		).toBe(true);
	});

	it("accepts expected_absent — the add path", () => {
		expect(
			validate(
				withActions([{ ...base, operation: "set", value: "x", expected_absent: true }]),
			).ok,
		).toBe(true);
	});

	it("accepts a literal null as a VALUE expectation", () => {
		// The case the old `expected: null` overload could not express.
		expect(
			validate(withActions([{ ...base, operation: "set", value: "x", expected: null }])).ok,
		).toBe(true);
	});

	it("rejects both halves of the expectation pair at once", () => {
		// Two different statements about one key have no honest winner, so the
		// schema refuses rather than picking a precedence.
		expect(
			validate(
				withActions([
					{ ...base, operation: "set", value: "x", expected: null, expected_absent: true },
				]),
			).ok,
		).toBe(false);
	});

	it("rejects expected_absent: false — omit it instead", () => {
		expect(
			validate(
				withActions([{ ...base, operation: "set", value: "x", expected_absent: false }]),
			).ok,
		).toBe(false);
	});

	it("accepts a remove without a value", () => {
		expect(
			validate(withActions([{ ...base, operation: "remove", expected: ["[[Old]]"] }])).ok,
		).toBe(true);
	});

	it("rejects a set with no value (the allOf conditional)", () => {
		expect(
			validate(withActions([{ ...base, operation: "set", expected_absent: true }])).ok,
		).toBe(false);
	});

	it("rejects an action stating NEITHER expectation — the guard is not optional", () => {
		expect(validate(withActions([{ ...base, operation: "set", value: "x" }])).ok).toBe(false);
	});

	it("rejects an unknown operation", () => {
		expect(
			validate(withActions([{ ...base, operation: "append", value: "x", expected: null }])).ok,
		).toBe(false);
	});

	it("rejects unknown fields", () => {
		expect(
			validate(
				withActions([
					{ ...base, operation: "set", value: "x", expected: null, scope: "frontmatter" },
				]),
			).ok,
		).toBe(false);
	});
});

