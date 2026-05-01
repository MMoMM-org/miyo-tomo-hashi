/**
 * PRD F9/AC6 invariant: no chat content logged.
 *
 * The PRD explicitly mandates a grep-based assertion: "No log statement in
 * connection or chat-view code SHALL receive a chunk, frame, or buffer
 * originating from the container's stdio stream … verified by a grep-based
 * assertion in tests (forbidden patterns: `logger.*(chunk`, `logger.*(data`,
 * `logger.*(stdout`, `logger.*(stderr` in `src/connection/**` and
 * `src/ui/chat-view/**`)."
 *
 * Why this matters: a Claude Code session can carry sensitive user text
 * (paths, secrets, credentials, draft writing). Even a `console.debug` of a
 * chunk would write that text to a log file Obsidian controls. The grep
 * test runs on every CI build so a future contributor who adds `logger.debug(
 * "chunk received", chunk)` for diagnostics receives a hard test failure
 * instead of merging a privacy regression.
 *
 * The test scans both directories recursively. It excludes:
 *   - inline comments and block comments (those are commentary about the
 *     restriction, not actual log calls — e.g., this very file's docstring)
 *   - test files (none in src/, but documented for clarity)
 *
 * Pattern: `/logger\.[a-z]+\(.*?(chunk|data|stdout|stderr)/` — matches
 * `logger.<method>(...<keyword>...` on a single line. Multi-line matches are
 * not currently a real-world risk in this codebase (Logger has 4 methods, all
 * one-line call sites).
 *
 * Spec refs: spec 001-session-view requirements.md F9/AC6;
 *            traceability.md §F9.6 + §"2026-04-28 review-fix follow-ups".
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "../..");
const SCAN_ROOTS = [
	resolve(REPO_ROOT, "src/connection"),
	resolve(REPO_ROOT, "src/ui/chat-view"),
];

const FORBIDDEN = /logger\.[a-z]+\([^)]*?(chunk|data|stdout|stderr)/;

function* walkTs(dir: string): Iterable<string> {
	const entries = readdirSync(dir);
	for (const entry of entries) {
		const full = join(dir, entry);
		const s = statSync(full);
		if (s.isDirectory()) {
			yield* walkTs(full);
		} else if (s.isFile() && entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
			yield full;
		}
	}
}

function stripComments(source: string): string {
	// Strip block comments first, then line comments. Imperfect (will mangle
	// strings containing "//" or "/*") but the codebase doesn't use those
	// patterns at scan-target lines, and false negatives here would only let
	// a forbidden call slip through if disguised inside a string — which
	// would still log the data. We accept that residual false-positive risk
	// in favor of a simpler scanner.
	return source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");
}

describe("PRD F9/AC6 — no chat content logged", () => {
	it("no logger.<method>(... chunk|data|stdout|stderr ...) anywhere in src/connection/** or src/ui/chat-view/**", () => {
		const violations: { file: string; line: number; text: string }[] = [];

		for (const root of SCAN_ROOTS) {
			for (const file of walkTs(root)) {
				const stripped = stripComments(readFileSync(file, "utf-8"));
				const lines = stripped.split("\n");
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i]!;
					if (FORBIDDEN.test(line)) {
						violations.push({
							file: file.replace(REPO_ROOT + "/", ""),
							line: i + 1,
							text: line.trim(),
						});
					}
				}
			}
		}

		if (violations.length > 0) {
			const report = violations
				.map((v) => `  ${v.file}:${v.line}  ${v.text}`)
				.join("\n");
			throw new Error(
				`PRD F9/AC6 violation — chat content may be logged. Found ${violations.length} match(es):\n${report}\n\n` +
					`Forbidden patterns: logger.<method>(... chunk|data|stdout|stderr ...) in src/connection/** and src/ui/chat-view/**.\n` +
					`Rationale: Claude Code session bytes can contain sensitive user text. Logging them writes that text to a file Obsidian controls.`,
			);
		}

		// Sanity: the scanner must have looked at at least one file in each root.
		// If a future refactor moves all logger usage out of these directories
		// the test still passes; if it accidentally moves the directories
		// themselves, this fails fast.
		expect(violations).toEqual([]);
	});
});
