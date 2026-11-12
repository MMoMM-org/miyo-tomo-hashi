/**
 * fullApplyCleanup — opt-in removal of a finished instruction set (#146).
 *
 * ADR-018 §4 (amended 2026-10-11, Kokoro 76e0fba) makes cleanup after a full
 * apply OPTIONAL and default-off: applied docs stay in the inbox unless the
 * user enables `cleanupAfterFullApply`. When enabled, the executor calls this
 * once per instruction set that reached literal 100% success. The 100% gate
 * lives in the executor; this module only performs the ordered cleanup:
 *
 *   1. read `tomo.sources[]` from the `.md` peer's frontmatter (ADR-018's
 *      source of truth) and, in the same write, flip `tomo.state=applied`
 *      by frontmatter MERGE;
 *   3. trash every `sources[].path`, then the `.md` peer, then the `.json`.
 *
 * The order is load-bearing: the instructions doc's `sources[]` is Tomo's only
 * record that the work is done. If the doc disappears while an approved
 * suggestions doc remains, Tomo synthesises the set again. So any trash
 * failure stops the cleanup and the doc is kept. A source that is already gone
 * is fine (warn + continue), because it can no longer trigger re-synthesis.
 *
 * Best-effort and never throws: everything that goes wrong lands in
 * `warnings`, which the run log records as paths only (Constitution L2).
 *
 * No import 'obsidian' at this layer — runs on the VaultFS port.
 */

import type { VaultFS } from "../vault/VaultFS.js";
import type { Clock } from "./state.js";
import { derivePeerPath } from "./peerCheckboxSync.js";
import { denyListMatch, normalizeAndContain } from "../util/paths.js";

/** Sentinel thrown inside processFrontMatter to abort the write. */
const NO_SOURCES = new Error("no tomo.sources");

export interface CleanupReport {
	readonly fileId: string;
	/** Paths actually trashed, in trash order. */
	readonly trashed: readonly string[];
	readonly warnings: readonly string[];
}

export async function cleanupFullyAppliedSet(
	vault: VaultFS,
	jsonPath: string,
	clock: Clock,
	hooksDir: string,
): Promise<CleanupReport> {
	const mdPath = derivePeerPath(jsonPath);
	const trashed: string[] = [];
	const warnings: string[] = [];
	const report = (): CleanupReport => ({ fileId: jsonPath, trashed, warnings });

	try {
		if (!(await vault.exists(mdPath))) {
			warnings.push(`no cleanup: instructions doc missing: ${mdPath}`);
			return report();
		}

		// Sources are read inside processFrontMatter, which parses the file
		// itself, NOT via readFrontMatter: the peer-checkbox ticks rewrite this
		// .md just before cleanup, so the metadataCache is often mid-rebuild and
		// reads as "no frontmatter". Throwing NO_SOURCES aborts without a write.
		const read: { sources: string[] | null } = { sources: null };
		try {
			await vault.processFrontMatter(mdPath, (fm) => {
				read.sources = readSourcePaths(fm);
				if (read.sources === null) throw NO_SOURCES;
				const tomo = fm["tomo"] as Record<string, unknown>;
				fm["tomo"] = { ...tomo, state: "applied", updated_at: clock.now().toISOString() };
			});
		} catch (err) {
			if (err !== NO_SOURCES) throw err;
		}
		const sources = read.sources;
		if (sources === null) {
			warnings.push(`no cleanup: no tomo.sources on ${mdPath}`);
			return report();
		}

		const seen = new Set<string>([mdPath, jsonPath]);
		for (const raw of sources) {
			const safe = normalizeAndContain(raw);
			if (!safe.ok || safe.vaultRelativePath === "" || denyListMatch(safe.vaultRelativePath, hooksDir)) {
				warnings.push(`unsafe source path skipped: ${raw}`);
				continue;
			}
			const path = safe.vaultRelativePath;
			if (seen.has(path)) continue;
			seen.add(path);

			if (!(await vault.exists(path))) {
				warnings.push(`source already gone: ${path}`);
				continue;
			}
			if (!(await tryTrash(vault, path, trashed, warnings))) return report();
		}

		// Doc last: .md (carries the tomo block) before the .json, so a failed
		// .md trash never leaves Tomo's record without its executable twin.
		if (!(await tryTrash(vault, mdPath, trashed, warnings))) return report();
		await tryTrash(vault, jsonPath, trashed, warnings);
	} catch (err) {
		warnings.push(`cleanup aborted: ${errorMessage(err)}`);
	}
	return report();
}

async function tryTrash(
	vault: VaultFS,
	path: string,
	trashed: string[],
	warnings: string[],
): Promise<boolean> {
	try {
		await vault.trash(path);
		trashed.push(path);
		return true;
	} catch (err) {
		warnings.push(`trash failed: ${path}: ${errorMessage(err)} — instructions doc kept`);
		return false;
	}
}

/** `tomo.sources[].path` strings, or null when the block has no sources array. */
function readSourcePaths(fm: Record<string, unknown> | undefined): string[] | null {
	const tomo = fm?.["tomo"];
	if (!isRecord(tomo) || !Array.isArray(tomo["sources"])) return null;
	const paths: string[] = [];
	for (const entry of tomo["sources"] as unknown[]) {
		if (isRecord(entry) && typeof entry["path"] === "string") paths.push(entry["path"]);
	}
	return paths;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
