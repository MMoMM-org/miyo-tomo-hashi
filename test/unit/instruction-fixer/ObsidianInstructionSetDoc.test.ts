/**
 * ObsidianInstructionSetDoc (spec-006 Phase 1, T1.1) — the real
 * InstructionSetDoc adapter.
 *
 * Exercised purely through the public InstructionSetDoc port (load/save)
 * against a FakeVaultFS — no real Obsidian app in the loop (Constitution L1:
 * pure core testable without a host framework). Seeded from the
 * `test/fixtures/instructions/current-set.json` fixture.
 *
 * ADR-1: reuses the existing instruction wire/validator as-is — no new
 * editor wire. ADR-7: save() writes the JSON wire only, never the `.md`
 * peer or its `tomo.sources` block.
 */

import { describe, expect, it, vi } from "vitest";

import { ObsidianInstructionSetDoc } from "../../../src/instruction-fixer/ObsidianInstructionSetDoc.js";
import type { InstructionFixerModel } from "../../../src/vault/InstructionSetDoc.js";
import type { InstructionSet } from "../../../src/schema/types.js";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import type { VaultFS } from "../../../src/vault/VaultFS.js";
import rawFixture from "../../fixtures/instructions/current-set.json";

const DOC_PATH = "100 Inbox/2026-07-20_1015_instructions.json";
const MD_PEER_PATH = "100 Inbox/2026-07-20_1015_instructions.md";

/** A VaultFS whose process()/create() reject for one specific path — drives the save() failure path. */
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
		create: async (path, content) => {
			if (path === failPath) throw new Error("disk full");
			await base.create(path, content);
		},
	};
}

const FIXTURE_JSON = JSON.stringify(rawFixture, null, 2) + "\n";

async function seededVault(): Promise<FakeVaultFS> {
	const vault = new FakeVaultFS();
	await vault.create(DOC_PATH, FIXTURE_JSON);
	// The .md peer lives alongside the JSON in real vaults — seed it too, so
	// a save-writes-only-JSON test has something to prove untouched.
	await vault.create(MD_PEER_PATH, "# Instructions\n\n- [x] Approved\n");
	return vault;
}

describe("ObsidianInstructionSetDoc.load()", () => {
	it("loads the whole current-set fixture into a clean InstructionFixerModel (dirty:false, no field dropped)", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianInstructionSetDoc(vault);

		const model = await adapter.load(DOC_PATH);

		expect(model.dirty).toBe(false);
		expect(model.doc).toEqual(rawFixture);
	});

	it("throws on invalid JSON", async () => {
		const vault = new FakeVaultFS();
		await vault.create(DOC_PATH, "{ not valid json");
		const adapter = new ObsidianInstructionSetDoc(vault);

		await expect(adapter.load(DOC_PATH)).rejects.toThrow(/invalid JSON/);
	});

	it("fails loud on schema rejection (Constitution L1 denial path), with the validator's message", async () => {
		const vault = new FakeVaultFS();
		const badRaw = { ...(rawFixture as Record<string, unknown>), schema_version: "99" };
		await vault.create(DOC_PATH, JSON.stringify(badRaw));
		const adapter = new ObsidianInstructionSetDoc(vault);

		await expect(adapter.load(DOC_PATH)).rejects.toThrow(
			"Schema version mismatch — expected 2, got 99",
		);
	});

	it("throws a clear error when the document is corrupt (structurally invalid, e.g. missing required field)", async () => {
		const vault = new FakeVaultFS();
		const badRaw = { ...(rawFixture as Record<string, unknown>) };
		delete badRaw.type;
		await vault.create(DOC_PATH, JSON.stringify(badRaw));
		const adapter = new ObsidianInstructionSetDoc(vault);

		await expect(adapter.load(DOC_PATH)).rejects.toThrow(/ObsidianInstructionSetDoc\.load/);
	});
});

describe("ObsidianInstructionSetDoc.save()", () => {
	it("does not write when the model is not dirty", async () => {
		const vault = await seededVault();
		const processSpy = vi.spyOn(vault, "process");
		const createSpy = vi.spyOn(vault, "create");
		const adapter = new ObsidianInstructionSetDoc(vault);
		const model = await adapter.load(DOC_PATH);

		await adapter.save(model); // dirty: false

		expect(processSpy).not.toHaveBeenCalled();
		expect(createSpy).not.toHaveBeenCalled();
		expect(await vault.read(DOC_PATH)).toBe(FIXTURE_JSON);
	});

	it("verbatim round-trip: an unedited load -> save is byte-identical and re-validates clean", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianInstructionSetDoc(vault);
		const model = await adapter.load(DOC_PATH);

		// Force the write path even though nothing was edited, to prove the
		// serialization itself is byte-identical to the source fixture.
		const dirtyButUnedited: InstructionFixerModel = { doc: model.doc, dirty: true };
		await adapter.save(dirtyButUnedited);

		const written = await vault.read(DOC_PATH);
		expect(written).toBe(FIXTURE_JSON);

		// Re-load must re-validate clean — proves no field was dropped.
		const reloaded = await adapter.load(DOC_PATH);
		expect(reloaded.doc).toEqual(rawFixture);
	});

	it("round-trips untouched fields verbatim (tomo block, applied flags, md_peer) when only one target field is edited", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianInstructionSetDoc(vault);
		const model = await adapter.load(DOC_PATH);

		const edited: InstructionFixerModel = {
			doc: {
				...model.doc,
				actions: model.doc.actions.map((a) =>
					a.id === "I01" && a.action === "link_to_moc"
						? { ...a, target_moc_path: "Atlas/200 Maps/Hobbies (MOC) v2.md" }
						: a,
				),
			} as InstructionSet,
			dirty: true,
		};

		await adapter.save(edited);

		const written = JSON.parse(await vault.read(DOC_PATH)) as InstructionSet;
		expect(written.tomo).toEqual(rawFixture.tomo);
		expect(written.md_peer).toBe(rawFixture.md_peer);
		expect(written.actions.find((a) => a.id === "I02")?.applied).toBe(true);
		expect(written.actions.find((a) => a.id === "I03")?.applied).toBe(false);
		const writtenI01 = written.actions.find((a) => a.id === "I01");
		expect(writtenI01 && "target_moc_path" in writtenI01 ? writtenI01.target_moc_path : undefined).toBe(
			"Atlas/200 Maps/Hobbies (MOC) v2.md",
		);
	});

	it("writes only the _instructions.json — never the .md peer", async () => {
		const vault = await seededVault();
		const processSpy = vi.spyOn(vault, "process");
		const createSpy = vi.spyOn(vault, "create");
		const adapter = new ObsidianInstructionSetDoc(vault);
		const model = await adapter.load(DOC_PATH);
		const edited: InstructionFixerModel = {
			doc: { ...model.doc, profile: "edited-profile" },
			dirty: true,
		};

		await adapter.save(edited);

		for (const call of processSpy.mock.calls) expect(call[0]).toBe(DOC_PATH);
		for (const call of createSpy.mock.calls) expect(call[0]).toBe(DOC_PATH);
		expect(await vault.read(MD_PEER_PATH)).toBe("# Instructions\n\n- [x] Approved\n");
	});

	it("on write failure: notifies, keeps the caller's model unchanged, and rethrows", async () => {
		const vault = await seededVault();
		const failingVault = withFailingWrite(vault, DOC_PATH);
		const notify = vi.fn();
		const adapter = new ObsidianInstructionSetDoc(failingVault, notify);
		const model = await adapter.load(DOC_PATH);
		const edited: InstructionFixerModel = {
			doc: { ...model.doc, profile: "will-not-be-saved" },
			dirty: true,
		};
		const snapshotBefore = JSON.parse(JSON.stringify(edited)) as InstructionFixerModel;

		await expect(adapter.save(edited)).rejects.toThrow("disk full");

		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify.mock.calls[0]?.[0]).toEqual(expect.stringContaining("disk full"));
		expect(edited).toEqual(snapshotBefore); // not mutated in place
		expect(await vault.read(DOC_PATH)).toBe(FIXTURE_JSON);
	});

	it("throws a clear error when save() is called before load()", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianInstructionSetDoc(vault);
		const model: InstructionFixerModel = { doc: rawFixture as InstructionSet, dirty: true };

		await expect(adapter.save(model)).rejects.toThrow(/load\(\)/);
	});
});
