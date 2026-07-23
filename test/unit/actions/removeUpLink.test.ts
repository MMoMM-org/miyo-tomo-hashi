/**
 * removeUpLink handler tests.
 *
 * remove_up_link removes ONE link from a note's `up::` line while
 * preserving the field itself. Covers happy paths + every failure/denial
 * path (Constitution L1 Testing — happy path + rejection):
 *   - multi-link removal: trailing / leading / middle, whitespace-tolerant
 *   - only-link removal → field kept, empty value (line NOT deleted)
 *   - callout + list-bullet structural prefix preserved
 *   - no up:: line → skipped-already (no mutation)
 *   - link not on the up:: line → skipped-already (no mutation)
 *   - idempotent re-run → skipped-already
 *   - target note missing → failed "target note missing"
 *
 * [ref: tomo-to-hashi handoff 2026-07-23 remove_up_link]
 */

import { describe, expect, it } from "vitest";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { removeUpLink } from "../../../src/actions/removeUpLink.js";
import type { RemoveUpLinkAction } from "../../../src/schema/types.js";

const PATH = "022 Placeholders MOC.md";

const makeAction = (overrides?: Partial<RemoveUpLinkAction>): RemoveUpLinkAction => ({
	action: "remove_up_link",
	id: "I01",
	path: PATH,
	link: "021 Fleeting MOC",
	...overrides,
});

const makeCtx = (vault: FakeVaultFS) => ({
	vault,
	clock: { now: () => new Date("2026-07-23T10:00:00Z") },
});

// ---------------------------------------------------------------------------
// multi-link removal — trailing / leading / middle, whitespace-tolerant
// ---------------------------------------------------------------------------

describe("removeUpLink — multi-link removal", () => {
	it("removes a trailing link, keeping the remaining one", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, "up:: [[021 Fleeting MOC]], [[999 Other MOC]]");

		const outcome = await removeUpLink(
			makeAction({ link: "999 Other MOC" }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe("up:: [[021 Fleeting MOC]]");
	});

	it("removes a leading link, keeping the remaining one", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, "up:: [[999 Other MOC]], [[021 Fleeting MOC]]");

		const outcome = await removeUpLink(
			makeAction({ link: "999 Other MOC" }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe("up:: [[021 Fleeting MOC]]");
	});

	it("removes a middle link, keeping both neighbors", async () => {
		const vault = new FakeVaultFS();
		await vault.create(
			PATH,
			"up:: [[021 Fleeting MOC]], [[999 Other MOC]], [[888 Third MOC]]",
		);

		const outcome = await removeUpLink(
			makeAction({ link: "999 Other MOC" }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe(
			"up:: [[021 Fleeting MOC]], [[888 Third MOC]]",
		);
	});

	it("is whitespace-tolerant around commas (no space after comma, extra spaces)", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, "up::   [[021 Fleeting MOC]],[[999 Other MOC]]");

		const outcome = await removeUpLink(
			makeAction({ link: "999 Other MOC" }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe("up:: [[021 Fleeting MOC]]");
	});
});

// ---------------------------------------------------------------------------
// only-link removal — field kept, empty value
// ---------------------------------------------------------------------------

describe("removeUpLink — only-link removal preserves the field", () => {
	it("empties the value but keeps the up:: field when it was the only link", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, "up:: [[021 Fleeting MOC]]");

		const outcome = await removeUpLink(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		const result = await vault.read(PATH);
		// The line still exists and still starts with up:: — never deleted.
		expect(result).toBe("up:: ");
		expect(result.startsWith("up::")).toBe(true);
	});

	it("preserves surrounding lines when emptying the only link", async () => {
		const vault = new FakeVaultFS();
		const doc = ["# Note", "up:: [[021 Fleeting MOC]]", "body text"].join("\n");
		await vault.create(PATH, doc);

		const outcome = await removeUpLink(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe(
			["# Note", "up:: ", "body text"].join("\n"),
		);
	});
});

// ---------------------------------------------------------------------------
// structural prefix preservation — callout + list bullet
// ---------------------------------------------------------------------------

describe("removeUpLink — structural prefix preservation", () => {
	it("preserves the `> ` callout prefix", async () => {
		const vault = new FakeVaultFS();
		const doc = [
			"> [!info] Structure",
			"> up:: [[021 Fleeting MOC]], [[999 Other MOC]]",
		].join("\n");
		await vault.create(PATH, doc);

		const outcome = await removeUpLink(
			makeAction({ link: "999 Other MOC" }),
			makeCtx(vault),
		);

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe(
			["> [!info] Structure", "> up:: [[021 Fleeting MOC]]"].join("\n"),
		);
	});

	it("preserves a `> - ` callout + list-bullet prefix, including on empty-out", async () => {
		const vault = new FakeVaultFS();
		const doc = ["> [!info] Structure", "> - up:: [[021 Fleeting MOC]]"].join("\n");
		await vault.create(PATH, doc);

		const outcome = await removeUpLink(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("applied");
		expect(await vault.read(PATH)).toBe(
			["> [!info] Structure", "> - up:: "].join("\n"),
		);
	});
});

// ---------------------------------------------------------------------------
// no-op success — skip-and-report, no partial write
// ---------------------------------------------------------------------------

describe("removeUpLink — no-op success (skip-and-report)", () => {
	it("no up:: line present → skipped-already (no mutation)", async () => {
		const vault = new FakeVaultFS();
		const doc = "# Note\nbody text, no up field here";
		await vault.create(PATH, doc);

		const outcome = await removeUpLink(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(PATH)).toBe(doc);
	});

	it("link not present on the up:: line → skipped-already (no mutation)", async () => {
		const vault = new FakeVaultFS();
		const doc = "up:: [[999 Other MOC]]";
		await vault.create(PATH, doc);

		const outcome = await removeUpLink(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(PATH)).toBe(doc);
	});

	it("idempotent re-run: link already absent (emptied by a prior run) → skipped-already", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, "up:: ");

		const outcome = await removeUpLink(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("skipped-already");
		expect(await vault.read(PATH)).toBe("up:: ");
	});
});

// ---------------------------------------------------------------------------
// failure / denial path
// ---------------------------------------------------------------------------

describe("removeUpLink — failure paths", () => {
	it("target note missing → failed 'target note missing' (no mutation)", async () => {
		const vault = new FakeVaultFS();

		const outcome = await removeUpLink(makeAction(), makeCtx(vault));

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") expect(outcome.reason).toBe("target note missing");
	});
});
