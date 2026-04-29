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
		this.contentEl.removeEventListener("keydown", this.escHandler);
		if (this.unsubscribe !== null) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
		this.contentEl.empty();
	}

	private render(state: RunState): void {
		this.currentState = state;
		const wrappedCallbacks = this.wrapCallbacks(state);

		switch (state.kind) {
			case "previewing":
				renderPreviewView(this.contentEl, state, wrappedCallbacks);
				break;
			case "running":
				renderProgressView(this.contentEl, state, wrappedCallbacks);
				break;
			case "summary":
			case "validation-failed":
				renderSummaryView(this.contentEl, state, wrappedCallbacks);
				break;
			case "idle":
			case "preparing":
				// Transient phases — render nothing useful but keep the
				// container class so styles apply if the modal is shown.
				this.contentEl.empty();
				this.contentEl.addClass("hashi-execution-modal");
				break;
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
			onViewErrors: () => {
				this.callbacks.onViewErrors?.();
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
