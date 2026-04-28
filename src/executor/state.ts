/**
 * Executor runtime state types.
 *
 * RunState models the executor state machine (idle → preparing → previewing →
 * running → summary | validation-failed). All variants are discriminated by
 * `kind` for exhaustive handling.
 *
 * References: SDD "Application Data Models" section.
 */

import type { ActionKind, InstructionSet } from "../schema/types";

// Re-export for consumers that import from this module.
export type { ActionKind };

// ---------------------------------------------------------------------------
// ExecutionMode
// ---------------------------------------------------------------------------

export type ExecutionMode = "confirm" | "auto-run" | "silent";

// ---------------------------------------------------------------------------
// ActionOutcome — 5 variants, discriminated by `kind`
// ---------------------------------------------------------------------------

export type ActionOutcome =
	| { readonly kind: "applied" }
	| { readonly kind: "skipped-already" }
	| { readonly kind: "skipped-dependency"; readonly dependsOn: string }
	| { readonly kind: "skipped-cancelled" }
	| { readonly kind: "failed"; readonly reason: string };

// ---------------------------------------------------------------------------
// ActionRecord — executor-internal row (wraps an Action from InstructionSet)
// ---------------------------------------------------------------------------

export interface ActionRecord {
	readonly fileId: string;
	readonly id: string;
	readonly kind: ActionKind;
	readonly summary: string;
	outcome: ActionOutcome | null;
}

// ---------------------------------------------------------------------------
// RunCounts — tallied per-outcome counts plus elapsed duration
// ---------------------------------------------------------------------------

export type RunCounts = Record<ActionOutcome["kind"] | "pending", number> & {
	readonly durationMs: number;
};

// ---------------------------------------------------------------------------
// ResolvedSource — a validated _instructions.json file ready for execution
// ---------------------------------------------------------------------------

export interface ResolvedSource {
	readonly fileId: string;
	readonly sourcePath: string;
	readonly instructionSet: InstructionSet;
}

// ---------------------------------------------------------------------------
// ValidationOutcome — returned by the schema validator (Phase 2)
// ---------------------------------------------------------------------------

export type ValidationOutcome =
	| { readonly ok: true; readonly data: InstructionSet }
	| { readonly ok: false; readonly message: string };

// ---------------------------------------------------------------------------
// RunState — 6-variant discriminated union
// ---------------------------------------------------------------------------

export type RunState =
	| { readonly kind: "idle" }
	| {
			readonly kind: "preparing";
			readonly mode: ExecutionMode;
			readonly sources: ResolvedSource[];
	  }
	| {
			readonly kind: "previewing";
			readonly mode: ExecutionMode;
			readonly records: readonly ActionRecord[];
			readonly remaining: number;
			readonly total: number;
	  }
	| {
			readonly kind: "running";
			readonly mode: ExecutionMode;
			readonly records: readonly ActionRecord[];
			readonly currentIndex: number;
	  }
	| {
			readonly kind: "summary";
			readonly mode: ExecutionMode;
			readonly records: readonly ActionRecord[];
			readonly counts: RunCounts;
			readonly logFilePath: string | null;
	  }
	| {
			readonly kind: "validation-failed";
			readonly mode: ExecutionMode;
			readonly perFileFailures: ReadonlyMap<string, string>;
	  };

// ---------------------------------------------------------------------------
// Clock — injectable time source (for testability)
// ---------------------------------------------------------------------------

export interface Clock {
	now(): Date;
}

// ---------------------------------------------------------------------------
// Readable<T> — read-only Store<T> subset
// ---------------------------------------------------------------------------

export type Readable<T> = import("../util/store").Store<T>;
