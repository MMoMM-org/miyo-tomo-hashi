/**
 * executionStore — module-level singleton RunState store + derived selectors.
 *
 * One execution per plugin instance — the singleton is the shared coordination
 * point between InstructionExecutor and any UI surface that subscribes.
 *
 * [ref: PRD/F1; SDD/InstructionExecutor Service Surface; T4.5]
 */

import { Store } from "../util/store.js";
import type { RunState } from "./state.js";

/** Module-level singleton — one execution per plugin instance. */
export const executionStore = new Store<RunState>({ kind: "idle" });

/** Derived selector: kind only. */
export function selectKind(state: RunState): RunState["kind"] {
	return state.kind;
}

/** Derived selector: progress for status bar / modal. Returns null when not running. */
export function selectProgress(
	state: RunState,
): { current: number; total: number } | null {
	if (state.kind !== "running") return null;
	return { current: state.currentIndex, total: state.records.length };
}
