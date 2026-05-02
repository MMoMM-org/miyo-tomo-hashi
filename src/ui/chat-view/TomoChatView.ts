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
 * 1. `getChosenInstanceName` is dependency-injected as a `() => string | null`
 *    callback rather than reading the settings object directly. Mirrors
 *    `StatusBarIcon` (T4.2) and keeps the view decoupled from the plugin
 *    settings shape; main.ts wires it to the persisted instance NAME (label
 *    `miyo.tomo.instance-name`), which survives container stop+start.
 *    Receivers treat the value as an opaque "anything chosen?" check, so
 *    the historical parameter name is preserved.
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
 * 4. The Force Reconnect button is `disabled` when `getChosenInstanceName()`
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
import { ZOOM_LEVELS, type ZoomLevel } from "../../types/index";

import { VIEW_TYPE_TOMO_CHAT } from "./index";
import {
	createTerminal,
	dispose,
	fit,
	writeChunk,
	type TerminalSession,
} from "./terminalHost";

// Anchors xterm font sizing to a fixed base so the zoom multipliers map to
// concrete pixel sizes (0.5×→7px, 1×→14px, 1.5×→21px). 14px matches the
// xterm.js default and keeps cells legible on standard Obsidian themes.
const BASE_FONT_SIZE = 14;

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

// Trailing-debounce window for the ResizeObserver-driven `fit()`. xterm's
// fit() re-measures the host element, recomputes the cell grid, and pushes
// a resize event downstream — non-trivial work to thrash on every pixel of
// a pane drag. 150 ms is the standard xterm-integration debounce and feels
// instant after the user stops dragging.
const RESIZE_DEBOUNCE_MS = 150;

export class TomoChatView extends ItemView {
	private unsubscribe: (() => void) | null = null;
	private dataDisposable: { dispose: () => void } | null = null;
	private terminalInputDisposable: { dispose: () => void } | null = null;
	private terminalResizeDisposable: { dispose: () => void } | null = null;
	private terminal: TerminalSession | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	// Drives the post-Connected resize push. Tracking the previous state
	// kind avoids resyncing on every store transition (e.g. indicator-only
	// updates) — only the disconnected→connected edge needs the explicit
	// fit + resize.
	private lastStateKind: ConnectionState["kind"] | null = null;
	// Continuity-gap signal — flipped true on the reconnecting → connected
	// transition (PRD F8/AC5 + F5/AC5). The indicator carries a
	// "Reconnected (gap)" suffix until the user types a character, at which
	// point we clear it (the user has acknowledged recovery by acting).
	private showGapNotice: boolean = false;
	private currentZoom: ZoomLevel;

	// DOM refs — captured during onOpen() so render() can update them on
	// every store transition.
	private indicatorEl: HTMLElement | null = null;
	private forceReconnectBtn: HTMLButtonElement | null = null;
	private inputEl: HTMLInputElement | null = null;
	private zoomButtons: Map<ZoomLevel, HTMLButtonElement> = new Map();

	constructor(
		leaf: WorkspaceLeaf,
		private readonly connection: TomoConnection,
		private readonly getChosenInstanceName: () => string | null,
		initialZoom: ZoomLevel,
		private readonly onZoomChange: (level: ZoomLevel) => Promise<void>,
	) {
		super(leaf);
		this.currentZoom = initialZoom;
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

		// --- Header (indicator + zoom controls + force-reconnect action) ----
		const header = root.createDiv({ cls: "hashi-chat-view-header" });
		this.indicatorEl = header.createDiv({
			cls: "hashi-chat-view-indicator",
		});
		// PRD F5/AC7 + F9/AC5 — screen-reader announcement contract for
		// indicator state changes. `aria-live` lives on the element whose
		// text content changes; render() updates the live politeness based
		// on severity (assertive for disconnected/error).
		//
		// M12 (review/spec-001): no `role="status"` — its implicit
		// aria-live="polite" overrides the dynamic assertive escalation
		// in some AT (JAWS, older VoiceOver), silently downgrading the
		// "Disconnected" announcement that needs to interrupt.
		this.indicatorEl.setAttr("aria-live", "polite");
		const headerActions = header.createDiv({
			cls: "hashi-chat-view-header-actions",
		});

		// Zoom buttons — fixed-arity selector (see ZOOM_LEVELS). Continuous
		// slider was rejected because xterm's cell grid rounds to integer
		// pixel cells, and a slider would drift between integer fontSizes,
		// constantly fighting the fit-addon for a stable layout.
		const zoomGroup = headerActions.createDiv({
			cls: "hashi-chat-view-zoom-group",
		});
		// M14 (review/spec-001): SR users hear three isolated buttons
		// without the structural context that they form a mutually-
		// exclusive selector. role=group + aria-label gives the trio a
		// single accessible name.
		zoomGroup.setAttr("role", "group");
		zoomGroup.setAttr("aria-label", "Terminal zoom");
		this.zoomButtons.clear();
		for (const level of ZOOM_LEVELS) {
			const btn = zoomGroup.createEl("button", {
				cls: "hashi-chat-view-zoom-btn",
				text: this.formatZoomLabel(level),
			});
			// review round 2 / L30: per-button label is just the size — the
			// containing role=group's "Terminal zoom" name supplies the
			// context. Pre-fix label was "Zoom S/M/L" which some screen
			// readers concatenated with the group label as "Terminal zoom
			// Zoom S".
			btn.setAttr("aria-label", this.formatZoomLabel(level));
			// H5 (review/spec-001): SR users can't tell which zoom is
			// active without aria-pressed — the .is-active CSS class is
			// invisible to AT.
			btn.setAttr("aria-pressed", level === this.currentZoom ? "true" : "false");
			btn.addEventListener("click", () => {
				void this.handleZoomClick(level);
			});
			this.zoomButtons.set(level, btn);
		}

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
		this.applyZoomToTerminal(this.currentZoom);
		this.refreshZoomButtons();

		this.dataDisposable = this.connection.onData((chunk: Uint8Array) => {
			if (this.terminal !== null) writeChunk(this.terminal, chunk);
		});

		// Forward keystrokes typed inside the xterm area to the container's
		// stdin. This is what makes the chat view behave like a normal terminal
		// emulator — without this, xterm captures key events but does nothing
		// with them, so typing into the visible Tomo TUI silently drops bytes.
		// The PRD-style separate input field below is still wired (for chat-
		// style line submit on Enter); both entry points coexist.
		this.terminalInputDisposable = this.terminal.terminal.onData((data) => {
			try {
				this.connection.write(data);
			} catch {
				// not connected — drop silently; render() shows the disconnected
				// state and the user can re-Connect / Force Reconnect.
			}
		});

		// Forward xterm geometry to the container PTY. `docker run -it`
		// creates a TTY at a fixed default size (80x24); without this, every
		// dimension Claude Code computes for its TUI is wrong, and cursor
		// backsteps / line-clears land on stale cells, leaving previous
		// animation frames as visible ghost lines in xterm.
		this.terminalResizeDisposable = this.terminal.terminal.onResize(
			({ rows, cols }) => {
				void this.connection.resize(rows, cols).catch(() => {});
			},
		);

		// Keep the terminal sized to its container. ResizeObserver is missing
		// under jsdom (test runtime) — guard the wiring so unit tests don't
		// blow up; the production runtime (Electron) provides it.
		// Debounced 150 ms trailing — fit() does real measurement work and
		// must not run for every pixel of a pane drag.
		if (typeof ResizeObserver !== "undefined") {
			this.resizeObserver = new ResizeObserver(() => {
				if (this.resizeDebounceTimer !== null) {
					clearTimeout(this.resizeDebounceTimer);
				}
				this.resizeDebounceTimer = setTimeout(() => {
					this.resizeDebounceTimer = null;
					if (this.terminal !== null) fit(this.terminal);
				}, RESIZE_DEBOUNCE_MS);
			});
			this.resizeObserver.observe(termHost);
		}

		// --- Input row -------------------------------------------------------
		const inputRow = root.createDiv({ cls: "hashi-chat-view-input-row" });
		this.inputEl = inputRow.createEl("input", {
			cls: "hashi-chat-view-input",
			// review round 2 / L28: aria-label="Message" — placeholder is
			// not a substitute for an accessible name in some browser/AT
			// combinations; an explicit label guarantees the input is
			// announced to screen readers.
			attr: {
				type: "text",
				placeholder: "Type a message…",
				"aria-label": "Message",
			},
		});
		this.inputEl.addEventListener("keydown", (evt) => {
			if (evt.key !== "Enter" || evt.shiftKey) return;
			evt.preventDefault();
			const text = this.inputEl?.value ?? "";
			if (text.length === 0) return;
			this.connection.write(`${text}\n`);
			if (this.inputEl !== null) this.inputEl.value = "";
			// User acknowledged recovery by acting — clear the gap notice and
			// re-render so the indicator drops the suffix.
			if (this.showGapNotice) {
				this.showGapNotice = false;
				this.render(connectionStore.get());
			}
		});

		// Subscribe AFTER the skeleton is built — Store fires the listener
		// immediately on subscribe with the current value, so render() must
		// have its DOM refs.
		this.unsubscribe = connectionStore.subscribe((state) =>
			this.render(state),
		);

		// C1 (review/spec-001): bootstrap focus on open. The render()
		// transition path only focuses on disabled→enabled, which doesn't
		// fire on first mount (input.disabled defaults to false either way).
		// Without this, keyboard users open the view and must mouse-click
		// before any keystroke is captured. Connected → input owns focus;
		// otherwise → terminal owns focus so the AT user at least lands
		// inside the chat view's primary surface.
		const initial = connectionStore.get();
		if (initial.kind === "connected") {
			this.inputEl?.focus();
		} else {
			this.terminal?.terminal.focus();
		}
	}

	/**
	 * Obsidian's workspace focus system delegates here when the view becomes
	 * active. The `override` keyword is omitted because `focus()` isn't in
	 * Obsidian's typed `ItemView` declarations — the runtime calls it via
	 * duck typing. Defaults would land focus on `contentEl`; we route to
	 * the input when Connected (so users can type immediately) or to the
	 * xterm terminal otherwise (so AT users land inside the chat surface).
	 * Mirrors the onOpen bootstrap (review round 2 / L29). Pre-fix this
	 * always routed to the terminal, forcing the user to manually move
	 * focus to the input each time the view was re-activated mid-session.
	 */
	focus(): void {
		if (connectionStore.get().kind === "connected") {
			this.inputEl?.focus();
		} else {
			this.terminal?.terminal.focus();
		}
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
		if (this.terminalInputDisposable !== null) {
			this.terminalInputDisposable.dispose();
			this.terminalInputDisposable = null;
		}
		if (this.terminalResizeDisposable !== null) {
			this.terminalResizeDisposable.dispose();
			this.terminalResizeDisposable = null;
		}
		if (this.resizeObserver !== null) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}
		if (this.resizeDebounceTimer !== null) {
			clearTimeout(this.resizeDebounceTimer);
			this.resizeDebounceTimer = null;
		}
		if (this.terminal !== null) {
			dispose(this.terminal);
			this.terminal = null;
		}
	}

	private formatZoomLabel(level: ZoomLevel): string {
		// "0.5×" / "1×" / "1.5×" — strip any trailing ".0" so 1 reads as "1×"
		// rather than "1.0×". Number.toString() already does this for integer
		// values; explicit branches keep the formatting deterministic.
		if (level === 1) return "1×";
		return `${level}×`;
	}

	private applyZoomToTerminal(level: ZoomLevel): void {
		if (this.terminal === null) return;
		this.terminal.terminal.options.fontSize = BASE_FONT_SIZE * level;
		// Re-fit so xterm's cell grid is recomputed against the new font;
		// fit() triggers terminal.onResize, which we already wire to
		// connection.resize so the container PTY follows. Without this the
		// PTY would stay at the old geometry and ghost-line artifacts would
		// reappear immediately after a zoom change.
		fit(this.terminal);
	}

	private refreshZoomButtons(): void {
		for (const [level, btn] of this.zoomButtons) {
			const isActive = level === this.currentZoom;
			if (isActive) btn.addClass("is-active");
			else btn.removeClass("is-active");
			// H5: keep aria-pressed in sync on every zoom change so SR
			// users hear the new selection.
			btn.setAttr("aria-pressed", isActive ? "true" : "false");
		}
	}

	private async handleZoomClick(level: ZoomLevel): Promise<void> {
		// No-op when the user clicks the already-active level — saves a
		// saveData round-trip on a fast-clicker and avoids a needless
		// fit/resize churn on the container PTY.
		if (level === this.currentZoom) return;
		this.currentZoom = level;
		this.applyZoomToTerminal(level);
		this.refreshZoomButtons();
		await this.onZoomChange(level);
	}

	private render(state: ConnectionState): void {
		const indicator = this.indicatorEl;
		const btn = this.forceReconnectBtn;
		const input = this.inputEl;
		if (indicator === null || btn === null || input === null) return;

		// PRD F8/AC5 — flip the gap-notice flag on reconnecting → connected.
		// The flag is sticky until the user types in the input (handled in
		// the keydown listener); subsequent renders see it set and append
		// "(gap)" to the indicator label.
		const recoveredFromReconnect =
			state.kind === "connected" && this.lastStateKind === "reconnecting";
		if (recoveredFromReconnect) {
			this.showGapNotice = true;
		}

		const view = viewFor(state);
		const label =
			this.showGapNotice && state.kind === "connected"
				? `${view.label} — Reconnected (gap)`
				: view.label;
		indicator.setText(label);
		for (const c of STATE_CLASSES) {
			if (c === view.stateClass) indicator.addClass(c);
			else indicator.removeClass(c);
		}
		// PRD F5/AC7 — politeness escalates with severity. Disconnected /
		// error states use `aria-live="assertive"` so AT users hear the
		// failure immediately; transitional states stay polite to avoid
		// stomping on whatever the user is reading.
		indicator.setAttr(
			"aria-live",
			view.stateClass === "is-disconnected" ? "assertive" : "polite",
		);

		const wasDisabled = input.disabled;
		const shouldBeDisabled = state.kind !== "connected";
		input.disabled = shouldBeDisabled;
		if (wasDisabled && !shouldBeDisabled) {
			input.focus();
		}

		const noInstance = this.getChosenInstanceName() === null;
		btn.disabled = noInstance;
		btn.title = noInstance
			? "Force reconnect (no instance chosen)"
			: "Force reconnect";

		// Edge-trigger pty resize push on the disconnected-or-attaching →
		// connected transition. The new container PTY always starts at the
		// docker-run -it default 80x24; xterm's onResize only fires when its
		// own dimensions change, which doesn't happen on attach. So we fit()
		// to ensure the addon has measured the host element, then push the
		// resulting geometry through to the container ourselves. Once the
		// stream is live, subsequent ResizeObserver-triggered fits will
		// drive xterm's onResize and keep the two in sync.
		const becameConnected =
			state.kind === "connected" && this.lastStateKind !== "connected";
		this.lastStateKind = state.kind;
		if (becameConnected && this.terminal !== null) {
			fit(this.terminal);
			const { rows, cols } = this.terminal.terminal;
			void this.connection.resize(rows, cols).catch(() => {});
		}
	}
}
