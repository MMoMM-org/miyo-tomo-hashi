/**
 * Status bar icon — registers a footer item that shows the Tomo kanji (友)
 * with a state class (`is-connected` / `is-reconnecting` / `is-disconnected`)
 * derived from the connection store. Hover tooltip describes the current
 * state. Click / Enter / Space open a three-action popover (see
 * `openPopover`).
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
 * `unmount()` during `onunload()`. The status-bar element itself is removed
 * by Obsidian when the plugin unloads; `unmount()` only releases our store
 * subscription so the listener doesn't leak.
 *
 * Spec refs: spec 001-session-view phase-4 T4.2; PRD F3 (all ACs);
 * SDD ADR-9, "UI Visualization / Status bar icon".
 */

import type { Plugin } from "obsidian";

import {
	connectionStore,
	displayInstanceName,
} from "../../connection/connectionStore";
import type { ConnectionState } from "../../connection/state";

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
] as const;

type StateClass = (typeof STATE_CLASSES)[number];

function classFor(state: ConnectionState): StateClass {
	if (state.kind === "connected") return "is-connected";
	if (state.kind === "reconnecting" || state.kind === "attaching") {
		return "is-reconnecting";
	}
	return "is-disconnected";
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
	private unsubscribe: (() => void) | null = null;

	constructor(
		private readonly plugin: Plugin,
		private readonly actions: StatusBarActions,
		// Dep-injected so phase-5 can wire it to the persisted settings.
		private readonly chosenInstanceId: () => string | null,
	) {}

	mount(): void {
		const root = this.plugin.addStatusBarItem();
		root.addClass("hashi-status-bar");
		root.setAttr("role", "button");
		root.setAttr("tabindex", "0");

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
			openPopover(mouseEvt, {
				forceReconnectEnabled: this.chosenInstanceId() !== null,
				onForceReconnect: this.actions.onForceReconnect,
				onOpenChat: this.actions.onOpenChat,
				onOpenSettings: this.actions.onOpenSettings,
			});
		};

		root.addEventListener("click", handleActivate);
		root.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				handleActivate(evt);
			}
		});

		this.el = root;
		this.unsubscribe = connectionStore.subscribe((state) => {
			if (this.el === null) return;
			const cls = classFor(state);
			for (const c of STATE_CLASSES) {
				if (c === cls) this.el.addClass(c);
				else this.el.removeClass(c);
			}
			const tooltip = tooltipFor(state);
			this.el.setAttr("aria-label", tooltip);
			this.el.setAttr("title", tooltip);
		});
	}

	unmount(): void {
		if (this.unsubscribe !== null) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
		// Obsidian removes the status-bar element on plugin unload — no need
		// to remove it manually here. Drop the reference so any late events
		// (during teardown) cannot mutate a detached element.
		this.el = null;
	}
}
