/**
 * Status bar icon — registers a footer item that shows the Tomo kanji (友)
 * with a combined state class derived from BOTH the Docker connection store
 * and the IDE Bridge store (per ADR-6 precedence: ide error > docker
 * disconnected/reconnecting > connected/healthy).
 *
 * T4.4 extends the original T4.2 implementation with:
 *  - A second store subscription (ideBridgeStore) that drives the combined
 *    color via `combinedClass()`.
 *  - `is-error` CSS class for the IDE Bridge error tier.
 *  - IDE status line folded into aria-label/title so color is not the sole
 *    signal (PRD F3/AC9).
 *  - "IDE Bridge: <state>" info line + optional "Copy auth token" action in
 *    the click popover.
 *
 * Per SDD ADR-9 the status bar is the only persistent UI surface for the
 * connection state. Per PRD F3/AC2 state is conveyed by something beyond
 * color alone — we render a separate indicator span (styled via CSS by the
 * state class) in addition to applying the class to the root.
 *
 * Per ADR-6 (revised 2026-04-25) we ship CSS classes only — color is
 * theme-bound. No pulse animation.
 *
 * The owning plugin lifecycle calls `mount()` once during `onload()` and
 * `unmount()` during `onunload()`. `unmount()` releases BOTH store
 * subscriptions so neither listener leaks.
 *
 * Spec refs: spec 001-session-view phase-4 T4.2; PRD F3 (all ACs);
 * spec 003-ide-bridge phase-4 T4.4; SDD ADR-6, ADR-9,
 * "UI Visualization / Status bar icon".
 */

import type { Plugin } from "obsidian";

import {
	connectionStore,
	displayInstanceName,
} from "../../connection/connectionStore";
import type { ConnectionState } from "../../connection/state";
import { ideBridgeStore } from "../../ide-bridge/ideBridgeStore";
import type { IdeBridgeState } from "../../ide-bridge/state";

import { openPopover } from "./openPopover";

export interface StatusBarActions {
	onForceReconnect: () => void;
	onOpenChat: () => void;
	onOpenSettings: () => void;
}

const STATE_CLASSES = [
	"is-connected",
	"is-reconnecting",
	"is-disconnected",
	"is-error",
] as const;

type StateClass = (typeof STATE_CLASSES)[number];

function classFor(state: ConnectionState): Exclude<StateClass, "is-error"> {
	if (state.kind === "connected") return "is-connected";
	if (state.kind === "reconnecting" || state.kind === "attaching") {
		return "is-reconnecting";
	}
	return "is-disconnected";
}

/**
 * Combined worst-state CSS class per ADR-6 precedence.
 * IDE error beats any Docker state. IDE stopped/listening/connected are
 * healthy and cannot upgrade a degraded Docker axis.
 */
export function combinedClass(conn: ConnectionState, ide: IdeBridgeState): StateClass {
	if (ide.kind === "error") return "is-error";
	return classFor(conn);
}

/**
 * Human-readable single-line IDE Bridge status for the popover and
 * aria-label fold. Sentence-case per Obsidian style guide.
 */
export function ideStatusLine(ide: IdeBridgeState): string {
	switch (ide.kind) {
		case "stopped":
			return "IDE Bridge: stopped";
		case "listening":
			return `IDE Bridge: listening :${ide.port}`;
		case "connected":
			return `IDE Bridge: connected(${ide.clientCount}) :${ide.port}`;
		case "error":
			return `IDE Bridge: error — ${ide.reason}`;
	}
}

function tooltipFor(state: ConnectionState): string {
	if (state.kind === "connected") {
		const name = displayInstanceName(state);
		return name !== null ? `Tomo: ${name}` : "Tomo: connected";
	}
	if (state.kind === "reconnecting") return "Reconnecting…";
	if (state.kind === "attaching") return "Connecting…";
	return "Tomo: disconnected";
}

export class StatusBarIcon {
	private el: HTMLElement | null = null;
	private unsubscribeConn: (() => void) | null = null;
	private unsubscribeIde: (() => void) | null = null;
	private lastConn: ConnectionState = { kind: "disconnected" };
	private lastIde: IdeBridgeState = { kind: "stopped" };

	constructor(
		private readonly plugin: Plugin,
		private readonly actions: StatusBarActions,
		// Dep-injected so phase-5 can wire it to the persisted settings.
		private readonly getChosenInstanceName: () => string | null,
		// Dep-injected callback for the Copy auth token popover action.
		// The caller (main.ts) owns the clipboard write + Notice so this
		// class stays free of side effects and testable without a clipboard.
		private readonly getToken: () => string,
	) {}

	mount(): void {
		const root = this.plugin.addStatusBarItem();
		root.addClass("hashi-status-bar");
		root.setAttr("role", "button");
		root.setAttr("tabindex", "0");
		// PRD F3/AC9 — screen-reader announcement contract. `aria-live` lives
		// on the root so the announcement attaches to the same element whose
		// `aria-label` changes; the live politeness is updated per state in
		// the subscribe handlers below.
		root.setAttr("aria-live", "polite");

		root.createSpan({ cls: "hashi-status-bar-glyph", text: "友" });
		root.createSpan({
			cls: "hashi-status-bar-indicator",
			attr: { "aria-hidden": "true" },
		});

		const handleActivate = (evt: MouseEvent | KeyboardEvent): void => {
			const mouseEvt: MouseEvent =
				evt instanceof MouseEvent
					? evt
					: new MouseEvent("click", { clientX: 0, clientY: 0 });
			const ide = ideBridgeStore.get();
			const ideRunning = ide.kind === "listening" || ide.kind === "connected";
			openPopover(mouseEvt, {
				forceReconnectEnabled: this.getChosenInstanceName() !== null,
				onForceReconnect: this.actions.onForceReconnect,
				onOpenChat: this.actions.onOpenChat,
				onOpenSettings: this.actions.onOpenSettings,
				ideStatusLine: ideStatusLine(ide),
				ideRunning,
				onCopyToken: () => {
					const token = this.getToken();
					void navigator.clipboard.writeText(token);
				},
			});
		};

		this.plugin.registerDomEvent(root, "click", handleActivate);
		this.plugin.registerDomEvent(root, "keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				handleActivate(evt);
			}
		});

		this.el = root;
		// Initialize from current store values before subscribing so we hold
		// them for use in applyState() when only one store fires.
		this.lastConn = connectionStore.get();
		this.lastIde = ideBridgeStore.get();

		this.unsubscribeConn = connectionStore.subscribe((state) => {
			this.lastConn = state;
			this.applyState();
		});

		this.unsubscribeIde = ideBridgeStore.subscribe((state) => {
			this.lastIde = state;
			this.applyState();
		});
	}

	private applyState(): void {
		if (this.el === null) return;
		const cls = combinedClass(this.lastConn, this.lastIde);
		for (const c of STATE_CLASSES) {
			if (c === cls) this.el.addClass(c);
			else this.el.removeClass(c);
		}
		const connTooltip = tooltipFor(this.lastConn);
		const ideLine = ideStatusLine(this.lastIde);
		// Fold IDE state into accessible label so color is not the sole signal.
		const fullLabel =
			this.lastIde.kind === "stopped"
				? connTooltip
				: `${connTooltip} | ${ideLine}`;
		this.el.setAttr("aria-label", fullLabel);
		this.el.setAttr("title", fullLabel);
		// PRD F3/AC9 — politeness escalates for disconnected/error states.
		const isUrgent = cls === "is-disconnected" || cls === "is-error";
		this.el.setAttr("aria-live", isUrgent ? "assertive" : "polite");
	}

	unmount(): void {
		if (this.unsubscribeConn !== null) {
			this.unsubscribeConn();
			this.unsubscribeConn = null;
		}
		if (this.unsubscribeIde !== null) {
			this.unsubscribeIde();
			this.unsubscribeIde = null;
		}
		// Obsidian removes the status-bar element on plugin unload — no need
		// to remove it manually here. Drop the reference so any late events
		// (during teardown) cannot mutate a detached element.
		this.el = null;
	}
}
