/**
 * editNoteText handler tests.
 *
 * edit_note_text does a LITERAL find-and-replace inside a note's BODY (never
 * frontmatter). Covers happy paths + every failure/denial path (Constitution
 * L1 Testing — happy path + rejection):
 *   - inline repoint (occurrence all / first)
 *   - inline removal (replace "")
 *   - whole-line removal collapses the empty line (no blank accumulation)
 *   - frontmatter frozen: a match present in frontmatter is never touched
 *   - literal matching: regex/glob metacharacters treated as literal text
 *   - match not found → skipped-already (no mutation, no failure)
 *   - idempotency: re-run after a repoint → skipped-already
 *   - target missing → failed "target note missing"
 *
 * [ref: Tomo handoff 2026-07-21 garden-audit-edit-note-text; spec 030 ADR-3]
 */

import { describe, expect, it } from "vitest";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { editNoteText } from "../../../src/actions/editNoteText.js";
import type { EditNoteTextAction } from "../../../src/schema/types.js";

const PATH = "020 Active MOC.md";

const makeAction = (overrides?: Partial<EditNoteTextAction>): EditNoteTextAction => ({
	action: "edit_note_text",
	id: "I01",
	path: PATH,
	match: "[[023 Sparks MOC]]",
	replace: "[[023 Sparks (MOC)]]",
	occurrence: "all",
	...overrides,
});

const makeCtx = (vault: FakeVaultFS) => ({
	vault,
	clock: { now: () => new Date("2026-07-21T10:00:00Z") },
});

// ---------------------------------------------------------------------------
// happy path — inline repoint / removal
// ---------------------------------------------------------------------------

describe("editNoteText — repoint", () => {
	it("repoints every occurrence of a dead link (occurrence: all)", async () => {
		const vault = new FakeVaultFS();
		const doc = ["# MOC", "- [[023 Sparks MOC]]", "see [[023 Sparks MOC]] too"].join("\n");
		await vault.create(PATH, doc);

		const outcome = await editNoteText(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe(
			["# MOC", "- [[023 Sparks (MOC)]]", "see [[023 Sparks (MOC)]] too"].join("\n"),
		);
	});

	it("repoints only the first occurrence (occurrence: first)", async () => {
		const vault = new FakeVaultFS();
		const doc = ["- [[023 Sparks MOC]]", "- [[023 Sparks MOC]]"].join("\n");
		await vault.create(PATH, doc);

		const outcome = await editNoteText(makeAction({ occurrence: "first" }), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe(["- [[023 Sparks (MOC)]]", "- [[023 Sparks MOC]]"].join("\n"));
	});

	it("defaults to occurrence: first when omitted", async () => {
		const vault = new FakeVaultFS();
		const doc = ["x [[023 Sparks MOC]]", "y [[023 Sparks MOC]]"].join("\n");
		await vault.create(PATH, doc);

		const outcome = await editNoteText(
			makeAction({ occurrence: undefined }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe(["x [[023 Sparks (MOC)]]", "y [[023 Sparks MOC]]"].join("\n"));
	});

	it("removes an inline dead link, leaving surrounding text (replace: '')", async () => {
		const vault = new FakeVaultFS();
		const doc = ["see [[024 Thinking About MOC]] here"].join("\n");
		await vault.create(PATH, doc);

		const outcome = await editNoteText(
			makeAction({ match: "[[024 Thinking About MOC]]", replace: "", occurrence: "all" }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe("see  here");
	});
});

// ---------------------------------------------------------------------------
// whole-line removal — collapse the empty line
// ---------------------------------------------------------------------------

describe("editNoteText — whole-line removal", () => {
	it("removes a broken up:: line and collapses the empty line", async () => {
		const vault = new FakeVaultFS();
		const doc = ["# Note", "up:: [[021 Fleeting MOC]]", "body text"].join("\n");
		await vault.create("022 Placeholders MOC.md", doc);

		const outcome = await editNoteText(
			makeAction({
				path: "022 Placeholders MOC.md",
				match: "up:: [[021 Fleeting MOC]]",
				replace: "",
				occurrence: "first",
			}),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		// The whole line is dropped — no dangling blank line accumulates.
		expect(await vault.read("022 Placeholders MOC.md")).toBe(["# Note", "body text"].join("\n"));
	});
});

// ---------------------------------------------------------------------------
// frontmatter is frozen
// ---------------------------------------------------------------------------

describe("editNoteText — frontmatter safety", () => {
	it("never edits inside the YAML frontmatter block", async () => {
		const vault = new FakeVaultFS();
		const doc = [
			"---",
			"aliases: [[023 Sparks MOC]]",
			"---",
			"body [[023 Sparks MOC]]",
		].join("\n");
		await vault.create(PATH, doc);

		const outcome = await editNoteText(makeAction({ occurrence: "all" }), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		// Frontmatter occurrence untouched; only the body line is repointed.
		expect(await vault.read(PATH)).toBe(
			["---", "aliases: [[023 Sparks MOC]]", "---", "body [[023 Sparks (MOC)]]"].join("\n"),
		);
	});
});

// ---------------------------------------------------------------------------
// literal matching (no regex/glob interpretation)
// ---------------------------------------------------------------------------

describe("editNoteText — literal matching", () => {
	it("treats regex metacharacters in match as literal text", async () => {
		const vault = new FakeVaultFS();
		const doc = "a.(b)* and literal a.(b)*";
		await vault.create(PATH, doc);

		const outcome = await editNoteText(
			makeAction({ match: "a.(b)*", replace: "X", occurrence: "all" }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe("X and literal X");
	});
});

// ---------------------------------------------------------------------------
// no-op success + idempotency
// ---------------------------------------------------------------------------

describe("editNoteText — no-op success", () => {
	it("match not found → skipped-already (no mutation)", async () => {
		const vault = new FakeVaultFS();
		const doc = "already clean note";
		await vault.create(PATH, doc);

		const outcome = await editNoteText(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(PATH)).toBe(doc);
	});

	it("re-run after a repoint is idempotent → skipped-already", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, "- [[023 Sparks (MOC)]]");

		const outcome = await editNoteText(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(PATH)).toBe("- [[023 Sparks (MOC)]]");
	});

	it("empty match → skipped-already (degenerate, no mutation)", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, "content");

		const outcome = await editNoteText(makeAction({ match: "" }), makeCtx(vault));

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(PATH)).toBe("content");
	});
});

// ---------------------------------------------------------------------------
// failure / denial path
// ---------------------------------------------------------------------------

describe("editNoteText — failure paths", () => {
	it("target note missing → failed 'target note missing' (no mutation)", async () => {
		const vault = new FakeVaultFS();

		const outcome = await editNoteText(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") expect(outcome.reason).toBe("target note missing");
	});
});
