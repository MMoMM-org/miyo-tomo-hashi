import { describe, expect, expectTypeOf, it } from "vitest";

import type {
	ActionKind,
	InstructionSet,
} from "../../../src/schema/types";
import type {
	ActionOutcome,
	ActionRecord,
	ExecutionMode,
	ResolvedSource,
	RunCounts,
	RunState,
} from "../../../src/executor/state";

// ---------------------------------------------------------------------------
// RunState — 6 variants
// ---------------------------------------------------------------------------

describe("RunState", () => {
	it("idle variant has kind 'idle' only", () => {
		const s: RunState = { kind: "idle" };
		expect(s.kind).toBe("idle");
	});

	it("preparing variant carries mode and sources", () => {
		const source: ResolvedSource = {
			fileId: "2026-04-28_instructions.json",
			sourcePath: "100 Inbox/2026-04-28_instructions.json",
			instructionSet: makeInstructionSet(),
		};
		const s: RunState = {
			kind: "preparing",
			mode: "confirm",
			sources: [source],
		};
		if (s.kind === "preparing") {
			const _mode: ExecutionMode = s.mode;
			const _sources: readonly ResolvedSource[] = s.sources;
			expect(_mode).toBe("confirm");
			expect(_sources).toHaveLength(1);
		}
	});

	it("previewing variant carries mode, records, remaining, total", () => {
		const records: readonly ActionRecord[] = [makeActionRecord("I01", "move_note")];
		const s: RunState = {
			kind: "previewing",
			mode: "auto-run",
			records,
			remaining: 1,
			total: 1,
		};
		if (s.kind === "previewing") {
			const _remaining: number = s.remaining;
			const _total: number = s.total;
			expect(_remaining).toBe(1);
			expect(_total).toBe(1);
		}
	});

	it("running variant carries mode, records, currentIndex", () => {
		const records: readonly ActionRecord[] = [makeActionRecord("I01", "move_note")];
		const s: RunState = {
			kind: "running",
			mode: "silent",
			records,
			currentIndex: 0,
		};
		if (s.kind === "running") {
			const _idx: number = s.currentIndex;
			expect(_idx).toBe(0);
		}
	});

	it("summary variant carries mode, records, counts, logFilePath", () => {
		const counts: RunCounts = {
			applied: 1,
			"skipped-already": 0,
			"skipped-dependency": 0,
			"skipped-cancelled": 0,
			failed: 0,
			pending: 0,
			durationMs: 42,
		};
		const s: RunState = {
			kind: "summary",
			mode: "confirm",
			records: [],
			counts,
			logFilePath: "run-log/2026-04-28.md",
		};
		if (s.kind === "summary") {
			const _path: string | null = s.logFilePath;
			expect(_path).toBe("run-log/2026-04-28.md");
		}
	});

	it("summary variant accepts null logFilePath", () => {
		const s: RunState = {
			kind: "summary",
			mode: "confirm",
			records: [],
			counts: makeRunCounts(),
			logFilePath: null,
		};
		if (s.kind === "summary") {
			expect(s.logFilePath).toBeNull();
		}
	});

	it("validation-failed variant carries mode and perFileFailures map", () => {
		const failures: ReadonlyMap<string, string> = new Map([
			["2026-04-28_instructions.json", "schema_version mismatch"],
		]);
		const s: RunState = {
			kind: "validation-failed",
			mode: "confirm",
			perFileFailures: failures,
		};
		if (s.kind === "validation-failed") {
			const _map: ReadonlyMap<string, string> = s.perFileFailures;
			expect(_map.size).toBe(1);
		}
	});

	it("exhaustive switch over all 6 RunState variants compiles", () => {
		function describeState(s: RunState): string {
			switch (s.kind) {
				case "idle":
					return "idle";
				case "preparing":
					return `preparing:${s.mode}`;
				case "previewing":
					return `previewing:${s.remaining}/${s.total}`;
				case "running":
					return `running:${s.currentIndex}`;
				case "summary":
					return `summary:${s.logFilePath ?? "no-log"}`;
				case "validation-failed":
					return `validation-failed:${s.perFileFailures.size}`;
				default: {
					const _exhaustive: never = s;
					return _exhaustive;
				}
			}
		}
		const s: RunState = { kind: "idle" };
		expect(describeState(s)).toBe("idle");
	});
});

// ---------------------------------------------------------------------------
// ActionOutcome — 5 variants
// ---------------------------------------------------------------------------

describe("ActionOutcome", () => {
	it("applied variant", () => {
		const o: ActionOutcome = { kind: "applied" };
		expect(o.kind).toBe("applied");
	});

	it("skipped-already variant", () => {
		const o: ActionOutcome = { kind: "skipped-already" };
		expect(o.kind).toBe("skipped-already");
	});

	it("skipped-dependency variant carries dependsOn", () => {
		const o: ActionOutcome = { kind: "skipped-dependency", dependsOn: "I01" };
		if (o.kind === "skipped-dependency") {
			const _dep: string = o.dependsOn;
			expect(_dep).toBe("I01");
		}
	});

	it("skipped-cancelled variant", () => {
		const o: ActionOutcome = { kind: "skipped-cancelled" };
		expect(o.kind).toBe("skipped-cancelled");
	});

	it("failed variant carries reason", () => {
		const o: ActionOutcome = { kind: "failed", reason: "file not found" };
		if (o.kind === "failed") {
			const _reason: string = o.reason;
			expect(_reason).toBe("file not found");
		}
	});

	it("exhaustive switch over all 5 ActionOutcome variants compiles", () => {
		function describeOutcome(o: ActionOutcome): string {
			switch (o.kind) {
				case "applied":
					return "applied";
				case "skipped-already":
					return "skipped-already";
				case "skipped-dependency":
					return `skipped-dependency:${o.dependsOn}`;
				case "skipped-cancelled":
					return "skipped-cancelled";
				case "failed":
					return `failed:${o.reason}`;
				default: {
					const _exhaustive: never = o;
					return _exhaustive;
				}
			}
		}
		expect(describeOutcome({ kind: "applied" })).toBe("applied");
		expect(describeOutcome({ kind: "failed", reason: "err" })).toBe("failed:err");
	});
});

// ---------------------------------------------------------------------------
// ActionRecord
// ---------------------------------------------------------------------------

describe("ActionRecord", () => {
	it("has fileId, id, kind, summary as readonly strings; outcome is ActionOutcome | null", () => {
		const rec: ActionRecord = makeActionRecord("I01", "move_note");
		expect(rec.fileId).toBe("test.json");
		expect(rec.id).toBe("I01");
		expect(rec.kind).toBe("move_note");
		expect(rec.summary).toBe("move_note test");
		expect(rec.outcome).toBeNull();
	});

	it("outcome can be set to an ActionOutcome (mutable field)", () => {
		const rec: ActionRecord = makeActionRecord("I01", "move_note");
		rec.outcome = { kind: "applied" };
		expect(rec.outcome).toEqual({ kind: "applied" });
	});

	it("kind field is typed as ActionKind", () => {
		const rec: ActionRecord = makeActionRecord("I01", "create_moc");
		expectTypeOf(rec.kind).toEqualTypeOf<ActionKind>();
	});
});

// ---------------------------------------------------------------------------
// RunCounts
// ---------------------------------------------------------------------------

describe("RunCounts", () => {
	it("includes all ActionOutcome kinds plus pending and durationMs", () => {
		const counts: RunCounts = {
			applied: 3,
			"skipped-already": 1,
			"skipped-dependency": 0,
			"skipped-cancelled": 2,
			failed: 0,
			pending: 0,
			durationMs: 1234,
		};
		expect(counts.applied).toBe(3);
		expect(counts["skipped-already"]).toBe(1);
		expect(counts.durationMs).toBe(1234);
	});

	it("RunCounts keys include all ActionOutcome kind values plus 'pending'", () => {
		// Type-level: RunCounts must have a key for each outcome kind + pending
		expectTypeOf<RunCounts["applied"]>().toEqualTypeOf<number>();
		expectTypeOf<RunCounts["skipped-already"]>().toEqualTypeOf<number>();
		expectTypeOf<RunCounts["skipped-dependency"]>().toEqualTypeOf<number>();
		expectTypeOf<RunCounts["skipped-cancelled"]>().toEqualTypeOf<number>();
		expectTypeOf<RunCounts["failed"]>().toEqualTypeOf<number>();
		expectTypeOf<RunCounts["pending"]>().toEqualTypeOf<number>();
		expectTypeOf<RunCounts["durationMs"]>().toEqualTypeOf<number>();
	});
});

// ---------------------------------------------------------------------------
// ExecutionMode
// ---------------------------------------------------------------------------

describe("ExecutionMode", () => {
	it("is the 3-literal union confirm | auto-run | silent", () => {
		expectTypeOf<ExecutionMode>().toEqualTypeOf<"confirm" | "auto-run" | "silent">();
	});
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInstructionSet(): InstructionSet {
	return {
		schema_version: "1",
		type: "tomo-instructions",
		generated: "2026-04-28T00:00:00Z",
		profile: null,
		actions: [],
	};
}

function makeActionRecord(id: string, kind: ActionKind): ActionRecord {
	return {
		fileId: "test.json",
		id,
		kind,
		summary: `${kind} test`,
		outcome: null,
	};
}

function makeRunCounts(): RunCounts {
	return {
		applied: 0,
		"skipped-already": 0,
		"skipped-dependency": 0,
		"skipped-cancelled": 0,
		failed: 0,
		pending: 0,
		durationMs: 0,
	};
}
