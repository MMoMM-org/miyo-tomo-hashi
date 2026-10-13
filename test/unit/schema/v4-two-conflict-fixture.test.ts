/**
 * The wire-v4 fixture — Tomo's spec-039 release run (2026-10-13), produced by
 * Tomo's own Pass 1 on a fake built from our QA vault's Run A shape. Synthetic
 * Dresden / Leipzig notes; no personal content.
 *
 * v4 adds one required field to every `attachment_conflicts[]` entry,
 * `proposed_dir` (string | null; null = Tomo's configured asset folder). The
 * items are closed and the version is a const, so a Hashi still on v3 shows
 * the error screen on every 039 run — these tests are the vendoring proof.
 *
 * The `.edited.json` sibling is the save Tomo expects from our editor for the
 * "move it, keep the name" decision: folder `Atlas/290 Assets/296 Maps`, name
 * typed back to `karte.png`. Until the #141 control lands, what the editor
 * owes the field is the round-trip.
 */

import { describe, expect, it } from "vitest";

import { validate } from "../../../src/schema/suggestions-validator.js";
import { ObsidianSuggestionsDoc } from "../../../src/suggestions/ObsidianSuggestionsDoc.js";
import { setTitle } from "../../../src/suggestions/transforms/suggestion.js";
import type { SuggestionsWire } from "../../../src/types/suggestions.js";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import edited from "../../fixtures/suggestions/v4-two-conflict-run.edited.json";
import emitted from "../../fixtures/suggestions/v4-two-conflict-run.json";

const DOC_PATH = "100 Inbox/2026-10-13_0900_suggestions.json";

const withConflicts = (conflicts: readonly unknown[]): unknown => ({ ...emitted, attachment_conflicts: conflicts });
const [KARTE] = emitted.attachment_conflicts;

describe("v4 fixture (Tomo spec-039 two-conflict run)", () => {
	it("validates the emitted wire and the editor's expected save", () => {
		for (const doc of [emitted, edited]) {
			const result = validate(doc);
			expect(result.ok, result.ok ? "" : result.message).toBe(true);
		}
	});

	it("emits proposed_dir: null on every conflict; the edited save carries the picked folder", () => {
		expect(emitted.attachment_conflicts.map((c) => c.proposed_dir)).toEqual([null, null]);
		expect(edited.attachment_conflicts[0]).toMatchObject({
			proposed_name: "karte.png",
			proposed_dir: "Atlas/290 Assets/296 Maps",
		});
	});

	it("refuses a v3 document with the fail-loud version message", () => {
		const result = validate({ ...emitted, schema_version: "3" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toBe("Schema version mismatch — expected 4, got 3");
	});

	it("rejects a conflict entry without proposed_dir, naming the field", () => {
		const { proposed_dir: _dropped, ...withoutDir } = KARTE!;
		const result = validate(withConflicts([withoutDir]));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain("proposed_dir");
	});

	it("carries attachment_conflicts, proposed_dir included, back unchanged through an unrelated saved edit", async () => {
		const vault = new FakeVaultFS();
		await vault.create(DOC_PATH, JSON.stringify(edited, null, 2) + "\n");
		const adapter = new ObsidianSuggestionsDoc(vault);

		const model = await adapter.load(DOC_PATH);
		await adapter.save(setTitle(model, "S01", "Dresden, Altstadt"));

		const written = JSON.parse(await vault.read(DOC_PATH)) as SuggestionsWire;
		expect(written.suggestions[0]?.title).toBe("Dresden, Altstadt");
		expect(written.attachment_conflicts).toEqual(edited.attachment_conflicts);
	});
});
