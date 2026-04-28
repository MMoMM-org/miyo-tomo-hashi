import { describe, expect, it } from "vitest";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { linkToMoc } from "../../../src/actions/linkToMoc.js";
import type { LinkToMocAction } from "../../../src/schema/types.js";
import type { FileMetadata } from "../../../src/vault/VaultFS.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeAction = (overrides?: Partial<LinkToMocAction>): LinkToMocAction => ({
	action: "link_to_moc",
	id: "test-id-003",
	target_moc: "MOCs/projects.md",
	line_to_add: "- [[Notes/Projects/raw-note|Raw Note]]",
	...overrides,
});

const makeCtx = (vault: FakeVaultFS) => ({
	vault,
	clock: { now: () => new Date("2026-04-28T10:00:00Z") },
});

/**
 * Build a FileMetadata with one heading section "Projects" covering lines 2–6.
 */
const makeHeadingMetadata = (): FileMetadata => ({
	headings: [{ heading: "Projects", level: 2, line: 1 }],
	sections: [{ type: "heading", line: 1, endLine: 6 }],
});

/**
 * Build a FileMetadata with one callout titled "Projects" covering lines 1–5.
 * Line 1 is the callout opener; lines 2–5 are body lines.
 */
const makeCalloutMetadata = (): FileMetadata => ({
	headings: [],
	sections: [{ type: "callout", line: 1, endLine: 5 }],
});

/**
 * Build a FileMetadata with two callouts.
 * First callout "Other" lines 1–4; second callout "Projects" lines 6–10.
 */
const makeTwoCalloutMetadata = (): FileMetadata => ({
	headings: [],
	sections: [
		{ type: "callout", line: 1, endLine: 4 },
		{ type: "callout", line: 6, endLine: 10 },
	],
});

/**
 * Build a FileMetadata with one callout titled "Other" (no match for "Projects").
 */
const makeFallbackCalloutMetadata = (): FileMetadata => ({
	headings: [],
	sections: [{ type: "callout", line: 1, endLine: 5 }],
});

/**
 * Build a FileMetadata with no headings and no callouts (empty doc).
 */
const makeEmptyMetadata = (): FileMetadata => ({
	headings: [],
	sections: [],
});

const MOC_PATH = "MOCs/projects.md";

// ---------------------------------------------------------------------------
// Fixtures for heading-section content
// ---------------------------------------------------------------------------
const headingMocContent = [
	"# Main MOC",
	"## Projects",
	"- [[existing]]",
	"",
	"Some text",
	"",
	"more text",
	"## Other",
].join("\n");

// ---------------------------------------------------------------------------
// Fixtures for callout content
// The callout opener is line index 1 (second line); body follows.
// ---------------------------------------------------------------------------
const calloutMocContent = [
	"# Main MOC",
	"> [!note] Projects",
	"> - [[existing]]",
	">",
	"> More text",
	"> Last body line",
	"",
	"After callout",
].join("\n");

// ---------------------------------------------------------------------------
// Fixture: callout titled "Other" — used for no-matching-section fallback
// ---------------------------------------------------------------------------
const fallbackCalloutContent = [
	"# Main MOC",
	"> [!note] Other",
	"> - [[existing]]",
	">",
	"> More text",
	"> Last body line",
	"",
].join("\n");

// ---------------------------------------------------------------------------
// link_to_moc — scenarios
// ---------------------------------------------------------------------------

describe("linkToMoc handler", () => {
	// -------------------------------------------------------------------------
	// MOC missing → failed "MOC target missing"
	// -------------------------------------------------------------------------
	it("MOC missing → failed with exact reason string", async () => {
		const vault = new FakeVaultFS();
		// MOC does NOT exist
		const action = makeAction();
		const ctx = makeCtx(vault);

		const outcome = await linkToMoc(action, ctx);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe("MOC target missing");
		}
		// No mutation — vault stays empty
		expect(await vault.exists(MOC_PATH)).toBe(false);
	});

	// -------------------------------------------------------------------------
	// target_moc_path takes priority over target_moc for path resolution
	// -------------------------------------------------------------------------
	it("target_moc_path present → uses it for MOC lookup", async () => {
		const vault = new FakeVaultFS();
		const canonicalPath = "MOCs/canonical.md";
		const metaMap = new Map<string, FileMetadata | null>([
			[canonicalPath, makeHeadingMetadata()],
		]);
		const vaultWithMeta = new FakeVaultFS(metaMap);
		await vaultWithMeta.create(canonicalPath, headingMocContent);

		const action = makeAction({
			target_moc: "some/legacy.md",
			target_moc_path: canonicalPath,
			section_name: "Projects",
		});
		const ctx = makeCtx(vaultWithMeta);

		const outcome = await linkToMoc(action, ctx);

		expect(outcome.kind).toBe("applied");
	});

	// -------------------------------------------------------------------------
	// Heading section match → bullet appended at end of heading section
	// -------------------------------------------------------------------------
	it("MOC exists, heading section match → bullet appended; outcome applied", async () => {
		const metaMap = new Map<string, FileMetadata | null>([
			[MOC_PATH, makeHeadingMetadata()],
		]);
		const vault = new FakeVaultFS(metaMap);
		await vault.create(MOC_PATH, headingMocContent);
		const action = makeAction({ section_name: "Projects" });
		const ctx = makeCtx(vault);

		const outcome = await linkToMoc(action, ctx);

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(MOC_PATH);
		expect(result).toContain("- [[Notes/Projects/raw-note|Raw Note]]");
		// The bullet must appear in the heading section (NOT with > prefix)
		expect(result).not.toContain("> - [[Notes/Projects/raw-note|Raw Note]]");
	});

	// -------------------------------------------------------------------------
	// Callout section match → bullet appended with "> " prefix inside callout
	// -------------------------------------------------------------------------
	it("MOC exists, callout section match → bullet appended with '> ' prefix; outcome applied", async () => {
		const metaMap = new Map<string, FileMetadata | null>([
			[MOC_PATH, makeCalloutMetadata()],
		]);
		const vault = new FakeVaultFS(metaMap);
		await vault.create(MOC_PATH, calloutMocContent);
		const action = makeAction({ section_name: "Projects" });
		const ctx = makeCtx(vault);

		const outcome = await linkToMoc(action, ctx);

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(MOC_PATH);
		// Must have > prefix to be inside callout
		expect(result).toContain("> - [[Notes/Projects/raw-note|Raw Note]]");
	});

	// -------------------------------------------------------------------------
	// No section_name → in-set fallback to first editable callout
	// -------------------------------------------------------------------------
	it("section_name absent → fallback to first callout → bullet appended with '> ' prefix", async () => {
		const metaMap = new Map<string, FileMetadata | null>([
			[MOC_PATH, makeCalloutMetadata()],
		]);
		const vault = new FakeVaultFS(metaMap);
		await vault.create(MOC_PATH, calloutMocContent);
		// No section_name
		const action = makeAction({ section_name: null });
		const ctx = makeCtx(vault);

		const outcome = await linkToMoc(action, ctx);

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(MOC_PATH);
		expect(result).toContain("> - [[Notes/Projects/raw-note|Raw Note]]");
	});

	// -------------------------------------------------------------------------
	// section_name provided but no match → fallback to first editable callout
	// -------------------------------------------------------------------------
	it("section_name provided but no match → fallback to first callout → applied", async () => {
		const metaMap = new Map<string, FileMetadata | null>([
			[MOC_PATH, makeFallbackCalloutMetadata()],
		]);
		const vault = new FakeVaultFS(metaMap);
		await vault.create(MOC_PATH, fallbackCalloutContent);
		// "Nonexistent" doesn't match any heading/callout, but there IS a callout "Other"
		const action = makeAction({ section_name: "Nonexistent" });
		const ctx = makeCtx(vault);

		const outcome = await linkToMoc(action, ctx);

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(MOC_PATH);
		expect(result).toContain("> - [[Notes/Projects/raw-note|Raw Note]]");
	});

	// -------------------------------------------------------------------------
	// No matching section AND no callout at all → failed
	// -------------------------------------------------------------------------
	it("no callout exists and no matching section → failed with deterministic reason", async () => {
		const metaMap = new Map<string, FileMetadata | null>([
			[MOC_PATH, makeEmptyMetadata()],
		]);
		const vault = new FakeVaultFS(metaMap);
		await vault.create(MOC_PATH, "# Empty MOC\n\nNo sections here.\n");
		const action = makeAction({ section_name: "Missing" });
		const ctx = makeCtx(vault);
		const originalContent = await vault.read(MOC_PATH);

		const outcome = await linkToMoc(action, ctx);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe("No section found for link_to_moc");
		}
		// No mutation
		expect(await vault.read(MOC_PATH)).toBe(originalContent);
	});

	// -------------------------------------------------------------------------
	// Idempotency — identical bullet already in heading section → skipped-already
	// -------------------------------------------------------------------------
	it("identical bullet already in heading section → skipped-already; content unchanged", async () => {
		const bullet = "- [[Notes/Projects/raw-note|Raw Note]]";
		// Heading section "Projects" already contains the bullet
		const contentWithBullet = [
			"# Main MOC",
			"## Projects",
			"- [[existing]]",
			bullet,
			"",
			"## Other",
		].join("\n");
		const metaMap = new Map<string, FileMetadata | null>([
			[MOC_PATH, makeHeadingMetadata()],
		]);
		const vault = new FakeVaultFS(metaMap);
		await vault.create(MOC_PATH, contentWithBullet);
		const action = makeAction({ section_name: "Projects" });
		const ctx = makeCtx(vault);

		const outcome = await linkToMoc(action, ctx);

		expect(outcome.kind).toBe("skipped-already");
		// Content must be unchanged
		expect(await vault.read(MOC_PATH)).toBe(contentWithBullet);
	});

	// -------------------------------------------------------------------------
	// Idempotency — identical bullet already in callout section → skipped-already
	// -------------------------------------------------------------------------
	it("identical bullet already in callout (with > prefix) → skipped-already; content unchanged", async () => {
		const bullet = "- [[Notes/Projects/raw-note|Raw Note]]";
		const contentWithBullet = [
			"# Main MOC",
			"> [!note] Projects",
			"> - [[existing]]",
			`> ${bullet}`,
			"> Last body line",
			"",
		].join("\n");
		const metaMap = new Map<string, FileMetadata | null>([
			[MOC_PATH, makeCalloutMetadata()],
		]);
		const vault = new FakeVaultFS(metaMap);
		await vault.create(MOC_PATH, contentWithBullet);
		const action = makeAction({ section_name: "Projects" });
		const ctx = makeCtx(vault);

		const outcome = await linkToMoc(action, ctx);

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(MOC_PATH)).toBe(contentWithBullet);
	});

	// -------------------------------------------------------------------------
	// Metadata null (non-markdown or cache miss) → treated as no sections → failed
	// -------------------------------------------------------------------------
	it("metadata returns null → failed (no section found)", async () => {
		const vault = new FakeVaultFS(); // no metadataMap entry → returns null
		await vault.create(MOC_PATH, "# MOC\n");
		const action = makeAction({ section_name: "Projects" });
		const ctx = makeCtx(vault);

		const outcome = await linkToMoc(action, ctx);

		expect(outcome.kind).toBe("failed");
	});
});
