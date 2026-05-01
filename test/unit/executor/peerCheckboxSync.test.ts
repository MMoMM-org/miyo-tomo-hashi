/**
 * T4.2 — PeerCheckboxSync tests (RED phase)
 *
 * Covers:
 *   - Peer present + heading `### I03 — …` + unticked checkbox → ticks the checkbox; outcome "ticked"
 *   - Peer present + heading missing for I03 → outcome "heading-missing" (no error, no write)
 *   - Peer absent → outcome "peer-missing" (no error, no write)
 *   - Peer present + checkbox already `- [x]` (pre-ticked) → outcome "already-ticked" (no write)
 *   - Soft-warn semantics: a tick failure NEVER throws
 *
 * Peer naming convention (aligned with planner.ts resolveSingle):
 *   `foo_instructions.json` → `foo_instructions.md` (strip `.json`, add `.md`)
 *
 * [ref: PRD/F5; SDD/PeerCheckboxSync design]
 */

import { describe, expect, it } from "vitest";

import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { tickPeerCheckbox } from "../../../src/executor/peerCheckboxSync.js";
import type { PeerSyncOutcome } from "../../../src/executor/peerCheckboxSync.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const JSON_PATH = "inbox/2026-04-28_instructions.json";
const MD_PATH = "inbox/2026-04-28_instructions.md";

function buildPeerContent(actionId: string, checkboxState: "ticked" | "unticked" | "none"): string {
	const checkbox =
		checkboxState === "ticked"
			? "- [x] Applied"
			: checkboxState === "unticked"
				? "- [ ] Applied"
				: "";

	return [
		"# Instruction Review",
		"",
		`### ${actionId} — Create MOC`,
		"",
		"Some description of the action.",
		"",
		...(checkbox ? [checkbox, ""] : []),
		"### Other section",
		"",
		"Unrelated content.",
	].join("\n");
}

// ---------------------------------------------------------------------------
// tickPeerCheckbox — outcome: "peer-missing"
// ---------------------------------------------------------------------------

describe("tickPeerCheckbox — peer-missing", () => {
	it("returns 'peer-missing' when the .md peer does not exist", async () => {
		const vault = new FakeVaultFS();
		// Only the JSON exists, no .md peer
		await vault.create(JSON_PATH, '{"actions":[]}');

		const outcome = await tickPeerCheckbox(vault, JSON_PATH, "I03");

		expect(outcome).toBe<PeerSyncOutcome>("peer-missing");
	});

	it("does not write anything when peer is missing", async () => {
		const vault = new FakeVaultFS();
		await vault.create(JSON_PATH, '{"actions":[]}');

		await tickPeerCheckbox(vault, JSON_PATH, "I03");

		expect(await vault.exists(MD_PATH)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// tickPeerCheckbox — outcome: "heading-missing"
// ---------------------------------------------------------------------------

describe("tickPeerCheckbox — heading-missing", () => {
	it("returns 'heading-missing' when peer exists but has no heading for the actionId", async () => {
		const vault = new FakeVaultFS();
		const content = [
			"# Instruction Review",
			"",
			"### I01 — Some Other Action",
			"",
			"- [ ] Applied",
			"",
		].join("\n");
		await vault.create(MD_PATH, content);
		await vault.create(JSON_PATH, '{"actions":[]}');

		const outcome = await tickPeerCheckbox(vault, JSON_PATH, "I03");

		expect(outcome).toBe<PeerSyncOutcome>("heading-missing");
	});

	it("does not modify the peer when heading is missing", async () => {
		const vault = new FakeVaultFS();
		const content = "# No headings\n\nSome text.\n";
		await vault.create(MD_PATH, content);
		await vault.create(JSON_PATH, '{"actions":[]}');

		await tickPeerCheckbox(vault, JSON_PATH, "I03");

		expect(await vault.read(MD_PATH)).toBe(content);
	});

	it("returns 'heading-missing' when the heading section has no Applied checkbox at all", async () => {
		const vault = new FakeVaultFS();
		const content = [
			"### I03 — Create MOC",
			"",
			"Description only, no checkbox.",
			"",
		].join("\n");
		await vault.create(MD_PATH, content);
		await vault.create(JSON_PATH, '{"actions":[]}');

		const outcome = await tickPeerCheckbox(vault, JSON_PATH, "I03");

		expect(outcome).toBe<PeerSyncOutcome>("heading-missing");
	});
});

// ---------------------------------------------------------------------------
// tickPeerCheckbox — outcome: "ticked"
// ---------------------------------------------------------------------------

describe("tickPeerCheckbox — ticked", () => {
	it("returns 'ticked' and flips '- [ ] Applied' to '- [x] Applied' under the correct heading", async () => {
		const vault = new FakeVaultFS();
		await vault.create(MD_PATH, buildPeerContent("I03", "unticked"));
		await vault.create(JSON_PATH, '{"actions":[]}');

		const outcome = await tickPeerCheckbox(vault, JSON_PATH, "I03");

		expect(outcome).toBe<PeerSyncOutcome>("ticked");
		const updated = await vault.read(MD_PATH);
		expect(updated).toContain("- [x] Applied");
	});

	it("only ticks the checkbox under the matching heading, not under other headings", async () => {
		const vault = new FakeVaultFS();
		const content = [
			"### I01 — First Action",
			"",
			"- [ ] Applied",
			"",
			"### I03 — Third Action",
			"",
			"- [ ] Applied",
			"",
		].join("\n");
		await vault.create(MD_PATH, content);
		await vault.create(JSON_PATH, '{"actions":[]}');

		await tickPeerCheckbox(vault, JSON_PATH, "I03");

		const updated = await vault.read(MD_PATH);
		// I01 checkbox must remain unticked
		const i01Section = updated.split("### I03")[0];
		expect(i01Section).toContain("- [ ] Applied");
		// I03 checkbox must be ticked
		const i03Section = updated.split("### I03")[1];
		expect(i03Section).toContain("- [x] Applied");
	});

	it("handles em-dash heading format '### I03 — …'", async () => {
		const vault = new FakeVaultFS();
		const content = "### I03 — Create MOC\n\n- [ ] Applied\n";
		await vault.create(MD_PATH, content);
		await vault.create(JSON_PATH, '{"actions":[]}');

		const outcome = await tickPeerCheckbox(vault, JSON_PATH, "I03");

		expect(outcome).toBe<PeerSyncOutcome>("ticked");
	});

	it("ticks the checkbox when heading has plain continuation (no em-dash)", async () => {
		const vault = new FakeVaultFS();
		const content = "### I03\n\n- [ ] Applied\n";
		await vault.create(MD_PATH, content);
		await vault.create(JSON_PATH, '{"actions":[]}');

		const outcome = await tickPeerCheckbox(vault, JSON_PATH, "I03");

		expect(outcome).toBe<PeerSyncOutcome>("ticked");
	});
});

// ---------------------------------------------------------------------------
// tickPeerCheckbox — outcome: "already-ticked"
// ---------------------------------------------------------------------------

describe("tickPeerCheckbox — already-ticked", () => {
	it("returns 'already-ticked' when the checkbox is already '- [x] Applied'", async () => {
		const vault = new FakeVaultFS();
		await vault.create(MD_PATH, buildPeerContent("I03", "ticked"));
		await vault.create(JSON_PATH, '{"actions":[]}');

		const outcome = await tickPeerCheckbox(vault, JSON_PATH, "I03");

		expect(outcome).toBe<PeerSyncOutcome>("already-ticked");
	});

	it("does not write to the peer file when checkbox is already ticked", async () => {
		const vault = new FakeVaultFS();
		const originalContent = buildPeerContent("I03", "ticked");
		await vault.create(MD_PATH, originalContent);
		await vault.create(JSON_PATH, '{"actions":[]}');

		await tickPeerCheckbox(vault, JSON_PATH, "I03");

		expect(await vault.read(MD_PATH)).toBe(originalContent);
	});
});

// ---------------------------------------------------------------------------
// tickPeerCheckbox — soft-warn semantics
// ---------------------------------------------------------------------------

describe("tickPeerCheckbox — soft-warn semantics", () => {
	it("never throws even when the peer content is malformed", async () => {
		const vault = new FakeVaultFS();
		// Malformed but present peer
		await vault.create(MD_PATH, "");
		await vault.create(JSON_PATH, '{"actions":[]}');

		await expect(tickPeerCheckbox(vault, JSON_PATH, "I03")).resolves.not.toThrow();
	});

	it("returns a valid PeerSyncOutcome for an empty peer file", async () => {
		const vault = new FakeVaultFS();
		await vault.create(MD_PATH, "");
		await vault.create(JSON_PATH, '{"actions":[]}');

		const outcome = await tickPeerCheckbox(vault, JSON_PATH, "I03");

		const validOutcomes: PeerSyncOutcome[] = ["ticked", "already-ticked", "heading-missing", "peer-missing"];
		expect(validOutcomes).toContain(outcome);
	});
});

// ---------------------------------------------------------------------------
// tickPeerCheckbox — peer path derivation
// ---------------------------------------------------------------------------

describe("tickPeerCheckbox — peer path derivation", () => {
	it("derives the .md peer from a _instructions.json path in a subfolder", async () => {
		const vault = new FakeVaultFS();
		const jsonPath = "deep/nested/2026-04-28_instructions.json";
		const mdPath = "deep/nested/2026-04-28_instructions.md";
		await vault.create(mdPath, buildPeerContent("I01", "unticked"));
		await vault.create(jsonPath, '{"actions":[]}');

		const outcome = await tickPeerCheckbox(vault, jsonPath, "I01");

		expect(outcome).toBe<PeerSyncOutcome>("ticked");
	});
});
