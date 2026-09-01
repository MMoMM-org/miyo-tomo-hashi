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
 *     absent-when-value-expected) → failed, nothing written
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
		expect(vault.readFrontMatter(PATH)).toEqual({ up: [NEW_LINK], related: [] });
	});

	it("replaces a scalar value", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, { status: "draft" });

		const outcome = await editFrontmatter(
			makeAction({ property: "status", value: "published", expected: "draft" }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		expect(vault.readFrontMatter(PATH)).toEqual({ status: "published" });
	});

	it("adds an absent property — expected null is how an add is expressed", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, { related: [] });

		const outcome = await editFrontmatter(
			makeAction({ expected: null }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		expect(vault.readFrontMatter(PATH)).toEqual({ related: [], up: [NEW_LINK] });
	});

	it("leaves the other properties alone", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, { up: [OLD_LINK], related: ["[[X]]"], created: "2025-11-19" });

		await editFrontmatter(makeAction(), makeCtx(vault));

		expect(vault.readFrontMatter(PATH)).toEqual({
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
		expect(vault.readFrontMatter(PATH)).toEqual({ related: [] });
	});

	it("already gone with expected null → skipped-already", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, { related: [] });

		const outcome = await editFrontmatter(
			makeAction({ operation: "remove", value: undefined, expected: null }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("skipped-already");
		expect(vault.readFrontMatter(PATH)).toEqual({ related: [] });
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
		expect(vault.readFrontMatter(PATH)).toEqual({ up: ["[[Someone Else Changed This]]"] });
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
			makeAction({ expected: null }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("failed");
		expect(vault.readFrontMatter(PATH)).toEqual({ up: [OLD_LINK] });
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

	it("distinguishes a null value from an absent property", async () => {
		// `expected: null` means ABSENT. A property holding a literal null is a
		// different thing, and must not satisfy it.
		const vault = new FakeVaultFS();
		await seed(vault, { up: null });

		const outcome = await editFrontmatter(makeAction({ expected: null }), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
	});

	it("distinguishes false from absent", async () => {
		const vault = new FakeVaultFS();
		await seed(vault, { pinned: false });

		const outcome = await editFrontmatter(
			makeAction({ property: "pinned", expected: false, value: true }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		expect(vault.readFrontMatter(PATH)).toEqual({ pinned: true });
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
