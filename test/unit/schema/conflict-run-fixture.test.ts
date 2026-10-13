/**
 * The conflict fixture — Tomo's spec-038 Run A (2026-10-11), handed over with
 * the wire-v3 release for exactly this purpose. Not a real vault run: the
 * `tomo-instance` test vault (Bautzen / Dresden / Meissen), vendored verbatim.
 *
 * It is the first run either side holds that carries an
 * `attachment_conflicts[]` entry. Wire v3 makes that field required on a
 * closed top-level node, so a Hashi still pinned to v2 shows the error screen
 * on every 038 run — these tests are the vendoring proof.
 *
 * The editor has no conflict control yet (#141). What it owes the field today
 * is the round-trip: an unrelated saved edit must carry the entry back to Tomo
 * unchanged, because Pass 2 reads the JSON alone once `emit_digest` moves.
 */

import { describe, expect, it } from "vitest";

import { validate } from "../../../src/schema/suggestions-validator.js";
import { ObsidianSuggestionsDoc } from "../../../src/suggestions/ObsidianSuggestionsDoc.js";
import { setTitle } from "../../../src/suggestions/transforms/suggestion.js";
import type { SuggestionsWire } from "../../../src/types/suggestions.js";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import fixture from "../../fixtures/suggestions/conflict-run.json";

const DOC_PATH = "100 Inbox/2026-10-11_0802_suggestions.json";

const CONFLICT = {
	source: "100 Inbox/Scans/karte.png",
	destination: "Atlas/290 Assets/295 Attachments/karte.png",
	same_file: false,
	remedy: "rename",
	proposed_name: "karte (2).png",
	proposed_dir: null,
} as const;

const withConflicts = (conflicts: readonly unknown[]): unknown => ({
	...fixture,
	attachment_conflicts: conflicts,
});

describe("conflict fixture (Tomo spec-038 Run A)", () => {
	it("validates against the vendored v3 wire", () => {
		const result = validate(fixture);
		expect(result.ok, result.ok ? "" : result.message).toBe(true);
	});

	it("carries one conflict whose source joins to an owning suggestion's attachments", () => {
		const result = validate(fixture);
		if (!result.ok) throw new Error(result.message);

		expect(result.data.attachment_conflicts).toEqual([CONFLICT]);
		const owners = result.data.suggestions.filter((s) => s.attachments.includes(CONFLICT.source));
		expect(owners.map((s) => s.item_key)).toEqual(["100 Inbox/Dresden.md"]);
	});

	it("accepts same_file: null and proposed_name: null (no comparison, no free name)", () => {
		const result = validate(withConflicts([{ ...CONFLICT, same_file: null, proposed_name: null, remedy: "keep_in_inbox" }]));
		expect(result.ok, result.ok ? "" : result.message).toBe(true);
	});

	it("rejects a run without attachment_conflicts, naming the field", () => {
		const { attachment_conflicts: _dropped, ...withoutConflicts } = fixture;
		const result = validate(withoutConflicts);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain("attachment_conflicts");
	});

	it("rejects a conflict entry carrying an unknown field", () => {
		const result = validate(withConflicts([{ ...CONFLICT, owners: ["100 Inbox/Dresden.md"] }]));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain("owners");
	});

	it("rejects a remedy outside rename | keep_in_inbox | ignore", () => {
		expect(validate(withConflicts([{ ...CONFLICT, remedy: "overwrite" }])).ok).toBe(false);
	});

	it("carries attachment_conflicts back unchanged through an unrelated saved edit", async () => {
		const vault = new FakeVaultFS();
		await vault.create(DOC_PATH, JSON.stringify(fixture, null, 2) + "\n");
		const adapter = new ObsidianSuggestionsDoc(vault);

		const model = await adapter.load(DOC_PATH);
		const firstId = model.doc.suggestions[0]?.id;
		if (!firstId) throw new Error("fixture has no suggestions");
		await adapter.save(setTitle(model, firstId, "Retitled"));

		const written = JSON.parse(await vault.read(DOC_PATH)) as SuggestionsWire;
		expect(written.suggestions[0]?.title).toBe("Retitled");
		expect(written.attachment_conflicts).toEqual(fixture.attachment_conflicts);
		expect(written.suggestions.map((s) => s.attachments)).toEqual(fixture.suggestions.map((s) => s.attachments));
	});
});
