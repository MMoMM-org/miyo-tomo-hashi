/**
 * The namesake fixture — a real Tomo run (2026-09-08), anonymised by Tomo and
 * handed over 2026-09-09 for exactly this purpose.
 *
 * It is the first fixture carrying the ambiguity `item_key` exists to remove:
 * two suggestions sharing one `stem` in different folders. Content is
 * synthetic; structure, cardinalities and the collision are the real run's.
 * The only edit on vendoring was `schema_version` 1 → 2 (the const moved in
 * Tomo's spec-035 release; the file's daily buckets are empty, so the F9
 * widening does not touch it).
 *
 * What it CANNOT do, and why there is no daily test here: no run Tomo still
 * has exercises `log_links[]`, because their markdown parser dropped every
 * log link before it ever reached a wire (their retraction, 2026-09-11). A
 * fixture that exercises all three daily buckets is owed to us separately.
 */

import { describe, expect, it } from "vitest";
import { validate } from "../../../src/schema/suggestions-validator.js";
import fixture from "../../fixtures/suggestions/namesake-run.json";

describe("namesake fixture (real anonymised Tomo run)", () => {
	it("validates against the vendored v2 wire", () => {
		const result = validate(fixture);
		expect(result.ok, result.ok ? "" : result.message).toBe(true);
	});

	it("carries a colliding stem pair with distinct item_keys", () => {
		const result = validate(fixture);
		if (!result.ok) throw new Error(result.message);
		const stems = result.data.suggestions.map((s) => s.stem);
		const keys = result.data.suggestions.map((s) => s.item_key);

		// The collision is the point: stems are NOT unique, item_keys are.
		expect(new Set(stems).size).toBeLessThan(stems.length);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("the colliding pair differs only by folder", () => {
		const result = validate(fixture);
		if (!result.ok) throw new Error(result.message);
		const byStem = new Map<string, string[]>();
		for (const s of result.data.suggestions) {
			byStem.set(s.stem, [...(byStem.get(s.stem) ?? []), s.item_key]);
		}
		const collided = [...byStem.values()].filter((k) => k.length > 1);
		expect(collided.length).toBeGreaterThan(0);
		for (const keys of collided) {
			const basenames = keys.map((k) => k.slice(k.lastIndexOf("/") + 1));
			expect(new Set(basenames).size).toBe(1);
			expect(new Set(keys).size).toBe(keys.length);
		}
	});
});
