/**
 * addRelationship handler — replaces a Dataview marker line in a target MOC
 * with the verbatim `line` value.
 *
 * Locator: first line whose stripped content (after optional `> ` callout
 * prefix and whitespace) starts with `marker`. Hashi preserves the leading
 * `> ` prefix when present.
 *
 * Failure cases:
 *   - target MOC missing       → "Relationship target missing"
 *   - marker line not present  → "Marker not found: <marker>"
 *
 * [ref: PRD/F4 add_relationship; Tomo docs/instructions-json.md § add_relationship]
 */

import { describe, expect, it } from "vitest";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { addRelationship } from "../../../src/actions/addRelationship.js";
import type { AddRelationshipAction } from "../../../src/schema/types.js";

const makeAction = (overrides?: Partial<AddRelationshipAction>): AddRelationshipAction => ({
	action: "add_relationship",
	id: "test-rel-001",
	target_moc_path: "Atlas/200 Maps/Brettspiele (MOC).md",
	marker: "up::",
	line: "up:: [[Hobbies (MOC)]]",
	...overrides,
});

const makeCtx = (vault: FakeVaultFS) => ({
	vault,
	clock: { now: () => new Date("2026-05-01T08:00:00Z") },
});

const MOC_PATH = "Atlas/200 Maps/Brettspiele (MOC).md";

// ---------------------------------------------------------------------------

describe("addRelationship — target missing", () => {
	it("MOC file does not exist → failed 'Relationship target missing'", async () => {
		const vault = new FakeVaultFS();
		const outcome = await addRelationship(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe("Relationship target missing");
		}
	});
});

// ---------------------------------------------------------------------------

describe("addRelationship — marker line in callout", () => {
	it("replaces `> up::` line inside [!connect] callout, preserving the `> ` prefix", async () => {
		const content = [
			"---",
			"title: Brettspiele (MOC)",
			"---",
			"",
			"> [!connect] Your way around",
			"> up:: ",
			"> related:: ",
			"",
			"# [[Brettspiele (MOC)]]",
		].join("\n") + "\n";
		const vault = new FakeVaultFS();
		await vault.create(MOC_PATH, content);

		const outcome = await addRelationship(makeAction({
			marker: "up::",
			line: "up:: [[Hobbies (MOC)]]",
		}), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(MOC_PATH);
		const lines = result.split("\n");
		expect(lines).toContain("> up:: [[Hobbies (MOC)]]");
		// Old empty marker line should be gone
		expect(lines).not.toContain("> up:: ");
	});

	it("replaces `> related::` line and tolerates trailing whitespace in marker line", async () => {
		const content = [
			"> [!connect] Your way around",
			"> up:: [[Other]]",
			">    related::   ",
			"",
		].join("\n");
		const vault = new FakeVaultFS();
		await vault.create(MOC_PATH, content);

		const outcome = await addRelationship(makeAction({
			marker: "related::",
			line: "related:: [[Catan]], [[Wingspan]]",
		}), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(MOC_PATH);
		const lines = result.split("\n");
		expect(lines).toContain("> related:: [[Catan]], [[Wingspan]]");
	});
});

// ---------------------------------------------------------------------------

describe("addRelationship — marker line is a callout list item", () => {
	it("fills empty `> - up::` list item, preserving the `> - ` callout+bullet prefix", async () => {
		const content = [
			"> [!METADATA]-",
			"> - Created:: [[2023-05-10]]",
			"> - up::",
			"> - Topics::",
			"",
		].join("\n");
		const vault = new FakeVaultFS();
		await vault.create(MOC_PATH, content);

		const outcome = await addRelationship(makeAction({
			marker: "up::",
			line: "up:: [[Some MOC]]",
		}), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		const lines = (await vault.read(MOC_PATH)).split("\n");
		expect(lines).toContain("> - up:: [[Some MOC]]");
		// Surrounding list items untouched, formatting preserved
		expect(lines).toContain("> - Created:: [[2023-05-10]]");
		expect(lines).toContain("> - Topics::");
		// The bare-callout form must NOT appear (bullet must be preserved)
		expect(lines).not.toContain("> up:: [[Some MOC]]");
	});

	it("supports `*`, `+`, and ordered (`1.`) bullets inside a callout", async () => {
		const content = [
			"> [!METADATA]-",
			"> * up::",
			"> + related::",
			"> 1. down::",
			"",
		].join("\n");
		const vault = new FakeVaultFS();
		await vault.create(MOC_PATH, content);

		expect((await addRelationship(makeAction({ marker: "up::", line: "up:: [[A]]" }), makeCtx(vault))).kind).toBe("applied");
		expect((await addRelationship(makeAction({ marker: "related::", line: "related:: [[B]]" }), makeCtx(vault))).kind).toBe("applied");
		expect((await addRelationship(makeAction({ marker: "down::", line: "down:: [[C]]" }), makeCtx(vault))).kind).toBe("applied");

		const lines = (await vault.read(MOC_PATH)).split("\n");
		expect(lines).toContain("> * up:: [[A]]");
		expect(lines).toContain("> + related:: [[B]]");
		expect(lines).toContain("> 1. down:: [[C]]");
	});

	it("fills a bare (non-callout) `- up::` list item, preserving the `- ` bullet", async () => {
		const content = [
			"# Some MOC",
			"- up::",
			"",
		].join("\n");
		const vault = new FakeVaultFS();
		await vault.create(MOC_PATH, content);

		const outcome = await addRelationship(makeAction({
			marker: "up::",
			line: "up:: [[Hobbies (MOC)]]",
		}), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		const lines = (await vault.read(MOC_PATH)).split("\n");
		expect(lines).toContain("- up:: [[Hobbies (MOC)]]");
		// Bullet must be kept — the bare (bullet-less) form must NOT appear
		expect(lines).not.toContain("up:: [[Hobbies (MOC)]]");
	});

	it("already-filled `> - up:: [[X]]` list item → skipped-already; no mutation", async () => {
		const content = [
			"> [!METADATA]-",
			"> - up:: [[Hobbies (MOC)]]",
			"",
		].join("\n");
		const vault = new FakeVaultFS();
		await vault.create(MOC_PATH, content);

		const outcome = await addRelationship(makeAction({
			marker: "up::",
			line: "up:: [[Hobbies (MOC)]]",
		}), makeCtx(vault));

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(MOC_PATH)).toBe(content);
	});
});

// ---------------------------------------------------------------------------

describe("addRelationship — marker line outside callout", () => {
	it("replaces a plain `up::` line at top-of-file (no `> ` prefix)", async () => {
		const content = [
			"---",
			"title: Brettspiele (MOC)",
			"---",
			"",
			"up::",
			"related::",
			"",
			"# Brettspiele",
		].join("\n") + "\n";
		const vault = new FakeVaultFS();
		await vault.create(MOC_PATH, content);

		const outcome = await addRelationship(makeAction({
			marker: "up::",
			line: "up:: [[Hobbies (MOC)]]",
		}), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(MOC_PATH);
		const lines = result.split("\n");
		expect(lines).toContain("up:: [[Hobbies (MOC)]]");
		expect(lines).not.toContain("up::");
	});
});

// ---------------------------------------------------------------------------

describe("addRelationship — marker not found", () => {
	it("MOC has no line starting with the marker → failed 'Marker not found: <marker>'", async () => {
		const content = [
			"# Some MOC",
			"body without any relationship markers",
		].join("\n") + "\n";
		const vault = new FakeVaultFS();
		await vault.create(MOC_PATH, content);

		const outcome = await addRelationship(makeAction({
			marker: "up::",
		}), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe("Marker not found: up::");
		}
		expect(await vault.read(MOC_PATH)).toBe(content);
	});
});

// ---------------------------------------------------------------------------

describe("addRelationship — idempotency", () => {
	it("marker line already equals target `line` → skipped-already; no mutation", async () => {
		const content = [
			"> [!connect] Your way around",
			"> up:: [[Hobbies (MOC)]]",
			"> related:: ",
			"",
		].join("\n");
		const vault = new FakeVaultFS();
		await vault.create(MOC_PATH, content);

		const outcome = await addRelationship(makeAction({
			marker: "up::",
			line: "up:: [[Hobbies (MOC)]]",
		}), makeCtx(vault));

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(MOC_PATH)).toBe(content);
	});
});

// ---------------------------------------------------------------------------

describe("addRelationship — first match wins", () => {
	it("if multiple lines start with marker, only the first is replaced", async () => {
		const content = [
			"> [!connect] Your way around",
			"> up:: [[A]]",      // ← target (first match)
			"> related:: ",
			"",
			"up:: [[B]]",         // ← duplicate further down, untouched
		].join("\n");
		const vault = new FakeVaultFS();
		await vault.create(MOC_PATH, content);

		const outcome = await addRelationship(makeAction({
			marker: "up::",
			line: "up:: [[Replaced]]",
		}), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(MOC_PATH);
		const lines = result.split("\n");
		expect(lines[1]).toBe("> up:: [[Replaced]]");
		// Second occurrence untouched
		expect(lines).toContain("up:: [[B]]");
	});
});
