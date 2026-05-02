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

import type { HookKey, HookLoader, ResolvedHook } from "./HookRunner.js";

export class FsHookLoader implements HookLoader {
	constructor(
		private readonly vaultBasePath: string,
		private readonly getHooksDir: () => string,
	) {}

	resolve(key: HookKey): ResolvedHook | null {
		const hooksDir = this.getHooksDir();
		const absoluteDir = path.resolve(this.vaultBasePath, hooksDir);

		// M2: refuse hooksDir values that escape the vault root. `data.json`
		// could be tampered (e.g., via Obsidian Sync from another device)
		// to point hooksDir at "../escape" or an absolute path elsewhere
		// on disk; without this guard, FsHookLoader would happily load
		// hook code from arbitrary FS locations. Allow only paths that
		// resolve inside the vault tree (or equal the vault root).
		//
		// review round 2 / L25: realpath both sides before the prefix
		// check so a symlinked hooksDir cannot pass the string compare
		// while resolving outside the vault. Common macOS pitfall:
		// /var/folders/ is a symlink to /private/var/folders/ — a vault
		// or hooksDir on such a path would otherwise mismatch under
		// path.resolve (which normalises but does NOT resolve symlinks).
		// Soft-fail to the pre-realpath comparison if either realpath
		// throws (e.g. directory does not exist yet) — the readdirSync
		// below will then fail naturally and return null.
		let canonicalDir = absoluteDir;
		let canonicalBase = this.vaultBasePath;
		try {
			canonicalDir = fs.realpathSync(absoluteDir);
			canonicalBase = fs.realpathSync(this.vaultBasePath);
		} catch {
			// keep the unrealpathed values for the comparison below
		}
		if (
			canonicalDir !== canonicalBase &&
			!canonicalDir.startsWith(canonicalBase + path.sep)
		) {
			return null;
		}

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
		const absolutePath = path.join(absoluteDir, first);

		// M1: stat the matched file so HookRunner can detect file
		// replacement between ask-mode runs and re-prompt. Soft-fail to
		// "no fingerprint" if stat throws (race with deletion); the
		// staleness guard then degrades to the prior cached-decision
		// behavior rather than blocking the run.
		let fingerprint: { size: number; mtimeMs: number } | undefined;
		try {
			const stat = fs.statSync(absolutePath);
			fingerprint = { size: stat.size, mtimeMs: stat.mtimeMs };
		} catch {
			fingerprint = undefined;
		}

		return {
			absolutePath,
			duplicates: rest.map((d) => path.join(absoluteDir, d)),
			...(fingerprint !== undefined ? { fingerprint } : {}),
		};
	}
}
