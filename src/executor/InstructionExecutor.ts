/**
 * InstructionExecutor — orchestrator that drives the full run lifecycle.
 *
 * Wires every Phase 1–4 collaborator: Planner, JsonAppliedWriter,
 * PeerCheckboxSync, RunLogWriter, HookRunner, HANDLERS dispatch, and
 * executionStore state transitions.
 *
 * Algorithm (SDD §Complex Logic):
 *   1. Acquire single-run lock atomically — reject if already held.
 *   2. Resolve sources via Planner.
 *   3. Validate each source. Build per-file failure map.
 *   4. Compute remaining records (canonical order, applied filter).
 *   5. Set store: preparing → previewing/running.
 *   6. If mode == confirm: await proceed() (or cancel → summary-all-skipped).
 *   7. Create empty run log file.
 *   8. For each record: cancel-check → dependency-check → before-hook →
 *      handler → after-hook → mark applied → tick peer → append log.
 *   9. Finalize run log per retention policy.
 *  10. Set store → summary.
 *  11. Fire run-end Notice.
 *  12. Release lock.
 *  13. Return counts.
 *
 * No import 'obsidian' — notify is injected.
 *
 * [ref: PRD/F1, F3, F4, F5, F6, F7, F8; SDD/InstructionExecutor Service Surface]
 */

import type { VaultFS } from "../vault/VaultFS.js";
import type { Action } from "../schema/types.js";
import type {
	ActionRecord,
	ActionOutcome,
	Clock,
	ExecutionMode,
	RunCounts,
	RunState,
	ValidationOutcome,
} from "./state.js";
import type { PluginSettings } from "../types/index.js";
import type { HookOutcome } from "../hooks/HookRunner.js";
import { Store } from "../util/store.js";
import { executionStore } from "./executionStore.js";
import {
	resolveSingle,
	resolveBatch,
	computeRemaining,
	type DependencyEdge,
} from "./planner.js";
import { markActionApplied } from "./jsonAppliedWriter.js";
import { tickPeerCheckbox } from "./peerCheckboxSync.js";
import { RunLogWriter } from "./runLog.js";
import { HANDLERS } from "../actions/index.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Invocation =
	| { kind: "single-file"; sourcePath: string }
	| { kind: "batch" };

export interface InstructionExecutorDeps {
	readonly vault: VaultFS;
	readonly validator: { validate(raw: unknown): ValidationOutcome };
	readonly hookRunner: { run(phase: "before" | "after", action: Action): Promise<HookOutcome> };
	readonly settings: PluginSettings;
	readonly clock: Clock;
	readonly store?: Store<RunState>;
	readonly notify?: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// InstructionExecutor
// ---------------------------------------------------------------------------

export class InstructionExecutor {
	private readonly vault: VaultFS;
	private readonly validator: { validate(raw: unknown): ValidationOutcome };
	private readonly hookRunner: { run(phase: "before" | "after", action: Action): Promise<HookOutcome> };
	private readonly settings: PluginSettings;
	private readonly clock: Clock;
	readonly state: Store<RunState>;
	private readonly notify: (msg: string) => void;

	private running = false;
	private cancelled = false;
	private proceedResolve: (() => void) | null = null;

	constructor(deps: InstructionExecutorDeps) {
		this.vault = deps.vault;
		this.validator = deps.validator;
		this.hookRunner = deps.hookRunner;
		this.settings = deps.settings;
		this.clock = deps.clock;
		this.state = deps.store ?? executionStore;
		this.notify = deps.notify ?? (() => { /* no-op in prod when not injected */ });
	}

	cancel(): void {
		this.cancelled = true;
		// If waiting at the proceed gate, also cancel through it
		if (this.proceedResolve) {
			this.proceedResolve();
			this.proceedResolve = null;
		}
	}

	proceed(): void {
		if (this.proceedResolve) {
			this.proceedResolve();
			this.proceedResolve = null;
		}
	}

	async execute(invocation: Invocation): Promise<RunCounts> {
		// Step 1: acquire single-run lock atomically
		if (this.running) {
			this.notify("Execution already in progress");
			return buildCounts({}, 0);
		}
		this.running = true;
		this.cancelled = false;

		const startedAt = this.clock.now();
		const mode: ExecutionMode = this.settings.executionMode;

		try {
			return await this.run(invocation, startedAt, mode);
		} finally {
			this.running = false;
		}
	}

	private async run(
		invocation: Invocation,
		startedAt: Date,
		mode: ExecutionMode,
	): Promise<RunCounts> {
		const { vault, settings } = this;

		// Step 2: resolve sources
		const sourcePaths = await this.resolveSources(invocation);

		// Step 3: validate each source, build per-file failure map
		const validSources: Array<{ fileId: string; sourcePath: string; set: unknown }> = [];
		const perFileFailures = new Map<string, string>();

		for (const sourcePath of sourcePaths) {
			const raw = await vault.readJSON(sourcePath);
			const outcome = this.validator.validate(raw);
			if (outcome.ok) {
				validSources.push({
					fileId: sourcePath,
					sourcePath,
					set: outcome.data,
				});
			} else {
				perFileFailures.set(sourcePath, outcome.message);
			}
		}

		// All files failed validation
		if (sourcePaths.length > 0 && validSources.length === 0) {
			this.state.set({
				kind: "preparing",
				mode,
				sources: [],
			});
			this.state.set({
				kind: "validation-failed",
				mode,
				perFileFailures,
			});
			// Silent mode has no modal to drive close → return to idle for next run.
			// Confirm/auto-run keep the validation-failed state until the modal's
			// Close handler signals idle (otherwise the modal blanks).
			if (mode === "silent") {
				this.state.set({ kind: "idle" });
			}
			return buildCounts({}, 0);
		}

		// Build ResolvedSource array
		const resolvedSources = validSources.map((s) => ({
			fileId: s.fileId,
			sourcePath: s.sourcePath,
			instructionSet: s.set as import("../schema/types.js").InstructionSet,
		}));

		// Build action lookup map: (fileId, actionId) → Action
		const actionLookup = buildActionLookup(resolvedSources);

		// Step 4: compute remaining records + dependency graph
		// Cast to mutable array — ActionRecord.outcome is intentionally mutable per state.ts
		const { records: readonlyRecords, dependencies } = computeRemaining(resolvedSources);
		const records = readonlyRecords as ActionRecord[];

		// Step 5: set store → preparing → previewing/running
		this.state.set({
			kind: "preparing",
			mode,
			sources: resolvedSources,
		});

		if (mode === "confirm" || mode === "auto-run") {
			this.state.set({
				kind: "previewing",
				mode,
				records,
				remaining: records.length,
				total: records.length,
			});
		}

		// Step 6: if confirm mode, await proceed() or cancel
		if (mode === "confirm") {
			await this.awaitProceed();

			if (this.cancelled) {
				// User cancelled at preview — mark all skipped-cancelled
				for (const record of records) {
					record.outcome = { kind: "skipped-cancelled" };
				}
				const endedAt = this.clock.now();
				const counts = tallyCounts(records, startedAt, endedAt);
				this.state.set({
					kind: "summary",
					mode,
					records,
					counts,
					logFilePath: null,
				});
				// Cancel-during-preview can only happen in confirm mode (modal open),
				// so the summary view stays visible until the modal's Close handler
				// drives idle. No auto-idle here.
				return counts;
			}
		}

		this.state.set({
			kind: "running",
			mode,
			records,
			currentIndex: 0,
		});

		// Step 7: create run log
		const logWriter = new RunLogWriter(vault);
		const logPath = await logWriter.start({
			inboxFolder: settings.tomoInboxFolder,
			startedAt,
			mode,
			sources: resolvedSources.map((s) => s.sourcePath),
		});

		// Append validation failures to log
		for (const [fileId, message] of perFileFailures) {
			logWriter.appendValidationFailure({ fileId, message });
		}

		// Step 8: execute each record
		const failedIds = new Set<string>();

		for (let i = 0; i < records.length; i++) {
			const record = records[i] as ActionRecord;

			// Update running index
			this.state.set({
				kind: "running",
				mode,
				records,
				currentIndex: i,
			});

			// Step 8a: cancellation check
			if (this.cancelled) {
				for (let j = i; j < records.length; j++) {
					const remaining = records[j] as ActionRecord;
					remaining.outcome = { kind: "skipped-cancelled" };
					logWriter.appendRecord(remaining);
				}
				break;
			}

			// Step 8b: dependency check
			const depFailure = findDependencyFailure(record, dependencies, failedIds);
			if (depFailure !== null) {
				record.outcome = { kind: "skipped-dependency", dependsOn: depFailure };
				logWriter.appendRecord(record);
				continue;
			}

			// Look up the actual Action object for handler dispatch + hooks
			const action = actionLookup.get(`${record.fileId}::${record.id}`);
			if (action === undefined) {
				record.outcome = { kind: "failed", reason: `Action ${record.id} not found in source` };
				failedIds.add(record.id);
				logWriter.appendRecord(record);
				continue;
			}

			// Step 8c: before-hook
			const beforeOutcome = await this.hookRunner.run("before", action);
			if (beforeOutcome.kind === "failed") {
				record.outcome = { kind: "failed", reason: beforeOutcome.reason };
				failedIds.add(record.id);
				logWriter.appendRecord(record);
				continue;
			}

			// Step 8d: dispatch handler
			const handler = HANDLERS[record.kind] as (
				action: Action,
				ctx: { vault: VaultFS; clock: Clock },
			) => Promise<Extract<ActionOutcome, { kind: "applied" | "skipped-already" | "failed" }>>;

			const handlerOutcome = await handler(action, { vault, clock: this.clock });
			record.outcome = handlerOutcome;

			if (handlerOutcome.kind === "failed") {
				failedIds.add(record.id);
			}

			// Step 8e: after-hook (runs regardless of handler outcome)
			const afterOutcome = await this.hookRunner.run("after", action);

			if (handlerOutcome.kind !== "failed") {
				// Step 8f: write applied:true to source JSON
				if (handlerOutcome.kind === "applied") {
					await markActionApplied(vault, record.fileId, record.id);
					// Step 8g: best-effort tick peer .md
					await tickPeerCheckbox(vault, record.fileId, record.id);
				}
			}

			// Step 8e (continued): after-hook failure does NOT change action outcome,
			// but we record it as a separate log entry
			if (afterOutcome.kind === "failed") {
				logWriter.appendRecord(record);
				// Append a pseudo-record capturing the hook failure
				const hookFailRecord: ActionRecord = {
					fileId: record.fileId,
					id: `${record.id}-after-hook`,
					kind: record.kind,
					summary: `after-hook failure for ${record.id}`,
					outcome: { kind: "failed", reason: afterOutcome.reason },
				};
				logWriter.appendRecord(hookFailRecord);
			} else {
				// Step 8h: append record outcome to run log
				logWriter.appendRecord(record);
			}
		}

		// Step 9: finalize run log per retention policy
		const endedAt = this.clock.now();
		await logWriter.finalize(endedAt, settings.runLogRetention);

		// Determine final log path (may have been trashed)
		const finalLogPath = settings.runLogRetention === "always" ? logPath : null;
		const counts = tallyCounts(records, startedAt, endedAt);

		// Step 10: set store → summary
		this.state.set({
			kind: "summary",
			mode,
			records,
			counts,
			logFilePath: finalLogPath,
		});
		// Confirm/auto-run keep summary visible until modal close drives idle
		// (otherwise the subscribed modal re-renders blank — the empty-modal
		// regression of 2026-04-30). Silent mode has no modal — auto-idle.
		if (mode === "silent") {
			this.state.set({ kind: "idle" });
		}

		// Step 11: fire run-end Notice
		this.notify(`Hashi run complete — ${counts.applied} applied, ${counts.failed} failed`);

		// Steps 12 & 13 handled by execute() finally block
		return counts;
	}

	private async resolveSources(invocation: Invocation): Promise<string[]> {
		if (invocation.kind === "single-file") {
			const resolved = await resolveSingle(this.vault, invocation.sourcePath);
			if (resolved === null) return [invocation.sourcePath];
			return [resolved];
		}
		return resolveBatch(this.vault, this.settings.tomoInboxFolder);
	}

	private awaitProceed(): Promise<void> {
		return new Promise<void>((resolve) => {
			this.proceedResolve = resolve;
		});
	}
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function buildActionLookup(
	sources: readonly { fileId: string; instructionSet: { actions: readonly Action[] } }[],
): Map<string, Action> {
	const map = new Map<string, Action>();
	for (const source of sources) {
		for (const action of source.instructionSet.actions) {
			map.set(`${source.fileId}::${action.id}`, action);
		}
	}
	return map;
}

function findDependencyFailure(
	record: ActionRecord,
	dependencies: readonly DependencyEdge[],
	failedIds: ReadonlySet<string>,
): string | null {
	for (const edge of dependencies) {
		if (edge.dependent === record.id && failedIds.has(edge.dependsOn)) {
			return edge.dependsOn;
		}
	}
	return null;
}

function tallyCounts(
	records: readonly ActionRecord[],
	startedAt: Date,
	endedAt: Date,
): RunCounts {
	const tally: Record<string, number> = {
		applied: 0,
		"skipped-already": 0,
		"skipped-dependency": 0,
		"skipped-cancelled": 0,
		failed: 0,
		pending: 0,
	};

	for (const record of records) {
		if (record.outcome === null) {
			tally["pending"] = (tally["pending"] ?? 0) + 1;
		} else {
			tally[record.outcome.kind] = (tally[record.outcome.kind] ?? 0) + 1;
		}
	}

	return {
		applied: tally["applied"] ?? 0,
		"skipped-already": tally["skipped-already"] ?? 0,
		"skipped-dependency": tally["skipped-dependency"] ?? 0,
		"skipped-cancelled": tally["skipped-cancelled"] ?? 0,
		failed: tally["failed"] ?? 0,
		pending: tally["pending"] ?? 0,
		durationMs: endedAt.getTime() - startedAt.getTime(),
	};
}

function buildCounts(
	partial: Partial<RunCounts>,
	durationMs: number,
): RunCounts {
	return {
		applied: partial.applied ?? 0,
		"skipped-already": partial["skipped-already"] ?? 0,
		"skipped-dependency": partial["skipped-dependency"] ?? 0,
		"skipped-cancelled": partial["skipped-cancelled"] ?? 0,
		failed: partial.failed ?? 0,
		pending: partial.pending ?? 0,
		durationMs,
	};
}
