/**
 * editFrontmatter handler tests.
 *
 * The kind exists because a link in a YAML property was unrepairable and
 * reported success anyway (see editNoteText's frontmatter guard). Its own
 * guarantee is optimistic locking: a note that moved since the instruction set
 * was written must FAIL and be left untouched, never silently clobbered.
 *
 * Covered (Constitution L1 — happy path + rejection on every vault-mutating
 * path):
 *   - set: change a scalar, change a list, add an absent key (expected null)
 *   - remove an existing key
 *   - idempotent re-run → skipped-already
 *   - expectation mismatch (wrong value / present-when-absent-expected /
 *     absent-when-value-expected) → failed, and processFrontMatter is never
 *     even OPENED, because opening it re-serialises the block and loses the
 *     note's YAML comments whether or not anything is written
 *   - deep comparison: element order matters, key order does not
 *   - non-markdown target, missing note, malformed YAML → failed
 *
 * Note the fake holds frontmatter as a parsed map — YAML round-trip fidelity is
 * a test-vault question, not a unit-test one. See FakeVaultFS's header.
 */

import { describe, expect, it, vi } from "vitest";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { editFrontmatter } from "../../../src/actions/editFrontmatter.js";
import type { EditFrontmatterAction } from "../../../src/schema/types.js";

const PATH = "Atlas/202 Notes/Tschechien.md";
const OLD_LINK = "[[Efforts/Actual Projects/⛰ Elbsandstein & Tschechien 2026]]";
const NEW_LINK = "[[Elbsandstein & Tschechien 2026 (MOC)]]";

const makeAction = (overrides?: Partial<EditFrontmatterAction>): EditFrontmatterAction => ({
	action: "edit_frontmatter",
	id: "I24",
	path: PATH,
	property: "up",
	operation: "set",
	value: [NEW_LINK],
	expected: [OLD_LINK],
	...overrides,
});

const makeCtx = (vault: FakeVaultFS) => ({
	vault,
	clock: { now: () => new Date("2026-09-01T10:00:00Z") },
});

/** Seed a note plus its parsed frontmatter. */
const seed = async (vault: FakeVaultFS, fm: Record<string, unknown>, path = PATH) => {
	await vault.create(path, "# body");
	vault.seedFrontMatter(path, fm);
};

// ---------------------------------------------------------------------------
// set — edit and add
// ---------------------------------------------------------------------------

describe("editFrontmatter — set", () => {
	it("replaces a list value when the expectation holds", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, { up: [OLD_LINK], related: [] });

		const outcome = await editFrontmatter(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		expect(await vault.readFrontMatter(PATH)).toEqual({ up: [NEW_LINK], related: [] });
	});

	it("replaces a scalar value", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, { status: "draft" });

		const outcome = await editFrontmatter(
			makeAction({ property: "status", value: "published", expected: "draft" }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		expect(await vault.readFrontMatter(PATH)).toEqual({ status: "published" });
	});

	it("adds an absent property — expected null is how an add is expressed", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, { related: [] });

		const outcome = await editFrontmatter(
			makeAction({ expected: undefined, expected_absent: true }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		expect(await vault.readFrontMatter(PATH)).toEqual({ related: [], up: [NEW_LINK] });
	});

	it("leaves the other properties alone", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, { up: [OLD_LINK], related: ["[[X]]"], created: "2025-11-19" });

		await editFrontmatter(makeAction(), makeCtx(vault));

		expect(await vault.readFrontMatter(PATH)).toEqual({
			up: [NEW_LINK],
			related: ["[[X]]"],
			created: "2025-11-19",
		});
	});

	it("re-running after a successful set → skipped-already", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, { up: [NEW_LINK] });

		const outcome = await editFrontmatter(
			makeAction({ expected: [NEW_LINK] }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("skipped-already");
	});
});

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

describe("editFrontmatter — remove", () => {
	it("deletes the property when the expectation holds", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, { up: [OLD_LINK], related: [] });

		const outcome = await editFrontmatter(
			makeAction({ operation: "remove", value: undefined }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		expect(await vault.readFrontMatter(PATH)).toEqual({ related: [] });
	});

	it("already gone with expected null → skipped-already", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, { related: [] });

		const outcome = await editFrontmatter(
			makeAction({ operation: "remove", value: undefined, expected: undefined, expected_absent: true }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.readFrontMatter(PATH)).toEqual({ related: [] });
	});
});

// ---------------------------------------------------------------------------
// The guard — this is the reason the kind carries `expected` at all
// ---------------------------------------------------------------------------

describe("editFrontmatter — expectation mismatch", () => {
	it("fails and writes NOTHING when the current value differs", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, { up: ["[[Someone Else Changed This]]"] });

		const outcome = await editFrontmatter(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toContain("not what the instruction expected");
			expect(outcome.reason).toContain(PATH);
		}
		expect(await vault.readFrontMatter(PATH)).toEqual({ up: ["[[Someone Else Changed This]]"] });
	});

	it("fails when the property is absent but a value was expected", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, { related: [] });

		const outcome = await editFrontmatter(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") expect(outcome.reason).toContain("found absent");
	});

	it("fails when the property exists but absence was expected", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, { up: [OLD_LINK] });

		const outcome = await editFrontmatter(
			makeAction({ expected: undefined, expected_absent: true }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("failed");
		expect(await vault.readFrontMatter(PATH)).toEqual({ up: [OLD_LINK] });
	});

	it("never opens a write it already knows it will refuse", async () => {
		// The reason this matters is measured, not theoretical: Obsidian's
		// processFrontMatter re-serialises the whole block on entry, and its
		// serialiser drops YAML comments. Entering it only to then refuse would
		// cost the user their comments for nothing.
		const vault = new FakeVaultFS();
		await seed(vault, { up: ["[[Someone Else Changed This]]"] });
		const spy = vi.spyOn(vault, "processFrontMatter");

		const outcome = await editFrontmatter(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
		expect(spy).not.toHaveBeenCalled();
	});

	it("still refuses when the pre-check read is unavailable", async () => {
		// The pre-check is an optimisation, never the guard. With it blinded,
		// the authoritative in-callback comparison must still catch the
		// mismatch — this is the stale-cache path.
		const vault = new FakeVaultFS();
		await seed(vault, { up: ["[[Someone Else Changed This]]"] });
		vi.spyOn(vault, "readFrontMatter").mockRejectedValueOnce(new Error("cache miss"));
		const spy = vi.spyOn(vault, "processFrontMatter");

		const outcome = await editFrontmatter(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
		// It DID open the write this time — that is the cost of a stale read,
		// and the point of the pre-check is to make this the rare path.
		expect(spy).toHaveBeenCalled();
		expect(await vault.readFrontMatter(PATH)).toEqual({
			up: ["[[Someone Else Changed This]]"],
		});
	});

	it("a stale pre-check that says MATCH is overruled by the real comparison", async () => {
		// The dangerous direction: the cache must never be able to authorise a
		// write the note does not actually permit.
		const vault = new FakeVaultFS();
		await seed(vault, { up: ["[[Actually Something Else]]"] });
		vi.spyOn(vault, "readFrontMatter").mockResolvedValueOnce({ up: [OLD_LINK] });

		const outcome = await editFrontmatter(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
		expect(await vault.readFrontMatter(PATH)).toEqual({ up: ["[[Actually Something Else]]"] });
	});

	it("the failure message names shapes, never the values themselves", async () => {
		// The reason string reaches the run log. Constitution L2: audit traces
		// carry metadata, never note content.
		const vault = new FakeVaultFS();
		await seed(vault, { up: ["[[Secret Client Project]]"] });

		const outcome = await editFrontmatter(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).not.toContain("Secret Client Project");
			expect(outcome.reason).toContain("list of 1");
		}
	});
});

// ---------------------------------------------------------------------------
// deep comparison
// ---------------------------------------------------------------------------

describe("editFrontmatter — deep comparison", () => {
	it("list order is significant — a reordered list is a mismatch", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, { up: ["[[B]]", "[[A]]"] });

		const outcome = await editFrontmatter(
			makeAction({ expected: ["[[A]]", "[[B]]"] }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("failed");
	});

	it("map key order is not significant", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, { meta: { b: 2, a: 1 } });

		const outcome = await editFrontmatter(
			makeAction({ property: "meta", expected: { a: 1, b: 2 }, value: { a: 9 } }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
	});

	it("distinguishes a null value from an absent property — both directions", async () => {
		// The whole reason expected_absent exists (Tomo, 2026-09-01): the old
		// `expected: null` overload could not tell these apart.
		const holdsNull = new FakeVaultFS();
		await seed(holdsNull, { up: null });

		// Expecting ABSENT against a key that holds null → mismatch.
		expect(
			(
				await editFrontmatter(
					makeAction({ expected: undefined, expected_absent: true }),
					makeCtx(holdsNull),
				)
			).kind,
		).toBe("failed");

		// Expecting a literal null against that same key → match. This is the
		// case that was inexpressible before.
		const outcome = await editFrontmatter(makeAction({ expected: null }), makeCtx(holdsNull));
		expect(outcome.kind).toBe("applied");
		expect(await holdsNull.readFrontMatter(PATH)).toEqual({ up: [NEW_LINK] });

		// And expecting a literal null against an ABSENT key → mismatch.
		const absent = new FakeVaultFS();
		await seed(absent, { related: [] });
		expect((await editFrontmatter(makeAction({ expected: null }), makeCtx(absent))).kind).toBe(
			"failed",
		);
	});

	it("distinguishes false from absent", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, { pinned: false });

		const outcome = await editFrontmatter(
			makeAction({ property: "pinned", expected: false, value: true }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		expect(await vault.readFrontMatter(PATH)).toEqual({ pinned: true });
	});
});

// ---------------------------------------------------------------------------
// failure / denial paths
// ---------------------------------------------------------------------------

describe("editFrontmatter — failure paths", () => {
	it.each([".canvas", ".base", ".png"])("rejects a %s target before touching the vault", async (ext) => {
		const vault = new FakeVaultFS();
		const path = `Atlas/thing${ext}`;
		await seed(vault, {}, path);
		const spy = vi.spyOn(vault, "processFrontMatter");

		const outcome = await editFrontmatter(makeAction({ path }), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toBe(`edit_frontmatter only handles markdown notes, got: ${path}`);
		}
		expect(spy).not.toHaveBeenCalled();
	});

	it("target note missing → failed", async () => {
		const vault = new FakeVaultFS();

		const outcome = await editFrontmatter(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") expect(outcome.reason).toBe("target note missing");
	});

	it("a malformed YAML block fails the action, it does not abort the run", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, { up: [OLD_LINK] });
		vi.spyOn(vault, "processFrontMatter").mockRejectedValueOnce(
			new Error("YAMLParseError: bad indentation"),
		);

		const outcome = await editFrontmatter(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toContain("could not be parsed");
			expect(outcome.reason).toContain("bad indentation");
		}
	});
});
