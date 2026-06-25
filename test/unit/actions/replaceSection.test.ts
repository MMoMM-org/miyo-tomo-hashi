/**
 * replaceSection handler tests.
 *
 * replace_section OVERWRITES a heading section's body (heading line preserved,
 * next-section boundary respected) — the deliberate "replace, not append"
 * action. Covers the happy path + every failure/denial path (Constitution L1
 * Testing — happy path + rejection):
 *   - heading body replaced in place; content after the next heading untouched
 *   - section running to EOF replaced
 *   - multi-line content
 *   - target missing / null value / non-heading anchor / anchor-not-found → failed
 *   - identical body already present → skipped-already
 *
 * [ref: Tomo handoff 2026-06-25 block-anchor-and-replace-section]
 */

import { describe, expect, it } from "vitest";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { replaceSection } from "../../../src/actions/replaceSection.js";
import type { ReplaceSectionAction } from "../../../src/schema/types.js";

const PATH = "Efforts/Some Note.md";

const makeAction = (overrides?: Partial<ReplaceSectionAction>): ReplaceSectionAction => ({
	action: "replace_section",
	id: "I01",
	target_path: PATH,
	anchor: { type: "heading", value: "Status" },
	content: "new body",
	...overrides,
});

const makeCtx = (vault: FakeVaultFS) => ({
	vault,
	clock: { now: () => new Date("2026-06-25T10:00:00Z") },
});

// "## Status" section (lines 2..3) bounded by a same-level "## Other".
const doc = [
	"# Note", // 0
	"## Status", // 1
	"old line 1", // 2
	"old line 2", // 3
	"## Other", // 4
	"keep me", // 5
].join("\n");

// "## Status" runs to EOF (no following heading).
const docEof = ["# Note", "## Status", "old"].join("\n");

// ---------------------------------------------------------------------------
// happy path — overwrite in place
// ---------------------------------------------------------------------------

describe("replaceSection — overwrite", () => {
	it("replaces the heading body in place; heading preserved; next section untouched", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, doc);

		const outcome = await replaceSection(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe(
			["# Note", "## Status", "new body", "## Other", "keep me"].join("\n"),
		);
	});

	it("replaces a section that runs to EOF", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, docEof);

		const outcome = await replaceSection(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe(["# Note", "## Status", "new body"].join("\n"));
	});

	it("writes multi-line content verbatim (blank lines preserved)", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, doc);

		const outcome = await replaceSection(
			makeAction({ content: "line A\n\nline B" }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe(
			["# Note", "## Status", "line A", "", "line B", "## Other", "keep me"].join("\n"),
		);
	});
});

// ---------------------------------------------------------------------------
// failure / denial paths
// ---------------------------------------------------------------------------

describe("replaceSection — failure paths", () => {
	it("target note missing → failed 'target note missing' (no mutation)", async () => {
		const vault = new FakeVaultFS();
		const outcome = await replaceSection(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") expect(outcome.reason).toBe("target note missing");
	});

	it("null anchor value → failed (no mutation)", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, doc);

		const outcome = await replaceSection(
			makeAction({ anchor: { type: "heading", value: null } }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("failed");
		expect(await vault.read(PATH)).toBe(doc);
	});

	it("non-heading anchor (heading-scoped v1) → failed gracefully, file untouched", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, doc);

		const outcome = await replaceSection(
			makeAction({ anchor: { type: "callout", value: "[!note] Status" } }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe("replace_section v1 supports heading anchors only");
		}
		expect(await vault.read(PATH)).toBe(doc);
	});

	it("anchor not found → failed 'anchor not found: <value>', file untouched", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, doc);

		const outcome = await replaceSection(
			makeAction({ anchor: { type: "heading", value: "Nonexistent" } }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") expect(outcome.reason).toBe("anchor not found: Nonexistent");
		expect(await vault.read(PATH)).toBe(doc);
	});
});

// ---------------------------------------------------------------------------
// idempotency
// ---------------------------------------------------------------------------

describe("replaceSection — idempotency", () => {
	it("body already equals content → skipped-already (no rewrite)", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, doc);

		const action = makeAction({ content: "old line 1\nold line 2" });
		const outcome = await replaceSection(action, makeCtx(vault));

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(PATH)).toBe(doc);
	});
});
