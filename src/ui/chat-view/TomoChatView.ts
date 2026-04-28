/**
 * Tomo chat view — unified Session View over a Tomo Docker container. Hosts
 * an xterm.js terminal that surfaces the bidirectional Docker attach stream
 * (stdout/stderr → terminal, user input → `connection.write`), plus a
 * header with a state indicator and a Force Reconnect button.
 *
 * Spec refs: spec 001-session-view phase-4 T4.3; PRD F4 (chat view), F5
 * (bidirectional chat), F8 (force-reconnect parity); SDD ADR-2 (xterm.js
 * via Docker stream), ADR-6 (CSS classes only — theme-bound colors),
 * "UI Visualization / Chat view".
 *
 * --- Decisions ---
 *
 * 1. `chosenInstanceId` is dependency-injected as a `() => string | null`
 *    callback rather than reading the settings object directly. Mirrors
 *    `StatusBarIcon` (T4.2) and keeps the view decoupled from the plugin
 *    settings shape; Phase 5 wires it to `() => plugin.settings.chosenInstanceId`.
 *
 * 2. The store subscription is established AFTER the DOM skeleton is built
 *    so the initial `render(state)` callback (Store fires immediately on
 *    subscribe) finds the indicator / button / input refs already attached.
 *
 * 3. Input is `disabled` whenever state is not Connected. On the
 *    disabled→enabled transition the input is `focus()`-ed so the user can
 *    type without an extra click. Production mounts the contentEl into a
 *    real workspace leaf — focus works there. Tests append the contentEl
 *    to `document.body` to verify focus behavior.
 *
 * 4. The Force Reconnect button is `disabled` when `chosenInstanceId()`
 *    returns null. Parity with the status-bar popover (PRD F3 / AC5,
 *    SDD ADR-9): "Force Reconnect" must never open the picker.
 *
 * 5. ResizeObserver is used to keep the xterm fit-to-container. Falls back
 *    silently when the runtime lacks ResizeObserver (jsdom under vitest).
 */

import { ItemView, type WorkspaceLeaf } from "obsidian";

import {
	connectionStore,
	displayInstanceName,
} from "../../connection/connectionStore";
import type { ConnectionState } from "../../connection/state";
import type { TomoConnection } from "../../connection/TomoConnection";

import { VIEW_TYPE_TOMO_CHAT } from "./index";
import {
	createTerminal,
	dispose,
	fit,
	writeChunk,
	type TerminalSession,
} from "./terminalHost";

const STATE_CLASSES = [
	"is-connected",
	"is-reconnecting",
	"is-attaching",
	"is-disconnected",
] as const;

type StateClass = (typeof STATE_CLASSES)[number];

interface IndicatorView {
	label: string;
	stateClass: StateClass;
}

function viewFor(state: ConnectionState): IndicatorView {
	const name = displayInstanceName(state);
	switch (state.kind) {
		case "connected":
			return {
				label: `Connected — ${name ?? "Tomo"}`,
				stateClass: "is-connected",
			};
		case "reconnecting":
			return {
				label: `Reconnecting (attempt ${state.attempt})…`,
				stateClass: "is-reconnecting",
			};
		case "attaching":
			return {
				label: `Connecting to ${name ?? "Tomo"}…`,
				stateClass: "is-attaching",
			};
		case "error":
			return {
				label: `Disconnected — ${state.error.detail}`,
				stateClass: "is-disconnected",
			};
		case "disconnected":
			return {
				label:
					state.reason !== undefined
						? `Disconnected — ${state.reason.detail}`
						: "Disconnected",
				stateClass: "is-disconnected",
			};
	}
}

export class TomoChatView extends ItemView {
	private unsubscribe: (() => void) | null = null;
	private dataDisposable: { dispose: () => void } | null = null;
	private terminal: TerminalSession | null = null;
	private resizeObserver: ResizeObserver | null = null;

	// DOM refs — captured during onOpen() so render() can update them on
	// every store transition.
	private indicatorEl: HTMLElement | null = null;
	private forceReconnectBtn: HTMLButtonElement | null = null;
	private inputEl: HTMLInputElement | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly connection: TomoConnection,
		private readonly chosenInstanceId: () => string | null,
	) {
		super(leaf);
	}

	override getViewType(): string {
		return VIEW_TYPE_TOMO_CHAT;
	}

	override getDisplayText(): string {
		return "Tomo chat";
	}

	override getIcon(): string {
		return "message-square";
	}

	/**
	 * Returns the chat input element, or `null` if `onOpen()` has not yet
	 * built the DOM. Used by the file-menu @file prefill (T5.3) to insert a
	 * reference at the caret of the open chat. Narrow accessor — exposes the
	 * input element only, not the rest of the view internals.
	 *
	 * Spec ref: spec 001-session-view phase-5 T5.3; PRD FS1.
	 */
	getInputElement(): HTMLInputElement | null {
		return this.inputEl;
	}

	/**
	 * Sets the input value, focuses it, and places the caret at the end. Used
	 * by the file-menu @file prefill (T5.3) when the chat view was just opened
	 * by `openChatViewAndPrefill` and the user expects to start typing
	 * immediately after the inserted reference. No-op when the DOM has not
	 * yet been built.
	 */
	setInputAndFocus(text: string): void {
		if (this.inputEl === null) return;
		this.inputEl.value = text;
		this.inputEl.focus();
		const len = text.length;
		this.inputEl.setSelectionRange(len, len);
	}

	override async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("hashi-chat-view");

		// --- Header (indicator + force-reconnect action) ---------------------
		const header = root.createDiv({ cls: "hashi-chat-view-header" });
		this.indicatorEl = header.createDiv({
			cls: "hashi-chat-view-indicator",
		});
		const headerActions = header.createDiv({
			cls: "hashi-chat-view-header-actions",
		});
		this.forceReconnectBtn = headerActions.createEl("button", {
			cls: "hashi-chat-view-force-reconnect",
			text: "Force reconnect",
		});
		this.forceReconnectBtn.addEventListener("click", () => {
			void this.connection.forceReconnect();
		});

		// --- Terminal host ---------------------------------------------------
		const termHost = root.createDiv({ cls: "hashi-chat-view-terminal-host" });
		this.terminal = createTerminal(termHost);

		this.dataDisposable = this.connection.onData((chunk: Uint8Array) => {
			if (this.terminal !== null) writeChunk(this.terminal, chunk);
		});

		// Keep the terminal sized to its container. ResizeObserver is missing
		// under jsdom (test runtime) — guard the wiring so unit tests don't
		// blow up; the production runtime (Electron) provides it.
		if (typeof ResizeObserver !== "undefined") {
			this.resizeObserver = new ResizeObserver(() => {
				if (this.terminal !== null) fit(this.terminal);
			});
			this.resizeObserver.observe(termHost);
		}

		// --- Input row -------------------------------------------------------
		const inputRow = root.createDiv({ cls: "hashi-chat-view-input-row" });
		this.inputEl = inputRow.createEl("input", {
			cls: "hashi-chat-view-input",
			attr: { type: "text", placeholder: "Type a message…" },
		});
		this.inputEl.addEventListener("keydown", (evt) => {
			if (evt.key !== "Enter" || evt.shiftKey) return;
			evt.preventDefault();
			const text = this.inputEl?.value ?? "";
			if (text.length === 0) return;
			this.connection.write(`${text}\n`);
			if (this.inputEl !== null) this.inputEl.value = "";
		});

		// Subscribe AFTER the skeleton is built — Store fires the listener
		// immediately on subscribe with the current value, so render() must
		// have its DOM refs.
		this.unsubscribe = connectionStore.subscribe((state) =>
			this.render(state),
		);
	}

	override async onClose(): Promise<void> {
		if (this.unsubscribe !== null) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
		if (this.dataDisposable !== null) {
			this.dataDisposable.dispose();
			this.dataDisposable = null;
		}
		if (this.resizeObserver !== null) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}
		if (this.terminal !== null) {
			dispose(this.terminal);
			this.terminal = null;
		}
	}

	private render(state: ConnectionState): void {
		const indicator = this.indicatorEl;
		const btn = this.forceReconnectBtn;
		const input = this.inputEl;
		if (indicator === null || btn === null || input === null) return;

		const view = viewFor(state);
		indicator.setText(view.label);
		for (const c of STATE_CLASSES) {
			if (c === view.stateClass) indicator.addClass(c);
			else indicator.removeClass(c);
		}

		const wasDisabled = input.disabled;
		const shouldBeDisabled = state.kind !== "connected";
		input.disabled = shouldBeDisabled;
		if (wasDisabled && !shouldBeDisabled) {
			input.focus();
		}

		const noInstance = this.chosenInstanceId() === null;
		btn.disabled = noInstance;
		btn.title = noInstance
			? "Force reconnect (no instance chosen)"
			: "Force reconnect";
	}
}
