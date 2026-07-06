/**
 * ObsidianSuggestionsDoc (T2.1/T2.2) — the real SuggestionsDoc adapter.
 *
 * Exercised purely through the public SuggestionsDoc port (load/save) plus
 * the exported `renderCourtesyMarkdown` pure function, against a
 * FakeVaultFS — no real Obsidian app in the loop (Constitution L1: pure
 * core testable without a host framework). Seeded from the same real Tomo
 * emission used by FakeSuggestionsDoc (test/fixtures/suggestions/1115.json)
 * per the spec-002 real-data-over-synthetic-fixture lesson.
 */

import { describe, expect, it, vi } from "vitest";

import {
	ObsidianSuggestionsDoc,
	renderCourtesyMarkdown,
} from "../../../src/suggestions/ObsidianSuggestionsDoc.js";
import type { EditModel, SuggestionsWire } from "../../../src/types/suggestions.js";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import type { VaultFS } from "../../../src/vault/VaultFS.js";
import rawFixture from "../../fixtures/suggestions/1115.json";

const DOC_PATH = "100 Inbox/2026-07-06_1115_suggestions.json";
const MD_PATH = "100 Inbox/2026-07-06_1115_suggestions.md";

/** A VaultFS whose process() rejects for one specific path — used to drive the save() failure path. */
function withFailingWrite(base: VaultFS, failPath: string): VaultFS {
	return {
		read: (path) => base.read(path),
		cachedRead: (path) => base.cachedRead(path),
		readJSON: (path) => base.readJSON(path),
		exists: (path) => base.exists(path),
		list: (folder) => base.list(folder),
		process: async (path, transform) => {
			if (path === failPath) throw new Error("disk full");
			await base.process(path, transform);
		},
		processJSON: (path, transform) => base.processJSON(path, transform),
		rename: (from, to) => base.rename(from, to),
		createFolder: (path) => base.createFolder(path),
		trash: (path) => base.trash(path),
		create: (path, content) => base.create(path, content),
	};
}

async function seededVault(): Promise<FakeVaultFS> {
	const vault = new FakeVaultFS();
	await vault.create(DOC_PATH, JSON.stringify(rawFixture, null, 2) + "\n");
	await vault.create(MD_PATH, "stale courtesy markdown from a prior Tomo run\n");
	return vault;
}

describe("ObsidianSuggestionsDoc.load()", () => {
	it("loads the whole 1115 fixture into a clean EditModel (dirty:false, no field dropped)", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianSuggestionsDoc(vault);

		const model = await adapter.load(DOC_PATH);

		expect(model.dirty).toBe(false);
		expect(model.doc).toEqual(rawFixture);
	});

	it("fails loud on an unknown schema_version, with the prescribed version-mismatch wording", async () => {
		const vault = new FakeVaultFS();
		const badRaw = { ...(rawFixture as Record<string, unknown>), schema_version: "99" };
		await vault.create(DOC_PATH, JSON.stringify(badRaw));
		const adapter = new ObsidianSuggestionsDoc(vault);

		await expect(adapter.load(DOC_PATH)).rejects.toThrow(
			"Schema version mismatch — expected 1, got 99",
		);
	});
});

describe("ObsidianSuggestionsDoc.save()", () => {
	it("writes the whole doc back with emit_digest and passthrough fields byte-identical", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianSuggestionsDoc(vault);
		const model = await adapter.load(DOC_PATH);
		const edited: EditModel = {
			doc: { ...model.doc, run_id: "edited-run-id" },
			dirty: true,
		};

		await adapter.save(edited);

		const written = JSON.parse(await vault.read(DOC_PATH)) as SuggestionsWire;
		expect(written.emit_digest).toBe(rawFixture.emit_digest);
		expect(written.daily_updates).toEqual(rawFixture.daily_updates);
		expect(written.tag_handler_groups).toEqual(rawFixture.tag_handler_groups);
		expect(written.run_id).toBe("edited-run-id");
	});

	it("does not write when the model is not dirty", async () => {
		const vault = await seededVault();
		const processSpy = vi.spyOn(vault, "process");
		const adapter = new ObsidianSuggestionsDoc(vault);
		const model = await adapter.load(DOC_PATH);

		await adapter.save(model); // dirty: false

		expect(processSpy).not.toHaveBeenCalled();
		expect(await vault.read(DOC_PATH)).toBe(JSON.stringify(rawFixture, null, 2) + "\n");
	});

	it("re-renders the courtesy .md sibling on a dirty save", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianSuggestionsDoc(vault);
		const model = await adapter.load(DOC_PATH);
		const edited: EditModel = { doc: model.doc, dirty: true };

		await adapter.save(edited);

		const md = await vault.read(MD_PATH);
		expect(md).not.toBe("stale courtesy markdown from a prior Tomo run\n");
		expect(md).toBe(renderCourtesyMarkdown(edited));
	});

	it("on write failure: notifies, keeps the model unchanged, and surfaces the failure to the caller", async () => {
		const vault = await seededVault();
		const failingVault = withFailingWrite(vault, DOC_PATH);
		const notify = vi.fn();
		const adapter = new ObsidianSuggestionsDoc(failingVault, notify);
		const model = await adapter.load(DOC_PATH);
		const edited: EditModel = {
			doc: { ...model.doc, run_id: "will-not-be-saved" },
			dirty: true,
		};
		const snapshotBefore = JSON.parse(JSON.stringify(edited)) as EditModel;

		await expect(adapter.save(edited)).rejects.toThrow();

		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify.mock.calls[0]?.[0]).toEqual(expect.stringContaining("disk full"));
		expect(edited).toEqual(snapshotBefore); // not mutated in place
		expect(edited.dirty).toBe(true); // stayed dirty
		// the original on-disk JSON is untouched by the failed write
		expect(await vault.read(DOC_PATH)).toBe(JSON.stringify(rawFixture, null, 2) + "\n");
	});

	it("throws a clear error when save() is called before load()", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianSuggestionsDoc(vault);
		const model: EditModel = { doc: rawFixture as SuggestionsWire, dirty: true };

		await expect(adapter.save(model)).rejects.toThrow(/load\(\)/);
	});
});

describe("renderCourtesyMarkdown()", () => {
	function makeModel(overrides?: Partial<SuggestionsWire>): EditModel {
		return { doc: { ...(rawFixture as SuggestionsWire), ...overrides }, dirty: true };
	}

	it("is a pure function producing a deterministic, clearly-Hashi-generated summary", () => {
		const model = makeModel();

		const md = renderCourtesyMarkdown(model);

		expect(md).toBe(renderCourtesyMarkdown(model)); // deterministic — same input, same output
		expect(md).toContain("Edited in Hashi");
		expect(md).toContain("/inbox");
		expect(md).toContain(rawFixture.run_id);
		// per-suggestion one-liner: id · title · decision
		expect(md).toContain("S07");
		expect(md).toContain("The Zettelkasten Method");
		expect(md).toContain("approve");
		// daily entry one-liner: date · content · accepted
		expect(md).toContain("2026-07-05");
		expect(md).toContain("Vendor call: quote under review until Friday, send references.");
		expect(md).toContain("accepted: false");
		// tag-handler one-liner: group_id · approved
		expect(md).toContain("th-sample-project-log-md");
		expect(md).toContain("approved: true");
	});

	it("renders '(none)' placeholders for empty sections rather than omitting them", () => {
		const model = makeModel({ suggestions: [], proposed_mocs: [], daily_updates: [], tag_handler_groups: [] });

		const md = renderCourtesyMarkdown(model);

		expect(md).toMatch(/\(none\)/);
	});
});
