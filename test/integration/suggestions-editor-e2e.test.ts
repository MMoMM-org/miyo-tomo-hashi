/**
 * End-to-end integration test for the Suggestions Editor (spec-004 Phase 4,
 * T4.2; SDD §10, PRD Success Metrics). Drives the WHOLE stack for real: the
 * `ObsidianSuggestionsDoc` adapter backed by `FakeVaultFS`, `SuggestionsStore`,
 * and the actual Phase-1 transforms — one representative edit per tab —
 * then asserts the written JSON through `save()` and re-validates it.
 *
 * The per-tab DOM/picker interactions already have their own unit tests
 * (test/unit/ui/suggestions-view/tabs/*.test.ts); this file's job is proving
 * the tabs' real edit paths compose correctly through the store and the real
 * adapter, not re-testing picker UI. Per the task brief, the candidate-anchor
 * set is applied via a small local helper that mirrors SuggestionsTab.ts's
 * (intentionally unexported, single-call-site) `setCandidateAnchor` byte for
 * byte, driven by a REAL `AnchorWire` built through the exported
 * `computeSpotOptions`/`buildAnchorWire` pair from SpotPicker.ts — not a
 * hand-rolled anchor literal.
 *
 * Seeded from test/fixtures/suggestions/1115.json — the one pre-anonymized
 * fixture allowed under the MiYo Constitution's local-first/privacy rules.
 * proposed_mocs is empty in 1115, so that sub-case uses a synthetic
 * in-memory EditModel variant built inline (never a second fixture file).
 */

import { describe, expect, it } from "vitest";

import { computeSpotOptions, buildAnchorWire, flattenSpotChoices } from "../../src/ui/suggestions-view/pickers/SpotPicker.js";
import { ObsidianSuggestionsDoc } from "../../src/suggestions/ObsidianSuggestionsDoc.js";
import { SuggestionsStore } from "../../src/suggestions/store.js";
import { setDailyLogAccepted, setDailyLogContent } from "../../src/suggestions/transforms/daily.js";
import { renameProposedMoc } from "../../src/suggestions/transforms/proposedMoc.js";
import { selectCandidateMoc, setDecision } from "../../src/suggestions/transforms/suggestion.js";
import { setTagGroupApproved } from "../../src/suggestions/transforms/tagHandler.js";
import { validate } from "../../src/schema/suggestions-validator.js";
import type {
	AnchorWire,
	CandidateMocWire,
	EditModel,
	SuggestionWire,
} from "../../src/types/suggestions.js";
import { FakeVaultFS } from "../../src/vault/FakeVaultFS.js";
import rawFixture from "../fixtures/suggestions/1115.json";

const DOC_PATH = "100 Inbox/2026-07-06_1115_suggestions.json";
const MD_PATH = "100 Inbox/2026-07-06_1115_suggestions.md";
const MOC_PATH = "Atlas/200 Maps/Type of Notes (MOC).md";

// A realistic target-MOC body — gives SpotPicker's computeSpotOptions() real
// headings to choose from, so the anchor set below is a REAL AnchorWire, not
// a hand-rolled literal.
const MOC_CONTENT = ["# Type of Notes", "", "## Existing", "", "- one", ""].join("\n");

/**
 * Simulates the HAPPY PATH of `SuggestionsTab.ts`'s local, intentionally-
 * unexported `setCandidateAnchor` (Phase 1 has no dedicated transform for
 * `candidate_mocs[].anchor`, and the tab is its one call site). Re-implemented
 * here (not imported) because it is not part of the tab's public surface; this
 * test drives it against a REAL `AnchorWire` produced by the real
 * `buildAnchorWire`, so the edit itself is genuine. NOTE: the real helper also
 * carries an `anchorsEqual` no-op guard (skip dirty when re-picking the same
 * spot) that this stand-in omits — that guard is covered directly by T3.2's
 * unit tests (test/unit/ui/suggestions-view/tabs/SuggestionsTab.test.ts), not
 * here.
 */
function setCandidateAnchor(
	model: EditModel,
	suggestionId: string,
	mocPath: string,
	anchor: AnchorWire,
): EditModel {
	const suggestion = model.doc.suggestions.find((s) => s.id === suggestionId);
	if (suggestion === undefined) return model;
	const candidate = suggestion.candidate_mocs.find((c) => c.path === mocPath);
	if (candidate === undefined) return model;

	const candidate_mocs: CandidateMocWire[] = suggestion.candidate_mocs.map((c) =>
		c.path === mocPath ? { ...c, anchor } : c,
	);
	const nextSuggestion: SuggestionWire = { ...suggestion, candidate_mocs };
	const suggestions = model.doc.suggestions.map((s) =>
		s.id === suggestionId ? nextSuggestion : s,
	);
	return { doc: { ...model.doc, suggestions }, dirty: true };
}

async function seededVault(): Promise<FakeVaultFS> {
	const vault = new FakeVaultFS();
	await vault.create(DOC_PATH, JSON.stringify(rawFixture, null, 2) + "\n");
	await vault.create(MD_PATH, "stale courtesy markdown from a prior Tomo run\n");
	await vault.create(MOC_PATH, MOC_CONTENT);
	return vault;
}

/** A real AnchorWire, built through the exported SpotPicker pure core. */
function realAnchorWire(): AnchorWire {
	const options = computeSpotOptions(MOC_CONTENT, "existing");
	const choices = flattenSpotChoices(options);
	const headingChoice = choices.find((c) => c.option.type === "heading");
	if (headingChoice === undefined) {
		throw new Error("test setup: expected at least one heading spot option in MOC_CONTENT");
	}
	return buildAnchorWire(headingChoice);
}

describe("Suggestions Editor end-to-end — one real edit per tab through the real stack", () => {
	it("loads via ObsidianSuggestionsDoc, edits every tab's representative field via the real transforms + store, saves through the real adapter, and round-trips schema-valid with emit_digest + untouched sections byte-identical", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianSuggestionsDoc(vault);
		const loaded = await adapter.load(DOC_PATH);
		const store = new SuggestionsStore(loaded);

		// --- Suggestions tab: select a candidate MOC + flip a decision (S07 is
		// the one worthy, non-suppressed suggestion in the fixture). ---
		store.apply((model) => selectCandidateMoc(model, "S07", MOC_PATH));
		store.apply((model) => setDecision(model, "S07", "skip"));

		// --- (spot pick) anchor a selected candidate — a real AnchorWire built
		// via SpotPicker's own pure core against MOC_CONTENT's real headings. ---
		const anchor = realAnchorWire();
		store.apply((model) => setCandidateAnchor(model, "S07", MOC_PATH, anchor));

		// --- Daily tab: edit a log entry's content + accept it. ---
		store.apply((model) => setDailyLogContent(model, "2026-07-05", 0, "Vendor call rescheduled to Monday."));
		store.apply((model) => setDailyLogAccepted(model, "2026-07-05", 0, true));

		// --- Tag-Handler tab: approve the group. The fixture already has it
		// approved:true, so first flip it off to prove the edit is a REAL
		// change (not a same-value no-op that would leave `dirty` untouched by
		// coincidence), then flip it back on for the actual "approve" edit. ---
		store.apply((model) => setTagGroupApproved(model, "th-sample-project-log-md", false));
		store.apply((model) => setTagGroupApproved(model, "th-sample-project-log-md", true));

		const edited = store.getModel();
		expect(edited.dirty).toBe(true);

		await adapter.save(edited);

		const written = JSON.parse(await vault.read(DOC_PATH)) as typeof rawFixture;

		// --- emit_digest carried verbatim, never recomputed ---
		expect(written.emit_digest).toBe(rawFixture.emit_digest);

		// --- Suggestions tab edits landed ---
		const writtenS07 = written.suggestions.find((s) => s.id === "S07");
		expect(writtenS07?.decision).toBe("skip");
		const writtenMoc = writtenS07?.candidate_mocs.find((c) => c.path === MOC_PATH);
		expect(writtenMoc?.selected).toBe(true);
		// re-point cleared every other candidate's selection (single-select semantics)
		expect(
			writtenS07?.candidate_mocs.filter((c) => c.selected).map((c) => c.path),
		).toEqual([MOC_PATH]);
		expect(writtenMoc?.anchor).toEqual(anchor);

		// --- Daily tab edits landed ---
		const writtenDaily0705 = written.daily_updates.find((d) => d.date === "2026-07-05");
		expect(writtenDaily0705?.log_entries[0]?.content).toBe(
			"Vendor call rescheduled to Monday.",
		);
		expect(writtenDaily0705?.log_entries[0]?.accepted).toBe(true);

		// --- Tag-Handler tab edit landed ---
		const writtenGroup = written.tag_handler_groups.find(
			(g) => g.group_id === "th-sample-project-log-md",
		);
		expect(writtenGroup?.approved).toBe(true);

		// --- Untouched sections byte-identical to the original (own-the-whole-
		// document, PRD F10): the OTHER daily date, and every other suggestion. ---
		const writtenDaily0706 = written.daily_updates.find((d) => d.date === "2026-07-06");
		const originalDaily0706 = rawFixture.daily_updates.find((d) => d.date === "2026-07-06");
		expect(writtenDaily0706).toEqual(originalDaily0706);

		for (const original of rawFixture.suggestions) {
			if (original.id === "S07") continue;
			const writtenOther = written.suggestions.find((s) => s.id === original.id);
			expect(writtenOther).toEqual(original);
		}

		// Read-only fields on S07 itself must also survive untouched.
		expect(writtenS07?.id).toBe("S07");
		expect(writtenS07?.stem).toBe("zettelkasten-method");
		expect(writtenS07?.title).toBe(rawFixture.suggestions.find((s) => s.id === "S07")?.title);
		expect(writtenS07?.suppressed).toBe(false);
		expect(writtenS07?.worthiness).toBe(0.7);

		// Top-level passthrough metadata untouched.
		expect(written.schema_version).toBe(rawFixture.schema_version);
		expect(written.generated).toBe(rawFixture.generated);
		expect(written.run_id).toBe(rawFixture.run_id);
		expect(written.profile).toBe(rawFixture.profile);
		expect(written.source_items).toBe(rawFixture.source_items);
		expect(written.proposed_mocs).toEqual(rawFixture.proposed_mocs);

		// --- the courtesy view file was re-rendered (no longer the stale stub) ---
		const writtenMd = await vault.read(MD_PATH);
		expect(writtenMd).not.toBe("stale courtesy markdown from a prior Tomo run\n");
		expect(writtenMd).toContain(rawFixture.run_id);

		// --- re-run validate() on the written JSON — still schema-valid ---
		const result = validate(written);
		expect(result.ok).toBe(true);
	});

	it("Proposed MOCs tab (synthetic seed — 1115 has none): rename lands, save writes it, untouched fields survive, re-validates", async () => {
		const syntheticMoc = {
			id: "M01",
			topic: "learning-methods",
			name: "Learning Methods (draft)",
			parent: "Atlas/200 Maps/",
			member_ids: ["S02", "S04", "S06"],
			tags: ["topic/mind/concepts"],
			reason: "Groups three related learning-science atomics under one MOC.",
			decision: "skip",
		};
		const synthetic = {
			...rawFixture,
			proposed_mocs: [syntheticMoc],
		};

		const vault = new FakeVaultFS();
		await vault.create(DOC_PATH, JSON.stringify(synthetic, null, 2) + "\n");
		await vault.create(MD_PATH, "stale courtesy markdown from a prior Tomo run\n");

		const adapter = new ObsidianSuggestionsDoc(vault);
		const loaded = await adapter.load(DOC_PATH);
		const store = new SuggestionsStore(loaded);

		store.apply((model) => renameProposedMoc(model, "M01", "Learning Methods"));

		const edited = store.getModel();
		expect(edited.dirty).toBe(true);

		await adapter.save(edited);

		const written = JSON.parse(await vault.read(DOC_PATH)) as typeof synthetic;

		expect(written.emit_digest).toBe(synthetic.emit_digest);
		const writtenMoc = written.proposed_mocs.find((m) => m.id === "M01");
		expect(writtenMoc?.name).toBe("Learning Methods");
		// read-only/unedited fields on the same node survive
		expect(writtenMoc?.parent).toBe(syntheticMoc.parent);
		expect(writtenMoc?.member_ids).toEqual(syntheticMoc.member_ids);
		expect(writtenMoc?.decision).toBe(syntheticMoc.decision);

		// untouched top-level sections byte-identical
		expect(written.suggestions).toEqual(synthetic.suggestions);
		expect(written.daily_updates).toEqual(synthetic.daily_updates);
		expect(written.tag_handler_groups).toEqual(synthetic.tag_handler_groups);

		const result = validate(written);
		expect(result.ok).toBe(true);
	});

	it("dirty-gating end-to-end: a load -> save with no edit writes nothing, so Tomo stays on the markdown path", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianSuggestionsDoc(vault);
		const loaded = await adapter.load(DOC_PATH);
		const store = new SuggestionsStore(loaded);

		expect(store.getModel().dirty).toBe(false);

		const beforeJson = await vault.read(DOC_PATH);
		const beforeMd = await vault.read(MD_PATH);

		await adapter.save(store.getModel());

		expect(await vault.read(DOC_PATH)).toBe(beforeJson);
		// the courtesy markdown is untouched too — save() no-ops entirely on a
		// clean model, it does not even re-render the disposable courtesy view.
		expect(await vault.read(MD_PATH)).toBe(beforeMd);
	});
});
