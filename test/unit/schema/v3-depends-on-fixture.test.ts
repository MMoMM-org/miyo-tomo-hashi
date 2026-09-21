/**
 * The v3 drift guard — Tomo's run `2026-09-18T11-30-00Z-f7d1b1`, the first
 * instruction set we received carrying `schema_version: "3"` and
 * `delete_source.depends_on`.
 *
 * Vendored verbatim from our QA vault. Every string in it is the synthetic 034
 * test-vault corpus (place names, a Zettelkasten note, Test files) — audited
 * before committing, because a real-run fixture in a public repo is how PKM
 * leaks (spec-004 lesson, and Tomo's own anonymiser near-miss).
 *
 * What it exists to hold:
 *   1. `schema_version: "3"` validates, and would have been REFUSED at 0.25.0
 *      with "Schema version mismatch — expected 2, got 3". This fixture is the
 *      thing that fails if someone reverts the const.
 *   2. A `delete_source` with a populated `depends_on` naming a real action in
 *      the same set — the shape the executor's gate reads.
 *   3. Tomo's producer-side guard visible in `tomo.delete_withdrawals`: this
 *      run's daily-note updates (I02/I03) were dropped by their
 *      `filter_missing_daily_notes` because `Calendar/301 Daily/2026-09-15.md`
 *      does not exist, so the delete they justified (I04) was withdrawn rather
 *      than shipped unconditional. Evidence that the "a delete must not outlive
 *      the action that justified it" rule is enforced on both sides, not just
 *      ours.
 *
 * What it CANNOT do: it carries no dangling id and no `[]` depends_on, because
 * a well-behaved producer never emits the first and this run had no
 * user-requested deletion. Both are covered by constructed cases in
 * `test/unit/executor/planner.test.ts` and
 * `test/unit/executor/InstructionExecutor.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { validate } from "../../../src/schema/validator.js";
import fixture from "../../fixtures/instructions/v3-depends-on-run.json";

describe("v3 depends_on fixture (Tomo run 2026-09-18T11-30-00Z-f7d1b1)", () => {
	it("validates against the vendored v3 wire", () => {
		const result = validate(fixture);
		expect(result.ok, result.ok ? "" : result.message).toBe(true);
	});

	it("is schema_version 3 — the const 0.25.0 refused", () => {
		const result = validate(fixture);
		if (!result.ok) throw new Error(result.message);
		expect(result.data.schema_version).toBe("3");
	});

	it("carries a delete_source whose depends_on names an action in the same set", () => {
		const result = validate(fixture);
		if (!result.ok) throw new Error(result.message);

		const deletes = result.data.actions.filter((a) => a.action === "delete_source");
		expect(deletes.length).toBeGreaterThan(0);

		const ids = new Set(result.data.actions.map((a) => a.id));
		const withDeps = deletes.filter((d) => d.depends_on.length > 0);
		expect(withDeps.length).toBeGreaterThan(0);
		for (const del of withDeps) {
			for (const dependsOn of del.depends_on) {
				// No dangling ids — Tomo's invariant, verified rather than assumed.
				expect(ids.has(dependsOn)).toBe(true);
			}
		}
	});

	it("every delete_source carries depends_on — absent is not the same as empty", () => {
		const result = validate(fixture);
		if (!result.ok) throw new Error(result.message);
		for (const del of result.data.actions.filter((a) => a.action === "delete_source")) {
			expect(Array.isArray(del.depends_on)).toBe(true);
		}
	});
});
