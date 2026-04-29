/**
 * FsHookLoader — production HookLoader for v0.1.
 *
 * Synchronous filesystem-backed implementation of the `HookLoader` interface
 * defined in `HookRunner.ts`. Obsidian Desktop runs in Electron with full
 * Node access, so `fs.readdirSync` against the user's hooks directory is
 * fast (microseconds for a small hooks dir) and side-effect free. No cache,
 * no pre-warming — every `resolve()` call re-reads the directory so newly
 * dropped hook files are picked up on the next run without a plugin reload.
 *
 * Discovery rules:
 *   - Match `<hooksDir>/<key>.js` and `<hooksDir>/<key>.cjs`.
 *   - Multiple matches → first alphabetical wins; the rest surface in
 *     `duplicates` so HookRunner can warn about them.
 *   - `hooksDir` is resolved against `vaultBasePath` (the desktop adapter's
 *     `getBasePath()`), which gives us absolute paths to feed into
 *     `createRequire` (per ADR-3).
 *
 * Why not the vault adapter? `vault.adapter.list` is async, but `HookLoader`
 * is sync (per ADR-3, which prescribes sync `createRequire` + cache evict).
 * Bridging async list → sync resolve would require pre-warming a cache; for
 * a small hooks directory the cache is more code than the operation it
 * replaces.
 *
 * Spec refs: SDD ADR-3 (sync createRequire + cache evict); PRD F8 (hook
 *   discovery `<hooksDir>/<phase>-<kind>.{js,cjs}`); HookRunner.HookLoader
 *   interface.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { HookKey, HookLoader } from "./HookRunner.js";

export class FsHookLoader implements HookLoader {
	constructor(
		private readonly vaultBasePath: string,
		private readonly getHooksDir: () => string,
	) {}

	resolve(key: HookKey): { absolutePath: string; duplicates: string[] } | null {
		const hooksDir = this.getHooksDir();
		const absoluteDir = path.resolve(this.vaultBasePath, hooksDir);
		let entries: string[];
		try {
			entries = fs.readdirSync(absoluteDir);
		} catch {
			return null;
		}
		const matches = entries
			.filter((e) => e === `${key}.js` || e === `${key}.cjs`)
			.sort();
		if (matches.length === 0) return null;
		const [first, ...rest] = matches;
		if (first === undefined) return null;
		return {
			absolutePath: path.join(absoluteDir, first),
			duplicates: rest.map((d) => path.join(absoluteDir, d)),
		};
	}
}
