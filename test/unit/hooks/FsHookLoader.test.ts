/**
 * T6.2-fix — FsHookLoader tests (RED phase).
 *
 * Replaces the null-returning `createHookLoader` stub in `src/main.ts` with a
 * real synchronous filesystem-backed `HookLoader` implementation. Obsidian
 * desktop runs in Electron with full Node access, so a synchronous
 * `fs.readdirSync` against the user's hooks directory is the simplest
 * solution — no cache, no pre-warming.
 *
 * Test surface:
 *   1. Returns null when hooksDir does not exist on disk
 *   2. Returns null when dir exists but no matching file is present
 *   3. Returns null for a `.js` file (Electron requires `.cjs` for CJS)
 *   4. Returns `{ absolutePath, duplicates: [] }` for a single matching `.cjs`
 *   5. `.js` file present alongside `.cjs` → `.cjs` matches, `.js` ignored
 *   6. Unrelated files in the directory are ignored
 *   7. Re-reads the directory on every resolve (no caching)
 *
 * Spec refs: SDD ADR-3 (sync `createRequire` + cache evict — implies the
 *   loader contract is sync); HookRunner `HookLoader.resolve(key)` interface;
 *   PRD F8 (hook discovery rules).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FsHookLoader } from "../../../src/hooks/FsHookLoader";

describe("FsHookLoader", () => {
	let tmpRoot: string;

	beforeEach(() => {
		tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hashi-fshookloader-"));
	});

	afterEach(() => {
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	});

	// -- M2: vault-root containment --------------------------------------

	it("returns null when hooksDir resolves outside the vault root via .. traversal (M2)", () => {
		const loader = new FsHookLoader(tmpRoot, () => "../escape/hooks");
		expect(loader.resolve("before-create_moc")).toBeNull();
	});

	it("returns null when hooksDir is an absolute path outside the vault (M2)", () => {
		const escapeDir = fs.mkdtempSync(path.join(os.tmpdir(), "hashi-escape-"));
		try {
			fs.writeFileSync(
				path.join(escapeDir, "before-create_moc.cjs"),
				"module.exports = () => {};",
			);
			const loader = new FsHookLoader(tmpRoot, () => escapeDir);
			expect(loader.resolve("before-create_moc")).toBeNull();
		} finally {
			fs.rmSync(escapeDir, { recursive: true, force: true });
		}
	});

	// -- M1: file fingerprint exposed for staleness guard ----------------

	it("includes a file fingerprint (size + mtimeMs) for matched hooks (M1)", () => {
		const hooksDir = ".tomo-hashi/hooks";
		const absoluteDir = path.join(tmpRoot, hooksDir);
		fs.mkdirSync(absoluteDir, { recursive: true });
		const file = path.join(absoluteDir, "before-create_moc.cjs");
		fs.writeFileSync(file, "module.exports = () => {};");

		const loader = new FsHookLoader(tmpRoot, () => hooksDir);
		const result = loader.resolve("before-create_moc");

		expect(result?.fingerprint).toBeDefined();
		expect(typeof result?.fingerprint?.size).toBe("number");
		expect(typeof result?.fingerprint?.mtimeMs).toBe("number");
		expect(result?.fingerprint?.size).toBeGreaterThan(0);
	});

	it("returns null when the hooks directory does not exist on disk", () => {
		const loader = new FsHookLoader(tmpRoot, () => ".tomo-hashi/hooks");
		expect(loader.resolve("before-create_moc")).toBeNull();
	});

	// -- #52: debug trace sink (silent by default, opt-in for debugging) -----

	it("is silent by default — no debug sink passed, resolve does not throw", () => {
		// Default no-op sink: routine resolution emits nothing to the console.
		const loader = new FsHookLoader(tmpRoot, () => ".tomo-hashi/hooks");
		expect(() => loader.resolve("before-create_moc")).not.toThrow();
	});

	it("routes discovery traces to the debug sink when one is provided (#52)", () => {
		const debug = vi.fn();
		// Absent hooks dir → the useful 'dir + not readable' detail that
		// diagnosed #52 still surfaces, but only through the (gated) sink.
		const loader = new FsHookLoader(tmpRoot, () => "missing/hooks", debug);

		expect(loader.resolve("before-create_moc")).toBeNull();
		expect(debug).toHaveBeenCalled();
		const messages = debug.mock.calls.map((c) => String(c[0])).join("\n");
		expect(messages).toContain("before-create_moc");
		expect(messages).toContain("not readable");
	});

	it("returns null when the hooks directory exists but contains no matching file", () => {
		const hooksDir = ".tomo-hashi/hooks";
		fs.mkdirSync(path.join(tmpRoot, hooksDir), { recursive: true });
		const loader = new FsHookLoader(tmpRoot, () => hooksDir);
		expect(loader.resolve("before-create_moc")).toBeNull();
	});

	it("returns null for a .js file — Electron requires .cjs for CommonJS", () => {
		const hooksDir = ".tomo-hashi/hooks";
		const absoluteDir = path.join(tmpRoot, hooksDir);
		fs.mkdirSync(absoluteDir, { recursive: true });
		fs.writeFileSync(
			path.join(absoluteDir, "before-create_moc.js"),
			"module.exports = () => {};",
		);

		const loader = new FsHookLoader(tmpRoot, () => hooksDir);
		expect(loader.resolve("before-create_moc")).toBeNull();
	});

	it("returns { absolutePath, duplicates: [] } for a single matching .cjs file", () => {
		const hooksDir = ".tomo-hashi/hooks";
		const absoluteDir = path.join(tmpRoot, hooksDir);
		fs.mkdirSync(absoluteDir, { recursive: true });
		const file = path.join(absoluteDir, "after-move_note.cjs");
		fs.writeFileSync(file, "module.exports = () => {};");

		const loader = new FsHookLoader(tmpRoot, () => hooksDir);
		const result = loader.resolve("after-move_note");
		expect(result).not.toBeNull();
		expect(result?.absolutePath).toBe(file);
		expect(result?.duplicates).toEqual([]);
	});

	it("when both .cjs and .js exist, only .cjs matches; .js is ignored", () => {
		const hooksDir = ".tomo-hashi/hooks";
		const absoluteDir = path.join(tmpRoot, hooksDir);
		fs.mkdirSync(absoluteDir, { recursive: true });
		const cjsPath = path.join(absoluteDir, "before-update_tracker.cjs");
		fs.writeFileSync(cjsPath, "module.exports = () => {};");
		fs.writeFileSync(
			path.join(absoluteDir, "before-update_tracker.js"),
			"module.exports = () => {};",
		);

		const loader = new FsHookLoader(tmpRoot, () => hooksDir);
		const result = loader.resolve("before-update_tracker");
		expect(result?.absolutePath).toBe(cjsPath);
		expect(result?.duplicates).toEqual([]);
	});

	it("ignores unrelated files in the hooks directory", () => {
		const hooksDir = ".tomo-hashi/hooks";
		const absoluteDir = path.join(tmpRoot, hooksDir);
		fs.mkdirSync(absoluteDir, { recursive: true });
		fs.writeFileSync(path.join(absoluteDir, "README.md"), "# hooks");
		fs.writeFileSync(
			path.join(absoluteDir, "before-create_moc.txt"),
			"not a hook",
		);
		fs.writeFileSync(
			path.join(absoluteDir, "before-create_moc.js"),
			"module.exports = () => {};",
		);
		const matchPath = path.join(absoluteDir, "before-create_moc.cjs");
		fs.writeFileSync(matchPath, "module.exports = () => {};");

		const loader = new FsHookLoader(tmpRoot, () => hooksDir);
		const result = loader.resolve("before-create_moc");
		expect(result?.absolutePath).toBe(matchPath);
		expect(result?.duplicates).toEqual([]);
	});

	it("re-reads the hooks directory on every resolve (no caching)", () => {
		const hooksDir = "hooks";
		const absoluteDir = path.join(tmpRoot, hooksDir);
		fs.mkdirSync(absoluteDir, { recursive: true });

		const loader = new FsHookLoader(tmpRoot, () => hooksDir);
		expect(loader.resolve("before-create_moc")).toBeNull();

		const filePath = path.join(absoluteDir, "before-create_moc.cjs");
		fs.writeFileSync(filePath, "module.exports = () => {};");

		const result = loader.resolve("before-create_moc");
		expect(result?.absolutePath).toBe(filePath);
	});
});
