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
		const result = findCheckboxInSection(content, actionId);

		if (result === null) {
			return "heading-missing";
		}

		if (result.state === "ticked") {
			return "already-ticked";
		}

		await vault.process(peerPath, (raw) =>
			flipCheckbox(raw, actionId),
		);

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

type CheckboxResult = { state: "ticked" | "unticked" };

/**
 * Find the Applied checkbox under the heading for `actionId`.
 * Returns null when the heading or checkbox is not found.
 *
 * Heading match: `### <actionId>` optionally followed by em-dash, hyphen,
 * colon, or any other continuation (tolerant). Em-dash is the documented form.
 */
function findCheckboxInSection(
	content: string,
	actionId: string,
): CheckboxResult | null {
	const lines = content.split("\n");
	const headingPattern = new RegExp(`^### ${escapeRegExp(actionId)}(\\s|$)`);

	let inSection = false;

	for (const line of lines) {
		if (!inSection) {
			if (headingPattern.test(line)) {
				inSection = true;
			}
			continue;
		}

		// Next heading at level 3+ ends the section
		if (/^###/.test(line)) {
			break;
		}

		if (line.trim() === "- [x] Applied") {
			return { state: "ticked" };
		}

		if (line.trim() === "- [ ] Applied") {
			return { state: "unticked" };
		}
	}

	return null;
}

/**
 * Return new content with the first `- [ ] Applied` under `### <actionId>`
 * replaced by `- [x] Applied`. Preserves all other content verbatim.
 */
function flipCheckbox(content: string, actionId: string): string {
	const lines = content.split("\n");
	const headingPattern = new RegExp(`^### ${escapeRegExp(actionId)}(\\s|$)`);

	let inSection = false;
	let flipped = false;

	const result = lines.map((line) => {
		if (flipped) return line;

		if (!inSection) {
			if (headingPattern.test(line)) {
				inSection = true;
			}
			return line;
		}

		if (/^###/.test(line)) {
			return line;
		}

		if (line.trim() === "- [ ] Applied") {
			flipped = true;
			return line.replace("- [ ] Applied", "- [x] Applied");
		}

		return line;
	});

	return result.join("\n");
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
