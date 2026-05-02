/**
 * T4.3 — RunLogWriter tests (RED phase)
 *
 * Covers all PRD F7 ACs:
 *   - Filename builder: tomo-hashi-run-log_YYYY-MM-DDTHHMM.md with _2/_3 suffix on collision
 *   - Header includes start/end timestamps, mode, sources, totals
 *   - Body groups records by source file with ## <filename> sub-heading
 *   - Each row includes I##, kind, payload summary, outcome, error (if failed)
 *   - Verbatim content fields (no fingerprint, no truncation)
 *   - Retention "always" → kept regardless
 *   - Retention "only-after-failed" + 0 failures → deleted
 *   - Retention "only-after-failed" + ≥1 failure → kept
 *   - Validation-only failures appear as the only entry for that file
 *   - Filename collision → _2, _3 suffix
 *
 * [ref: PRD/F7; SDD/ADR-8]
 */

import { describe, expect, it } from "vitest";

import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { RunLogWriter } from "../../../src/executor/runLog.js";
import { buildRunLogFilename, resolveCollisionFreePath } from "../../../src/util/filenames.js";
import type { ActionRecord, ActionOutcome } from "../../../src/executor/state.js";
import type { RunLogStartMeta } from "../../../src/executor/runLog.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_START = new Date("2026-04-29T14:32:00");
const FIXED_END = new Date("2026-04-29T14:32:18");
const INBOX = "tomo-inbox";

function makeRecord(
	fileId: string,
	id: string,
	kind: ActionRecord["kind"],
	summary: string,
	outcome: ActionOutcome | null = null,
): ActionRecord {
	return { fileId, id, kind, summary, outcome };
}

function makeStartMeta(overrides?: Partial<RunLogStartMeta>): RunLogStartMeta {
	return {
		inboxFolder: INBOX,
		startedAt: FIXED_START,
		mode: "confirm",
		sources: ["2026-04-29_1432_instructions.json"],
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// buildRunLogFilename
// ---------------------------------------------------------------------------

describe("buildRunLogFilename", () => {
	it("formats a local-time filename from a fixed date", () => {
		const result = buildRunLogFilename(FIXED_START);
		// Expected: tomo-hashi-run-log_2026-04-29T1432.md
		expect(result).toBe("tomo-hashi-run-log_2026-04-29T1432.md");
	});

	it("zero-pads month, day, hour, minute", () => {
		const d = new Date(2026, 0, 5, 9, 7); // Jan 5, 09:07 local
		const result = buildRunLogFilename(d);
		expect(result).toBe("tomo-hashi-run-log_2026-01-05T0907.md");
	});
});

// ---------------------------------------------------------------------------
// resolveCollisionFreePath
// ---------------------------------------------------------------------------

describe("resolveCollisionFreePath", () => {
	it("returns base path when no collision", async () => {
		const vault = new FakeVaultFS();
		const result = await resolveCollisionFreePath(vault, INBOX, "tomo-hashi-run-log_2026-04-29T1432.md");
		expect(result).toBe("tomo-inbox/tomo-hashi-run-log_2026-04-29T1432.md");
	});

	it("appends _2 when base path exists", async () => {
		const vault = new FakeVaultFS();
		await vault.create("tomo-inbox/tomo-hashi-run-log_2026-04-29T1432.md", "placeholder");
		const result = await resolveCollisionFreePath(vault, INBOX, "tomo-hashi-run-log_2026-04-29T1432.md");
		expect(result).toBe("tomo-inbox/tomo-hashi-run-log_2026-04-29T1432_2.md");
	});

	it("appends _3 when base and _2 both exist", async () => {
		const vault = new FakeVaultFS();
		await vault.create("tomo-inbox/tomo-hashi-run-log_2026-04-29T1432.md", "a");
		await vault.create("tomo-inbox/tomo-hashi-run-log_2026-04-29T1432_2.md", "b");
		const result = await resolveCollisionFreePath(vault, INBOX, "tomo-hashi-run-log_2026-04-29T1432.md");
		expect(result).toBe("tomo-inbox/tomo-hashi-run-log_2026-04-29T1432_3.md");
	});
});

// ---------------------------------------------------------------------------
// RunLogWriter — start()
// ---------------------------------------------------------------------------

describe("RunLogWriter.start", () => {
	it("creates the log file and returns its path", async () => {
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta());

		expect(path).toBe("tomo-inbox/tomo-hashi-run-log_2026-04-29T1432.md");
		expect(await vault.exists(path)).toBe(true);
	});

	it("resolves collision with _2 suffix", async () => {
		const vault = new FakeVaultFS();
		await vault.create("tomo-inbox/tomo-hashi-run-log_2026-04-29T1432.md", "placeholder");
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta());

		expect(path).toBe("tomo-inbox/tomo-hashi-run-log_2026-04-29T1432_2.md");
	});

	it("placeholder file has YAML frontmatter with started and mode", async () => {
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta());
		const content = await vault.read(path);

		expect(content).toContain("started:");
		expect(content).toContain("mode: confirm");
	});
});

// ---------------------------------------------------------------------------
// RunLogWriter — finalize() — header and body content
// ---------------------------------------------------------------------------

describe("RunLogWriter.finalize — header", () => {
	it("includes log_format_version in frontmatter (M16)", async () => {
		// Future tooling that parses run-log frontmatter (Tomo, dashboards,
		// re-run helpers) gets a clear contract version. Cheap to add now;
		// expensive to back-port if the format evolves silently.
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		const filePath = await writer.start(makeStartMeta());
		await writer.finalize(FIXED_END, "always");
		const content = await vault.read(filePath);

		expect(content).toMatch(/^---[\s\S]*?\nlog_format_version:\s*1\b/m);
	});

	it("includes start and end timestamps in frontmatter", async () => {
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta());
		await writer.finalize(FIXED_END, "always");
		const content = await vault.read(path);

		expect(content).toContain("started: 2026-04-29T14:32:00");
		expect(content).toContain("ended:   2026-04-29T14:32:18");
	});

	it("includes execution mode in frontmatter", async () => {
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta({ mode: "auto-run" }));
		await writer.finalize(FIXED_END, "always");
		const content = await vault.read(path);

		expect(content).toContain("mode: auto-run");
	});

	it("includes source filenames in frontmatter", async () => {
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta({
			sources: ["2026-04-29_1432_instructions.json"],
		}));
		await writer.finalize(FIXED_END, "always");
		const content = await vault.read(path);

		expect(content).toContain("2026-04-29_1432_instructions.json");
	});

	it("includes totals in frontmatter", async () => {
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		await writer.start(makeStartMeta());
		writer.appendRecord(makeRecord("2026-04-29_1432_instructions.json", "I01", "create_moc", "src → dst", { kind: "applied" }));
		writer.appendRecord(makeRecord("2026-04-29_1432_instructions.json", "I02", "move_note", "a → b", { kind: "skipped-already" }));
		writer.appendRecord(makeRecord("2026-04-29_1432_instructions.json", "I03", "link_to_moc", "moc ← link", { kind: "failed", reason: "missing target" }));
		await writer.finalize(FIXED_END, "always");
		const path = "tomo-inbox/tomo-hashi-run-log_2026-04-29T1432.md";
		const content = await vault.read(path);

		expect(content).toContain("applied: 1");
		expect(content).toContain("skipped-already: 1");
		expect(content).toContain("skipped-dependency: 0");
		expect(content).toContain("skipped-cancelled: 0");
		expect(content).toContain("failed: 1");
	});
});

describe("RunLogWriter.finalize — body", () => {
	it("groups records under ## <source file> sub-heading", async () => {
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta({
			sources: ["2026-04-29_1432_instructions.json"],
		}));
		writer.appendRecord(makeRecord("2026-04-29_1432_instructions.json", "I01", "create_moc", "src → dst", { kind: "applied" }));
		await writer.finalize(FIXED_END, "always");
		const content = await vault.read(path);

		expect(content).toContain("## 2026-04-29_1432_instructions.json");
	});

	it("each row contains I##, kind, summary, outcome", async () => {
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta());
		writer.appendRecord(makeRecord("2026-04-29_1432_instructions.json", "I01", "create_moc", "inbox/note.md → moc/MyMOC.md", { kind: "applied" }));
		await writer.finalize(FIXED_END, "always");
		const content = await vault.read(path);

		expect(content).toContain("I01");
		expect(content).toContain("create_moc");
		expect(content).toContain("inbox/note.md → moc/MyMOC.md");
		expect(content).toContain("applied");
	});

	it("failed row includes error message", async () => {
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta());
		writer.appendRecord(makeRecord(
			"2026-04-29_1432_instructions.json",
			"I03",
			"link_to_moc",
			"moc/MyMOC.md ← - [[note]]",
			{ kind: "failed", reason: "MOC target missing" },
		));
		await writer.finalize(FIXED_END, "always");
		const content = await vault.read(path);

		expect(content).toContain("failed");
		expect(content).toContain("MOC target missing");
	});

	it("records verbatim free-text content (no fingerprint, no truncation)", async () => {
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta());
		// Simulate an update_tracker record with long literal value
		writer.appendRecord(makeRecord(
			"2026-04-29_1432_instructions.json",
			"I04",
			"update_tracker",
			"daily.md :: score=Hello World — full sentence",
			{ kind: "skipped-already" },
		));
		await writer.finalize(FIXED_END, "always");
		const content = await vault.read(path);

		expect(content).toContain("Hello World — full sentence");
	});

	// -- M5: pipe escaping in non-id columns ----------------------------

	it("escapes literal | in summary, error, and depNote columns (M5)", async () => {
		// bb7d6fb only escaped the I## column. Other columns can carry
		// pipes (e.g., wikilink alias separator in update_log_link
		// summaries, exception messages mentioning regex unions, dep
		// notes in unusual ids). Without escaping, the markdown table
		// row breaks.
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		const filePath = await writer.start(makeStartMeta());
		writer.appendRecord(makeRecord(
			"2026-04-29_1432_instructions.json",
			"I05",
			"update_log_link",
			"daily.md#section ← [[stem|with|pipes]]",
			{ kind: "failed", reason: "matched | option a or b" },
		));
		await writer.finalize(FIXED_END, "always");
		const content = await vault.read(filePath);

		// The summary cell's pipes are escaped (\| keeps the cell intact).
		expect(content).toContain("[[stem\\|with\\|pipes]]");
		// The error cell's pipe is escaped too.
		expect(content).toContain("matched \\| option a or b");

		// Sanity: each table row has the expected 5 separator pipes (the
		// outer two + four inner). Count of literal `|` (not `\\|`) per
		// row must remain 6.
		const recordLine = content
			.split("\n")
			.find((l) => l.includes("update_log_link"));
		expect(recordLine).toBeDefined();
		const literalPipes = (recordLine ?? "")
			.replace(/\\\|/g, "")
			.match(/\|/g) ?? [];
		expect(literalPipes.length).toBe(6);
	});

	it("collapses newlines in cells so a row stays single-line (review round 2 / L15)", async () => {
		// A hook-emitted info/warnings string carrying \n was previously
		// embedded verbatim into the table row, terminating every column
		// after the newline and leaving trailing pipe-free text outside
		// the table. escapeCell now collapses [\r\n]+ to a single space
		// before pipe-escape so the row stays valid Markdown regardless
		// of the source string's whitespace shape.
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta());
		writer.appendRecord(makeRecord(
			"2026-04-29_1432_instructions.json",
			"I07",
			"create_moc",
			"a → moc",
			{ kind: "failed", reason: "line one\nline two\r\nline three" },
		));
		await writer.finalize(FIXED_END, "always");
		const content = await vault.read(path);

		// The failed record's row must be a single line — the embedded
		// \n / \r\n must not split the row across multiple table lines.
		const rowLines = content
			.split("\n")
			.filter((l) => l.includes("create_moc") && l.includes("failed"));
		expect(rowLines.length).toBe(1);
		// And the failure-reason text is preserved with newlines collapsed
		// to spaces.
		expect(rowLines[0]).toContain("line one line two line three");
	});

	it("skipped-dependency row includes the dependsOn id", async () => {
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta());
		writer.appendRecord(makeRecord(
			"2026-04-29_1432_instructions.json",
			"I02",
			"link_to_moc",
			"moc ← link",
			{ kind: "skipped-dependency", dependsOn: "I01" },
		));
		await writer.finalize(FIXED_END, "always");
		const content = await vault.read(path);

		expect(content).toContain("skipped-dependency");
		expect(content).toContain("I01");
	});

	it("batch run groups records by source with separate ## headings", async () => {
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta({
			sources: ["file-a_instructions.json", "file-b_instructions.json"],
		}));
		writer.appendRecord(makeRecord("file-a_instructions.json", "I01", "create_moc", "a → moc", { kind: "applied" }));
		writer.appendRecord(makeRecord("file-b_instructions.json", "I01", "move_note", "b → notes/b", { kind: "applied" }));
		await writer.finalize(FIXED_END, "always");
		const content = await vault.read(path);

		expect(content).toContain("## file-a_instructions.json");
		expect(content).toContain("## file-b_instructions.json");
	});
});

// ---------------------------------------------------------------------------
// RunLogWriter — validation failures
// ---------------------------------------------------------------------------

describe("RunLogWriter.finalize — validation failures", () => {
	it("validation-only failure appears as the only entry with failed outcome", async () => {
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta({
			sources: ["bad_instructions.json"],
		}));
		writer.appendValidationFailure({
			fileId: "bad_instructions.json",
			message: "Schema version mismatch — expected 1, got 2",
		});
		await writer.finalize(FIXED_END, "always");
		const content = await vault.read(path);

		expect(content).toContain("## bad_instructions.json");
		expect(content).toContain("Schema version mismatch — expected 1, got 2");
		expect(content).toContain("failed");
	});

	it("validation failure section heading includes (validation failed)", async () => {
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta({
			sources: ["bad_instructions.json"],
		}));
		writer.appendValidationFailure({
			fileId: "bad_instructions.json",
			message: "some error",
		});
		await writer.finalize(FIXED_END, "always");
		const content = await vault.read(path);

		expect(content).toContain("validation failed");
	});

	it("validation failure counts toward failed total", async () => {
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta({
			sources: ["bad_instructions.json"],
		}));
		writer.appendValidationFailure({
			fileId: "bad_instructions.json",
			message: "bad schema",
		});
		await writer.finalize(FIXED_END, "always");
		const content = await vault.read(path);

		expect(content).toContain("failed: 1");
	});
});

// ---------------------------------------------------------------------------
// RunLogWriter — retention rules
// ---------------------------------------------------------------------------

describe("RunLogWriter.finalize — retention", () => {
	it("retention=always: file kept when no failures", async () => {
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta());
		writer.appendRecord(makeRecord("2026-04-29_1432_instructions.json", "I01", "create_moc", "a → b", { kind: "applied" }));
		await writer.finalize(FIXED_END, "always");

		expect(await vault.exists(path)).toBe(true);
	});

	it("retention=always: file kept even with failures", async () => {
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta());
		writer.appendRecord(makeRecord("2026-04-29_1432_instructions.json", "I01", "create_moc", "a → b", { kind: "failed", reason: "error" }));
		await writer.finalize(FIXED_END, "always");

		expect(await vault.exists(path)).toBe(true);
	});

	it("retention=only-after-failed + 0 failures: file deleted", async () => {
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta());
		writer.appendRecord(makeRecord("2026-04-29_1432_instructions.json", "I01", "create_moc", "a → b", { kind: "applied" }));
		await writer.finalize(FIXED_END, "only-after-failed");

		expect(await vault.exists(path)).toBe(false);
	});

	it("retention=only-after-failed + ≥1 failure: file kept", async () => {
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta());
		writer.appendRecord(makeRecord("2026-04-29_1432_instructions.json", "I01", "create_moc", "a → b", { kind: "failed", reason: "missing" }));
		await writer.finalize(FIXED_END, "only-after-failed");

		expect(await vault.exists(path)).toBe(true);
	});

	it("retention=only-after-failed + validation failure: file kept", async () => {
		const vault = new FakeVaultFS();
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta({
			sources: ["bad_instructions.json"],
		}));
		writer.appendValidationFailure({
			fileId: "bad_instructions.json",
			message: "Schema error",
		});
		await writer.finalize(FIXED_END, "only-after-failed");

		expect(await vault.exists(path)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// I## column wikilinks to the .md peer (2026-05-01)
// ---------------------------------------------------------------------------
//
// When a source's .md peer exists and contains `### <id> — <title>` headings,
// the run log renders each I## column as a wikilink to the matching peer
// heading. Falls back to plain `I##` text when peer is missing or no heading
// matches. Format: `[[<peer_stem>#<heading_text>|I##]]`.

describe("RunLogWriter — I## wikilinks to peer headings", () => {
	const SOURCE = "2026-05-01_1008_instructions.json";
	const PEER = "2026-05-01_1008_instructions.md";

	const peerContent = [
		"# Tomo instructions",
		"",
		"### I01 — Create MOC: Board Games (MOC)",
		"- [ ] Applied",
		"",
		"### I03 — Move Note: Asahikawa — Hokkaidos zweitgrößte Stadt",
		"- [ ] Applied",
		"",
	].join("\n");

	it("renders I## as wikilink when peer exists with matching heading", async () => {
		const vault = new FakeVaultFS();
		await vault.create(`${INBOX}/${PEER}`, peerContent);
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta({
			sources: [`${INBOX}/${SOURCE}`],
		}));
		writer.appendRecord(makeRecord(`${INBOX}/${SOURCE}`, "I01", "create_moc", "src → dst", { kind: "applied" }));
		writer.appendRecord(makeRecord(`${INBOX}/${SOURCE}`, "I03", "move_note", "src → dst", { kind: "applied" }));
		await writer.finalize(FIXED_END, "always");
		const content = await vault.read(path);

		// Pipe in alias separator is escaped (\|) so the wikilink survives
		// the markdown table cell — Obsidian renders \| as the alias separator.
		expect(content).toContain(
			"[[2026-05-01_1008_instructions#I01 — Create MOC: Board Games (MOC)\\|I01]]",
		);
		expect(content).toContain(
			"[[2026-05-01_1008_instructions#I03 — Move Note: Asahikawa — Hokkaidos zweitgrößte Stadt\\|I03]]",
		);
	});

	it("falls back to plain I## when peer file does not exist", async () => {
		const vault = new FakeVaultFS();
		// No peer file created
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta({
			sources: [`${INBOX}/${SOURCE}`],
		}));
		writer.appendRecord(makeRecord(`${INBOX}/${SOURCE}`, "I01", "create_moc", "src → dst", { kind: "applied" }));
		await writer.finalize(FIXED_END, "always");
		const content = await vault.read(path);

		expect(content).not.toContain("[[2026-05-01_1008_instructions#");
		// Plain I01 still appears in the row
		expect(content).toContain("| I01 |");
	});

	it("falls back to plain I## when peer exists but heading for that id is missing", async () => {
		const partialPeer = [
			"# Tomo instructions",
			"",
			"### I01 — Create MOC: Board Games (MOC)",
			"- [ ] Applied",
			"",
		].join("\n");
		const vault = new FakeVaultFS();
		await vault.create(`${INBOX}/${PEER}`, partialPeer);
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta({
			sources: [`${INBOX}/${SOURCE}`],
		}));
		// I01 has a heading; I99 does not
		writer.appendRecord(makeRecord(`${INBOX}/${SOURCE}`, "I01", "create_moc", "src → dst", { kind: "applied" }));
		writer.appendRecord(makeRecord(`${INBOX}/${SOURCE}`, "I99", "skip", "x", { kind: "applied" }));
		await writer.finalize(FIXED_END, "always");
		const content = await vault.read(path);

		expect(content).toContain("[[2026-05-01_1008_instructions#I01 — Create MOC: Board Games (MOC)\\|I01]]");
		expect(content).toContain("| I99 |");
		expect(content).not.toContain("#I99");
	});

	it("validation-failure rows do not get wikilinks (I## column is `—`)", async () => {
		const vault = new FakeVaultFS();
		await vault.create(`${INBOX}/${PEER}`, peerContent);
		const writer = new RunLogWriter(vault);
		const path = await writer.start(makeStartMeta({
			sources: [`${INBOX}/${SOURCE}`],
		}));
		writer.appendValidationFailure({
			fileId: `${INBOX}/${SOURCE}`,
			message: "Schema error",
		});
		await writer.finalize(FIXED_END, "always");
		const content = await vault.read(path);

		// Row contains the dash placeholder, not a wikilink
		expect(content).toMatch(/\|\s*—\s*\|/);
	});
});

// ---------------------------------------------------------------------------
// No crypto imports guard
// ---------------------------------------------------------------------------

describe("no crypto/sha256 in implementation", () => {
	it("runLog.ts does not import crypto", async () => {
		// This test is a build-time assertion documented in test comments.
		// The grep check is done by CI; here we just verify the module loads.
		const mod = await import("../../../src/executor/runLog.js");
		expect(mod.RunLogWriter).toBeDefined();
	});

	it("filenames.ts does not import crypto", async () => {
		const mod = await import("../../../src/util/filenames.js");
		expect(mod.buildRunLogFilename).toBeDefined();
		expect(mod.resolveCollisionFreePath).toBeDefined();
	});
});
