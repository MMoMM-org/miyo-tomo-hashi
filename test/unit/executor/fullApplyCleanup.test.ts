/**
 * #146 — opt-in cleanup after a fully successful apply (ADR-018 §4).
 *
 * Covers the per-set cleanup primitive in isolation; the executor gate
 * (setting + 100%-success check) is covered in InstructionExecutor.test.ts.
 */

import { describe, expect, it, vi } from "vitest";

import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { cleanupFullyAppliedSet } from "../../../src/executor/fullApplyCleanup.js";

const JSON_PATH = "inbox/2026-10-23_instructions.json";
const MD_PATH = "inbox/2026-10-23_instructions.md";
const SUGGESTIONS = "inbox/2026-10-23_suggestions.md";
const PROPOSAL = "inbox/2026-10-23_moc-proposal.md";
const NOW = new Date("2026-10-23T12:00:00.000Z");
const clock = { now: () => NOW };
const HOOKS_DIR = ".tomo-hashi/hooks";

async function seedSet(
	vault: FakeVaultFS,
	sources: unknown[],
	extraFm: Record<string, unknown> = {},
): Promise<void> {
	await vault.create(JSON_PATH, "{}");
	await vault.create(MD_PATH, "# Instructions");
	vault.seedFrontMatter(MD_PATH, {
		...extraFm,
		tomo: { doc_type: "instructions", state: "pending-apply", run_id: "r1", sources },
	});
}

describe("cleanupFullyAppliedSet", () => {
	it("flips tomo.state by merge, then trashes sources before the .md and the .json", async () => {
		const vault = new FakeVaultFS();
		await vault.create(SUGGESTIONS, "s");
		await vault.create(PROPOSAL, "p");
		await seedSet(vault, [{ path: SUGGESTIONS, checksum: "abc" }, { path: PROPOSAL }], {
			tags: ["MiYo-Tomo/instructions"],
		});

		const flips: Record<string, unknown>[] = [];
		const order: string[] = [];
		const realProcessFm = vault.processFrontMatter.bind(vault);
		vi.spyOn(vault, "processFrontMatter").mockImplementation(async (path, fn) => {
			await realProcessFm(path, (fm) => {
				fn(fm);
				flips.push(structuredClone(fm));
			});
		});
		const realTrash = vault.trash.bind(vault);
		vi.spyOn(vault, "trash").mockImplementation(async (path) => {
			order.push(path);
			await realTrash(path);
		});

		const report = await cleanupFullyAppliedSet(vault, JSON_PATH, clock, HOOKS_DIR);

		expect(flips).toEqual([
			{
				tags: ["MiYo-Tomo/instructions"],
				tomo: {
					doc_type: "instructions",
					state: "applied",
					run_id: "r1",
					sources: [{ path: SUGGESTIONS, checksum: "abc" }, { path: PROPOSAL }],
					updated_at: NOW.toISOString(),
				},
			},
		]);
		expect(order).toEqual([SUGGESTIONS, PROPOSAL, MD_PATH, JSON_PATH]);
		expect(report).toEqual({
			fileId: JSON_PATH,
			trashed: [SUGGESTIONS, PROPOSAL, MD_PATH, JSON_PATH],
			warnings: [],
		});
	});

	it("warns and continues when a source path is already gone", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PROPOSAL, "p");
		await seedSet(vault, [{ path: SUGGESTIONS }, { path: PROPOSAL }]);

		const report = await cleanupFullyAppliedSet(vault, JSON_PATH, clock, HOOKS_DIR);

		expect(report.trashed).toEqual([PROPOSAL, MD_PATH, JSON_PATH]);
		expect(report.warnings).toEqual([`source already gone: ${SUGGESTIONS}`]);
		expect(await vault.exists(JSON_PATH)).toBe(false);
	});

	it("skips unsafe, denied, duplicate and self-referencing source paths", async () => {
		const vault = new FakeVaultFS();
		await vault.create(SUGGESTIONS, "s");
		await vault.create(".obsidian/app.json", "{}");
		await seedSet(vault, [
			{ path: "../outside.md" },
			{ path: ".obsidian/app.json" },
			{ path: SUGGESTIONS },
			{ path: SUGGESTIONS },
			{ path: MD_PATH },
			{ checksum: "no-path" },
		]);

		const report = await cleanupFullyAppliedSet(vault, JSON_PATH, clock, HOOKS_DIR);

		expect(report.trashed).toEqual([SUGGESTIONS, MD_PATH, JSON_PATH]);
		expect(report.warnings).toEqual([
			"unsafe source path skipped: ../outside.md",
			"unsafe source path skipped: .obsidian/app.json",
		]);
		expect(await vault.exists(".obsidian/app.json")).toBe(true);
	});

	it("trashes nothing when the .md peer is missing", async () => {
		const vault = new FakeVaultFS();
		await vault.create(JSON_PATH, "{}");
		const trash = vi.spyOn(vault, "trash");

		const report = await cleanupFullyAppliedSet(vault, JSON_PATH, clock, HOOKS_DIR);

		expect(trash).not.toHaveBeenCalled();
		expect(report.trashed).toEqual([]);
		expect(report.warnings).toEqual([`no cleanup: instructions doc missing: ${MD_PATH}`]);
	});

	it("trashes nothing when the .md peer has no tomo.sources", async () => {
		const vault = new FakeVaultFS();
		await vault.create(JSON_PATH, "{}");
		await vault.create(MD_PATH, "# Instructions");
		vault.seedFrontMatter(MD_PATH, { tomo: { doc_type: "instructions" } });
		const trash = vi.spyOn(vault, "trash");
		const processFm = vi.spyOn(vault, "processFrontMatter");

		const report = await cleanupFullyAppliedSet(vault, JSON_PATH, clock, HOOKS_DIR);

		expect(trash).not.toHaveBeenCalled();
		expect(processFm).not.toHaveBeenCalled();
		expect(report.warnings).toEqual([`no cleanup: no tomo.sources on ${MD_PATH}`]);
	});

	it("keeps the instructions doc when trashing a source throws", async () => {
		const vault = new FakeVaultFS();
		await vault.create(SUGGESTIONS, "s");
		await seedSet(vault, [{ path: SUGGESTIONS }]);
		vi.spyOn(vault, "trash").mockRejectedValueOnce(new Error("EACCES"));

		const report = await cleanupFullyAppliedSet(vault, JSON_PATH, clock, HOOKS_DIR);

		expect(report.trashed).toEqual([]);
		expect(report.warnings).toEqual([
			`trash failed: ${SUGGESTIONS}: EACCES — instructions doc kept`,
		]);
		expect(await vault.exists(MD_PATH)).toBe(true);
		expect(await vault.exists(JSON_PATH)).toBe(true);
	});

	it("keeps the .json when trashing the .md throws", async () => {
		const vault = new FakeVaultFS();
		await seedSet(vault, []);
		vi.spyOn(vault, "trash").mockRejectedValueOnce(new Error("busy"));

		const report = await cleanupFullyAppliedSet(vault, JSON_PATH, clock, HOOKS_DIR);

		expect(report.trashed).toEqual([]);
		expect(report.warnings).toEqual([`trash failed: ${MD_PATH}: busy — instructions doc kept`]);
		expect(await vault.exists(JSON_PATH)).toBe(true);
	});
});
