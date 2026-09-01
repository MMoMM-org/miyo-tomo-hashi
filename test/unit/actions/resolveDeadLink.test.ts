/**
 * resolveDeadLink handler tests.
 *
 * resolve_dead_link resolves a dead wikilink in a note BODY, alias-aware —
 * unlink (drop the [[ ]], keep display) or repoint (rewrite the target,
 * preserve display) — across all wikilink forms (bare/aliased/embed).
 * Covers happy paths + every failure/denial path (Constitution L1 Testing —
 * happy path + rejection):
 *   - bare unlink, aliased unlink (display kept), embed unlink
 *   - bare repoint, aliased repoint (display preserved)
 *   - multi-occurrence: every hit replaced
 *   - regex-special-char targets matched literally (parens, slash path)
 *   - whole-target matching: a longer link surviving a shorter target
 *   - no-match → skipped-already (no mutation)
 *   - target note missing → failed "target note missing"
 *   - idempotent re-run → skipped-already
 *
 * [ref: Tomo commit 4251618; src/actions/resolveDeadLink.ts]
 */

import { describe, expect, it } from "vitest";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { resolveDeadLink } from "../../../src/actions/resolveDeadLink.js";
import type { ResolveDeadLinkAction } from "../../../src/schema/types.js";

const PATH = "020 Active MOC.md";

const makeAction = (overrides?: Partial<ResolveDeadLinkAction>): ResolveDeadLinkAction => ({
	action: "resolve_dead_link",
	id: "I01",
	path: PATH,
	target: "023 Sparks MOC",
	replace: "",
	...overrides,
});

const makeCtx = (vault: FakeVaultFS) => ({
	vault,
	clock: { now: () => new Date("2026-07-25T10:00:00Z") },
});

// ---------------------------------------------------------------------------
// unlink — replace: ""
// ---------------------------------------------------------------------------

describe("resolveDeadLink — unlink", () => {
	it("bare unlink: [[t]] -> t", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, "See [[023 Sparks MOC]] for more.");

		const outcome = await resolveDeadLink(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe("See 023 Sparks MOC for more.");
	});

	it("aliased unlink keeps display text: [[t|Nice]] -> Nice", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, "See [[023 Sparks MOC|Nice]] for more.");

		const outcome = await resolveDeadLink(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe("See Nice for more.");
	});

	it("embed unlink: ![[t]] -> t", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, "![[023 Sparks MOC]]");

		const outcome = await resolveDeadLink(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe("023 Sparks MOC");
	});
});

// ---------------------------------------------------------------------------
// repoint — replace: "[[New]]"
// ---------------------------------------------------------------------------

describe("resolveDeadLink — repoint", () => {
	it("bare repoint: [[t]] -> [[New]]", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, "See [[023 Sparks MOC]] for more.");

		const outcome = await resolveDeadLink(
			makeAction({ replace: "[[023 Sparks (MOC)]]" }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe("See [[023 Sparks (MOC)]] for more.");
	});

	it("aliased repoint preserves display: [[t|Nice]] -> [[New|Nice]]", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, "See [[023 Sparks MOC|Nice]] for more.");

		const outcome = await resolveDeadLink(
			makeAction({ replace: "[[023 Sparks (MOC)]]" }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe("See [[023 Sparks (MOC)|Nice]] for more.");
	});
});

// ---------------------------------------------------------------------------
// multi-occurrence — every hit in the body is replaced
// ---------------------------------------------------------------------------

describe("resolveDeadLink — multi-occurrence", () => {
	it("replaces every occurrence, mixed bare/aliased", async () => {
		const vault = new FakeVaultFS();
		await vault.create(
			PATH,
			"[[023 Sparks MOC]] and again [[023 Sparks MOC|Nice]] and once more [[023 Sparks MOC]].",
		);

		const outcome = await resolveDeadLink(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe(
			"023 Sparks MOC and again Nice and once more 023 Sparks MOC.",
		);
	});
});

// ---------------------------------------------------------------------------
// regex-special-char targets — matched literally, not as regex metachars
// ---------------------------------------------------------------------------

describe("resolveDeadLink — regex-special-char targets", () => {
	it("matches a target containing parentheses literally", async () => {
		const vault = new FakeVaultFS();
		const action = makeAction({ target: "A (1)" });
		await vault.create(PATH, "[[A (1)]]");

		const outcome = await resolveDeadLink(action, makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe("A (1)");
	});

	it("matches a slash-path target literally", async () => {
		const vault = new FakeVaultFS();
		const target = "X/600 Ressourcen/691 Readwise/Articles/SM - Passages Saved From iOS";
		const action = makeAction({ target });
		await vault.create(PATH, `[[${target}]]`);

		const outcome = await resolveDeadLink(action, makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe(target);
	});
});

// ---------------------------------------------------------------------------
// whole-target matching — never a substring hit
// ---------------------------------------------------------------------------

describe("resolveDeadLink — whole-target matching", () => {
	it("[[Old MOC]] survives when target is the substring 'MOC'", async () => {
		const vault = new FakeVaultFS();
		const doc = "[[Old MOC]] and [[MOC]]";
		await vault.create(PATH, doc);

		const outcome = await resolveDeadLink(makeAction({ target: "MOC" }), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe("[[Old MOC]] and MOC");
	});
});

// ---------------------------------------------------------------------------
// no-op success — skip-and-report, no partial write
// ---------------------------------------------------------------------------

describe("resolveDeadLink — no-op success (skip-and-report)", () => {
	it("target not present anywhere -> skipped-already (no mutation)", async () => {
		const vault = new FakeVaultFS();
		const doc = "No dead links here.";
		await vault.create(PATH, doc);

		const outcome = await resolveDeadLink(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(PATH)).toBe(doc);
	});

	it("idempotent re-run: already resolved -> skipped-already", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, "023 Sparks MOC");

		const outcome = await resolveDeadLink(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(PATH)).toBe("023 Sparks MOC");
	});
});

// ---------------------------------------------------------------------------
// failure / denial path
// ---------------------------------------------------------------------------

describe("resolveDeadLink — failure paths", () => {
	it("target note missing -> failed 'target note missing' (no mutation)", async () => {
		const vault = new FakeVaultFS();

		const outcome = await resolveDeadLink(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") expect(outcome.reason).toBe("target note missing");
	});

	// -------------------------------------------------------------------------
	// The frontmatter blind spot.
	//
	// Identical construction to the one fixed in editNoteText (PR #122) — this
	// handler's own docblock cites that file for both the frontmatter freeze and
	// the skipped-already convention, and inherited the bug with them. Reported
	// by Tomo 2026-09-01, who pointed out the inversion that matters: they never
	// emit edit_note_text (their parser rewrites it), but they DO emit
	// resolve_dead_link — so the bug was live here while already dead code there.
	// -------------------------------------------------------------------------

	it("dead link only in frontmatter -> failed, NOT skipped-already", async () => {
		const vault = new FakeVaultFS();
		const doc = [
			"---",
			"up:",
			'  - "[[023 Sparks MOC]]"',
			"related: []",
			"---",
			"",
			"# Body with no link at all",
			"",
		].join("\n");
		await vault.create(PATH, doc);

		const outcome = await resolveDeadLink(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toContain("YAML frontmatter");
			expect(outcome.reason).toContain(PATH);
		}
		expect(await vault.read(PATH)).toBe(doc);
	});

	it("fires for an aliased frontmatter link too", async () => {
		const vault = new FakeVaultFS();
		await vault.create(
			PATH,
			["---", 'up: "[[023 Sparks MOC|Sparks]]"', "---", "", "body"].join("\n"),
		);

		expect((await resolveDeadLink(makeAction(), makeCtx(vault))).kind).toBe("failed");
	});

	it("does NOT fire on the bare stem appearing as ordinary property text", async () => {
		// The head is probed with the link regex, not a substring: `target` is a
		// stem, and a looser check would fail an action over an unrelated
		// property that merely mentions the words.
		const vault = new FakeVaultFS();
		await vault.create(
			PATH,
			["---", "summary: about 023 Sparks MOC in passing", "---", "", "body"].join("\n"),
		);

		expect((await resolveDeadLink(makeAction(), makeCtx(vault))).kind).toBe("skipped-already");
	});

	it("still returns skipped-already when the link is absent everywhere", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, ["---", "up: []", "---", "", "already resolved"].join("\n"));

		expect((await resolveDeadLink(makeAction(), makeCtx(vault))).kind).toBe("skipped-already");
	});

	it("a body hit still wins when the frontmatter also carries the link", async () => {
		const vault = new FakeVaultFS();
		await vault.create(
			PATH,
			["---", 'up: "[[023 Sparks MOC]]"', "---", "", "body [[023 Sparks MOC]]"].join("\n"),
		);

		const outcome = await resolveDeadLink(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		// Frontmatter occurrence untouched — the freeze still holds.
		expect(await vault.read(PATH)).toContain('up: "[[023 Sparks MOC]]"');
	});
});
