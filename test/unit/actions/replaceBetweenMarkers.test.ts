/**
 * replaceBetweenMarkers handler tests (#179, Tomo handoff 2026-11-14).
 *
 * replace_between_markers swaps ONLY the lines strictly between a start-marker
 * line and its end-marker line. Tomo's `/review` puts one block per section of
 * the user's weekly/monthly/quarterly note between two invisible markers and
 * refreshes it on a re-run, so the user's own text in the same section must
 * survive byte for byte. Covers every outcome of the contract (Constitution L1:
 * happy path + each failure), the marker-line rules (fenced, indented, `> `,
 * trailing whitespace, CRLF), the optional scope, and the race the action was
 * specified around: markers are resolved inside `vault.process` on the CURRENT
 * content, never on an earlier read.
 */

import { describe, expect, it, vi } from "vitest";

import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { replaceBetweenMarkers } from "../../../src/actions/replaceBetweenMarkers.js";
import type { ReplaceBetweenMarkersAction } from "../../../src/schema/types.js";

const PATH = "Calendar/Weekly/2026-W13.md";
const START = "%% tomo:s1 2026-W13 %%";
const END = "%% /tomo:s1 2026-W13 %%";

const makeAction = (
	overrides?: Partial<ReplaceBetweenMarkersAction>,
): ReplaceBetweenMarkersAction => ({
	action: "replace_between_markers",
	id: "I01",
	target_path: PATH,
	start_marker: START,
	end_marker: END,
	content: "- new A\n- new B",
	...overrides,
});

const makeCtx = (vault: FakeVaultFS) => ({
	vault,
	clock: { now: () => new Date("2026-11-17T10:00:00Z") },
});

const WEEK = [
	"# 2026-W13", // 0
	"#### What Went Well This Week?", // 1
	"The user's own text stays here.", // 2
	START, // 3
	"- old 1", // 4
	"- old 2", // 5
	END, // 6
	"More user text after the block.", // 7
	"#### What Was Hard?", // 8
	"Untouched.", // 9
	"",
].join("\n");

async function run(content: string, action = makeAction()) {
	const vault = new FakeVaultFS();
	await vault.create(PATH, content);
	const outcome = await replaceBetweenMarkers(action, makeCtx(vault));
	return { outcome, after: await vault.read(PATH), vault };
}

// ---------------------------------------------------------------------------
// applied / skipped-already
// ---------------------------------------------------------------------------

describe("replaceBetweenMarkers — replace", () => {
	it("replaces only the lines between the markers; every other byte is kept", async () => {
		const { outcome, after } = await run(WEEK);

		expect(outcome).toEqual({ kind: "applied" });
		expect(after).toBe(WEEK.replace("- old 1\n- old 2", "- new A\n- new B"));
	});

	it("grows and shrinks the block", async () => {
		const grown = await run(WEEK, makeAction({ content: "a\nb\nc\nd" }));
		expect(grown.after).toBe(WEEK.replace("- old 1\n- old 2", "a\nb\nc\nd"));

		const shrunk = await run(WEEK, makeAction({ content: "only" }));
		expect(shrunk.after).toBe(WEEK.replace("- old 1\n- old 2", "only"));
	});

	it('empties the block for content "" and fills an empty block', async () => {
		const emptied = await run(WEEK, makeAction({ content: "" }));
		expect(emptied.outcome).toEqual({ kind: "applied" });
		expect(emptied.after).toBe(WEEK.replace("- old 1\n- old 2\n", ""));

		const filled = await run(emptied.after, makeAction({ content: "- first" }));
		expect(filled.outcome).toEqual({ kind: "applied" });
		expect(filled.after).toBe(WEEK.replace("- old 1\n- old 2", "- first"));
	});

	it("keeps a note without a trailing newline without one", async () => {
		const noEol = [START, "old", END].join("\n");
		const { after } = await run(noEol, makeAction({ content: "new" }));
		expect(after).toBe([START, "new", END].join("\n"));
	});

	it("is skipped-already, writing nothing, when the block already equals content", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, WEEK);
		const process = vi.spyOn(vault, "process");

		const outcome = await replaceBetweenMarkers(
			makeAction({ content: "- old 1\n- old 2" }),
			makeCtx(vault),
		);

		expect(outcome).toEqual({ kind: "skipped-already" });
		expect(await vault.read(PATH)).toBe(WEEK);
		// The transform ran but aborted, so the file was never rewritten.
		expect(process).toHaveBeenCalledTimes(1);
	});

	it("an empty block and content \"\" is skipped-already", async () => {
		const empty = [START, END, ""].join("\n");
		const { outcome, after } = await run(empty, makeAction({ content: "" }));
		expect(outcome).toEqual({ kind: "skipped-already" });
		expect(after).toBe(empty);
	});
});

// ---------------------------------------------------------------------------
// marker-line rules
// ---------------------------------------------------------------------------

describe("replaceBetweenMarkers — what counts as a marker line", () => {
	it("tolerates trailing whitespace on a marker line and keeps it", async () => {
		const padded = WEEK.replace(START, `${START}  `);
		const { outcome, after } = await run(padded);
		expect(outcome).toEqual({ kind: "applied" });
		expect(after).toBe(padded.replace("- old 1\n- old 2", "- new A\n- new B"));
	});

	it("ignores a marker inside a fenced code block", async () => {
		const fenced = ["```", START, "```", START, "old", END, ""].join("\n");
		const { outcome, after } = await run(fenced, makeAction({ content: "new" }));
		expect(outcome).toEqual({ kind: "applied" });
		expect(after).toBe(["```", START, "```", START, "new", END, ""].join("\n"));
	});

	it("does not count an indented or a quoted marker", async () => {
		const indented = ["  " + START, "old", END, ""].join("\n");
		expect((await run(indented)).outcome).toEqual({
			kind: "failed",
			reason: "start marker not found",
		});

		const quoted = ["> " + START, "old", END, ""].join("\n");
		expect((await run(quoted)).outcome).toEqual({
			kind: "failed",
			reason: "start marker not found",
		});
	});

	it("keeps CRLF line endings, giving the new lines the marker line's ending", async () => {
		const crlf = ["# W13", START, "old", END, "after", ""].join("\r\n");
		const { outcome, after } = await run(crlf, makeAction({ content: "a\nb" }));
		expect(outcome).toEqual({ kind: "applied" });
		expect(after).toBe(["# W13", START, "a", "b", END, "after", ""].join("\r\n"));
	});

	it("is skipped-already on a CRLF note whose block already equals content", async () => {
		const crlf = [START, "a", "b", END, ""].join("\r\n");
		const { outcome, after } = await run(crlf, makeAction({ content: "a\nb" }));
		expect(outcome).toEqual({ kind: "skipped-already" });
		expect(after).toBe(crlf);
	});
});

// ---------------------------------------------------------------------------
// failures — never a blind write
// ---------------------------------------------------------------------------

describe("replaceBetweenMarkers — failures leave the note untouched", () => {
	async function expectFailure(content: string, reason: string, action = makeAction()) {
		const { outcome, after } = await run(content, action);
		expect(outcome).toEqual({ kind: "failed", reason });
		expect(after).toBe(content);
	}

	it("target note missing", async () => {
		const vault = new FakeVaultFS();
		const outcome = await replaceBetweenMarkers(makeAction(), makeCtx(vault));
		expect(outcome).toEqual({ kind: "failed", reason: "target note missing" });
	});

	it("start marker not found", async () => {
		await expectFailure(["# W13", "text", END, ""].join("\n"), "start marker not found");
	});

	it("start marker duplicated anywhere in the note", async () => {
		await expectFailure([START, "a", END, "", START, "b", END, ""].join("\n"), "start marker duplicated");
	});

	it("end marker missing after the start", async () => {
		await expectFailure([END, START, "old", ""].join("\n"), "end marker missing");
	});

	it("end marker before the start", async () => {
		await expectFailure(
			[END, START, "old", END, ""].join("\n"),
			"end marker duplicated or out of order",
		);
	});

	it("a second end marker after the block", async () => {
		await expectFailure(
			[START, "old", END, "text", END, ""].join("\n"),
			"end marker duplicated or out of order",
		);
	});

	it("markers equal", async () => {
		await expectFailure(WEEK, "markers equal", makeAction({ end_marker: START }));
	});
});

// ---------------------------------------------------------------------------
// scope — can only turn an apply into a failure
// ---------------------------------------------------------------------------

describe("replaceBetweenMarkers — scope", () => {
	const scope = { heading: "What Went Well This Week?", level: 4 };

	it("applies when both markers sit inside the scoped section", async () => {
		const { outcome, after } = await run(WEEK, makeAction({ scope }));
		expect(outcome).toEqual({ kind: "applied" });
		expect(after).toBe(WEEK.replace("- old 1\n- old 2", "- new A\n- new B"));
	});

	it("fails when the scope heading is not found (level-aware, no fallback)", async () => {
		const { outcome, after } = await run(WEEK, makeAction({ scope: { ...scope, level: 3 } }));
		expect(outcome).toEqual({ kind: "failed", reason: "scope heading not found" });
		expect(after).toBe(WEEK);
	});

	it("fails when the markers sit outside the scoped section", async () => {
		const { outcome, after } = await run(
			WEEK,
			makeAction({ scope: { heading: "What Was Hard?", level: 4 } }),
		);
		expect(outcome).toEqual({ kind: "failed", reason: "markers outside scope" });
		expect(after).toBe(WEEK);
	});

	it("ends the scope at the next heading of the same or a higher level", async () => {
		// A deeper heading inside the section does not end it.
		const nested = WEEK.replace(START, `##### Sub\n${START}`);
		expect((await run(nested, makeAction({ scope }))).outcome).toEqual({ kind: "applied" });
	});
});

// ---------------------------------------------------------------------------
// the race the contract is built around
// ---------------------------------------------------------------------------

describe("replaceBetweenMarkers — resolves on the content process() hands over", () => {
	it("follows the markers when lines were added above them after an earlier read", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, WEEK);
		// Something (editor, sync, another plugin) writes between any earlier
		// read and the write: the content process() sees has two extra lines.
		const realProcess = vault.process.bind(vault);
		vi.spyOn(vault, "process").mockImplementation(async (path, transform) => {
			await realProcess(path, (current) => transform(`stamped\nby a plugin\n${current}`));
		});

		const outcome = await replaceBetweenMarkers(makeAction(), makeCtx(vault));

		expect(outcome).toEqual({ kind: "applied" });
		expect(await vault.read(PATH)).toBe(
			`stamped\nby a plugin\n${WEEK.replace("- old 1\n- old 2", "- new A\n- new B")}`,
		);
	});

	it("fails and writes nothing when the markers no longer resolve on the current content", async () => {
		const vault = new FakeVaultFS();
		await vault.create(PATH, WEEK);
		const realProcess = vault.process.bind(vault);
		vi.spyOn(vault, "process").mockImplementation(async (path, transform) => {
			await realProcess(path, (current) => transform(current.replace(START, "")));
		});

		const outcome = await replaceBetweenMarkers(makeAction(), makeCtx(vault));

		expect(outcome).toEqual({ kind: "failed", reason: "start marker not found" });
		expect(await vault.read(PATH)).toBe(WEEK);
	});
});
