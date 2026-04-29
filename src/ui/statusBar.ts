/**
 * Status bar 橋 — color-state indicator for the instruction executor.
 *
 * Registers an `addStatusBarItem` rendering the 橋 kanji with three
 * mutually-exclusive state classes (`is-idle` / `is-running` / `is-error`)
 * driven by `executionStore`. Per ADR-6 (revised 2026-04-25) the indicator
 * uses color states only — no animation, no `prefers-reduced-motion`
 * branch.
 *
 * State derivation:
 *   - `idle` / `preparing` / `previewing`               → `is-idle`
 *   - `running`                                         → `is-running`
 *   - `summary` with ≥ 1 failure                        → `is-error` for
 *     ~10 seconds, then auto-returns to `is-idle`
 *   - `summary` with 0 failures                         → `is-idle`
 *   - `validation-failed` with ≥ 1 per-file failure     → `is-error` (same
 *     auto-return window)
 *
 * Click semantics:
 *   - while `is-running` → invoke `onActiveModalFocus` callback (one-click
 *     "where's my modal" shortcut, per PRD F10).
 *   - while `is-idle` or `is-error` → no-op.
 *
 * ARIA: root carries `role="status"` + `aria-live="polite"`; on every
 * state change a brief text node ("Hashi running" / "Hashi error" /
 * "Hashi idle") is appended inside a sibling span so screen readers
 * announce the transition.
 *
 * Lifecycle: `mountStatusBar(plugin, callbacks)` returns a teardown
 * function. The plugin is responsible for calling it on `onunload()` so
 * the store subscription and the error-window timer are released — the
 * status-bar element itself is removed by Obsidian.
 *
 * Spec refs: 002-instruction-executor PRD F10; SDD ADR-6; phase-5 T5.2.
 */

import type { Plugin } from "obsidian";

import { executionStore, selectProgress } from "../executor/executionStore";
import type { RunState } from "../executor/state";

export interface StatusBarCallbacks {
	/** Invoked when the user clicks while a run is in progress. */
	readonly onActiveModalFocus: () => void;
}

type VisualState =
	| { readonly kind: "idle" }
	| { readonly kind: "running"; readonly current: number; readonly total: number }
	| { readonly kind: "error"; readonly failures: number; readonly logFileName: string | null };

type StateClass = "is-idle" | "is-running" | "is-error";

const ERROR_WINDOW_MS = 10_000;

function deriveVisual(state: RunState): VisualState {
	if (state.kind === "running") {
		const progress = selectProgress(state);
		if (progress === null) return { kind: "idle" };
		return { kind: "running", current: progress.current, total: progress.total };
	}
	if (state.kind === "summary") {
		const failures = state.counts.failed;
		if (failures > 0) {
			return {
				kind: "error",
				failures,
				logFileName: state.logFilePath !== null
					? basename(state.logFilePath)
					: null,
			};
		}
		return { kind: "idle" };
	}
	if (state.kind === "validation-failed") {
		const failures = state.perFileFailures.size;
		if (failures > 0) {
			return { kind: "error", failures, logFileName: null };
		}
		return { kind: "idle" };
	}
	// idle / preparing / previewing — all map to the idle visual.
	return { kind: "idle" };
}

function basename(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? path : path.slice(slash + 1);
}

function tooltipFor(visual: VisualState): string {
	if (visual.kind === "running") {
		return `Hashi: running — ${visual.current} of ${visual.total} actions`;
	}
	if (visual.kind === "error") {
		const suffix = visual.logFileName !== null
			? ` — see ${visual.logFileName}`
			: "";
		const noun = visual.failures === 1 ? "failure" : "failures";
		return `Hashi: last run had ${visual.failures} ${noun}${suffix}`;
	}
	return "Hashi: idle";
}

function classFor(visual: VisualState): StateClass {
	if (visual.kind === "running") return "is-running";
	if (visual.kind === "error") return "is-error";
	return "is-idle";
}

function announcementFor(visual: VisualState): string {
	if (visual.kind === "running") return "Hashi running";
	if (visual.kind === "error") return "Hashi error";
	return "Hashi idle";
}

/**
 * Mount the status bar. Returns a teardown function the caller invokes
 * on plugin unload to release the subscription and any pending timer.
 */
export function mountStatusBar(
	plugin: Plugin,
	callbacks: StatusBarCallbacks,
): () => void {
	const root = plugin.addStatusBarItem();
	root.addClass("hashi-status-bar-bridge");
	root.setAttr("role", "status");
	root.setAttr("aria-live", "polite");

	root.createSpan({ cls: "hashi-status-bar-bridge-glyph", text: "橋" });
	const announcer = root.createSpan({
		cls: "hashi-status-bar-bridge-sr",
		attr: { "aria-hidden": "false" },
	});

	let currentClass: StateClass = "is-idle";
	root.addClass(currentClass);
	root.setAttr("aria-label", "Hashi: idle");
	root.setAttr("title", "Hashi: idle");

	let errorTimer: ReturnType<typeof setTimeout> | null = null;
	let visual: VisualState = { kind: "idle" };

	function clearErrorTimer(): void {
		if (errorTimer !== null) {
			clearTimeout(errorTimer);
			errorTimer = null;
		}
	}

	function applyVisual(next: VisualState): void {
		visual = next;
		const nextClass = classFor(next);
		if (nextClass !== currentClass) {
			root.removeClass(currentClass);
			root.addClass(nextClass);
			currentClass = nextClass;
		}
		const tooltip = tooltipFor(next);
		root.setAttr("aria-label", tooltip);
		root.setAttr("title", tooltip);
		announcer.setText(announcementFor(next));
	}

	root.addEventListener("click", () => {
		if (visual.kind === "running") {
			callbacks.onActiveModalFocus();
		}
		// idle / error — deliberate no-op (PRD F10).
	});

	const unsubscribe = executionStore.subscribe((state) => {
		const next = deriveVisual(state);
		// Any non-error transition cancels a pending error-window timer.
		if (next.kind !== "error") clearErrorTimer();

		applyVisual(next);

		if (next.kind === "error") {
			clearErrorTimer();
			errorTimer = setTimeout(() => {
				errorTimer = null;
				applyVisual({ kind: "idle" });
			}, ERROR_WINDOW_MS);
		}
	});

	return () => {
		clearErrorTimer();
		unsubscribe();
	};
}
