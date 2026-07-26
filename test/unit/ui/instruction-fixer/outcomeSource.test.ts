/**
 * outcomeSource.resolveOutcomes (spec-006 Phase 2, T2.1) — the trusted-outcome
 * resolver behind the fail-closed edit gate (SDD ADR-4).
 *
 * There is NO durable per-action outcome store: on disk `failed`,
 * `skipped-dependency`, `skipped-cancelled` and never-run all collapse to
 * `applied:false`. This resolver is the only thing that can tell them apart,
 * so its REJECT paths (no log / stale log / fuzzy-matching log) matter more
 * than its happy path — a false positive would unlock editing on actions that
 * never failed. Those cases are first-class tests below.
 *
 * The run-log parsing tests build their logs with the REAL `RunLogWriter`
 * wherever possible, so a format change in `src/executor/runLog.ts` breaks
 * these tests instead of silently un-mapping outcomes in production.
 */

import { describe, expect, it } from "vitest";

import { RunLogWriter } from "../../../../src/executor/runLog.js";
import type {
	ActionOutcome,
	ActionRecord,
	RunCounts,
	RunState,
} from "../../../../src/executor/state.js";
import type { InstructionSet } from "../../../../src/schema/types.js";
import { FakeVaultFS } from "../../../../src/vault/FakeVaultFS.js";
import type { VaultFS } from "../../../../src/vault/VaultFS.js";
import {
	editGate,
	NO_TRUSTED_SIGNAL,
	resolveOutcomes,
	type EditGateResult,
	type OutcomeSourceDeps,
} from "../../../../src/ui/instruction-fixer/outcomeSource.js";

const INBOX = "100 Inbox";
const SET_PATH = `${INBOX}/2026-07-20_1015_instructions.json`;
const OTHER_SET_PATH = `${INBOX}/2026-07-19_0900_instructions.json`;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function setWithIds(...ids: readonly string[]): InstructionSet {
	return {
		schema_version: "2",
		type: "tomo-instructions",
		generated: "2026-07-20T10:15:00",
		profile: null,
		actions: ids.map((id) => ({
			id,
			action: "skip" as const,
			source_path: null,
		})),
	};
}

function record(
	id: string,
	outcome: ActionOutcome | null,
	fileId = SET_PATH,
): ActionRecord {
	return { fileId, id, kind: "skip", summary: `summary for ${id}`, outcome };
}

const ZERO_COUNTS: RunCounts = {
	applied: 0,
	"skipped-already": 0,
	"skipped-dependency": 0,
	"skipped-cancelled": 0,
	failed: 0,
	pending: 0,
	durationMs: 0,
};

function summaryState(records: readonly ActionRecord[]): RunState {
	return {
		kind: "summary",
		mode: "confirm",
		records,
		counts: ZERO_COUNTS,
		logFilePath: null,
	};
}

function deps(
	vault: Pick<VaultFS, "list" | "read">,
	state: RunState = { kind: "idle" },
	logFolder = INBOX,
): OutcomeSourceDeps {
	return { vault, getRunState: () => state, logFolder };
}

/** Write a run log through the REAL writer, so the parse is format-faithful. */
async function writeRunLog(
	vault: VaultFS,
	opts: {
		startedAt: Date;
		sources: readonly string[];
		records: readonly ActionRecord[];
	},
): Promise<string> {
	const writer = new RunLogWriter(vault);
	const path = await writer.start({
		inboxFolder: INBOX,
		startedAt: opts.startedAt,
		mode: "confirm",
		sources: opts.sources,
	});
	for (const rec of opts.records) writer.appendRecord(rec);
	await writer.finalize(new Date(opts.startedAt.getTime() + 1000), "always");
	return path;
}

/**
 * A hand-written log for shapes `RunLogWriter` cannot emit (a corrupted or
 * externally rewritten file). Mirrors the writer's frontmatter + one-section
 * table so only the deviation under test differs.
 */
function handWrittenLog(rows: readonly string[], sourcePath = SET_PATH): string {
	return [
		"---",
		"log_format_version: 1",
		"started: 2026-07-20T10:30:00",
		"mode: confirm",
		"sources:",
		`  - ${sourcePath}`,
		"---",
		"# Hashi run log",
		"",
		`## ${sourcePath}`,
		"",
		"| I##  | kind | summary | outcome | error |",
		"|------|------|---------|---------|-------|",
		...rows,
		"",
	].join("\n");
}

/** The vault read side with one path faulted — an unreadable log candidate. */
function withUnreadable(base: VaultFS, failPath: string): Pick<VaultFS, "list" | "read"> {
	return {
		list: (folder) => base.list(folder),
		read: async (path) => {
			if (path === failPath) throw new Error("EIO");
			return base.read(path);
		},
	};
}

/** Narrowing helper — a resolution that must be a map, not the sentinel. */
function asMap(
	result: ReadonlyMap<string, ActionOutcome> | typeof NO_TRUSTED_SIGNAL,
): ReadonlyMap<string, ActionOutcome> {
	if (result === NO_TRUSTED_SIGNAL) {
		throw new Error("expected a trusted outcome map, got NO_TRUSTED_SIGNAL");
	}
	return result;
}

// ---------------------------------------------------------------------------
// Trusted source #1 — the in-session executionStore summary
// ---------------------------------------------------------------------------

describe("resolveOutcomes — in-session summary (trusted source #1)", () => {
	it("maps all five outcome kinds, preserving dependsOn and the failure reason", async () => {
		const set = setWithIds("I01", "I02", "I03", "I04", "I05");
		const state = summaryState([
			record("I01", { kind: "applied" }),
			record("I02", { kind: "skipped-already" }),
			record("I03", { kind: "skipped-dependency", dependsOn: "I01" }),
			record("I04", { kind: "skipped-cancelled" }),
			record("I05", { kind: "failed", reason: "anchor not found" }),
		]);

		const map = asMap(await resolveOutcomes(set, SET_PATH, deps(new FakeVaultFS(), state)));

		expect(map.get("I01")).toEqual({ kind: "applied" });
		expect(map.get("I02")).toEqual({ kind: "skipped-already" });
		expect(map.get("I03")).toEqual({ kind: "skipped-dependency", dependsOn: "I01" });
		expect(map.get("I04")).toEqual({ kind: "skipped-cancelled" });
		expect(map.get("I05")).toEqual({ kind: "failed", reason: "anchor not found" });
		expect(map.size).toBe(5);
	});

	it("ignores records of another source file in the same multi-file run", async () => {
		const set = setWithIds("I01");
		const state = summaryState([
			record("I01", { kind: "failed", reason: "mine" }),
			record("I01", { kind: "applied" }, OTHER_SET_PATH),
			record("I09", { kind: "failed", reason: "theirs" }, OTHER_SET_PATH),
		]);

		const map = asMap(await resolveOutcomes(set, SET_PATH, deps(new FakeVaultFS(), state)));

		expect(map.get("I01")).toEqual({ kind: "failed", reason: "mine" });
		expect(map.has("I09")).toBe(false);
		expect(map.size).toBe(1);
	});

	it("omits records whose outcome is still null (pending / never reached)", async () => {
		const set = setWithIds("I01", "I02");
		const state = summaryState([
			record("I01", { kind: "failed", reason: "boom" }),
			record("I02", null),
		]);

		const map = asMap(await resolveOutcomes(set, SET_PATH, deps(new FakeVaultFS(), state)));

		expect(map.has("I02")).toBe(false);
		expect(map.size).toBe(1);
	});

	it("ignores summary rows for ids that are not in this set", async () => {
		const set = setWithIds("I01");
		const state = summaryState([
			record("I01", { kind: "applied" }),
			record("I99", { kind: "failed", reason: "stale id" }),
		]);

		const map = asMap(await resolveOutcomes(set, SET_PATH, deps(new FakeVaultFS(), state)));

		expect(map.has("I99")).toBe(false);
	});

	it("does not trust a mid-flight run state (running) — falls through, fail closed", async () => {
		const set = setWithIds("I01");
		const running: RunState = {
			kind: "running",
			mode: "confirm",
			records: [record("I01", { kind: "failed", reason: "not final yet" })],
			currentIndex: 0,
		};

		const result = await resolveOutcomes(set, SET_PATH, deps(new FakeVaultFS(), running));

		expect(result).toBe(NO_TRUSTED_SIGNAL);
	});

	it("falls through to the run log when the summary covers only a different set", async () => {
		const set = setWithIds("I01");
		const vault = new FakeVaultFS();
		await writeRunLog(vault, {
			startedAt: new Date(2026, 6, 20, 10, 30),
			sources: [SET_PATH],
			records: [record("I01", { kind: "failed", reason: "from the log" })],
		});
		const state = summaryState([record("I01", { kind: "applied" }, OTHER_SET_PATH)]);

		const map = asMap(await resolveOutcomes(set, SET_PATH, deps(vault, state)));

		expect(map.get("I01")).toEqual({ kind: "failed", reason: "from the log" });
	});
});

// ---------------------------------------------------------------------------
// Trusted source #2 — a confidently source-matched run log
// ---------------------------------------------------------------------------

describe("resolveOutcomes — run-log fallback (trusted source #2)", () => {
	it("parses a run log written by the real RunLogWriter", async () => {
		const set = setWithIds("I01", "I02", "I03", "I04", "I05");
		const vault = new FakeVaultFS();
		await writeRunLog(vault, {
			startedAt: new Date(2026, 6, 20, 10, 30),
			sources: [SET_PATH],
			records: [
				record("I01", { kind: "applied" }),
				record("I02", { kind: "skipped-already" }),
				record("I03", { kind: "skipped-dependency", dependsOn: "I01" }),
				record("I04", { kind: "skipped-cancelled" }),
				record("I05", { kind: "failed", reason: "anchor not found" }),
			],
		});

		const map = asMap(await resolveOutcomes(set, SET_PATH, deps(vault)));

		expect(map.get("I01")).toEqual({ kind: "applied" });
		expect(map.get("I02")).toEqual({ kind: "skipped-already" });
		expect(map.get("I03")).toEqual({ kind: "skipped-dependency", dependsOn: "I01" });
		expect(map.get("I04")).toEqual({ kind: "skipped-cancelled" });
		expect(map.get("I05")).toEqual({ kind: "failed", reason: "anchor not found" });
	});

	it("parses the wikilink I## cell form emitted when the .md peer has ### I## headings", async () => {
		const set = setWithIds("I01");
		const vault = new FakeVaultFS();
		await vault.create(
			SET_PATH.replace(/\.json$/, ".md"),
			"# Instructions\n\n### I01 — Link to [[Hobbies (MOC)]]\n",
		);
		await writeRunLog(vault, {
			startedAt: new Date(2026, 6, 20, 10, 30),
			sources: [SET_PATH],
			records: [record("I01", { kind: "failed", reason: "anchor not found" })],
		});

		const map = asMap(await resolveOutcomes(set, SET_PATH, deps(vault)));

		expect(map.get("I01")).toEqual({ kind: "failed", reason: "anchor not found" });
	});

	it("unescapes pipes inside a failed reason", async () => {
		const set = setWithIds("I01");
		const vault = new FakeVaultFS();
		await writeRunLog(vault, {
			startedAt: new Date(2026, 6, 20, 10, 30),
			sources: [SET_PATH],
			records: [record("I01", { kind: "failed", reason: "no match for /a|b/" })],
		});

		const map = asMap(await resolveOutcomes(set, SET_PATH, deps(vault)));

		expect(map.get("I01")).toEqual({ kind: "failed", reason: "no match for /a|b/" });
	});

	it("uses the newest matching log by filename timestamp", async () => {
		const set = setWithIds("I01");
		const vault = new FakeVaultFS();
		await writeRunLog(vault, {
			startedAt: new Date(2026, 6, 20, 9, 0),
			sources: [SET_PATH],
			records: [record("I01", { kind: "failed", reason: "the old run" })],
		});
		await writeRunLog(vault, {
			startedAt: new Date(2026, 6, 20, 14, 5),
			sources: [SET_PATH],
			records: [record("I01", { kind: "applied" })],
		});

		const map = asMap(await resolveOutcomes(set, SET_PATH, deps(vault)));

		expect(map.get("I01")).toEqual({ kind: "applied" });
	});

	it("tie-breaks same-minute collision logs by their _N suffix", async () => {
		const set = setWithIds("I01");
		const vault = new FakeVaultFS();
		const startedAt = new Date(2026, 6, 20, 10, 30);
		const first = await writeRunLog(vault, {
			startedAt,
			sources: [SET_PATH],
			records: [record("I01", { kind: "failed", reason: "the first run" })],
		});
		const second = await writeRunLog(vault, {
			startedAt,
			sources: [SET_PATH],
			records: [record("I01", { kind: "applied" })],
		});
		expect(second).not.toBe(first);

		const map = asMap(await resolveOutcomes(set, SET_PATH, deps(vault)));

		expect(map.get("I01")).toEqual({ kind: "applied" });
	});

	it("maps only the section of this exact source path in a multi-source log", async () => {
		const set = setWithIds("I01", "I02");
		const vault = new FakeVaultFS();
		await writeRunLog(vault, {
			startedAt: new Date(2026, 6, 20, 10, 30),
			sources: [OTHER_SET_PATH, SET_PATH],
			records: [
				record("I01", { kind: "applied" }, OTHER_SET_PATH),
				record("I02", { kind: "failed", reason: "not ours" }, OTHER_SET_PATH),
				record("I01", { kind: "failed", reason: "ours" }),
			],
		});

		const map = asMap(await resolveOutcomes(set, SET_PATH, deps(vault)));

		expect(map.get("I01")).toEqual({ kind: "failed", reason: "ours" });
		expect(map.has("I02")).toBe(false);
		expect(map.size).toBe(1);
	});

	it("ignores a validation-failure row that carries no I##", async () => {
		const set = setWithIds("I01");
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		await writer.start({
			inboxFolder: INBOX,
			startedAt: new Date(2026, 6, 20, 10, 30),
			mode: "confirm",
			sources: [SET_PATH],
		});
		writer.appendValidationFailure({ fileId: SET_PATH, message: "schema rejected" });
		await writer.finalize(new Date(2026, 6, 20, 10, 31), "always");

		const map = asMap(await resolveOutcomes(set, SET_PATH, deps(vault)));

		expect(map.size).toBe(0);
		expect(map.has("I01")).toBe(false);
	});

	it("ignores log rows for ids that are not in the set", async () => {
		const set = setWithIds("I01");
		const vault = new FakeVaultFS();
		await writeRunLog(vault, {
			startedAt: new Date(2026, 6, 20, 10, 30),
			sources: [SET_PATH],
			records: [
				record("I01", { kind: "applied" }),
				record("I42", { kind: "failed", reason: "id not in this set" }),
			],
		});

		const map = asMap(await resolveOutcomes(set, SET_PATH, deps(vault)));

		expect(map.has("I42")).toBe(false);
	});

	it("omits rows whose outcome column is `pending`", async () => {
		const set = setWithIds("I01", "I02");
		const vault = new FakeVaultFS();
		await writeRunLog(vault, {
			startedAt: new Date(2026, 6, 20, 10, 30),
			sources: [SET_PATH],
			records: [record("I01", { kind: "applied" }), record("I02", null)],
		});

		const map = asMap(await resolveOutcomes(set, SET_PATH, deps(vault)));

		expect(map.has("I02")).toBe(false);
	});

	it("is unaffected by an unreadable log older than the newest matching one", async () => {
		// Bounds the cost of the fail-closed read policy: resolution stops at
		// the newest match, so a corrupt older log is never even opened.
		const set = setWithIds("I01");
		const vault = new FakeVaultFS();
		const older = await writeRunLog(vault, {
			startedAt: new Date(2026, 6, 20, 9, 0),
			sources: [SET_PATH],
			records: [record("I01", { kind: "failed", reason: "superseded" })],
		});
		await writeRunLog(vault, {
			startedAt: new Date(2026, 6, 20, 14, 5),
			sources: [SET_PATH],
			records: [record("I01", { kind: "applied" })],
		});
		const faulted = withUnreadable(vault, older);

		const map = asMap(await resolveOutcomes(set, SET_PATH, deps(faulted)));

		expect(map.get("I01")).toEqual({ kind: "applied" });
	});

	it("orders same-minute collision suffixes numerically (_10 is newer than _9)", async () => {
		// A lexical sort would rank `_9` above `_10` and return the 9th run's
		// `failed` — the stale-outcome false positive this module must not make.
		const set = setWithIds("I01");
		const vault = new FakeVaultFS();
		const startedAt = new Date(2026, 6, 20, 10, 30);
		let newest = "";
		for (let n = 1; n <= 10; n++) {
			newest = await writeRunLog(vault, {
				startedAt,
				sources: [SET_PATH],
				records: [
					record(
						"I01",
						n === 10 ? { kind: "applied" } : { kind: "failed", reason: `run ${n}` },
					),
				],
			});
		}
		expect(newest.endsWith("_10.md")).toBe(true);

		const map = asMap(await resolveOutcomes(set, SET_PATH, deps(vault)));

		expect(map.get("I01")).toEqual({ kind: "applied" });
	});

	it("maps a skipped-dependency row that carries no (dependsOn: …) note", async () => {
		const set = setWithIds("I01");
		const vault = new FakeVaultFS();
		await vault.create(
			`${INBOX}/tomo-hashi-run-log_2026-07-20T1030.md`,
			handWrittenLog(["| I01 | skip | s | skipped-dependency |  |"]),
		);

		const map = asMap(await resolveOutcomes(set, SET_PATH, deps(vault)));

		expect(map.get("I01")).toEqual({ kind: "skipped-dependency", dependsOn: "" });
	});

	it("parses a log written with CRLF line endings (Windows)", async () => {
		const set = setWithIds("I01");
		const vault = new FakeVaultFS();
		await vault.create(
			`${INBOX}/tomo-hashi-run-log_2026-07-20T1030.md`,
			handWrittenLog(["| I01 | skip | s | failed | anchor not found |"]).replace(/\n/g, "\r\n"),
		);

		const map = asMap(await resolveOutcomes(set, SET_PATH, deps(vault)));

		expect(map.get("I01")).toEqual({ kind: "failed", reason: "anchor not found" });
	});

	it("ignores files in the log folder that are not run logs", async () => {
		const set = setWithIds("I01");
		const vault = new FakeVaultFS();
		await vault.create(`${INBOX}/notes.md`, "---\nsources:\n  - " + SET_PATH + "\n---\n");
		await vault.create(`${INBOX}/tomo-hashi-run-log_draft.md`, "---\nsources:\n  - " + SET_PATH + "\n---\n");

		const result = await resolveOutcomes(set, SET_PATH, deps(vault));

		expect(result).toBe(NO_TRUSTED_SIGNAL);
	});
});

// ---------------------------------------------------------------------------
// Fail closed — the REJECT paths (ADR-4). A false positive here would unlock
// editing on actions that never failed.
// ---------------------------------------------------------------------------

describe("resolveOutcomes — fail closed (reject paths)", () => {
	it("returns NO_TRUSTED_SIGNAL with no summary and no run log (bare applied:false is never trusted)", async () => {
		const set = setWithIds("I01", "I02");

		const result = await resolveOutcomes(set, SET_PATH, deps(new FakeVaultFS()));

		expect(result).toBe(NO_TRUSTED_SIGNAL);
	});

	it("returns NO_TRUSTED_SIGNAL when the newest log lists a different set", async () => {
		const set = setWithIds("I01");
		const vault = new FakeVaultFS();
		await writeRunLog(vault, {
			startedAt: new Date(2026, 6, 20, 10, 30),
			sources: [OTHER_SET_PATH],
			records: [record("I01", { kind: "failed", reason: "another set" }, OTHER_SET_PATH)],
		});

		const result = await resolveOutcomes(set, SET_PATH, deps(vault));

		expect(result).toBe(NO_TRUSTED_SIGNAL);
	});

	it.each([
		["basename only", "2026-07-20_1015_instructions.json"],
		["different folder", `200 Archive/2026-07-20_1015_instructions.json`],
		["path prefix", `${INBOX}/2026-07-20_1015_instructions`],
		["path suffix", `vault/${INBOX}/2026-07-20_1015_instructions.json`],
		["trailing slash noise", `${INBOX}//2026-07-20_1015_instructions.json`],
		["case-shifted", `${INBOX}/2026-07-20_1015_INSTRUCTIONS.json`],
	])("never fuzzy-matches a log whose sources only hold a near-miss path (%s)", async (_label, logged) => {
		const set = setWithIds("I01");
		const vault = new FakeVaultFS();
		await writeRunLog(vault, {
			startedAt: new Date(2026, 6, 20, 10, 30),
			sources: [logged],
			records: [record("I01", { kind: "failed", reason: "not this set" }, logged)],
		});

		const result = await resolveOutcomes(set, SET_PATH, deps(vault));

		expect(result).toBe(NO_TRUSTED_SIGNAL);
	});

	it("returns NO_TRUSTED_SIGNAL when the log folder cannot be listed", async () => {
		const set = setWithIds("I01");
		const vault: Pick<VaultFS, "list" | "read"> = {
			list: () => Promise.reject(new Error("folder not found")),
			read: () => Promise.reject(new Error("folder not found")),
		};

		const result = await resolveOutcomes(set, SET_PATH, deps(vault));

		expect(result).toBe(NO_TRUSTED_SIGNAL);
	});

	it("returns NO_TRUSTED_SIGNAL when a candidate newer than the match cannot be read", async () => {
		// The concrete false positive this policy prevents: the newest log
		// recorded the repaired action as `applied` but is transiently
		// unreadable, while an older log still says `failed`. Handing back the
		// older answer would unlock editing on an action that already succeeded.
		const set = setWithIds("I01");
		const vault = new FakeVaultFS();
		await writeRunLog(vault, {
			startedAt: new Date(2026, 6, 20, 9, 0),
			sources: [SET_PATH],
			records: [record("I01", { kind: "failed", reason: "superseded" })],
		});
		const newest = await writeRunLog(vault, {
			startedAt: new Date(2026, 6, 20, 14, 5),
			sources: [SET_PATH],
			records: [record("I01", { kind: "applied" })],
		});

		const result = await resolveOutcomes(set, SET_PATH, deps(withUnreadable(vault, newest)));

		expect(result).toBe(NO_TRUSTED_SIGNAL);
	});

	it("returns NO_TRUSTED_SIGNAL for an unreadable candidate that is not even a match", async () => {
		// Accepted cost of the shared policy: an unrelated corrupt log newer
		// than this set's own log blocks resolution until the user re-runs.
		const set = setWithIds("I01");
		const vault = new FakeVaultFS();
		await writeRunLog(vault, {
			startedAt: new Date(2026, 6, 20, 9, 0),
			sources: [SET_PATH],
			records: [record("I01", { kind: "failed", reason: "readable, matching" })],
		});
		const unrelated = await writeRunLog(vault, {
			startedAt: new Date(2026, 6, 20, 14, 5),
			sources: [OTHER_SET_PATH],
			records: [record("I01", { kind: "applied" }, OTHER_SET_PATH)],
		});

		const result = await resolveOutcomes(set, SET_PATH, deps(withUnreadable(vault, unrelated)));

		expect(result).toBe(NO_TRUSTED_SIGNAL);
	});

	it("returns NO_TRUSTED_SIGNAL for a truncated log whose frontmatter never closes", async () => {
		const set = setWithIds("I01");
		const vault = new FakeVaultFS();
		await vault.create(
			`${INBOX}/tomo-hashi-run-log_2026-07-20T1030.md`,
			["---", "log_format_version: 1", "sources:", `  - ${SET_PATH}`].join("\n"),
		);

		const result = await resolveOutcomes(set, SET_PATH, deps(vault));

		expect(result).toBe(NO_TRUSTED_SIGNAL);
	});

	it("returns NO_TRUSTED_SIGNAL when the matching log has no section for this path", async () => {
		const set = setWithIds("I01");
		const vault = new FakeVaultFS();
		// Frontmatter claims the set, body has no `## <path>` section — an
		// externally mangled log. Mapping it optimistically is exactly the
		// forbidden false positive.
		await vault.create(
			`${INBOX}/tomo-hashi-run-log_2026-07-20T1030.md`,
			[
				"---",
				"log_format_version: 1",
				"sources:",
				`  - ${SET_PATH}`,
				"---",
				"# Hashi run log",
				"",
			].join("\n"),
		);

		const result = await resolveOutcomes(set, SET_PATH, deps(vault));

		expect(result).toBe(NO_TRUSTED_SIGNAL);
	});

	it("does not fall back to an older log once a newer matching log is found", async () => {
		const set = setWithIds("I01", "I02");
		const vault = new FakeVaultFS();
		await writeRunLog(vault, {
			startedAt: new Date(2026, 6, 20, 9, 0),
			sources: [SET_PATH],
			records: [
				record("I01", { kind: "failed", reason: "stale failure" }),
				record("I02", { kind: "failed", reason: "stale failure" }),
			],
		});
		await writeRunLog(vault, {
			startedAt: new Date(2026, 6, 20, 14, 5),
			sources: [SET_PATH],
			records: [record("I01", { kind: "applied" })],
		});

		const map = asMap(await resolveOutcomes(set, SET_PATH, deps(vault)));

		expect(map.get("I01")).toEqual({ kind: "applied" });
		expect(map.has("I02")).toBe(false);
	});

	it("ignores a `sources:` entry that only starts with the set path (no prefix match)", async () => {
		const set = setWithIds("I01");
		const vault = new FakeVaultFS();
		await vault.create(
			`${INBOX}/tomo-hashi-run-log_2026-07-20T1030.md`,
			[
				"---",
				"sources:",
				`  - ${SET_PATH}.bak`,
				"---",
				"# Hashi run log",
				"",
				`## ${SET_PATH}`,
				"",
				"| I##  | kind | summary | outcome | error |",
				"|------|------|---------|---------|-------|",
				"| I01 | skip | s | failed | boom |",
				"",
			].join("\n"),
		);

		const result = await resolveOutcomes(set, SET_PATH, deps(vault));

		expect(result).toBe(NO_TRUSTED_SIGNAL);
	});
});

// ---------------------------------------------------------------------------
// editGate (spec-006 T2.2) — the fail-closed per-action editability decision.
// Exhaustive over {appliedFlag} x {outcome-source-shape}: every cell below is
// asserted by construction, not sampled, per Constitution Testing L1.
// ---------------------------------------------------------------------------

describe("editGate — per-action editability (T2.2)", () => {
	const ACTION_ID = "I01";
	const ACTION = { id: ACTION_ID };
	const EMPTY_MAP: ReadonlyMap<string, ActionOutcome> = new Map();

	function outcomeMap(outcome: ActionOutcome): ReadonlyMap<string, ActionOutcome> {
		return new Map([[ACTION_ID, outcome]]);
	}

	// [appliedLabel, appliedFlag, outcomeLabel, outcomeResult, expected]
	const CELLS: ReadonlyArray<
		readonly [
			string,
			boolean | undefined,
			string,
			ReadonlyMap<string, ActionOutcome> | typeof NO_TRUSTED_SIGNAL,
			EditGateResult,
		]
	> = [
		// appliedFlag = true -> frozen-applied regardless of outcome (step 1 short-circuits)
		["true", true, "NO_TRUSTED_SIGNAL", NO_TRUSTED_SIGNAL, "frozen-applied"],
		["true", true, "absent from map", EMPTY_MAP, "frozen-applied"],
		["true", true, "applied", outcomeMap({ kind: "applied" }), "frozen-applied"],
		["true", true, "skipped-already", outcomeMap({ kind: "skipped-already" }), "frozen-applied"],
		[
			"true",
			true,
			"skipped-dependency",
			outcomeMap({ kind: "skipped-dependency", dependsOn: "I00" }),
			"frozen-applied",
		],
		["true", true, "skipped-cancelled", outcomeMap({ kind: "skipped-cancelled" }), "frozen-applied"],
		["true", true, "failed", outcomeMap({ kind: "failed", reason: "boom" }), "frozen-applied"],

		// appliedFlag = false
		["false", false, "NO_TRUSTED_SIGNAL", NO_TRUSTED_SIGNAL, "read-only-no-signal"],
		["false", false, "absent from map", EMPTY_MAP, "read-only-no-signal"],
		["false", false, "applied", outcomeMap({ kind: "applied" }), "frozen-applied"],
		["false", false, "skipped-already", outcomeMap({ kind: "skipped-already" }), "editable"],
		[
			"false",
			false,
			"skipped-dependency",
			outcomeMap({ kind: "skipped-dependency", dependsOn: "I00" }),
			"editable",
		],
		["false", false, "skipped-cancelled", outcomeMap({ kind: "skipped-cancelled" }), "editable"],
		["false", false, "failed", outcomeMap({ kind: "failed", reason: "boom" }), "editable"],

		// appliedFlag = undefined (Action.applied never set)
		["undefined", undefined, "NO_TRUSTED_SIGNAL", NO_TRUSTED_SIGNAL, "read-only-no-signal"],
		["undefined", undefined, "absent from map", EMPTY_MAP, "read-only-no-signal"],
		["undefined", undefined, "applied", outcomeMap({ kind: "applied" }), "frozen-applied"],
		["undefined", undefined, "skipped-already", outcomeMap({ kind: "skipped-already" }), "editable"],
		[
			"undefined",
			undefined,
			"skipped-dependency",
			outcomeMap({ kind: "skipped-dependency", dependsOn: "I00" }),
			"editable",
		],
		["undefined", undefined, "skipped-cancelled", outcomeMap({ kind: "skipped-cancelled" }), "editable"],
		["undefined", undefined, "failed", outcomeMap({ kind: "failed", reason: "boom" }), "editable"],
	];

	it.each(CELLS)(
		"appliedFlag=%s, outcome=%s -> %s",
		(_appliedLabel, appliedFlag, _outcomeLabel, outcomeResult, expected) => {
			expect(editGate(ACTION, outcomeResult, appliedFlag)).toBe(expected);
		},
	);

	// -------------------------------------------------------------------------
	// SDD traced walkthrough: I07 failed(anchor not found), I09 applied, I12
	// never reached.
	// -------------------------------------------------------------------------

	it("traced walkthrough — opened from the apply modal (summary present)", () => {
		const map = new Map<string, ActionOutcome>([
			["I07", { kind: "failed", reason: "anchor not found" }],
			["I09", { kind: "applied" }],
			// I12 absent: never reached by the run.
		]);

		expect(editGate({ id: "I07" }, map, false)).toBe("editable");
		expect(editGate({ id: "I09" }, map, true)).toBe("frozen-applied");
		expect(editGate({ id: "I12" }, map, undefined)).toBe("read-only-no-signal");
	});

	it("traced walkthrough — opened cold with no run-log: all read-only (offer run)", () => {
		expect(editGate({ id: "I07" }, NO_TRUSTED_SIGNAL, false)).toBe("read-only-no-signal");
		expect(editGate({ id: "I09" }, NO_TRUSTED_SIGNAL, false)).toBe("read-only-no-signal");
		expect(editGate({ id: "I12" }, NO_TRUSTED_SIGNAL, false)).toBe("read-only-no-signal");
	});

	// -------------------------------------------------------------------------
	// Defensive step 6: outcome `applied` without a true appliedFlag is treated
	// as frozen, not editable — a false positive here would unlock editing on
	// an action the executor actually applied.
	// -------------------------------------------------------------------------

	it("defensive: outcome 'applied' with a falsy appliedFlag stays frozen, never editable", () => {
		const map = outcomeMap({ kind: "applied" });

		expect(editGate(ACTION, map, false)).toBe("frozen-applied");
		expect(editGate(ACTION, map, undefined)).toBe("frozen-applied");
	});
});
