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
	composeCourtesyMarkdown,
	extractFrontmatter,
	ObsidianSuggestionsDoc,
} from "../../../src/suggestions/ObsidianSuggestionsDoc.js";
import type { EditModel, SuggestionsWire } from "../../../src/types/suggestions.js";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import type { VaultFS } from "../../../src/vault/VaultFS.js";
import rawFixture from "../../fixtures/suggestions/1115.json";

const DOC_PATH = "100 Inbox/2026-07-06_1115_suggestions.json";
const MD_PATH = "100 Inbox/2026-07-06_1115_suggestions.md";

// A realistic Tomo `_suggestions.md` (frontmatter with the discovery-critical
// `tomo:` block + the unchecked Pass-2 gate + a foreign linter `Updated:` line
// inside the frontmatter). Modelled on a real emission (tomo→hashi handoff
// 2026-07-08) — the write-back must preserve this block verbatim.
const TOMO_FRONTMATTER = [
	"---",
	"type: tomo-suggestions",
	"generated: 2026-07-07T15:59:32Z",
	"tomo_version: 0.1.0",
	"profile: miyo",
	"source_items: 34",
	"run_id: 2026-07-07T15-25-12Z-d54055",
	"tomo:",
	"  doc_type: suggestions",
	"  state: pending-approval",
	"  run_id: 2026-07-07T15-25-12Z-d54055",
	"  updated_at: 2026-07-07T15:59:37Z",
	"Updated: 2026-07-07 18:02",
	"---",
].join("\n");
const TOMO_MD = `${TOMO_FRONTMATTER}\n\n# Inbox Suggestions — 2026-07-07\n\n- [ ] Approved\n\n(Tomo's own body view)\n`;

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
		const createSpy = vi.spyOn(vault, "create");
		const adapter = new ObsidianSuggestionsDoc(vault);
		const model = await adapter.load(DOC_PATH);

		await adapter.save(model); // dirty: false

		expect(processSpy).not.toHaveBeenCalled();
		expect(createSpy).not.toHaveBeenCalled();
		expect(await vault.read(DOC_PATH)).toBe(JSON.stringify(rawFixture, null, 2) + "\n");
	});

	it("creates the courtesy .md when it doesn't already exist (upsert, not just overwrite)", async () => {
		const vault = new FakeVaultFS();
		await vault.create(DOC_PATH, JSON.stringify(rawFixture, null, 2) + "\n");
		// MD_PATH is deliberately NOT pre-seeded here — exercises the create()
		// branch of writeFile(), which the seededVault()-backed tests above
		// never hit because they always pre-seed the sibling .md.
		const adapter = new ObsidianSuggestionsDoc(vault);
		const model = await adapter.load(DOC_PATH);
		const edited: EditModel = { doc: model.doc, dirty: true };

		await adapter.save(edited);

		expect(await vault.exists(MD_PATH)).toBe(true);
		// No prior .md → reconstruct-frontmatter path.
		expect(await vault.read(MD_PATH)).toBe(composeCourtesyMarkdown(null, edited));
	});

	it("re-renders the courtesy .md sibling on a dirty save", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianSuggestionsDoc(vault);
		const model = await adapter.load(DOC_PATH);
		const edited: EditModel = { doc: model.doc, dirty: true };

		await adapter.save(edited);

		const md = await vault.read(MD_PATH);
		expect(md).not.toBe("stale courtesy markdown from a prior Tomo run\n");
		expect(md).toBe(composeCourtesyMarkdown("stale courtesy markdown from a prior Tomo run\n", edited));
	});

	it("preserves Tomo's frontmatter verbatim and writes the Pass-2 gate checked", async () => {
		const vault = new FakeVaultFS();
		await vault.create(DOC_PATH, JSON.stringify(rawFixture, null, 2) + "\n");
		await vault.create(MD_PATH, TOMO_MD);
		const adapter = new ObsidianSuggestionsDoc(vault);
		const model = await adapter.load(DOC_PATH);
		const edited: EditModel = { doc: { ...model.doc, run_id: "edited" }, dirty: true };

		await adapter.save(edited);

		const md = await vault.read(MD_PATH);
		// Frontmatter block carried through byte-for-byte — including the
		// discovery-critical tomo: state and the foreign linter line.
		expect(md.startsWith(TOMO_FRONTMATTER)).toBe(true);
		expect(md).toContain("state: pending-approval");
		expect(md).toContain("Updated: 2026-07-07 18:02");
		expect(md).toContain("updated_at: 2026-07-07T15:59:37Z");
		// The Pass-2 gate is present and CHECKED (Save == whole-run approve).
		expect(md).toMatch(/^- \[x\] Approved$/m);
		expect(md).not.toMatch(/^- \[ \] Approved$/m);
		// Exactly one frontmatter block — no reconstructed block prepended.
		expect((md.match(/^---$/gm) ?? []).length).toBe(2);
	});

	it("does not mutate the tomo: state on save (discovery must keep working)", async () => {
		const vault = new FakeVaultFS();
		await vault.create(DOC_PATH, JSON.stringify(rawFixture, null, 2) + "\n");
		await vault.create(MD_PATH, TOMO_MD);
		const adapter = new ObsidianSuggestionsDoc(vault);
		const model = await adapter.load(DOC_PATH);

		await adapter.save({ doc: model.doc, dirty: true });
		// Save again over the now-Hashi-written .md — frontmatter must still survive.
		await adapter.save({ doc: model.doc, dirty: true });

		const md = await vault.read(MD_PATH);
		expect((md.match(/state: pending-approval/g) ?? []).length).toBe(1);
		expect(md.startsWith(TOMO_FRONTMATTER)).toBe(true);
	});

	it("on JSON write failure: hard-fails — notifies, keeps the model unchanged, and rethrows to the caller", async () => {
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

		await expect(adapter.save(edited)).rejects.toThrow("disk full");

		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify.mock.calls[0]?.[0]).toEqual(expect.stringContaining("disk full"));
		expect(edited).toEqual(snapshotBefore); // not mutated in place
		expect(edited.dirty).toBe(true); // stayed dirty
		// the original on-disk JSON is untouched by the failed write
		expect(await vault.read(DOC_PATH)).toBe(JSON.stringify(rawFixture, null, 2) + "\n");
	});

	it("on courtesy .md write failure (JSON already durable): soft-fails — resolves, soft notice, JSON stays saved", async () => {
		const vault = await seededVault();
		const failingVault = withFailingWrite(vault, MD_PATH);
		const notify = vi.fn();
		const adapter = new ObsidianSuggestionsDoc(failingVault, notify);
		const model = await adapter.load(DOC_PATH);
		const edited: EditModel = {
			doc: { ...model.doc, run_id: "durably-saved" },
			dirty: true,
		};

		await expect(adapter.save(edited)).resolves.toBeUndefined();

		expect(notify).toHaveBeenCalledTimes(1);
		const [message] = notify.mock.calls[0] ?? [];
		expect(message).toEqual(expect.stringContaining("Suggestions saved"));
		expect(message).toEqual(expect.stringContaining("disk full"));
		// the load-bearing JSON write went through despite the courtesy-view failure
		const written = JSON.parse(await vault.read(DOC_PATH)) as SuggestionsWire;
		expect(written.run_id).toBe("durably-saved");
	});

	it("throws a clear error when save() is called before load()", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianSuggestionsDoc(vault);
		const model: EditModel = { doc: rawFixture as SuggestionsWire, dirty: true };

		await expect(adapter.save(model)).rejects.toThrow(/load\(\)/);
	});

	it("single-active-doc trust boundary: load(A) then load(B) then save(modelFromA) writes A's edits to B's path", async () => {
		const vault = new FakeVaultFS();
		const pathA = "100 Inbox/a_suggestions.json";
		const pathB = "100 Inbox/b_suggestions.json";
		const docA: SuggestionsWire = { ...(rawFixture as SuggestionsWire), run_id: "run-a" };
		const docB: SuggestionsWire = { ...(rawFixture as SuggestionsWire), run_id: "run-b" };
		await vault.create(pathA, JSON.stringify(docA, null, 2) + "\n");
		await vault.create(pathB, JSON.stringify(docB, null, 2) + "\n");
		const adapter = new ObsidianSuggestionsDoc(vault);

		const modelA = await adapter.load(pathA);
		await adapter.load(pathB); // switches the adapter's single active doc to B

		const editedFromA: EditModel = {
			doc: { ...modelA.doc, run_id: "edited-from-a" },
			dirty: true,
		};
		await adapter.save(editedFromA);

		const writtenB = JSON.parse(await vault.read(pathB)) as SuggestionsWire;
		expect(writtenB.run_id).toBe("edited-from-a"); // A's edited content landed on B's path
		const writtenA = JSON.parse(await vault.read(pathA)) as SuggestionsWire;
		expect(writtenA.run_id).toBe("run-a"); // A's own on-disk file is untouched
	});

	it("treats a non-.json docPath as a loud programmer error deriving the courtesy path, not a silent <path>.md write", async () => {
		const vault = new FakeVaultFS();
		const oddPath = "100 Inbox/note-without-extension";
		await vault.create(oddPath, JSON.stringify(rawFixture, null, 2) + "\n");
		const notify = vi.fn();
		const adapter = new ObsidianSuggestionsDoc(vault, notify);
		const model = await adapter.load(oddPath);
		const edited: EditModel = { doc: { ...model.doc, run_id: "edited" }, dirty: true };

		await expect(adapter.save(edited)).resolves.toBeUndefined();

		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify.mock.calls[0]?.[0]).toEqual(
			expect.stringContaining('expected a ".json" docPath'),
		);
		expect(await vault.exists(`${oddPath}.md`)).toBe(false);
		// the durable JSON write still succeeded despite the courtesy-path error
		const written = JSON.parse(await vault.read(oddPath)) as SuggestionsWire;
		expect(written.run_id).toBe("edited");
	});
});

describe("composeCourtesyMarkdown()", () => {
	function makeModel(overrides?: Partial<SuggestionsWire>): EditModel {
		return { doc: { ...(rawFixture as SuggestionsWire), ...overrides }, dirty: true };
	}

	it("is a pure function producing a deterministic, clearly-Hashi-generated summary", () => {
		const model = makeModel();

		const md = composeCourtesyMarkdown(TOMO_MD, model);

		expect(md).toBe(composeCourtesyMarkdown(TOMO_MD, model)); // deterministic — same input, same output
		expect(md).toContain("Edited in Hashi");
		expect(md).toContain("/inbox");
		expect(md).toContain(rawFixture.run_id);
		// the Pass-2 gate is written checked
		expect(md).toMatch(/^- \[x\] Approved$/m);
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

	it("reconstructs a discovery-capable frontmatter when the existing .md has none", () => {
		const md = composeCourtesyMarkdown(null, makeModel());

		expect(md.startsWith("---\ntype: tomo-suggestions")).toBe(true);
		expect(md).toContain("  state: pending-approval");
		expect(md).toContain(`  run_id: '${rawFixture.run_id}'`);
		expect(md).toMatch(/^- \[x\] Approved$/m);
	});

	it("renders '(none)' placeholders for empty sections rather than omitting them", () => {
		const model = makeModel({ suggestions: [], proposed_mocs: [], daily_updates: [], tag_handler_groups: [] });

		const md = composeCourtesyMarkdown(TOMO_MD, model);

		expect(md).toMatch(/\(none\)/);
	});
});

describe("extractFrontmatter()", () => {
	it("returns the frontmatter block (both fences) minus trailing whitespace", () => {
		expect(extractFrontmatter(TOMO_MD)).toBe(TOMO_FRONTMATTER);
	});

	it("returns null when the content does not open with a frontmatter block", () => {
		expect(extractFrontmatter("# just a heading\n\nbody\n")).toBeNull();
		expect(extractFrontmatter("\n---\ntype: x\n---\n")).toBeNull(); // must be at the very start
	});

	it("handles CRLF line endings", () => {
		const crlf = "---\r\ntype: x\r\nstate: pending-approval\r\n---\r\nbody\r\n";
		expect(extractFrontmatter(crlf)).toBe("---\r\ntype: x\r\nstate: pending-approval\r\n---");
	});
});
