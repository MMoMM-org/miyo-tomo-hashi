/**
 * ExecutionModal — single state-machine modal driven by `executionStore`.
 *
 * One Modal subclass, three subviews (preview / progress / summary +
 * validation-failed). Subscribes to the executor's RunState store on
 * `onOpen`; unsubscribes on `onClose`. Each store transition rebuilds
 * `contentEl` in place via the appropriate subview render function — the
 * Modal instance lives across phases (no `close()` + `open()` between
 * preview → running → summary).
 *
 * Callbacks supplied to the constructor are the user's intent hooks:
 *   - onExecute: user clicked Execute (preview).
 *   - onCancel:  user clicked Cancel (preview OR running). The modal does
 *                NOT call `executor.cancel()` during preview — the run
 *                hasn't started yet — but does during running.
 *   - onClose:   user clicked Close OR pressed Esc in summary /
 *                validation-failed.
 *
 * Esc key mapping:
 *   - preview / running → cancel
 *   - summary / validation-failed → close
 *
 * [ref: PRD/F3, F6, F7; SDD/ADR-5; phase-5 T5.1]
 */

import { type App, Modal } from "obsidian";

import type { RunState } from "../executor/state";
import type { Store } from "../util/store";

import type { ModalCallbacks } from "./modalContent/types";
import { renderPreviewView } from "./modalContent/previewView";
import { renderProgressView } from "./modalContent/progressView";
import { renderSummaryView } from "./modalContent/summaryView";

/** Subset of InstructionExecutor the modal needs. */
export interface ExecutorHandle {
	readonly state: Store<RunState>;
	cancel(): void;
}

export class ExecutionModal extends Modal {
	private unsubscribe: (() => void) | null = null;
	private currentState: RunState = { kind: "idle" };
	private readonly escHandler: (evt: KeyboardEvent) => void;

	constructor(
		app: App,
		private readonly executor: ExecutorHandle,
		private readonly callbacks: ModalCallbacks = {},
	) {
		super(app);
		this.escHandler = (evt: KeyboardEvent) => {
			if (evt.key !== "Escape") return;
			this.handleEsc();
		};
	}

	override onOpen(): void {
		this.contentEl.addEventListener("keydown", this.escHandler);
		this.unsubscribe = this.executor.state.subscribe((state) => {
			this.render(state);
		});
	}

	override onClose(): void {
		// Safety net for native dismissal (review H2): Obsidian's framework
		// Scope handles Esc and the X chrome before any contentEl listener
		// fires — only this lifecycle hook runs. If a run is gated at
		// proceedResolve (confirm-mode preview) or mid-execution, missing
		// the cancel here leaves the lock held and proceedResolve unresolved
		// until plugin reload. cancel() is idempotent.
		const needCancel =
			this.currentState.kind === "previewing" ||
			this.currentState.kind === "running";

		this.contentEl.removeEventListener("keydown", this.escHandler);
		if (this.unsubscribe !== null) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
		this.contentEl.empty();

		if (needCancel) {
			this.executor.cancel();
			// Drive the post-cancel idle transition through the consumer's
			// onClose hook so the executor doesn't park at `summary` with
			// no modal to surface it. Treats native dismiss as equivalent
			// to clicking Close on the summary view.
			this.callbacks.onClose?.();
		}
	}

	private render(state: RunState): void {
		this.currentState = state;
		const wrappedCallbacks = this.wrapCallbacks(state);

		switch (state.kind) {
			case "previewing":
				renderPreviewView(this.contentEl, state, wrappedCallbacks);
				return;
			case "running":
				renderProgressView(this.contentEl, state, wrappedCallbacks);
				return;
			case "summary":
			case "validation-failed":
				renderSummaryView(this.contentEl, state, wrappedCallbacks);
				return;
			case "idle":
			case "preparing":
				// Transient phases — leave a blank container so the modal
				// can stay open between runs without flashing stale content.
				this.contentEl.empty();
				this.contentEl.addClass("hashi-execution-modal");
				return;
		}
	}

	/**
	 * Wraps the user-supplied callbacks. Cancel during `running` calls
	 * `executor.cancel()` before the user's `onCancel` hook; cancel during
	 * `previewing` does not (no run has started yet). All other callbacks
	 * pass through unchanged.
	 */
	private wrapCallbacks(state: RunState): ModalCallbacks {
		return {
			onExecute: () => {
				this.callbacks.onExecute?.();
			},
			onCancel: () => {
				if (state.kind === "running") {
					this.executor.cancel();
				}
				this.callbacks.onCancel?.();
			},
			onClose: () => {
				this.callbacks.onClose?.();
			},
			onViewErrors: (logFilePath: string | null) => {
				this.callbacks.onViewErrors?.(logFilePath);
			},
		};
	}

	private handleEsc(): void {
		const wrapped = this.wrapCallbacks(this.currentState);
		switch (this.currentState.kind) {
			case "previewing":
			case "running":
				wrapped.onCancel?.();
				break;
			case "summary":
			case "validation-failed":
				wrapped.onClose?.();
				break;
			default:
				// idle / preparing — Esc is a no-op at the modal layer.
				break;
		}
	}
}
