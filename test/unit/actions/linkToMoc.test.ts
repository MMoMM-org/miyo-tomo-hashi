/**
 * linkToMoc handler — new contract (2026-05-01).
 *
 * Action shape: anchor: {type: "callout"|"heading"|"line", value} + placement:
 * "inside"|"after". `section_name` is gone. No fallback to "first editable
 * callout" — missing anchor is a hard fail.
 *
 * Insertion rules:
 *   - placement: "inside"  (callout only): line is written WITH `> ` prefix
 *     as the last content line of the callout body.
 *   - placement: "after":  line is written verbatim immediately after the
 *     anchor's terminal line. For callouts: after the closing `>` line. For
 *     headings: after the heading line itself (NOT after section content).
 *     For lines: after the matched body line.
 *
 * [ref: PRD/F4 link_to_moc; Tomo docs/instructions-json.md § Anchor Model]
 */

import { describe, expect, it } from "vitest";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { linkToMoc } from "../../../src/actions/linkToMoc.js";
import type { LinkToMocAction } from "../../../src/schema/types.js";
import type { FileMetadata } from "../../../src/vault/VaultFS.js";

const makeAction = (overrides?: Partial<LinkToMocAction>): LinkToMocAction => ({
	action: "link_to_moc",
	id: "test-id-003",
	target_moc: "MOCs/projects.md",
	line_to_add: "- [[Notes/Projects/raw-note|Raw Note]]",
	anchor: { type: "callout", value: "[!note] Projects" },
	placement: "inside",
	...overrides,
});

const makeCtx = (vault: FakeVaultFS) => ({
	vault,
	clock: { now: () => new Date("2026-04-28T10:00:00Z") },
});

const MOC_PATH = "MOCs/projects.md";

// Heading "Projects" at line 1, content lines 2..6
const headingMocContent = [
	"# Main MOC",                  // 0
	"## Projects",                 // 1
	"- [[existing]]",              // 2
	"",                            // 3
	"Some text",                   // 4
	"",                            // 5
	"more text",                   // 6
	"## Other",                    // 7
].join("\n");

const makeHeadingMetadata = (): FileMetadata => ({
	headings: [
		{ heading: "Main MOC", level: 1, line: 0 },
		{ heading: "Projects", level: 2, line: 1 },
		{ heading: "Other", level: 2, line: 7 },
	],
	sections: [
		{ type: "heading", line: 0, endLine: 0 },
		{ type: "heading", line: 1, endLine: 6 },
		{ type: "heading", line: 7, endLine: -1 },
	],
});

// Callout `[!note] Projects` at line 1, body lines 2..5, blank 6, line 7 outside
const calloutMocContent = [
	"# Main MOC",                  // 0
	"> [!note] Projects",          // 1
	"> - [[existing]]",            // 2
	">",                           // 3
	"> More text",                 // 4
	"> Last body line",            // 5
	"",                            // 6
	"After callout",               // 7
].join("\n");

const makeCalloutMetadata = (): FileMetadata => ({
	headings: [{ heading: "Main MOC", level: 1, line: 0 }],
	sections: [
		{ type: "heading", line: 0, endLine: 0 },
		{ type: "callout", line: 1, endLine: 5 },
	],
});

// ---------------------------------------------------------------------------

describe("linkToMoc — MOC missing", () => {
	it("MOC target file does not exist → failed 'MOC target missing'", async () => {
		const vault = new FakeVaultFS();
		const outcome = await linkToMoc(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe("MOC target missing");
		}
		expect(await vault.exists(MOC_PATH)).toBe(false);
	});
});

// ---------------------------------------------------------------------------

describe("linkToMoc — target_moc_path priority", () => {
	it("target_moc_path is used when present, regardless of target_moc", async () => {
		const canonicalPath = "MOCs/canonical.md";
		const metaMap = new Map<string, FileMetadata | null>([
			[canonicalPath, makeCalloutMetadata()],
		]);
		const vault = new FakeVaultFS(metaMap);
		await vault.create(canonicalPath, calloutMocContent);
		const action = makeAction({
			target_moc: "some/legacy.md",
			target_moc_path: canonicalPath,
		});

		const outcome = await linkToMoc(action, makeCtx(vault));

		expect(outcome.kind).toBe("applied");
	});
});

// ---------------------------------------------------------------------------
// callout anchor × inside placement → line goes inside body with `> ` prefix
// ---------------------------------------------------------------------------

describe("linkToMoc — callout anchor + inside placement", () => {
	it("appends `> <line_to_add>` as last line of callout body", async () => {
		const metaMap = new Map<string, FileMetadata | null>([
			[MOC_PATH, makeCalloutMetadata()],
		]);
		const vault = new FakeVaultFS(metaMap);
		await vault.create(MOC_PATH, calloutMocContent);
		const action = makeAction({
			anchor: { type: "callout", value: "[!note] Projects" },
			placement: "inside",
		});

		const outcome = await linkToMoc(action, makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(MOC_PATH);
		expect(result).toContain("> - [[Notes/Projects/raw-note|Raw Note]]");
		// Verify the new line is INSIDE the callout (before the blank line)
		const lines = result.split("\n");
		const newLineIdx = lines.indexOf("> - [[Notes/Projects/raw-note|Raw Note]]");
		const blankAfterCalloutIdx = lines.indexOf("After callout") - 1;
		expect(newLineIdx).toBeLessThan(blankAfterCalloutIdx);
	});

	it("idempotent: identical `> <line>` already in callout → skipped-already", async () => {
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
			[MOC_PATH, { headings: [], sections: [{ type: "callout", line: 1, endLine: 4 }] }],
		]);
		const vault = new FakeVaultFS(metaMap);
		await vault.create(MOC_PATH, contentWithBullet);

		const outcome = await linkToMoc(makeAction({
			anchor: { type: "callout", value: "[!note] Projects" },
			placement: "inside",
		}), makeCtx(vault));

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(MOC_PATH)).toBe(contentWithBullet);
	});
});

// ---------------------------------------------------------------------------
// callout anchor × after placement → line goes after callout closes, no prefix
// ---------------------------------------------------------------------------

describe("linkToMoc — callout anchor + after placement", () => {
	it("inserts <line_to_add> verbatim (no `> ` prefix) after the callout's last `>` line", async () => {
		const metaMap = new Map<string, FileMetadata | null>([
			[MOC_PATH, makeCalloutMetadata()],
		]);
		const vault = new FakeVaultFS(metaMap);
		await vault.create(MOC_PATH, calloutMocContent);

		const outcome = await linkToMoc(makeAction({
			anchor: { type: "callout", value: "[!note] Projects" },
			placement: "after",
		}), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(MOC_PATH);
		// New line lands after the closing `> Last body line` (line 5), before blank (line 6)
		const lines = result.split("\n");
		const lastBodyIdx = lines.indexOf("> Last body line");
		const newLineIdx = lines.indexOf("- [[Notes/Projects/raw-note|Raw Note]]");
		expect(newLineIdx).toBe(lastBodyIdx + 1);
		// Crucially, no `> ` prefix on the new line
		expect(result).not.toContain("> - [[Notes/Projects/raw-note|Raw Note]]");
	});
});

// ---------------------------------------------------------------------------
// heading anchor × after placement → line goes immediately below heading
// ---------------------------------------------------------------------------

describe("linkToMoc — heading anchor + after placement", () => {
	it("inserts <line_to_add> verbatim immediately after the heading line (NOT at end of section)", async () => {
		const metaMap = new Map<string, FileMetadata | null>([
			[MOC_PATH, makeHeadingMetadata()],
		]);
		const vault = new FakeVaultFS(metaMap);
		await vault.create(MOC_PATH, headingMocContent);

		const outcome = await linkToMoc(makeAction({
			anchor: { type: "heading", value: "Projects" },
			placement: "after",
		}), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(MOC_PATH);
		const lines = result.split("\n");
		const headingIdx = lines.indexOf("## Projects");
		const newLineIdx = lines.indexOf("- [[Notes/Projects/raw-note|Raw Note]]");
		expect(newLineIdx).toBe(headingIdx + 1);
		// No `> ` prefix
		expect(result).not.toContain("> - [[Notes/Projects/raw-note|Raw Note]]");
	});

	it("idempotent: identical line directly after heading → skipped-already", async () => {
		const bullet = "- [[Notes/Projects/raw-note|Raw Note]]";
		const content = [
			"# Main",
			"## Projects",
			bullet,
			"existing body",
			"",
		].join("\n");
		const metaMap = new Map<string, FileMetadata | null>([
			[MOC_PATH, {
				headings: [
					{ heading: "Main", level: 1, line: 0 },
					{ heading: "Projects", level: 2, line: 1 },
				],
				sections: [
					{ type: "heading", line: 0, endLine: 0 },
					{ type: "heading", line: 1, endLine: -1 },
				],
			}],
		]);
		const vault = new FakeVaultFS(metaMap);
		await vault.create(MOC_PATH, content);

		const outcome = await linkToMoc(makeAction({
			anchor: { type: "heading", value: "Projects" },
			placement: "after",
		}), makeCtx(vault));

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(MOC_PATH)).toBe(content);
	});
});

// ---------------------------------------------------------------------------
// line anchor × after placement → line goes after matched body line
// ---------------------------------------------------------------------------

describe("linkToMoc — line anchor + after placement", () => {
	it("inserts <line_to_add> after the line matching the anchor value", async () => {
		const content = [
			"# Main",                              // 0
			"random preamble",                     // 1
			"<!-- bookmark: sources -->",          // 2
			"already-here line",                   // 3
		].join("\n");
		const metaMap = new Map<string, FileMetadata | null>([
			[MOC_PATH, { headings: [{ heading: "Main", level: 1, line: 0 }], sections: [] }],
		]);
		const vault = new FakeVaultFS(metaMap);
		await vault.create(MOC_PATH, content);

		const outcome = await linkToMoc(makeAction({
			anchor: { type: "line", value: "<!-- bookmark: sources -->" },
			placement: "after",
		}), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(MOC_PATH);
		const lines = result.split("\n");
		const bookmarkIdx = lines.indexOf("<!-- bookmark: sources -->");
		const newLineIdx = lines.indexOf("- [[Notes/Projects/raw-note|Raw Note]]");
		expect(newLineIdx).toBe(bookmarkIdx + 1);
	});
});

// ---------------------------------------------------------------------------
// anchor not found / invalid → no fallback (per new contract)
// ---------------------------------------------------------------------------

describe("linkToMoc — anchor not found", () => {
	it("anchor not found → failed (no fallback to first callout)", async () => {
		const metaMap = new Map<string, FileMetadata | null>([
			[MOC_PATH, makeCalloutMetadata()],
		]);
		const vault = new FakeVaultFS(metaMap);
		await vault.create(MOC_PATH, calloutMocContent);
		const originalContent = await vault.read(MOC_PATH);

		const outcome = await linkToMoc(makeAction({
			anchor: { type: "callout", value: "[!nonexistent] Missing" },
			placement: "inside",
		}), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toMatch(/anchor not found/i);
		}
		expect(await vault.read(MOC_PATH)).toBe(originalContent);
	});

	it("anchor.value is null → failed (Tomo emission gap)", async () => {
		const metaMap = new Map<string, FileMetadata | null>([
			[MOC_PATH, makeCalloutMetadata()],
		]);
		const vault = new FakeVaultFS(metaMap);
		await vault.create(MOC_PATH, calloutMocContent);

		const outcome = await linkToMoc(makeAction({
			anchor: { type: "callout", value: null },
			placement: "inside",
		}), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
	});

	it("metadata null (cache miss) → failed", async () => {
		const vault = new FakeVaultFS();
		await vault.create(MOC_PATH, "# MOC\n");

		const outcome = await linkToMoc(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
	});
});

// ---------------------------------------------------------------------------
// inside placement on non-callout anchor → defensive fail
// ---------------------------------------------------------------------------

describe("linkToMoc — inside placement on non-callout anchor (schema-illegal)", () => {
	it("placement=inside + anchor.type=heading → failed (Tomo schema disallows; Hashi defensive)", async () => {
		const metaMap = new Map<string, FileMetadata | null>([
			[MOC_PATH, makeHeadingMetadata()],
		]);
		const vault = new FakeVaultFS(metaMap);
		await vault.create(MOC_PATH, headingMocContent);

		const outcome = await linkToMoc(makeAction({
			anchor: { type: "heading", value: "Projects" },
			placement: "inside",
		}), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toMatch(/placement.*inside.*callout/i);
		}
	});
});
