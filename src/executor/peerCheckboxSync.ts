/**
 * PeerCheckboxSync — best-effort tick of the Applied checkbox in the .md peer.
 *
 * Peer naming convention (aligned with planner.ts resolveSingle):
 *   `foo_instructions.json` → `foo_instructions.md`  (strip `.json`, add `.md`)
 *
 * Outcome semantics:
 *   "ticked"          — checkbox flipped from `- [ ] Applied` to `- [x] Applied`
 *   "already-ticked"  — checkbox was already `- [x] Applied`; no write performed
 *   "heading-missing" — peer exists but has no matching `### <actionId>` heading
 *                       OR the heading has no Applied checkbox; no write performed
 *   "peer-missing"    — .md peer file does not exist; no write performed
 *
 * Soft-warn contract: this function NEVER throws. Any unexpected error is
 * treated as "heading-missing" (conservative no-op). Deviation note: the plan
 * documents exactly 4 outcomes; a 5th "error" variant is not introduced — instead
 * unexpected errors collapse to "heading-missing" per the plan's own guidance.
 *
 * No import 'obsidian' — pure TypeScript on VaultFS port.
 *
 * [ref: PRD/F5; SDD/PeerCheckboxSync design]
 */

import type { VaultFS } from "../vault/VaultFS.js";

export type PeerSyncOutcome =
	| "ticked"
	| "already-ticked"
	| "heading-missing"
	| "peer-missing";

/**
 * Tick the `- [ ] Applied` checkbox under heading `### <actionId>` in the
 * .md peer of `jsonSourcePath`. Returns a PeerSyncOutcome and never throws.
 */
export async function tickPeerCheckbox(
	vault: VaultFS,
	jsonSourcePath: string,
	actionId: string,
): Promise<PeerSyncOutcome> {
	try {
		const peerPath = derivePeerPath(jsonSourcePath);

		if (!(await vault.exists(peerPath))) {
			return "peer-missing";
		}

		const content = await vault.read(peerPath);
		// M8: scan once on the read content so we know lineIdx +
		// already-ticked status. The vault.process callback then targets
		// the known line directly instead of re-scanning + rebuilding the
		// whole file. Pre-fix did 2 full scans + 2 RegExp allocations per
		// applied action.
		const result = findCheckboxInSection(content, actionId);

		if (result === null) {
			return "heading-missing";
		}

		if (result.state === "ticked") {
			return "already-ticked";
		}

		const targetIdx = result.lineIdx;
		await vault.process(peerPath, (raw) => {
			const lines = raw.split("\n");
			const target = lines[targetIdx];
			if (target !== undefined && target.trim() === "- [ ] Applied") {
				lines[targetIdx] = target.replace("- [ ] Applied", "- [x] Applied");
			}
			return lines.join("\n");
		});

		return "ticked";
	} catch {
		// Unexpected errors collapse to "heading-missing" (conservative no-op).
		// [ref: SDD/PeerCheckboxSync design — Soft-warn contract]
		return "heading-missing";
	}
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Derive the .md peer path from a _instructions.json path.
 * Strips `.json` and appends `.md`.
 */
function derivePeerPath(jsonSourcePath: string): string {
	return jsonSourcePath.slice(0, -".json".length) + ".md";
}

type CheckboxResult = { state: "ticked" | "unticked"; lineIdx: number };

/**
 * Find the Applied checkbox under the heading for `actionId`.
 * Returns null when the heading or checkbox is not found.
 *
 * Heading match: `### <actionId>` optionally followed by em-dash, hyphen,
 * colon, or any other continuation (tolerant). Em-dash is the documented form.
 *
 * lineIdx (review M8) lets the caller target the exact line in vault.process
 * without re-scanning the whole file.
 */
function findCheckboxInSection(
	content: string,
	actionId: string,
): CheckboxResult | null {
	const lines = content.split("\n");
	// review round 2 / L20: replace per-call new RegExp with a string
	// startsWith + delimiter check. Each instruction-set run was paying
	// one RegExp compile per applied action (e.g. 20 compiles for a
	// 20-action run); the equivalent string scan is allocation-free.
	// `headingPrefix` matches the documented format `### <actionId>`
	// followed by either whitespace, end of line, or any continuation
	// character handled below.
	const headingPrefix = `### ${actionId}`;
	const isHeadingForAction = (line: string): boolean => {
		if (!line.startsWith(headingPrefix)) return false;
		const tail = line.charAt(headingPrefix.length);
		return tail === "" || /\s/.test(tail);
	};

	let inSection = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (!inSection) {
			if (isHeadingForAction(line)) {
				inSection = true;
			}
			continue;
		}

		// Next heading at level 3+ ends the section
		if (/^###/.test(line)) {
			break;
		}

		if (line.trim() === "- [x] Applied") {
			return { state: "ticked", lineIdx: i };
		}

		if (line.trim() === "- [ ] Applied") {
			return { state: "unticked", lineIdx: i };
		}
	}

	return null;
}
