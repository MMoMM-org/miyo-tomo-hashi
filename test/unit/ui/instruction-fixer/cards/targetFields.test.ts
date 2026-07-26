/**
 * Unit tests for the Instruction Fixer's `targetFields` descriptor map
 * (spec-006 Phase 3, T3.2; SDD ADR-5).
 *
 * The sweep is driven off `TARGET_FIELD_WHITELIST` itself — the ONE roster
 * `setTargetField` enforces its writes against — so a kind or field added
 * there without a descriptor fails here rather than silently rendering a card
 * with a missing control.
 */

import { describe, expect, it } from "vitest";

import { TARGET_FIELD_WHITELIST } from "../../../../../src/instruction-fixer/transforms";
import type { Action } from "../../../../../src/schema/types";
import {
	readTargetFieldValue,
	targetFieldsFor,
} from "../../../../../src/ui/instruction-fixer/cards/targetFields";

import { SAMPLES, VIEW_ONLY_KINDS, repairKinds } from "./helpers";

describe("targetFieldsFor — the ADR-5 roster", () => {
	it.each(repairKinds())("%s renders exactly its whitelisted fields, in roster order", (kind) => {
		const whitelist: readonly string[] = TARGET_FIELD_WHITELIST[kind];

		const fields = targetFieldsFor(SAMPLES[kind]);

		expect(fields.map((field) => field.key)).toEqual([...whitelist]);
	});

	it.each(repairKinds())("%s gives every field a label and a placeholder", (kind) => {
		for (const field of targetFieldsFor(SAMPLES[kind])) {
			expect(field.spec.label.length).toBeGreaterThan(0);
			expect(field.spec.placeholder.length).toBeGreaterThan(0);
		}
	});

	it.each(VIEW_ONLY_KINDS)("%s is view-only — no target fields at all", (kind) => {
		expect(targetFieldsFor(SAMPLES[kind])).toEqual([]);
	});

	it("carries each field's current value alongside its descriptor", () => {
		const fields = targetFieldsFor(SAMPLES.resolve_dead_link);

		expect(fields.map((field) => field.value)).toEqual([
			"Atlas/202 Notes/Existing.md",
			"Dead Note",
			"",
		]);
	});
});

describe("readTargetFieldValue", () => {
	it("reads a plain string field verbatim", () => {
		expect(readTargetFieldValue(SAMPLES.edit_note_text, "path")).toBe(
			"Atlas/202 Notes/Existing.md",
		);
	});

	it("reads an empty string field as empty (not as missing)", () => {
		expect(readTargetFieldValue(SAMPLES.edit_note_text, "replace")).toBe("");
	});

	it("reads `anchor` through its nested `value`", () => {
		expect(readTargetFieldValue(SAMPLES.link_to_moc, "anchor")).toBe("Tools");
	});

	it("reads an unresolved (null) anchor value as empty, never the string 'null'", () => {
		const unresolved: Action = {
			id: "I01",
			action: "replace_section",
			target_path: "Atlas/202 Notes/Board.md",
			anchor: { type: "heading", value: null },
			content: "body",
		};

		expect(readTargetFieldValue(unresolved, "anchor")).toBe("");
	});

	it("reads a field the action does not carry as empty", () => {
		expect(readTargetFieldValue(SAMPLES.link_to_moc, "not_a_field")).toBe("");
	});
});
