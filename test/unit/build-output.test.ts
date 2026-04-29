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

	it("build/main.js is at most 1200 KB minified (SDD CON-7, raised at T6.2)", () => {
		const stats = statSync(buildOutput);
		const sizeKb = stats.size / 1024;
		// 1200 KB ceiling per SDD CON-7 (raised 2026-04-29 at T6.2). Revision
		// history:
		//   - Original 500 KB target (T1.2) assumed dockerode would be
		//     `external`; impossible because Obsidian plugins ship one main.js.
		//   - 1000 KB target (T5.6, 2026-04-28) was set for 001 + dockerode
		//     + xterm + ajv (≈ 940 KB).
		//   - 002 wiring at T6.2 adds InstructionExecutor + planner + 8 action
		//     handlers + RunLogWriter + HookRunner + ExecutionModal +
		//     statusBar + the schema validator's compiled-ajv ~165 KB → bundle
		//     is now ~1105 KB. 1200 KB is the realistic post-002 ceiling.
		// If this trips, audit ajv usage (consider validator.gen.js code-gen
		// per ADR-1 v1) or lazy-load xterm before raising.
		expect(sizeKb).toBeLessThanOrEqual(1200);
	});

	it("build/manifest.json declares isDesktopOnly: true (PRD Constraints / SDD CON-3)", () => {
		const manifestPath = resolve(repoRoot, "build/manifest.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
			isDesktopOnly: boolean;
		};
		expect(manifest.isDesktopOnly).toBe(true);
	});
});
