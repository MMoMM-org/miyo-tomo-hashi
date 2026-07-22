/**
 * Round-trip fidelity for the garden-audit wire (spec-005 Phase 1, T1.3) —
 * proves Hashi's JSON.stringify(doc, null, 2) + "\n" serialization convention
 * (matching test/fixtures/suggestions/1115.json's precedent) doesn't drop or
 * reorder a field, and that `emit_digest` — an opaque Tomo-computed
 * passthrough — survives byte-identical. No vault adapter exists yet at this
 * phase; the round-trip is exercised directly against the parsed fixture.
 */

import { describe, expect, it } from "vitest";

import { validate } from "../../../src/schema/garden-audit-validator.js";
import type { GardenAuditWire } from "../../../src/types/garden-audit.js";
import currentWire from "../../fixtures/garden-audit/current-wire.json";

describe("garden-audit wire round-trip — current-wire.json fixture", () => {
	it("validates as schema-conformant", () => {
		const result = validate(currentWire);
		expect(result.ok).toBe(true);
	});

	it("serializes and re-parses to a deep-equal document", () => {
		const result = validate(currentWire);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const serialized = JSON.stringify(result.data, null, 2) + "\n";
		const reparsed = JSON.parse(serialized) as GardenAuditWire;

		expect(reparsed).toEqual(currentWire);
	});

	it("carries emit_digest byte-identical through the round-trip", () => {
		const result = validate(currentWire);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const serialized = JSON.stringify(result.data, null, 2) + "\n";
		const reparsed = JSON.parse(serialized) as GardenAuditWire;

		expect(reparsed.emit_digest).toBe(
			(currentWire as GardenAuditWire).emit_digest,
		);
	});

	it("nothing is dropped — reparsed findings array is the same length as the source", () => {
		const result = validate(currentWire);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const serialized = JSON.stringify(result.data, null, 2) + "\n";
		const reparsed = JSON.parse(serialized) as GardenAuditWire;

		expect(reparsed.findings).toHaveLength(
			(currentWire as GardenAuditWire).findings.length,
		);
	});
});

describe("garden-audit wire round-trip — stale-shape rejection", () => {
	it("rejects a stale pre-spec-030 doc (decision missing the required 'action' field)", () => {
		const staleDoc = {
			schema_version: "1",
			generated: "2026-01-01T00:00:00Z",
			run_id: "run-stale-001",
			profile: null,
			emit_digest: `sha256:${"0".repeat(64)}`,
			findings: [
				{
					id: "F01",
					check: "dead_link",
					tier: "integrity",
					fixable: true,
					target: { path: "Notes/Src.md", stem: "Src" },
					detail: {},
					// pre-spec-030 wires only ever set `selected` — `action`
					// became required and additionalProperties:false is now
					// enforced, so this must fail loud rather than silently
					// round-tripping a stale shape.
					decision: { selected: true },
				},
			],
		};

		expect(validate(staleDoc).ok).toBe(false);
	});
});
