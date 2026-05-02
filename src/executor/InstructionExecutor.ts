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
import { markActionsApplied } from "./jsonAppliedWriter.js";
import { tickPeerCheckbox } from "./peerCheckboxSync.js";
import { RunLogWriter } from "./runLog.js";
import { HANDLERS, type Handler } from "../actions/index.js";

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
	/**
	 * Plugin settings — either a snapshot or a getter function.
	 *
	 * Pass a getter when the consumer reassigns its settings object on
	 * persist (this is what main.ts does). With a snapshot, the executor
	 * holds a frozen reference and silently uses stale values across
	 * in-session changes (review M4).
	 */
	readonly settings: PluginSettings | (() => PluginSettings);
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
	private readonly settingsRef: () => PluginSettings;
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
		this.settingsRef =
			typeof deps.settings === "function"
				? deps.settings
				: () => deps.settings as PluginSettings;
		this.clock = deps.clock;
		this.state = deps.store ?? executionStore;
		this.notify = deps.notify ?? (() => { /* no-op in prod when not injected */ });
	}

	// Reads through the registered accessor so consumers passing a getter
	// see live changes (review M4). Safe to call at any time during run().
	private get settings(): PluginSettings {
		return this.settingsRef();
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
		// `vault` is a stable construction-time reference. `settings` is read
		// through `this.settings` on every site below — destructuring it would
		// snapshot the object and defeat the live-getter introduced by M4
		// (review round 2 / M1).
		const { vault } = this;

		// Step 2: resolve sources
		const sourcePaths = await this.resolveSources(invocation);

		// Step 3: validate each source (M17: extracted from run()'s body
		// for readability — single-purpose helper, no behavior change).
		const { validSources, perFileFailures } = await this.validateAllSources(
			sourcePaths,
		);

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
		// M6: index dependencies once (O(E)) so findDependencyFailure does
		// O(d_record) lookup per record instead of O(E) scan. Pre-fix was
		// O(N*E); now O(N+E).
		const depMap = buildDepMap(dependencies);

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
			inboxFolder: this.settings.tomoInboxFolder,
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
		// H5: accumulate applied ids per source so we can flush all writes
		// in one processJSON call after the loop, instead of N per source.
		const appliedByFile = new Map<string, string[]>();

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
			const depFailure = findDependencyFailure(record, depMap, failedIds);
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
			// L11: collect any "messages" outcomes from before-hook so the
			// run log surfaces info/warnings (pre-fix only console).
			const beforeNote =
				beforeOutcome.kind === "messages"
					? formatHookMessages("before", beforeOutcome)
					: undefined;

			// Step 8d: dispatch handler. All handlers share the same broad
			// outcome union (review L4), so the registry indexing widens
			// cleanly to a single Action input — no narrowing cast needed.
			const handler = HANDLERS[record.kind] as Handler<Action>;
			const handlerOutcome = await handler(action, { vault, clock: this.clock });
			record.outcome = handlerOutcome;

			if (handlerOutcome.kind === "failed") {
				failedIds.add(record.id);
			}

			// Step 8e: after-hook (runs regardless of handler outcome)
			const afterOutcome = await this.hookRunner.run("after", action);

			if (handlerOutcome.kind !== "failed") {
				// Step 8f: queue applied:true write (flushed in one batch
				// after the loop — review H5). Peer-checkbox sync also
				// deferred to post-loop (review round 2 / M3): pre-fix
				// peer .md was ticked here, BEFORE the source JSON's
				// applied flag was written. A crash between the tick and
				// the post-loop flush left peer .md showing `[x] Applied`
				// while source JSON still had `applied: false` — the
				// next run re-enqueued the action while the user saw it
				// as done. Now: source JSON wins; peer ticks fire only
				// after their corresponding markActionsApplied succeeds.
				if (handlerOutcome.kind === "applied") {
					const list = appliedByFile.get(record.fileId) ?? [];
					list.push(record.id);
					appliedByFile.set(record.fileId, list);
				}
			}

			// Step 8e (continued): after-hook failure does NOT change action
			// outcome — the vault commit already happened. The failure is
			// attached to the same row's error column (review M18) instead
			// of being synthesized as a `${id}-after-hook` pseudo-record.
			const afterNote =
				afterOutcome.kind === "messages"
					? formatHookMessages("after", afterOutcome)
					: undefined;
			const combinedNote = [beforeNote, afterNote]
				.filter((n): n is string => n !== undefined)
				.join("; ");
			const opts: {
				afterHookFailure?: { reason: string };
				hookNote?: string;
			} = {};
			if (afterOutcome.kind === "failed") {
				opts.afterHookFailure = { reason: afterOutcome.reason };
			}
			if (combinedNote !== "") {
				opts.hookNote = combinedNote;
			}
			logWriter.appendRecord(record, opts);
		}

		// Step 8.5 (H5 + M3): flush batched applied-flag writes — one
		// processJSON call per source, regardless of how many actions in
		// that source were applied. Peer .md checkboxes are ticked AFTER
		// the JSON write succeeds, preserving the "source JSON is the
		// truth, peer .md mirrors it" invariant. If markActionsApplied
		// throws, peer ticks for that file are skipped (the throw
		// propagates and aborts the run); peer .md being slightly stale
		// is recoverable, peer .md being ahead of truth is not.
		for (const [fileId, ids] of appliedByFile) {
			await markActionsApplied(vault, fileId, ids);
			for (const id of ids) {
				await tickPeerCheckbox(vault, fileId, id);
			}
		}

		// Step 9: finalize run log per retention policy
		const endedAt = this.clock.now();
		await logWriter.finalize(endedAt, this.settings.runLogRetention);

		// Determine final log path (may have been trashed)
		const finalLogPath = this.settings.runLogRetention === "always" ? logPath : null;
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

	/**
	 * Read each sourcePath, JSON-parse it, run schema validation, and
	 * partition into valid sources vs per-file failures (review M17 +
	 * H3). Single-purpose helper extracted from run() to keep the
	 * orchestrator method below the file-size ceiling.
	 */
	private async validateAllSources(
		sourcePaths: readonly string[],
	): Promise<{
		validSources: Array<{ fileId: string; sourcePath: string; set: unknown }>;
		perFileFailures: Map<string, string>;
	}> {
		const validSources: Array<{
			fileId: string;
			sourcePath: string;
			set: unknown;
		}> = [];
		const perFileFailures = new Map<string, string>();

		for (const sourcePath of sourcePaths) {
			let raw: unknown;
			try {
				raw = await this.vault.readJSON(sourcePath);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				perFileFailures.set(sourcePath, `read failed: ${message}`);
				continue;
			}
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

		return { validSources, perFileFailures };
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

function formatHookMessages(
	phase: "before" | "after",
	outcome: { kind: "messages"; info: string[]; warnings: string[] },
): string {
	const parts: string[] = [];
	if (outcome.warnings.length > 0) {
		parts.push(`${phase}-warn: ${outcome.warnings.join(" | ")}`);
	}
	if (outcome.info.length > 0) {
		parts.push(`${phase}-info: ${outcome.info.join(" | ")}`);
	}
	return parts.join("; ");
}

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

function buildDepMap(
	dependencies: readonly DependencyEdge[],
): ReadonlyMap<string, ReadonlyArray<string>> {
	const map = new Map<string, string[]>();
	for (const edge of dependencies) {
		const list = map.get(edge.dependent) ?? [];
		list.push(edge.dependsOn);
		map.set(edge.dependent, list);
	}
	return map;
}

function findDependencyFailure(
	record: ActionRecord,
	depMap: ReadonlyMap<string, ReadonlyArray<string>>,
	failedIds: ReadonlySet<string>,
): string | null {
	const dependsOnIds = depMap.get(record.id);
	if (dependsOnIds === undefined) return null;
	for (const dependsOn of dependsOnIds) {
		if (failedIds.has(dependsOn)) return dependsOn;
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
