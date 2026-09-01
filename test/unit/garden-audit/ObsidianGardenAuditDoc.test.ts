/**
 * ObsidianGardenAuditDoc (spec-005 Phase 2, T2.1) — the real GardenAuditDoc
 * adapter.
 *
 * Exercised purely through the public GardenAuditDoc port (load/save)
 * against a FakeVaultFS — no real Obsidian app in the loop (Constitution L1:
 * pure core testable without a host framework). Seeded from the Phase 1
 * current-wire.json fixture (the verified SDD §2 example).
 *
 * ADR-6: unlike ObsidianSuggestionsDoc, there is NO courtesy `.md` write in
 * v1 — save() writes the JSON wire only. These tests deliberately do not
 * carry over the suggestions adapter's markdown-rendering coverage.
 */

import { describe, expect, it, vi } from "vitest";

import { ObsidianGardenAuditDoc } from "../../../src/garden-audit/ObsidianGardenAuditDoc.js";
import type { GardenAuditModel, GardenAuditWire } from "../../../src/types/garden-audit.js";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import type { VaultFS } from "../../../src/vault/VaultFS.js";
import rawFixture from "../../fixtures/garden-audit/current-wire.json";

const DOC_PATH = "100 Inbox/run-editor-001_garden-audit.json";

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
		processFrontMatter: (path, fn) => base.processFrontMatter(path, fn),
		rename: (from, to) => base.rename(from, to),
		createFolder: (path) => base.createFolder(path),
		trash: (path) => base.trash(path),
		create: async (path, content) => {
			if (path === failPath) throw new Error("disk full");
			await base.create(path, content);
		},
	};
}

async function seededVault(): Promise<FakeVaultFS> {
	const vault = new FakeVaultFS();
	await vault.create(DOC_PATH, JSON.stringify(rawFixture, null, 2) + "\n");
	return vault;
}

describe("ObsidianGardenAuditDoc.load()", () => {
	it("loads the whole current-wire fixture into a clean GardenAuditModel (dirty:false, no field dropped)", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianGardenAuditDoc(vault);

		const model = await adapter.load(DOC_PATH);

		expect(model.dirty).toBe(false);
		expect(model.doc).toEqual(rawFixture);
	});

	it("throws on invalid JSON", async () => {
		const vault = new FakeVaultFS();
		await vault.create(DOC_PATH, "{ not valid json");
		const adapter = new ObsidianGardenAuditDoc(vault);

		await expect(adapter.load(DOC_PATH)).rejects.toThrow(/invalid JSON/);
	});

	it("fails loud on schema rejection (Constitution L1 denial path), with the prescribed version-mismatch wording", async () => {
		const vault = new FakeVaultFS();
		const badRaw = { ...(rawFixture as Record<string, unknown>), schema_version: "99" };
		await vault.create(DOC_PATH, JSON.stringify(badRaw));
		const adapter = new ObsidianGardenAuditDoc(vault);

		await expect(adapter.load(DOC_PATH)).rejects.toThrow(
			"Schema version mismatch — expected 1, got 99",
		);
	});
});

describe("ObsidianGardenAuditDoc.save()", () => {
	it("does not write when the model is not dirty", async () => {
		const vault = await seededVault();
		const processSpy = vi.spyOn(vault, "process");
		const createSpy = vi.spyOn(vault, "create");
		const adapter = new ObsidianGardenAuditDoc(vault);
		const model = await adapter.load(DOC_PATH);

		await adapter.save(model); // dirty: false

		expect(processSpy).not.toHaveBeenCalled();
		expect(createSpy).not.toHaveBeenCalled();
		expect(await vault.read(DOC_PATH)).toBe(JSON.stringify(rawFixture, null, 2) + "\n");
	});

	it("writes the wire verbatim with emit_digest unchanged (ADR-2: the adapter no longer forces approved)", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianGardenAuditDoc(vault);
		const model = await adapter.load(DOC_PATH);
		// approved:false in the fixture — flip a decision field to prove a real
		// edit, not merely toggling approved.
		const edited: GardenAuditModel = {
			doc: {
				...model.doc,
				findings: model.doc.findings.map((f) =>
					f.id === "F01" && f.decision
						? { ...f, decision: { ...f.decision, replace: "[[New Note]]" } }
						: f,
				),
			},
			dirty: true,
		};

		await adapter.save(edited);

		const written = JSON.parse(await vault.read(DOC_PATH)) as GardenAuditWire;
		expect(written.emit_digest).toBe(rawFixture.emit_digest);
		// verbatim — the fixture's approved:false rides through unchanged;
		// the VIEW is responsible for setting the gate before save (T4.3/2026-07-24).
		expect(written.approved).toBe(false);
		const writtenF01 = written.findings.find((f) => f.id === "F01");
		expect(writtenF01?.decision?.replace).toBe("[[New Note]]");
	});

	it("writes approved:true verbatim when the model already carries it (view-set gate passthrough)", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianGardenAuditDoc(vault);
		const model = await adapter.load(DOC_PATH);
		const edited: GardenAuditModel = {
			doc: { ...model.doc, approved: true, suggest_pending: false },
			dirty: true,
		};

		await adapter.save(edited);

		const written = JSON.parse(await vault.read(DOC_PATH)) as GardenAuditWire;
		expect(written.approved).toBe(true);
		expect(written.suggest_pending).toBe(false);
	});

	it("on write failure: notifies, keeps the caller's model unchanged, and rethrows", async () => {
		const vault = await seededVault();
		const failingVault = withFailingWrite(vault, DOC_PATH);
		const notify = vi.fn();
		const adapter = new ObsidianGardenAuditDoc(failingVault, notify);
		const model = await adapter.load(DOC_PATH);
		const edited: GardenAuditModel = {
			doc: { ...model.doc, run_id: "will-not-be-saved" },
			dirty: true,
		};
		const snapshotBefore = JSON.parse(JSON.stringify(edited)) as GardenAuditModel;

		await expect(adapter.save(edited)).rejects.toThrow("disk full");

		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify.mock.calls[0]?.[0]).toEqual(expect.stringContaining("disk full"));
		expect(edited).toEqual(snapshotBefore); // not mutated in place
		expect(await vault.read(DOC_PATH)).toBe(JSON.stringify(rawFixture, null, 2) + "\n");
	});

	it("throws a clear error when save() is called before load()", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianGardenAuditDoc(vault);
		const model: GardenAuditModel = { doc: rawFixture as GardenAuditWire, dirty: true };

		await expect(adapter.save(model)).rejects.toThrow(/load\(\)/);
	});
});
