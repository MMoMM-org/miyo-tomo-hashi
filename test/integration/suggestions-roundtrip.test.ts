/**
 * Round-trip fidelity tests (spec-004 Phase 2, T2.3; SDD §9 mandatory
 * tests) — the "own-the-whole-document" guarantee (ADR-S4) exercised
 * end-to-end through ObsidianSuggestionsDoc + FakeVaultFS + the real
 * Phase-1 transforms, never by hand-editing `model.doc` directly.
 *
 * Three scenarios, each proving a different way Hashi could silently
 * corrupt a Tomo emission on the way back out:
 *   (a) a real edit must carry `emit_digest` verbatim — Hashi never
 *       recomputes it; the digest/payload mismatch is Tomo's own
 *       change-detection signal for Pass 2, not something Hashi manages.
 *   (b) the dirty gate must be exact: dirty:false writes nothing, and a
 *       forced-dirty save of an otherwise-unchanged doc must round-trip
 *       byte-for-byte (as a parsed-JSON deep-equal) so Tomo's canonical
 *       digest still matches.
 *   (c) fields the UI never renders (daily_updates, tag_handler_groups)
 *       must survive an unrelated edit untouched — the schema's
 *       additionalProperties:false is what would catch a dropped field,
 *       so re-validation is part of the proof, not decoration.
 *
 * Seeded from test/fixtures/suggestions/1115.json — the one pre-anonymized
 * fixture allowed under the MiYo Constitution's local-first/privacy rules.
 * It already carries populated daily_updates + tag_handler_groups, so no
 * synthetic second fixture is needed for scenario (c).
 */

import { describe, expect, it } from "vitest";

import { ObsidianSuggestionsDoc } from "../../src/suggestions/ObsidianSuggestionsDoc.js";
import { setDecision, setTitle } from "../../src/suggestions/transforms/suggestion.js";
import { validate } from "../../src/schema/suggestions-validator.js";
import type { EditModel, SuggestionsWire } from "../../src/types/suggestions.js";
import { FakeVaultFS } from "../../src/vault/FakeVaultFS.js";
import rawFixture from "../fixtures/suggestions/1115.json";

const DOC_PATH = "100 Inbox/2026-07-06_1115_suggestions.json";
const MD_PATH = "100 Inbox/2026-07-06_1115_suggestions.md";

async function seededVault(): Promise<FakeVaultFS> {
	const vault = new FakeVaultFS();
	await vault.create(DOC_PATH, JSON.stringify(rawFixture, null, 2) + "\n");
	await vault.create(MD_PATH, "stale courtesy markdown from a prior Tomo run\n");
	return vault;
}

describe("round-trip fidelity — load -> edit one field -> save -> emit_digest verbatim", () => {
	it("carries emit_digest through a real setDecision() edit byte-identical to the source fixture", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianSuggestionsDoc(vault);
		const loaded = await adapter.load(DOC_PATH);

		// S07 is "approve" in the fixture; flip it via the real Phase-1 transform.
		const edited = setDecision(loaded, "S07", "skip");
		expect(edited.dirty).toBe(true); // sanity: the transform did register a change

		await adapter.save(edited);

		const written = JSON.parse(await vault.read(DOC_PATH)) as SuggestionsWire;
		expect(written.emit_digest).toBe(rawFixture.emit_digest);
		// the edited field really did change on disk — proves this isn't a
		// vacuous digest check against an unedited write.
		const writtenS07 = written.suggestions.find((s) => s.id === "S07");
		expect(writtenS07?.decision).toBe("skip");
	});
});

describe("round-trip fidelity — no-edit save is byte-stable", () => {
	it("writes nothing when the model is not dirty", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianSuggestionsDoc(vault);
		const loaded = await adapter.load(DOC_PATH);
		expect(loaded.dirty).toBe(false);

		await adapter.save(loaded);

		expect(await vault.read(DOC_PATH)).toBe(JSON.stringify(rawFixture, null, 2) + "\n");
	});

	it("round-trips an otherwise-unchanged doc byte-for-byte (parsed deep-equal) when forced dirty", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianSuggestionsDoc(vault);
		const loaded = await adapter.load(DOC_PATH);

		// Force-dirty save with NO field changed — simulates a UI action that
		// flips dirty without actually altering the payload (e.g. toggling a
		// field back to its original value should still be safe to save).
		const forcedDirty: EditModel = { doc: loaded.doc, dirty: true };
		await adapter.save(forcedDirty);

		const written = JSON.parse(await vault.read(DOC_PATH)) as SuggestionsWire;
		expect(written).toEqual(loaded.doc);
		expect(written.emit_digest).toBe(rawFixture.emit_digest);
	});
});

describe("round-trip fidelity — UI-untouched fields survive an unrelated edit", () => {
	it("leaves daily_updates and tag_handler_groups byte-for-byte identical after an unrelated setTitle() edit", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianSuggestionsDoc(vault);
		const loaded = await adapter.load(DOC_PATH);

		// Sanity: the fixture actually carries non-empty daily/tag-handler
		// data, otherwise this test would prove nothing.
		expect(loaded.doc.daily_updates.length).toBeGreaterThan(0);
		expect(loaded.doc.tag_handler_groups.length).toBeGreaterThan(0);

		const edited = setTitle(loaded, "S01", "Vendor call — renamed via Hashi");
		expect(edited.dirty).toBe(true);

		await adapter.save(edited);

		const written = JSON.parse(await vault.read(DOC_PATH)) as SuggestionsWire;
		expect(written.daily_updates).toEqual(rawFixture.daily_updates);
		expect(written.tag_handler_groups).toEqual(rawFixture.tag_handler_groups);
		// the edit really landed — this isn't a no-op write
		const writtenS01 = written.suggestions.find((s) => s.id === "S01");
		expect(writtenS01?.title).toBe("Vendor call — renamed via Hashi");

		// additionalProperties:false on the schema is what would actually
		// catch a dropped/reordered daily or tag-handler field — prove the
		// written doc is still schema-valid, not merely deep-equal by luck.
		const result = validate(written);
		expect(result.ok).toBe(true);
	});
});
