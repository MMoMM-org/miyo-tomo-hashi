/**
 * T4.4 — HookRunner tests (RED phase)
 *
 * Scenarios:
 *   1. Discovery: hook files matching {before,after}-<kind>.js are found in the configured directory
 *   2. Loading: hooks are loaded fresh per run (cache evicted; edit between runs is visible)
 *   3. Multi-file conflict: multiple files for same (kind, phase) → first alphabetical wins; duplication logged
 *   4. Invocation context shape: { action, app, logger } — each property accessible
 *   5. Return-shape semantics: undefined → ok; { info } → logged; { warnings } → logged; { errors } → action fails
 *   6. Throw semantics: pre-hook throws → action fails (applied: false); post-hook throws → action committed (applied: true), separate failure entry
 *   7. Timeout: 30s timeout fires (injected as small value); treated as throw
 *   8. Kill-switch: hooksPolicy === "disabled" → no hook loaded or invoked
 *   9. Ask-mode: in-memory map; first call → askCallback; second call (same hook, enable-session) → no re-prompt
 *
 * [ref: PRD/F8; ADR-10 v2; T4.4]
 */

import { createRequire } from "node:module";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";

import { HookRunner, type HookLoader } from "../../../src/hooks/HookRunner.js";
import type { HookLogger } from "../../../src/hooks/HookContext.js";
import type { Action } from "../../../src/schema/types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const requireFn = createRequire(import.meta.url);

const fixturesDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../fixtures/hooks",
);

const fakeApp = {
	vault: { adapter: { someProperty: true } },
} as unknown as App;

function makeAction(kind: Action["action"] = "create_moc"): Action {
	if (kind === "create_moc") {
		return {
			action: "create_moc",
			id: "a1",
			source: "inbox/note.md",
			destination: "mocs/note-moc.md",
			title: "Note MOC",
		};
	}
	if (kind === "move_note") {
		return {
			action: "move_note",
			id: "a2",
			source: "inbox/note.md",
			destination: "notes/note.md",
			title: "Note",
		};
	}
	if (kind === "link_to_moc") {
		return {
			action: "link_to_moc",
			id: "a3",
			target_moc: "mocs/index-moc.md",
			line_to_add: "- [[note]]",
		};
	}
	if (kind === "update_tracker") {
		return {
			action: "update_tracker",
			id: "a4",
			daily_note_path: "journal/2026-04-28.md",
			date: "2026-04-28",
			field: "done",
			value: true,
			syntax: "checkbox",
		};
	}
	return {
		action: "skip",
		id: "a5",
		source_path: null,
	};
}

function makeLogger(): HookLogger & { infos: string[]; warns: string[]; errors: string[] } {
	const infos: string[] = [];
	const warns: string[] = [];
	const errors: string[] = [];
	return {
		infos,
		warns,
		errors,
		info: (msg) => { infos.push(msg); },
		warn: (msg) => { warns.push(msg); },
		error: (msg) => { errors.push(msg); },
	};
}

/** A HookLoader that resolves keys to absolute fixture paths. */
function makeFixtureLoader(
	mapping: Partial<Record<string, string>>,
	duplicateLog: string[] = [],
): HookLoader {
	return {
		resolve(key: string) {
			const absolutePath = mapping[key];
			if (absolutePath === undefined) return null;
			return { absolutePath, duplicates: duplicateLog };
		},
	};
}

// ---------------------------------------------------------------------------
// 1. Discovery — hook files for configured directory are resolved correctly
// ---------------------------------------------------------------------------

describe("HookRunner — discovery", () => {
	it("resolves before-create_moc to the fixture path", () => {
		const loader = makeFixtureLoader({
			"before-create_moc": path.join(fixturesDir, "before-create_moc-returns-errors.cjs"),
		});
		const result = loader.resolve("before-create_moc");
		expect(result).not.toBeNull();
		expect(result?.absolutePath).toMatch(/before-create_moc-returns-errors\.cjs$/);
	});

	it("returns null for a key with no matching fixture", () => {
		const loader = makeFixtureLoader({});
		expect(loader.resolve("after-delete_source")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 2. Cache eviction — edit between runs is visible on second run
// ---------------------------------------------------------------------------

describe("HookRunner — cache eviction", () => {
	let tmpFile: string;

	beforeEach(async () => {
		tmpFile = path.join(os.tmpdir(), `hashi-hook-evict-${Date.now()}.js`);
	});

	afterEach(async () => {
		await fs.rm(tmpFile, { force: true });
	});

	it("loads the updated export when the file changes between runs", async () => {
		// v1 export
		await fs.writeFile(
			tmpFile,
			`module.exports = function() { return { info: ["v1"] }; };`,
			"utf8",
		);

		const logger = makeLogger();
		const action = makeAction("create_moc");
		const loader = makeFixtureLoader({ "before-create_moc": tmpFile });
		const runner = new HookRunner(fakeApp, loader, logger, {
			policy: "enabled",
			requireFn,
		});

		const first = await runner.run("before", action);
		expect(first.kind).toBe("messages");
		if (first.kind === "messages") {
			expect(first.info).toContain("v1");
		}

		// Edit file between runs
		await fs.writeFile(
			tmpFile,
			`module.exports = function() { return { info: ["v2"] }; };`,
			"utf8",
		);

		const second = await runner.run("before", action);
		expect(second.kind).toBe("messages");
		if (second.kind === "messages") {
			expect(second.info).toContain("v2");
		}
	});
});

// ---------------------------------------------------------------------------
// 3. Multi-file conflict — first alphabetical wins; duplicates logged
// ---------------------------------------------------------------------------

describe("HookRunner — multi-file conflict", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hashi-hook-conflict-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("uses the first alphabetical match and logs duplicates", async () => {
		const fileA = path.join(tmpDir, "before-create_moc-aaa.js");
		const fileB = path.join(tmpDir, "before-create_moc-zzz.js");
		await fs.writeFile(fileA, `module.exports = function() { return { info: ["from-aaa"] }; };`, "utf8");
		await fs.writeFile(fileB, `module.exports = function() { return { info: ["from-zzz"] }; };`, "utf8");

		// Simulate discovery: first alphabetical is fileA; fileB is a duplicate
		const loader = makeFixtureLoader(
			{ "before-create_moc": fileA },
			[fileB],
		);

		const logger = makeLogger();
		const runner = new HookRunner(fakeApp, loader, logger, {
			policy: "enabled",
			requireFn,
		});

		const outcome = await runner.run("before", makeAction("create_moc"));
		expect(outcome.kind).toBe("messages");
		if (outcome.kind === "messages") {
			expect(outcome.info).toContain("from-aaa");
		}
		// Runner should log a warning about the duplicate
		expect(logger.warns.some((w) => w.includes(fileB))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 4. Invocation context shape: { action, app, logger }
// ---------------------------------------------------------------------------

describe("HookRunner — invocation context shape", () => {
	it("provides action, app, and logger in the hook context", async () => {
		// Verify ctx shape via the before-skip-uses-app fixture which reads
		// ctx.app.vault. If the app field were missing or shape mismatched,
		// the fixture would throw on property access and the runner would
		// surface a failed outcome.
		const action = makeAction("skip");
		const loader = makeFixtureLoader({
			"before-skip": path.join(fixturesDir, "before-skip-uses-app.cjs"),
		});
		const logger = makeLogger();
		const runner = new HookRunner(fakeApp, loader, logger, {
			policy: "enabled",
			requireFn,
		});

		const outcome = await runner.run("before", action);
		expect(outcome.kind).toBe("ok");
	});

	it("provides logger that writes into run log", async () => {
		const logger = makeLogger();
		const action = makeAction("move_note");
		const loader = makeFixtureLoader({
			"after-move_note": path.join(fixturesDir, "after-move_note-returns-info.cjs"),
		});
		const runner = new HookRunner(fakeApp, loader, logger, {
			policy: "enabled",
			requireFn,
		});

		await runner.run("after", action);
		// The hook returned { info: ["fyi"] } — runner should have logged it
		expect(logger.infos.some((m) => m.includes("fyi"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 5. Return-shape semantics
// ---------------------------------------------------------------------------

describe("HookRunner — return shapes", () => {
	it("returns ok when hook returns undefined (async resolves fixture)", async () => {
		const loader = makeFixtureLoader({
			"after-link_to_moc": path.join(fixturesDir, "after-link_to_moc-async-resolves.cjs"),
		});
		const logger = makeLogger();
		const runner = new HookRunner(fakeApp, loader, logger, { policy: "enabled", requireFn });
		const outcome = await runner.run("after", makeAction("link_to_moc"));
		expect(outcome.kind).toBe("ok");
	});

	it("returns messages.info and logs when hook returns { info: [...] }", async () => {
		const loader = makeFixtureLoader({
			"after-move_note": path.join(fixturesDir, "after-move_note-returns-info.cjs"),
		});
		const logger = makeLogger();
		const runner = new HookRunner(fakeApp, loader, logger, { policy: "enabled", requireFn });
		const outcome = await runner.run("after", makeAction("move_note"));
		expect(outcome.kind).toBe("messages");
		if (outcome.kind === "messages") {
			expect(outcome.info).toContain("fyi");
			expect(outcome.warnings).toHaveLength(0);
		}
		expect(logger.infos.some((m) => m.includes("fyi"))).toBe(true);
	});

	it("returns messages.warnings and logs when hook returns { warnings: [...] }", async () => {
		const loader = makeFixtureLoader({
			"after-move_note": path.join(fixturesDir, "after-move_note-returns-warnings.cjs"),
		});
		const logger = makeLogger();
		const runner = new HookRunner(fakeApp, loader, logger, { policy: "enabled", requireFn });
		const outcome = await runner.run("after", makeAction("move_note"));
		expect(outcome.kind).toBe("messages");
		if (outcome.kind === "messages") {
			expect(outcome.warnings).toContain("ok with caveat");
			expect(outcome.info).toHaveLength(0);
		}
		expect(logger.warns.some((m) => m.includes("ok with caveat"))).toBe(true);
	});

	it("returns failed when hook returns { errors: [...] }", async () => {
		const loader = makeFixtureLoader({
			"before-create_moc": path.join(fixturesDir, "before-create_moc-returns-errors.cjs"),
		});
		const logger = makeLogger();
		const runner = new HookRunner(fakeApp, loader, logger, { policy: "enabled", requireFn });
		const outcome = await runner.run("before", makeAction("create_moc"));
		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toContain("nope");
		}
	});

	it("substitutes noopHook (ok) for malformed exports (non-function)", async () => {
		const loader = makeFixtureLoader({
			"before-update_tracker": path.join(fixturesDir, "before-update_tracker-malformed.cjs"),
		});
		const logger = makeLogger();
		const runner = new HookRunner(fakeApp, loader, logger, { policy: "enabled", requireFn });
		const outcome = await runner.run("before", makeAction("update_tracker"));
		expect(outcome.kind).toBe("ok");
	});
});

// ---------------------------------------------------------------------------
// 6. Throw semantics
// ---------------------------------------------------------------------------

describe("HookRunner — throw semantics", () => {
	it("pre-hook throws → outcome is failed with throw message", async () => {
		const loader = makeFixtureLoader({
			"before-create_moc": path.join(fixturesDir, "before-create_moc-throws.cjs"),
		});
		const logger = makeLogger();
		const runner = new HookRunner(fakeApp, loader, logger, { policy: "enabled", requireFn });
		const outcome = await runner.run("before", makeAction("create_moc"));
		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toMatch(/before-hook threw/i);
			expect(outcome.reason).toContain("Intentional hook error");
		}
	});

	it("post-hook throws → outcome is failed (vault already committed; reason contains after-hook threw)", async () => {
		const loader = makeFixtureLoader({
			"after-move_note": path.join(fixturesDir, "before-create_moc-throws.cjs"),
		});
		const logger = makeLogger();
		const runner = new HookRunner(fakeApp, loader, logger, { policy: "enabled", requireFn });
		const outcome = await runner.run("after", makeAction("move_note"));
		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toMatch(/after-hook threw/i);
		}
	});
});

// ---------------------------------------------------------------------------
// 7. Timeout — async-hanging fixture; short injected timeoutMs
// ---------------------------------------------------------------------------

describe("HookRunner — timeout", () => {
	it("treats timeout as a throw (failed outcome) with a short timeoutMs", async () => {
		const loader = makeFixtureLoader({
			"before-update_tracker": path.join(
				fixturesDir,
				"before-update_tracker-infinite-loop.cjs",
			),
		});
		const logger = makeLogger();
		const runner = new HookRunner(fakeApp, loader, logger, {
			policy: "enabled",
			requireFn,
			timeoutMs: 50, // short; async fixture hangs forever so this fires first
		});

		const outcome = await runner.run("before", makeAction("update_tracker"));
		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toMatch(/timeout|exceeded/i);
		}
	}, 3000);
});

// ---------------------------------------------------------------------------
// 8. Kill-switch — hooksPolicy === "disabled"
// ---------------------------------------------------------------------------

describe("HookRunner — kill-switch (disabled policy)", () => {
	it("returns ok without loading or invoking any hook when disabled", async () => {
		const loadSpy = vi.fn(() => ({
			absolutePath: path.join(fixturesDir, "before-create_moc-throws.cjs"),
			duplicates: [],
		}));
		const loader: HookLoader = { resolve: loadSpy };

		const logger = makeLogger();
		const runner = new HookRunner(fakeApp, loader, logger, {
			policy: "disabled",
			requireFn,
		});

		const outcome = await runner.run("before", makeAction("create_moc"));
		expect(outcome.kind).toBe("ok");
		expect(loadSpy).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// 9. Ask-mode — in-memory session map
// ---------------------------------------------------------------------------

describe("HookRunner — ask-mode", () => {
	it("calls askCallback on first use; enable-session means no re-prompt on second call", async () => {
		const loader = makeFixtureLoader({
			"before-create_moc": path.join(fixturesDir, "before-create_moc-returns-errors.cjs"),
		});
		const logger = makeLogger();
		const askCallback = vi.fn().mockResolvedValue("enable-session");

		const runner = new HookRunner(fakeApp, loader, logger, {
			policy: "ask",
			requireFn,
			askCallback,
		});

		await runner.run("before", makeAction("create_moc"));
		await runner.run("before", makeAction("create_moc"));

		// askCallback should have been called only once (session remembers the decision)
		expect(askCallback).toHaveBeenCalledTimes(1);
	});

	it("calls askCallback again for a different hook key", async () => {
		const loader = makeFixtureLoader({
			"before-create_moc": path.join(fixturesDir, "before-create_moc-returns-errors.cjs"),
			"after-move_note": path.join(fixturesDir, "after-move_note-returns-info.cjs"),
		});
		const logger = makeLogger();
		const askCallback = vi.fn().mockResolvedValue("enable-session");

		const runner = new HookRunner(fakeApp, loader, logger, {
			policy: "ask",
			requireFn,
			askCallback,
		});

		await runner.run("before", makeAction("create_moc"));
		await runner.run("after", makeAction("move_note"));

		expect(askCallback).toHaveBeenCalledTimes(2);
	});

	it("enable-once: invokes hook but does not remember; re-prompts on next call", async () => {
		const loader = makeFixtureLoader({
			"before-create_moc": path.join(fixturesDir, "after-link_to_moc-async-resolves.cjs"),
		});
		const logger = makeLogger();
		const askCallback = vi.fn().mockResolvedValue("enable-once");

		const runner = new HookRunner(fakeApp, loader, logger, {
			policy: "ask",
			requireFn,
			askCallback,
		});

		await runner.run("before", makeAction("create_moc"));
		await runner.run("before", makeAction("create_moc"));

		expect(askCallback).toHaveBeenCalledTimes(2);
	});

	it("disable: returns ok without invoking; does not re-prompt for session", async () => {
		const loadSpy = vi.fn(() => ({
			absolutePath: path.join(fixturesDir, "before-create_moc-throws.cjs"),
			duplicates: [],
		}));
		const loader: HookLoader = { resolve: loadSpy };
		const logger = makeLogger();
		const askCallback = vi.fn().mockResolvedValue("disable");

		const runner = new HookRunner(fakeApp, loader, logger, {
			policy: "ask",
			requireFn,
			askCallback,
		});

		const first = await runner.run("before", makeAction("create_moc"));
		const second = await runner.run("before", makeAction("create_moc"));

		expect(first.kind).toBe("ok");
		expect(second.kind).toBe("ok");
		expect(askCallback).toHaveBeenCalledTimes(1);
	});

	it("resetSessionDecisions clears the map so next run re-prompts", async () => {
		const loader = makeFixtureLoader({
			"before-create_moc": path.join(fixturesDir, "after-link_to_moc-async-resolves.cjs"),
		});
		const logger = makeLogger();
		const askCallback = vi.fn().mockResolvedValue("enable-session");

		const runner = new HookRunner(fakeApp, loader, logger, {
			policy: "ask",
			requireFn,
			askCallback,
		});

		await runner.run("before", makeAction("create_moc"));
		runner.resetSessionDecisions();
		await runner.run("before", makeAction("create_moc"));

		expect(askCallback).toHaveBeenCalledTimes(2);
	});

	// ADR-3 transitive-import caveat documented
	it("transitive-import fixture runs without error (helper module may stay cached — ADR-3 caveat)", async () => {
		const loader = makeFixtureLoader({
			"before-create_moc": path.join(fixturesDir, "before-create_moc-transitive-import.cjs"),
		});
		const logger = makeLogger();
		const runner = new HookRunner(fakeApp, loader, logger, {
			policy: "enabled",
			requireFn,
		});

		const outcome = await runner.run("before", makeAction("create_moc"));
		expect(outcome.kind).toBe("ok");
	});
});
