import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Build-pipeline smoke test (T1.2).
 *
 * Validates that the production esbuild pipeline:
 *   (a) produces a non-empty `build/main.js`, and
 *   (b) declares a `.css` loader in `esbuild.config.mjs`, as required by
 *       SDD CON-2 + Implementation Gotchas (xterm.js CSS bundling).
 *
 * The CSS loader prepares for the phase-4 xterm.js integration; phase 1 only
 * needs the loader entry to exist so the bundler is ready when xterm CSS is
 * imported later. We use the `text` loader (per SDD gotcha guidance) so the
 * CSS can be inlined into a single `main.js` artifact, matching Obsidian's
 * plugin packaging model.
 */
describe("production build pipeline", () => {
	const repoRoot = resolve(__dirname, "../..");
	const buildOutput = resolve(repoRoot, "build/main.js");
	const esbuildConfigPath = resolve(repoRoot, "esbuild.config.mjs");

	beforeAll(() => {
		execSync("node esbuild.config.mjs production", {
			cwd: repoRoot,
			stdio: "inherit",
		});
	}, 60_000);

	it("produces a non-empty build/main.js", () => {
		const stats = statSync(buildOutput);
		expect(stats.isFile()).toBe(true);
		expect(stats.size).toBeGreaterThan(0);
	});

	it("declares a .css loader in esbuild.config.mjs (SDD CON-2)", () => {
		const configSource = readFileSync(esbuildConfigPath, "utf-8");
		// Loader entry can be `".css":` or `'.css':` — accept either quote style.
		expect(configSource).toMatch(/loader\s*:\s*\{[^}]*['"]\.css['"]\s*:/);
	});
});
