/**
 * The delete waits for its attachments — Tomo spec 039 / Kokoro ADR-029 §7.
 *
 * From spec 039 on, an origin's `delete_source.depends_on` names the
 * `move_asset` ids of every attachment its filed notes embed, and one shared
 * attachment couples two origins' deletes. Tomo shipped this as a description
 * change only, relying on behaviour our executor already has (ADR-029 C10):
 * declared `depends_on` is honoured on every kind, and `move_asset` is planned
 * before `delete_source`. These tests turn that reliance into contract, driven
 * by Tomo's own runnable two-conflict run through the real validator.
 *
 * Also pinned here: a `move_asset` that ends `skipped-already` (source gone,
 * destination present) satisfies its dependent delete. That is what lets a
 * re-run after a partial apply finish its deletes, and it is the answer we gave
 * Tomo on whether "applied" in the contract includes "already in place".
 */

import { describe, expect, it, vi } from "vitest";

import { InstructionExecutor } from "../../../src/executor/InstructionExecutor.js";
import type { Clock, RunState } from "../../../src/executor/state.js";
import { validate } from "../../../src/schema/validator.js";
import type { InstructionSet } from "../../../src/schema/types.js";
import type { PluginSettings } from "../../../src/types/index.js";
import { Store } from "../../../src/util/store.js";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import fixture from "../../fixtures/instructions/v4-asset-depends-on-run.json";

const INBOX = "100 Inbox";
const SET_PATH = `${INBOX}/2026-10-13_0905_instructions.json`;

const KARTE_SRC = `${INBOX}/Scans/karte.png`;
const KARTE_DST = "Atlas/290 Assets/296 Maps/karte.png";
const PLAN_SRC = `${INBOX}/Scans/plan.png`;
const PLAN_DST = "Atlas/290 Assets/295 Attachments/plan (2).png";
const DRESDEN = `${INBOX}/Dresden.md`;
const LEIPZIG = `${INBOX}/Leipzig.md`;

const settings: PluginSettings = {
	chosenInstanceName: null,
	containerComponent: "tomo",
	zoomLevel: 1,
	tomoInboxFolder: INBOX,
	executionMode: "silent",
	runLogRetention: "always",
	hooksDir: ".tomo-hashi/hooks",
	hooksPolicy: "enabled",
	debugLogging: false,
	permanentDeleteWarningShown: false,
	ideBridgeEnabled: false,
	ideBridgePort: 23027,
	ideBridgeAuthToken: "",
	suggestionsTemplateFolder: "",
	suggestionsLocationFolders: [],
	suggestionsTagFilters: [],
};

const clock: Clock = { now: () => new Date("2026-10-13T09:10:00") };

/** Tomo's "vault before the run", plus the staged files Pass 2 uploads. */
async function seedVault(): Promise<FakeVaultFS> {
	const vault = new FakeVaultFS();
	await vault.createFolder(`${INBOX}/Scans`);
	await vault.createFolder("Atlas/202 Notes");
	await vault.createFolder("Atlas/290 Assets/295 Attachments");

	await vault.create(DRESDEN, "Stadtplan von 1938.\n\n![[karte.png]]\n");
	await vault.create(LEIPZIG, "Vergleich mit Dresden.\n\n![[karte.png]]\n![[plan.png]]\n");
	await vault.create(KARTE_SRC, "inbox karte");
	await vault.create(PLAN_SRC, "inbox plan");
	await vault.create("Atlas/290 Assets/295 Attachments/karte.png", "occupier karte");
	await vault.create("Atlas/290 Assets/295 Attachments/plan.png", "occupier plan");

	await vault.create(`${INBOX}/2026-10-13_0905_dresden.md`, "# Dresden\n");
	await vault.create(`${INBOX}/2026-10-13_0905_leipzig.md`, "# Leipzig\n");
	await vault.create(SET_PATH, JSON.stringify(fixture, null, 2) + "\n");
	return vault;
}

async function apply(vault: FakeVaultFS): Promise<Map<string, string>> {
	const executor = new InstructionExecutor({
		vault,
		validator: { validate },
		hookRunner: { run: vi.fn().mockResolvedValue({ kind: "ok" }), preApprove: vi.fn().mockResolvedValue(undefined) },
		settings,
		clock,
		store: new Store<RunState>({ kind: "idle" }),
		notify: vi.fn(),
	});
	await executor.execute({ kind: "single-file", sourcePath: SET_PATH });

	const written = await vault.readJSON<InstructionSet>(SET_PATH);
	return new Map(written.actions.map((a) => [a.id, a.applied === true ? "applied" : "not-applied"]));
}

describe("delete_source waits for its attachments (Tomo spec 039 run)", () => {
	it("the fixture validates and both deletes name the shared attachment move I03", () => {
		const result = validate(fixture);
		if (!result.ok) throw new Error(result.message);

		const dependsOn = Object.fromEntries(
			result.data.actions.filter((a) => a.action === "delete_source").map((a) => [a.id, a.depends_on]),
		);
		expect(dependsOn).toEqual({ I05: ["I01", "I03"], I06: ["I02", "I03", "I04"] });
	});

	it("happy path: all six apply, the missing 296 Maps folder is created, both origins go", async () => {
		const vault = await seedVault();
		const applied = await apply(vault);

		expect([...applied.values()]).toEqual(Array(6).fill("applied"));
		expect(await vault.read(KARTE_DST)).toBe("inbox karte");
		expect(await vault.read(PLAN_DST)).toBe("inbox plan");
		expect(await vault.exists(DRESDEN)).toBe(false);
		expect(await vault.exists(LEIPZIG)).toBe(false);
	});

	it("cascade probe: an occupied attachment target keeps BOTH origins that embed it", async () => {
		const vault = await seedVault();
		await vault.createFolder("Atlas/290 Assets/296 Maps");
		await vault.create(KARTE_DST, "squatter");

		const applied = await apply(vault);

		// I03 failed (source and destination both present); I05 and I06 are
		// skipped-dependency. Everything else is independent and applies.
		expect(Object.fromEntries(applied)).toEqual({
			I01: "applied",
			I02: "applied",
			I03: "not-applied",
			I04: "applied",
			I05: "not-applied",
			I06: "not-applied",
		});
		expect(await vault.exists(DRESDEN)).toBe(true);
		expect(await vault.exists(LEIPZIG)).toBe(true);
		expect(await vault.read(KARTE_SRC)).toBe("inbox karte");
		expect(await vault.read(KARTE_DST)).toBe("squatter");
	});

	it("an attachment already in place (skipped-already) satisfies the delete that waits on it", async () => {
		const vault = await seedVault();
		// A previous, interrupted apply moved karte.png but never got to the deletes.
		await vault.createFolder("Atlas/290 Assets/296 Maps");
		await vault.rename(KARTE_SRC, KARTE_DST);

		const applied = await apply(vault);

		expect(applied.get("I03")).toBe("applied"); // skipped-already graduates to applied:true
		expect(await vault.exists(DRESDEN)).toBe(false);
		expect(await vault.exists(LEIPZIG)).toBe(false);
	});
});
