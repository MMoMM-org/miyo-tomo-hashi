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

	it("build/main.js is at most 1000 KB minified (SDD CON-7 / Quality Requirements, revised 2026-04-28)", () => {
		const stats = statSync(buildOutput);
		const sizeKb = stats.size / 1024;
		// 1000 KB ceiling per SDD CON-7 (revised 2026-04-28). Original target
		// was 500 KB but assumed dockerode would be `external` at runtime —
		// reality is Obsidian plugins ship as a single `main.js` with no
		// adjacent `node_modules/`, so dockerode must be bundled. xterm.js
		// (~150 KB) + dockerode + docker-modem (~250 KB minified) + xterm CSS
		// + app code = ~937 KB. 1000 KB is the realistic ceiling; if this
		// trips, lazy-load xterm or audit dockerode usage before raising.
		expect(sizeKb).toBeLessThanOrEqual(1000);
	});

	it("build/manifest.json declares isDesktopOnly: true (PRD Constraints / SDD CON-3)", () => {
		const manifestPath = resolve(repoRoot, "build/manifest.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
			isDesktopOnly: boolean;
		};
		expect(manifest.isDesktopOnly).toBe(true);
	});
});
