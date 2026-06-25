/**
 * insertUnderMarker handler tests.
 *
 * Covers the placement × marker-type matrix and every failure/denial path
 * (Constitution L1 Testing — happy path + rejection):
 *   - inside + heading → append at section end (above next same/higher heading)
 *   - inside + heading → append at EOF when the section runs to the end
 *   - inside + callout → `> `-prefixed append to the callout body
 *   - before/after × heading, callout, line → verbatim relative to the marker
 *   - multi-line `content` preserved
 *   - target missing / anchor-not-found / inside+line / null value → failed
 *   - identical block already present → skipped-already
 *
 * [ref: PRD/F4 insert_under_marker; Tomo handoff 2026-06-23]
 */

import { describe, expect, it } from "vitest";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { insertUnderMarker } from "../../../src/actions/insertUnderMarker.js";
import type { InsertUnderMarkerAction } from "../../../src/schema/types.js";

const PATH = "Efforts/Tomo Dev Log.md";

const makeAction = (overrides?: Partial<InsertUnderMarkerAction>): InsertUnderMarkerAction => ({
	action: "insert_under_marker",
	id: "I01",
	target_path: PATH,
	anchor: { type: "heading", value: "Captures" },
	placement: "inside",
	content: "### 2026-06-23\n\n- Shipped X",
	...overrides,
});

const makeCtx = (vault: FakeVaultFS) => ({
	vault,
	clock: { now: () => new Date("2026-06-23T10:00:00Z") },
});

// "## Captures" section (lines 1..3) followed by a same-level "## Other".
const headingDoc = [
	"# Dev Log", // 0
	"## Captures", // 1
	"- old entry", // 2
	"", // 3
	"## Other", // 4
	"- other", // 5
].join("\n");

// "## Captures" section runs to EOF (no following heading).
const headingDocEof = ["# Dev Log", "## Captures", "- old entry"].join("\n");

// Callout `[!note] Captures` at line 1, body lines 1..2, blank line 3 ends it.
const calloutDoc = [
	"# Dev Log", // 0
	"> [!note] Captures", // 1
	"> - old", // 2
	"", // 3
	"After", // 4
].join("\n");

// ---------------------------------------------------------------------------
// inside + heading → append at section end
// ---------------------------------------------------------------------------

describe("insertUnderMarker — inside + heading", () => {
	it("appends the block at the section end, above the next same-level heading", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, headingDoc);

		const outcome = await insertUnderMarker(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe(
			[
				"# Dev Log",
				"## Captures",
				"- old entry",
				"",
				"### 2026-06-23",
				"",
				"- Shipped X",
				"## Other",
				"- other",
			].join("\n"),
		);
	});

	it("appends at EOF when the section runs to the end of the file", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, headingDocEof);

		const outcome = await insertUnderMarker(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe(
			["# Dev Log", "## Captures", "- old entry", "### 2026-06-23", "", "- Shipped X"].join(
				"\n",
			),
		);
	});
});

// ---------------------------------------------------------------------------
// inside + callout → `> `-prefixed body append
// ---------------------------------------------------------------------------

describe("insertUnderMarker — inside + callout", () => {
	it("appends each content line with a `> ` prefix into the callout body", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, calloutDoc);

		const outcome = await insertUnderMarker(
			makeAction({
				anchor: { type: "callout", value: "[!note] Captures" },
				content: "new line",
			}),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe(
			["# Dev Log", "> [!note] Captures", "> - old", "> new line", "", "After"].join("\n"),
		);
	});
});

// ---------------------------------------------------------------------------
// before / after — verbatim, any marker type
// ---------------------------------------------------------------------------

describe("insertUnderMarker — before/after", () => {
	it("before + heading inserts immediately above the heading line", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, headingDoc);

		const outcome = await insertUnderMarker(
			makeAction({ placement: "before", content: "PRE" }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		const lines = (await vault.read(PATH)).split("\n");
		expect(lines[1]).toBe("PRE");
		expect(lines[2]).toBe("## Captures");
	});

	it("after + heading inserts immediately below the heading line", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, headingDoc);

		const outcome = await insertUnderMarker(
			makeAction({ placement: "after", content: "POST" }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		const lines = (await vault.read(PATH)).split("\n");
		expect(lines[1]).toBe("## Captures");
		expect(lines[2]).toBe("POST");
	});

	it("after + line marker inserts after the matched body line", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, headingDoc);

		const outcome = await insertUnderMarker(
			makeAction({
				anchor: { type: "line", value: "- old entry" },
				placement: "after",
				content: "AFTER LINE",
			}),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		const lines = (await vault.read(PATH)).split("\n");
		expect(lines[2]).toBe("- old entry");
		expect(lines[3]).toBe("AFTER LINE");
	});
});

// ---------------------------------------------------------------------------
// block anchor — newest-first table insert (header+separator + after)
// ---------------------------------------------------------------------------

describe("insertUnderMarker — block anchor", () => {
	// "## Captures" with a table; header (1) + separator (2) are the anchor block.
	const tableDoc = [
		"## Captures",                    // 0
		"| Date | Type | Description |",  // 1
		"| --- | --- | --- |",            // 2
		"| 2026-06-24 | feature | x |",   // 3
	].join("\n");

	const blockAnchor = {
		type: "block" as const,
		value: "| Date | Type | Description |\n| --- | --- | --- |",
	};

	it("after + block lands the new row as the FIRST data row (above existing rows)", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, tableDoc);

		const outcome = await insertUnderMarker(
			makeAction({
				anchor: blockAnchor,
				placement: "after",
				content: "| 2026-06-25 | fix | y |",
			}),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe(
			[
				"## Captures",
				"| Date | Type | Description |",
				"| --- | --- | --- |",
				"| 2026-06-25 | fix | y |",
				"| 2026-06-24 | feature | x |",
			].join("\n"),
		);
	});

	it("a second block insert stacks above the previous (anchor never moves → newest-first)", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, tableDoc);

		await insertUnderMarker(
			makeAction({ anchor: blockAnchor, placement: "after", content: "| 2026-06-25 | fix | y |" }),
			makeCtx(vault),
		);
		await insertUnderMarker(
			makeAction({ anchor: blockAnchor, placement: "after", content: "| 2026-06-26 | docs | z |" }),
			makeCtx(vault),
		);

		expect(await vault.read(PATH)).toBe(
			[
				"## Captures",
				"| Date | Type | Description |",
				"| --- | --- | --- |",
				"| 2026-06-26 | docs | z |", // newest on top
				"| 2026-06-25 | fix | y |",
				"| 2026-06-24 | feature | x |",
			].join("\n"),
		);
	});

	it("inside + block → failed gracefully, file untouched", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, tableDoc);

		const outcome = await insertUnderMarker(
			makeAction({ anchor: blockAnchor, placement: "inside", content: "| x | y | z |" }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe("placement: inside not supported for block anchor");
		}
		expect(await vault.read(PATH)).toBe(tableDoc);
	});

	it("non-matching block → failed 'anchor not found', file untouched", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, tableDoc);

		const outcome = await insertUnderMarker(
			makeAction({
				anchor: { type: "block", value: "| No | Such |\n| --- | --- |" },
				placement: "after",
				content: "| x | y |",
			}),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("failed");
		expect(await vault.read(PATH)).toBe(tableDoc);
	});
});

// ---------------------------------------------------------------------------
// failure / denial paths
// ---------------------------------------------------------------------------

describe("insertUnderMarker — failure paths", () => {
	it("target note missing → failed 'target note missing' (no mutation)", async () => {
		const vault = new FakeVaultFS();
		const outcome = await insertUnderMarker(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") expect(outcome.reason).toBe("target note missing");
	});

	it("null anchor value → failed 'anchor not found (null value)'", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, headingDoc);

		const outcome = await insertUnderMarker(
			makeAction({ anchor: { type: "heading", value: null } }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") expect(outcome.reason).toBe("anchor not found (null value)");
	});

	it("inside + line marker → failed gracefully, file untouched", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, headingDoc);

		const outcome = await insertUnderMarker(
			makeAction({ anchor: { type: "line", value: "- old entry" }, placement: "inside" }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe("placement: inside not supported for line anchor");
		}
		expect(await vault.read(PATH)).toBe(headingDoc);
	});

	it("anchor not resolvable → failed 'anchor not found: <value>', file untouched", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, headingDoc);

		const outcome = await insertUnderMarker(
			makeAction({ anchor: { type: "heading", value: "Nonexistent" } }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") expect(outcome.reason).toBe("anchor not found: Nonexistent");
		expect(await vault.read(PATH)).toBe(headingDoc);
	});
});

// ---------------------------------------------------------------------------
// idempotency
// ---------------------------------------------------------------------------

describe("insertUnderMarker — idempotency", () => {
	it("identical block already present → skipped-already (no duplicate)", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, headingDoc);

		const action = makeAction({ content: "- old entry" });
		const outcome = await insertUnderMarker(action, makeCtx(vault));

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(PATH)).toBe(headingDoc);
	});
});
