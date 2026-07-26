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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { markActionApplied } from "../../../src/executor/jsonAppliedWriter.js";
import {
	InstructionSetSaveError,
	ObsidianInstructionSetDoc,
} from "../../../src/instruction-fixer/ObsidianInstructionSetDoc.js";
import { setTargetField } from "../../../src/instruction-fixer/transforms.js";
import type { InstructionFixerModel } from "../../../src/vault/InstructionSetDoc.js";
import type { Action, InstructionSet } from "../../../src/schema/types.js";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import type { VaultFS } from "../../../src/vault/VaultFS.js";
import rawFixture from "../../fixtures/instructions/current-set.json";

const DOC_PATH = "100 Inbox/2026-07-20_1015_instructions.json";
const MD_PEER_PATH = "100 Inbox/2026-07-20_1015_instructions.md";

/**
 * Explicit delegating wrapper around a VaultFS, with per-method overrides.
 * Written out method-by-method rather than spread: `FakeVaultFS`'s methods
 * live on the prototype, so `{ ...base }` would produce an empty object.
 */
function delegating(base: VaultFS, overrides: Partial<VaultFS>): VaultFS {
	return {
		read: (path) => base.read(path),
		cachedRead: (path) => base.cachedRead(path),
		readJSON: (path) => base.readJSON(path),
		exists: (path) => base.exists(path),
		list: (folder) => base.list(folder),
		process: (path, transform) => base.process(path, transform),
		processJSON: (path, transform) => base.processJSON(path, transform),
		rename: (from, to) => base.rename(from, to),
		createFolder: (path) => base.createFolder(path),
		trash: (path) => base.trash(path),
		create: (path, content) => base.create(path, content),
		...overrides,
	};
}

/**
 * A VaultFS whose writes to one path reject — drives the save() failure path.
 * Only `processJSON` is faulted: since T1.5 `save()` writes exclusively through
 * `markActionFields`, so `process`/`create` are no longer on the save path at
 * all (and faulting `process` would be invisible anyway — FakeVaultFS.processJSON
 * calls its OWN `this.process`, not the wrapper's).
 */
function withFailingWrite(base: VaultFS, failPath: string): VaultFS {
	return delegating(base, {
		processJSON: async (path, transform) => {
			if (path === failPath) throw new Error("disk full");
			await base.processJSON(path, transform);
		},
	});
}

/**
 * A VaultFS that lets the first `failOnCall - 1` writes to `failPath` through
 * and rejects exactly the `failOnCall`-th — the multi-patch partial-failure
 * window. Counts across ALL save() calls on the same adapter, so a later retry
 * runs clean and can be asserted on.
 */
function withNthWriteFailing(base: VaultFS, failPath: string, failOnCall: number): VaultFS {
	let seen = 0;
	return delegating(base, {
		processJSON: async (path, transform) => {
			if (path === failPath) {
				seen += 1;
				if (seen === failOnCall) throw new Error(`disk full on write ${seen}`);
			}
			await base.processJSON(path, transform);
		},
	});
}

const FIXTURE_JSON = JSON.stringify(rawFixture, null, 2) + "\n";

// Real on-disk oracle — the fixture's LITERAL bytes, independent of any
// re-derivation through JSON.stringify(rawFixture, ...). The round-trip
// test below seeds with and asserts against THIS constant, not FIXTURE_JSON,
// so it can actually detect a fixture whose on-disk formatting diverges from
// canonical `JSON.stringify(x, null, 2) + "\n"` (different indentation,
// CRLF, hand-edited key order) — the exact failure mode "verbatim
// round-trip" exists to catch (additionalProperties:false everywhere).
const FIXTURE_JSON_ON_DISK = readFileSync(
	resolve(__dirname, "../../fixtures/instructions/current-set.json"),
	"utf8",
);

// The one edit the Fixer UI can actually make against this fixture (ADR-5's
// whitelist): repoint I01's MOC path. Used wherever a test needs "a dirty
// model" — going through setTargetField keeps the tests honest about what
// save() has to support.
const I01_PATH_BEFORE = "Atlas/200 Maps/Hobbies (MOC).md";
const I01_PATH_AFTER = "Atlas/200 Maps/Hobbies (MOC) v2.md";

const I02_REPLACE_AFTER = "[[Recovered Note]]";

function repointI01(model: InstructionFixerModel): InstructionFixerModel {
	return setTargetField(model, "I01", "target_moc_path", I01_PATH_AFTER);
}

/** A second, independent action edit — used to drive multi-patch saves. */
function repairI02(model: InstructionFixerModel): InstructionFixerModel {
	return setTargetField(model, "I02", "replace", I02_REPLACE_AFTER);
}

function findAction(set: InstructionSet, id: string): Action | undefined {
	return set.actions.find((a) => a.id === id);
}

function fieldOf(action: Action | undefined, key: string): unknown {
	return action === undefined
		? undefined
		: (action as unknown as Record<string, unknown>)[key];
}

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

	it("verbatim round-trip: an unedited load -> save is byte-identical to the fixture ON DISK and re-validates clean", async () => {
		// Seed with the fixture's literal file bytes (not a JSON.stringify
		// re-derivation) — the real on-disk oracle.
		const vault = new FakeVaultFS();
		await vault.create(DOC_PATH, FIXTURE_JSON_ON_DISK);
		const adapter = new ObsidianInstructionSetDoc(vault);
		const model = await adapter.load(DOC_PATH);

		// Force the write path even though nothing was edited, to prove the
		// serialization itself is byte-identical to the source fixture.
		const dirtyButUnedited: InstructionFixerModel = { doc: model.doc, dirty: true };
		await adapter.save(dirtyButUnedited);

		const written = await vault.read(DOC_PATH);
		expect(written).toBe(FIXTURE_JSON_ON_DISK);

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

		await adapter.save(repointI01(model));

		for (const call of processSpy.mock.calls) expect(call[0]).toBe(DOC_PATH);
		for (const call of createSpy.mock.calls) expect(call[0]).toBe(DOC_PATH);
		expect(processSpy).toHaveBeenCalled(); // the write really happened
		expect(await vault.read(MD_PEER_PATH)).toBe("# Instructions\n\n- [x] Approved\n");
	});

	it("on write failure: notifies, keeps the caller's model unchanged, and rethrows", async () => {
		const vault = await seededVault();
		const failingVault = withFailingWrite(vault, DOC_PATH);
		const notify = vi.fn();
		const adapter = new ObsidianInstructionSetDoc(failingVault, notify);
		const model = await adapter.load(DOC_PATH);
		const edited = repointI01(model);
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

	it("serializes an edited save byte-identically to the on-disk fixture, changing only the edited value", async () => {
		// Guards the verbatim contract on the WRITING path (the unedited
		// round-trip above only proves the no-write case once save() patches
		// per-action): routing through processJSON must not reindent, reorder
		// or drop anything outside the one edited field.
		const vault = new FakeVaultFS();
		await vault.create(DOC_PATH, FIXTURE_JSON_ON_DISK);
		const adapter = new ObsidianInstructionSetDoc(vault);
		const model = await adapter.load(DOC_PATH);

		await adapter.save(repointI01(model));

		expect(await vault.read(DOC_PATH)).toBe(
			FIXTURE_JSON_ON_DISK.replace(`"${I01_PATH_BEFORE}"`, `"${I01_PATH_AFTER}"`),
		);
	});
});

describe("ObsidianInstructionSetDoc.save() — ADR-9 single-writer discipline", () => {
	it("does not revert a concurrent executor applied-flush on a different action (lost-update regression)", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianInstructionSetDoc(vault);
		const model = await adapter.load(DOC_PATH);

		// The executor flushes `applied: true` for I03 through its own atomic
		// path AFTER the Fixer loaded the set — exactly the window ADR-9 calls
		// out. A whole-document save from the Fixer's stale snapshot would
		// silently push I03 back to `applied: false`, and the action would run
		// a second time on the next execute (duplicate MOC/move).
		await markActionApplied(vault, DOC_PATH, "I03");

		await adapter.save(repointI01(model));

		const written = JSON.parse(await vault.read(DOC_PATH)) as InstructionSet;
		expect(findAction(written, "I03")?.applied).toBe(true);
		expect(findAction(written, "I02")?.applied).toBe(true);
		expect(fieldOf(findAction(written, "I01"), "target_moc_path")).toBe(I01_PATH_AFTER);
	});

	it("does not revert a concurrent applied-flush on the very action being edited", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianInstructionSetDoc(vault);
		const model = await adapter.load(DOC_PATH);

		await markActionApplied(vault, DOC_PATH, "I01");

		await adapter.save(repointI01(model));

		const written = JSON.parse(await vault.read(DOC_PATH)) as InstructionSet;
		// markActionFields is monotonic — the patch may repoint the field but
		// can never move `applied` off true.
		expect(findAction(written, "I01")?.applied).toBe(true);
		expect(fieldOf(findAction(written, "I01"), "target_moc_path")).toBe(I01_PATH_AFTER);
	});

	it("leaves every other action's fields byte-untouched — it patches only the edited action", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianInstructionSetDoc(vault);
		const model = await adapter.load(DOC_PATH);

		// Out-of-band edit to a DIFFERENT action's own target field, as if
		// another writer had repaired it between load() and save().
		await vault.processJSON<InstructionSet>(DOC_PATH, (set) => ({
			...set,
			actions: set.actions.map((a) =>
				a.id === "I02" ? ({ ...a, replace: "[[Found Note]]" } as Action) : a,
			),
		}));

		await adapter.save(repointI01(model));

		const written = JSON.parse(await vault.read(DOC_PATH)) as InstructionSet;
		expect(fieldOf(findAction(written, "I02"), "replace")).toBe("[[Found Note]]");
	});

	it("rejects a structural edit the per-action patch path cannot express, rather than dropping it", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianInstructionSetDoc(vault);
		const model = await adapter.load(DOC_PATH);

		// Nothing in the Fixer's edit surface (ADR-5/ADR-6) can produce this —
		// but a save that silently succeeded while losing the change would be
		// worse than a loud failure.
		const topLevelEdit: InstructionFixerModel = {
			doc: { ...model.doc, profile: "edited-profile" },
			dirty: true,
		};

		await expect(adapter.save(topLevelEdit)).rejects.toThrow(/unsupported edit/);
		expect(await vault.read(DOC_PATH)).toBe(FIXTURE_JSON);
	});

	it("rejects an added or removed action rather than dropping it", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianInstructionSetDoc(vault);
		const model = await adapter.load(DOC_PATH);

		const truncated: InstructionFixerModel = {
			doc: { ...model.doc, actions: model.doc.actions.slice(0, 2) },
			dirty: true,
		};

		await expect(adapter.save(truncated)).rejects.toThrow(/unsupported edit/);
		expect(await vault.read(DOC_PATH)).toBe(FIXTURE_JSON);
	});
});

describe("ObsidianInstructionSetDoc.save() — multi-patch saves", () => {
	it("applies every changed action in one save, one atomic write each", async () => {
		const vault = await seededVault();
		const processJSONSpy = vi.spyOn(vault, "processJSON");
		const adapter = new ObsidianInstructionSetDoc(vault);
		const model = await adapter.load(DOC_PATH);

		await adapter.save(repairI02(repointI01(model)));

		expect(processJSONSpy).toHaveBeenCalledTimes(2); // one per changed action
		const written = JSON.parse(await vault.read(DOC_PATH)) as InstructionSet;
		expect(fieldOf(findAction(written, "I01"), "target_moc_path")).toBe(I01_PATH_AFTER);
		expect(fieldOf(findAction(written, "I02"), "replace")).toBe(I02_REPLACE_AFTER);
		// The untouched third action keeps every field, including `applied`.
		expect(findAction(written, "I03")).toEqual(rawFixture.actions[2]);
	});

	it("only re-writes what changed since the last successful save (pristine advances)", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianInstructionSetDoc(vault);
		const model = await adapter.load(DOC_PATH);

		const afterFirstEdit = repointI01(model);
		await adapter.save(afterFirstEdit);

		// A third party repoints I01 again after the Fixer's save landed. The
		// Fixer's SECOND save must not resurrect its own now-superseded value:
		// I01 is no longer a pending edit once it has been written.
		await vault.processJSON<InstructionSet>(DOC_PATH, (set) => ({
			...set,
			actions: set.actions.map((a) =>
				a.id === "I01" ? ({ ...a, target_moc_path: "Atlas/200 Maps/Elsewhere.md" } as Action) : a,
			),
		}));

		const processJSONSpy = vi.spyOn(vault, "processJSON");
		await adapter.save(repairI02(afterFirstEdit));

		expect(processJSONSpy).toHaveBeenCalledTimes(1); // I02 only
		const written = JSON.parse(await vault.read(DOC_PATH)) as InstructionSet;
		expect(fieldOf(findAction(written, "I01"), "target_moc_path")).toBe(
			"Atlas/200 Maps/Elsewhere.md",
		);
		expect(fieldOf(findAction(written, "I02"), "replace")).toBe(I02_REPLACE_AFTER);
	});

	it("leaves a partially-applied save recoverable: the same model re-saved converges", async () => {
		// The write is atomic PER ACTION, not per save — N patches are N
		// processJSON cycles. If the 2nd fails, the 1st has already landed.
		// The contract: `pristine` is NOT advanced on failure, so it still
		// describes the last state the user's edits were computed against, and
		// re-saving the same (still dirty) model re-derives BOTH patches. Patch
		// #1 is a no-op rewrite of the value already on disk, patch #2 finally
		// lands — so retry converges instead of losing the second edit.
		const vault = await seededVault();
		const failing = withNthWriteFailing(vault, DOC_PATH, 2);
		const notify = vi.fn();
		const adapter = new ObsidianInstructionSetDoc(failing, notify);
		const model = await adapter.load(DOC_PATH);
		const edited = repairI02(repointI01(model));
		const snapshotBefore = JSON.parse(JSON.stringify(edited)) as InstructionFixerModel;

		await expect(adapter.save(edited)).rejects.toThrow("disk full on write 2");

		// Partial state: patch #1 landed, patch #2 did not. No corruption — the
		// document is still schema-valid, it just holds one of the two repairs.
		const afterFailure = JSON.parse(await vault.read(DOC_PATH)) as InstructionSet;
		expect(fieldOf(findAction(afterFailure, "I01"), "target_moc_path")).toBe(I01_PATH_AFTER);
		expect(fieldOf(findAction(afterFailure, "I02"), "replace")).toBe("");
		expect(notify).toHaveBeenCalledTimes(1);
		expect(edited).toEqual(snapshotBefore); // model untouched — still dirty, still retryable

		// Retry the very same model: both patches are re-derived and re-sent.
		await adapter.save(edited);

		const afterRetry = JSON.parse(await vault.read(DOC_PATH)) as InstructionSet;
		expect(fieldOf(findAction(afterRetry, "I01"), "target_moc_path")).toBe(I01_PATH_AFTER);
		expect(fieldOf(findAction(afterRetry, "I02"), "replace")).toBe(I02_REPLACE_AFTER);
		expect(findAction(afterRetry, "I03")).toEqual(rawFixture.actions[2]);
	});

	it("a partially-applied save is also recoverable by reloading — no phantom pending edits", async () => {
		const vault = await seededVault();
		const failing = withNthWriteFailing(vault, DOC_PATH, 2);
		const adapter = new ObsidianInstructionSetDoc(failing, vi.fn());
		const model = await adapter.load(DOC_PATH);

		await expect(adapter.save(repairI02(repointI01(model)))).rejects.toThrow("disk full");

		// load() re-reads the partially-written document and re-baselines
		// `pristine` on it, so the already-landed I01 repair is not re-offered
		// as a pending change and a fresh unedited save is a genuine no-op.
		const reloaded = await adapter.load(DOC_PATH);
		expect(fieldOf(findAction(reloaded.doc, "I01"), "target_moc_path")).toBe(I01_PATH_AFTER);

		const processJSONSpy = vi.spyOn(vault, "processJSON");
		await adapter.save({ doc: reloaded.doc, dirty: true });

		expect(processJSONSpy).not.toHaveBeenCalled();
	});
});

describe("ObsidianInstructionSetDoc.save() — schema validation before write (PRD F4-AC2)", () => {
	const INSERT_ACTION = {
		id: "I04",
		action: "insert_under_marker",
		target_path: "Atlas/202 Notes/Existing.md",
		anchor: { type: "heading", value: "Log" },
		placement: "inside",
		content: "- an entry\n",
		applied: false,
	};

	async function vaultWithInsertAction(): Promise<{ vault: FakeVaultFS; seeded: string }> {
		const vault = new FakeVaultFS();
		const doc = {
			...(rawFixture as unknown as InstructionSet),
			action_count: 4,
			actions: [...rawFixture.actions, INSERT_ACTION],
		};
		const seeded = JSON.stringify(doc, null, 2) + "\n";
		await vault.create(DOC_PATH, seeded);
		return { vault, seeded };
	}

	it("rejects a schema-invalid edit with a message and writes nothing", async () => {
		const { vault, seeded } = await vaultWithInsertAction();
		const notify = vi.fn();
		const adapter = new ObsidianInstructionSetDoc(vault, notify);
		const model = await adapter.load(DOC_PATH);

		// `target_path` carries minLength:1 — setTargetField accepts "" verbatim
		// (it never coerces), so the schema is the only thing standing between
		// an empty target and the file.
		const edited = setTargetField(model, "I04", "target_path", "");
		expect(edited.dirty).toBe(true);

		await expect(adapter.save(edited)).rejects.toThrow(
			/ObsidianInstructionSetDoc\.save/,
		);
		expect(await vault.read(DOC_PATH)).toBe(seeded); // not written, not partially written
		// The validator message is a caller-visible rejection the view renders
		// itself — the adapter's Notice is reserved for I/O failures.
		expect(notify).not.toHaveBeenCalled();
	});

	it("leaves the rejected edit pending — a corrected re-save then writes", async () => {
		const { vault } = await vaultWithInsertAction();
		const adapter = new ObsidianInstructionSetDoc(vault);
		const model = await adapter.load(DOC_PATH);

		const broken = setTargetField(model, "I04", "target_path", "");
		await expect(adapter.save(broken)).rejects.toThrow();

		const fixed = setTargetField(broken, "I04", "target_path", "Atlas/202 Notes/Other.md");
		await adapter.save(fixed);

		const written = JSON.parse(await vault.read(DOC_PATH)) as InstructionSet;
		expect(fieldOf(findAction(written, "I04"), "target_path")).toBe(
			"Atlas/202 Notes/Other.md",
		);
	});
});

/**
 * T3.1 review: every save() rejection carries how much of the save reached
 * disk, because only this adapter knows. The view renders opposite recovery
 * instructions off that number ("nothing was written" vs. "k of n landed —
 * save again to finish"), and must not re-derive it from a second copy of the
 * patch-path invariant.
 */
describe("ObsidianInstructionSetDoc.save() — failures report how much landed", () => {
	async function saveError(
		adapter: ObsidianInstructionSetDoc,
		model: InstructionFixerModel,
	): Promise<InstructionSetSaveError> {
		try {
			await adapter.save(model);
		} catch (err) {
			if (err instanceof InstructionSetSaveError) return err;
			throw new Error(`expected an InstructionSetSaveError, got: ${String(err)}`);
		}
		throw new Error("expected save() to reject");
	}

	it("a structural edit reports zero landed patches — it rejects before the write loop", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianInstructionSetDoc(vault);
		const model = await adapter.load(DOC_PATH);

		const err = await saveError(adapter, {
			doc: { ...model.doc, actions: model.doc.actions.slice(0, 2) },
			dirty: true,
		});

		expect(err.landedPatchCount).toBe(0);
		expect(err.message).toMatch(/unsupported edit/);
		expect(await vault.read(DOC_PATH)).toBe(FIXTURE_JSON);
	});

	it("a schema-invalid document reports zero landed patches", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianInstructionSetDoc(vault);
		const model = await adapter.load(DOC_PATH);

		const err = await saveError(adapter, {
			doc: { ...model.doc, schema_version: "1" as unknown as "2" },
			dirty: true,
		});

		expect(err.landedPatchCount).toBe(0);
		expect(await vault.read(DOC_PATH)).toBe(FIXTURE_JSON);
	});

	it("save() before load() reports zero landed patches", async () => {
		const vault = await seededVault();
		const adapter = new ObsidianInstructionSetDoc(vault);
		const loaded = await new ObsidianInstructionSetDoc(vault).load(DOC_PATH);

		const err = await saveError(adapter, { doc: loaded.doc, dirty: true });

		expect(err.landedPatchCount).toBe(0);
		expect(err.message).toMatch(/load\(\)/);
	});

	it("a mid-loop write failure reports how many of the n patches landed", async () => {
		const vault = await seededVault();
		const failing = withNthWriteFailing(vault, DOC_PATH, 2);
		const adapter = new ObsidianInstructionSetDoc(failing, vi.fn());
		const model = await adapter.load(DOC_PATH);

		const err = await saveError(adapter, repairI02(repointI01(model)));

		expect(err.landedPatchCount).toBe(1);
		expect(err.totalPatchCount).toBe(2);
		// The underlying failure rides along, message verbatim.
		expect(err.message).toBe("disk full on write 2");
		expect((err.reason as Error).message).toBe("disk full on write 2");
	});

	it("a first-patch failure reports zero landed out of n", async () => {
		const vault = await seededVault();
		const failing = withNthWriteFailing(vault, DOC_PATH, 1);
		const adapter = new ObsidianInstructionSetDoc(failing, vi.fn());
		const model = await adapter.load(DOC_PATH);

		const err = await saveError(adapter, repairI02(repointI01(model)));

		expect(err.landedPatchCount).toBe(0);
		expect(err.totalPatchCount).toBe(2);
	});
});

/**
 * T3.1 review: the adapter is stateful ("one active doc"), and a `save()` can
 * still be in flight when the view retargets the leaf and calls `load()` on a
 * DIFFERENT set. The write itself is safe — `save()` binds its target at entry
 * — but advancing the diff baseline afterwards must not write through to
 * whatever document the adapter has moved on to.
 */
describe("ObsidianInstructionSetDoc.save() — a retarget mid-save", () => {
	const OTHER_PATH = "100 Inbox/2026-07-21_0900_instructions.json";

	/** The fixture minus its last action — a genuinely different set, so a
	 * baseline mix-up cannot pass unnoticed. */
	function otherSet(): InstructionSet {
		const set = JSON.parse(JSON.stringify(rawFixture)) as InstructionSet;
		return { ...set, action_count: 2, actions: set.actions.slice(0, 2) };
	}

	/** A VaultFS whose writes to `gatePath` block until the returned release. */
	function withGatedWrite(
		base: VaultFS,
		gatePath: string,
	): { vault: VaultFS; release: () => void; entered: Promise<void> } {
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let markEntered: () => void = () => {};
		const entered = new Promise<void>((resolve) => {
			markEntered = resolve;
		});
		const vault = delegating(base, {
			processJSON: async (path, transform) => {
				if (path === gatePath) {
					markEntered();
					await gate;
				}
				await base.processJSON(path, transform);
			},
		});
		return { vault, release, entered };
	}

	it("does not clobber the newly-loaded document's baseline when the stale save completes", async () => {
		const base = await seededVault();
		await base.create(OTHER_PATH, `${JSON.stringify(otherSet(), null, 2)}\n`);
		const { vault, release, entered } = withGatedWrite(base, DOC_PATH);
		const adapter = new ObsidianInstructionSetDoc(vault, vi.fn());

		// Save doc A, and hold it inside its write loop.
		const modelA = await adapter.load(DOC_PATH);
		const savingA = adapter.save(repointI01(modelA));
		await entered;

		// The leaf retargets to doc B while that save is still in flight.
		const modelB = await adapter.load(OTHER_PATH);

		release();
		await savingA;

		// Doc A's write still stands — it was requested, and save() bound its
		// target at entry.
		const writtenA = JSON.parse(await base.read(DOC_PATH)) as InstructionSet;
		expect(fieldOf(findAction(writtenA, "I01"), "target_moc_path")).toBe(I01_PATH_AFTER);

		// Doc B's baseline is intact: an unedited save is still a no-op...
		const otherJson = await base.read(OTHER_PATH);
		await adapter.save({ doc: modelB.doc, dirty: true });
		expect(await base.read(OTHER_PATH)).toBe(otherJson);

		// ...and an edited save derives exactly doc B's changed action.
		await adapter.save(repairI02(modelB));
		const writtenB = JSON.parse(await base.read(OTHER_PATH)) as InstructionSet;
		expect(writtenB.actions).toHaveLength(2);
		expect(fieldOf(findAction(writtenB, "I02"), "replace")).toBe(I02_REPLACE_AFTER);
		expect(fieldOf(findAction(writtenB, "I01"), "target_moc_path")).toBe(I01_PATH_BEFORE);
	});
});
