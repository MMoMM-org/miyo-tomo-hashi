/**
 * Filename utilities for run log files.
 *
 * buildRunLogFilename: produce the canonical log filename from a start timestamp.
 * resolveCollisionFreePath: find a non-colliding path in the given folder.
 *
 * Local time is used for the filename (getFullYear/getMonth/etc.) so the
 * timestamp matches what the user sees in their system clock.
 *
 * No crypto, no external dependencies.
 *
 * [ref: PRD/F7; SDD/ADR-8; T4.3]
 */

import type { VaultFS } from "../vault/VaultFS.js";

/**
 * Build the canonical run-log filename from the run's start timestamp.
 * Uses local time: tomo-hashi-run-log_YYYY-MM-DDTHHMM.md
 */
export function buildRunLogFilename(startedAt: Date): string {
	const year = String(startedAt.getFullYear());
	const month = String(startedAt.getMonth() + 1).padStart(2, "0");
	const day = String(startedAt.getDate()).padStart(2, "0");
	const hours = String(startedAt.getHours()).padStart(2, "0");
	const minutes = String(startedAt.getMinutes()).padStart(2, "0");
	return `tomo-hashi-run-log_${year}-${month}-${day}T${hours}${minutes}.md`;
}

/**
 * Resolve a non-colliding path inside `folder` for `baseFilename`.
 *
 * Tries: <folder>/<baseFilename>, then <folder>/<stem>_2.md, _3.md, …
 * until a path that does not yet exist in the vault is found.
 */
export async function resolveCollisionFreePath(
	vault: VaultFS,
	folder: string,
	baseFilename: string,
): Promise<string> {
	const stem = baseFilename.replace(/\.md$/, "");
	const base = `${folder}/${baseFilename}`;

	if (!(await vault.exists(base))) {
		return base;
	}

	let n = 2;
	while (true) {
		const candidate = `${folder}/${stem}_${n}.md`;
		if (!(await vault.exists(candidate))) {
			return candidate;
		}
		n++;
	}
}
