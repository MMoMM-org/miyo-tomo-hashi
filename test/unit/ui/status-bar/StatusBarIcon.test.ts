/**
 * Unit tests for StatusBarIcon — Phase-4 T4.2 status bar icon.
 *
 * Spec refs: spec 001-session-view phase-4 T4.2; PRD F3 (all ACs);
 * SDD ADR-9, "UI Visualization / Status bar icon".
 *
 * The Plugin mock's addStatusBarItem returns a real HTMLElement so
 * production code can use idiomatic Obsidian DOM helpers (createSpan,
 * addClass, setAttr).
 *
 * The click → openPopover wiring is verified via a vi.mock of the
 * `openPopover` module; the popover behavior itself is covered in
 * `openPopover.test.ts`.
 */

// Side-effect import (not just `import type`) so the obsidian mock module
// loads and its HTMLElement prototype shim (createSpan / addClass / setAttr)
// is installed before tests instantiate elements via document.createElement.
import "obsidian";
import type { Plugin } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectionStore } from "../../../../src/connection/connectionStore";
import type { TomoInstance } from "../../../../src/connection/types";
import {
	StatusBarIcon,
	type StatusBarActions,
} from "../../../../src/ui/status-bar/StatusBarIcon";
import { openPopover } from "../../../../src/ui/status-bar/openPopover";

vi.mock("../../../../src/ui/status-bar/openPopover", () => ({
	openPopover: vi.fn(),
}));

// --- factories ---------------------------------------------------------------

let _instCounter = 0;
const inst = (overrides: Partial<TomoInstance> = {}): TomoInstance => {
	_instCounter += 1;
	const seed = `abcdef${_instCounter.toString().padStart(6, "0")}`;
	const containerId = seed.padEnd(64, "0");
	return {
		containerId,
		shortId: containerId.slice(0, 12),
		name: "test-instance",
		startedAt: new Date("2026-04-28T11:55:00Z"),
		image: "miyo/tomo:0.7.0",
		...overrides,
	};
};

const makeActions = (): StatusBarActions => ({
	onForceReconnect: vi.fn(),
	onOpenChat: vi.fn(),
	onOpenSettings: vi.fn(),
});

// Minimal plugin stub — StatusBarIcon only calls `plugin.addStatusBarItem()`.
// Mirrors the cast-funnel pattern from `SettingsTab.test.ts`.
interface PluginStub {
	addStatusBarItem: ReturnType<typeof vi.fn>;
}

function asPlugin(stub: PluginStub): Plugin {
	return stub as unknown as Plugin;
}

interface Harness {
	plugin: PluginStub;
	icon: StatusBarIcon;
	actions: StatusBarActions;
	chosenInstanceId: ReturnType<typeof vi.fn>;
	getRoot: () => HTMLElement;
}

const mountIcon = (chosenId: string | null = null): Harness => {
	const created: HTMLElement[] = [];
	const plugin: PluginStub = {
		addStatusBarItem: vi.fn(() => {
			const el = document.createElement("div");
			document.body.appendChild(el);
			created.push(el);
			return el;
		}),
	};
	const actions = makeActions();
	const chosenInstanceId = vi.fn(() => chosenId);
	const icon = new StatusBarIcon(asPlugin(plugin), actions, chosenInstanceId);
	icon.mount();
	return {
		plugin,
		icon,
		actions,
		chosenInstanceId,
		getRoot: () => {
			const root = created[0];
			if (root === undefined) throw new Error("status bar item not created");
			return root;
		},
	};
};

describe("StatusBarIcon", () => {
	beforeEach(() => {
		connectionStore.set({ kind: "disconnected" });
		vi.clearAllMocks();
	});

	afterEach(() => {
		connectionStore.set({ kind: "disconnected" });
		document.body.innerHTML = "";
	});

	it("creates a status bar element with hashi-status-bar class on mount", () => {
		const h = mountIcon();
		expect(h.plugin.addStatusBarItem).toHaveBeenCalledTimes(1);
		expect(h.getRoot().classList.contains("hashi-status-bar")).toBe(true);
	});

	it("element has role='button' and tabindex='0' for keyboard a11y", () => {
		const h = mountIcon();
		expect(h.getRoot().getAttribute("role")).toBe("button");
		expect(h.getRoot().getAttribute("tabindex")).toBe("0");
	});

	it("element has aria-live attribute (polite by default) for state-change announcements (PRD F3/AC9)", () => {
		const h = mountIcon();
		// On initial subscribe the disconnected state escalates to assertive
		// (a fresh app-load disconnected state isn't a transient — see test
		// below). The presence of the attribute is what matters here.
		expect(h.getRoot().getAttribute("aria-live")).not.toBeNull();
	});

	it("aria-live escalates to 'assertive' on disconnected, polite on transitional states", () => {
		const h = mountIcon();
		// Walk through transitional → disconnected to observe the escalation,
		// not just the initial value.
		connectionStore.set({ kind: "connected", instance: inst() });
		expect(h.getRoot().getAttribute("aria-live")).toBe("polite");

		connectionStore.set({
			kind: "reconnecting",
			target: inst(),
			attempt: 1,
			nextDelayMs: 500,
		});
		expect(h.getRoot().getAttribute("aria-live")).toBe("polite");

		connectionStore.set({ kind: "attaching", target: inst() });
		expect(h.getRoot().getAttribute("aria-live")).toBe("polite");

		connectionStore.set({
			kind: "disconnected",
			reason: { code: "attach-failed", detail: "stream error" },
		});
		expect(h.getRoot().getAttribute("aria-live")).toBe("assertive");
	});

	it("contains the 友 kanji glyph", () => {
		const h = mountIcon();
		const glyph = h.getRoot().querySelector(".hashi-status-bar-glyph");
		expect(glyph).not.toBeNull();
		expect(glyph?.textContent).toBe("友");
	});

	it("includes a state indicator span (so state is conveyed beyond color)", () => {
		const h = mountIcon();
		const indicator = h.getRoot().querySelector(".hashi-status-bar-indicator");
		expect(indicator).not.toBeNull();
		expect(indicator?.getAttribute("aria-hidden")).toBe("true");
	});

	it("starts with is-disconnected class on initial subscribe", () => {
		const h = mountIcon();
		expect(h.getRoot().classList.contains("is-disconnected")).toBe(true);
	});

	it("transitions to is-connected when state becomes connected", () => {
		const h = mountIcon();
		connectionStore.set({ kind: "connected", instance: inst() });
		expect(h.getRoot().classList.contains("is-connected")).toBe(true);
		expect(h.getRoot().classList.contains("is-disconnected")).toBe(false);
		expect(h.getRoot().classList.contains("is-reconnecting")).toBe(false);
	});

	it("transitions to is-reconnecting on Reconnecting state", () => {
		const h = mountIcon();
		connectionStore.set({
			kind: "reconnecting",
			target: inst(),
			attempt: 1,
			nextDelayMs: 1000,
		});
		expect(h.getRoot().classList.contains("is-reconnecting")).toBe(true);
		expect(h.getRoot().classList.contains("is-connected")).toBe(false);
		expect(h.getRoot().classList.contains("is-disconnected")).toBe(false);
	});

	it("transitions to is-reconnecting on Attaching state", () => {
		const h = mountIcon();
		connectionStore.set({ kind: "attaching", target: inst() });
		expect(h.getRoot().classList.contains("is-reconnecting")).toBe(true);
		expect(h.getRoot().classList.contains("is-connected")).toBe(false);
		expect(h.getRoot().classList.contains("is-disconnected")).toBe(false);
	});

	it("returns to is-disconnected after going through other states", () => {
		const h = mountIcon();
		connectionStore.set({ kind: "connected", instance: inst() });
		connectionStore.set({ kind: "disconnected" });
		expect(h.getRoot().classList.contains("is-disconnected")).toBe(true);
		expect(h.getRoot().classList.contains("is-connected")).toBe(false);
	});

	it("tooltip says 'Tomo: <name>' when connected with named instance", () => {
		const h = mountIcon();
		connectionStore.set({
			kind: "connected",
			instance: inst({ name: "my-tomo" }),
		});
		expect(h.getRoot().getAttribute("aria-label")).toBe("Tomo: my-tomo");
		expect(h.getRoot().getAttribute("title")).toBe("Tomo: my-tomo");
	});

	it("tooltip falls back to shortId when name is null", () => {
		const h = mountIcon();
		const i = inst({ name: null });
		connectionStore.set({ kind: "connected", instance: i });
		expect(h.getRoot().getAttribute("aria-label")).toBe(`Tomo: ${i.shortId}`);
	});

	it("tooltip says 'Reconnecting…' on reconnecting", () => {
		const h = mountIcon();
		connectionStore.set({
			kind: "reconnecting",
			target: inst(),
			attempt: 1,
			nextDelayMs: 1000,
		});
		expect(h.getRoot().getAttribute("aria-label")).toBe("Reconnecting…");
	});

	it("tooltip says 'Connecting…' on attaching", () => {
		const h = mountIcon();
		connectionStore.set({ kind: "attaching", target: inst() });
		expect(h.getRoot().getAttribute("aria-label")).toBe("Connecting…");
	});

	it("tooltip says 'Tomo: disconnected' on disconnected", () => {
		const h = mountIcon();
		expect(h.getRoot().getAttribute("aria-label")).toBe("Tomo: disconnected");
	});

	it("click triggers openPopover with forceReconnectEnabled=false when no chosen instance", () => {
		const h = mountIcon(null);
		h.getRoot().dispatchEvent(new MouseEvent("click"));
		expect(openPopover).toHaveBeenCalledTimes(1);
		const callArgs = vi.mocked(openPopover).mock.calls[0];
		expect(callArgs).toBeDefined();
		const popoverActions = callArgs![1];
		expect(popoverActions.forceReconnectEnabled).toBe(false);
	});

	it("click triggers openPopover with forceReconnectEnabled=true when an instance is chosen", () => {
		const h = mountIcon("instance-id-123");
		h.getRoot().dispatchEvent(new MouseEvent("click"));
		expect(openPopover).toHaveBeenCalledTimes(1);
		const callArgs = vi.mocked(openPopover).mock.calls[0];
		expect(callArgs).toBeDefined();
		const popoverActions = callArgs![1];
		expect(popoverActions.forceReconnectEnabled).toBe(true);
	});

	it("click forwards all action callbacks to openPopover", () => {
		const h = mountIcon("any-id");
		h.getRoot().dispatchEvent(new MouseEvent("click"));
		const callArgs = vi.mocked(openPopover).mock.calls[0];
		expect(callArgs).toBeDefined();
		const popoverActions = callArgs![1];
		expect(popoverActions.onForceReconnect).toBe(h.actions.onForceReconnect);
		expect(popoverActions.onOpenChat).toBe(h.actions.onOpenChat);
		expect(popoverActions.onOpenSettings).toBe(h.actions.onOpenSettings);
	});

	it("Enter key triggers openPopover", () => {
		const h = mountIcon();
		h.getRoot().dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
		expect(openPopover).toHaveBeenCalledTimes(1);
	});

	it("Space key triggers openPopover", () => {
		const h = mountIcon();
		h.getRoot().dispatchEvent(
			new KeyboardEvent("keydown", { key: " ", bubbles: true }),
		);
		expect(openPopover).toHaveBeenCalledTimes(1);
	});

	it("other keys do not trigger openPopover", () => {
		const h = mountIcon();
		h.getRoot().dispatchEvent(
			new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
		);
		h.getRoot().dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
		expect(openPopover).not.toHaveBeenCalled();
	});

	it("unmount() unsubscribes from connectionStore", () => {
		const h = mountIcon();
		// before unmount: store updates reach the element
		connectionStore.set({ kind: "connected", instance: inst() });
		expect(h.getRoot().classList.contains("is-connected")).toBe(true);
		// unmount — subsequent updates must not reach the element
		h.icon.unmount();
		const rootAtUnmount = h.getRoot();
		connectionStore.set({ kind: "disconnected" });
		// the class remains "is-connected" because the listener no longer fires
		expect(rootAtUnmount.classList.contains("is-connected")).toBe(true);
		expect(rootAtUnmount.classList.contains("is-disconnected")).toBe(false);
	});
});
