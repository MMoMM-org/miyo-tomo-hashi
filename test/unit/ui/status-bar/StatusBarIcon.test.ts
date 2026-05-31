/**
 * Unit tests for StatusBarIcon — Phase-4 T4.2 status bar icon +
 * T4.4 IDE Bridge combined state.
 *
 * Spec refs: spec 001-session-view phase-4 T4.2; PRD F3 (all ACs);
 * spec 003-ide-bridge phase-4 T4.4; SDD ADR-6, ADR-9,
 * "UI Visualization / Status bar icon".
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
import { ideBridgeStore } from "../../../../src/ide-bridge/ideBridgeStore";
import type { IdeBridgeState } from "../../../../src/ide-bridge/state";
import {
	StatusBarIcon,
	type StatusBarActions,
	combinedClass,
	copyAuthToken,
	ideStatusLine,
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

// Minimal plugin stub — StatusBarIcon calls `plugin.addStatusBarItem()` and
// `plugin.registerDomEvent()` (the latter is the Obsidian-idiomatic
// auto-cleanup wrapper around addEventListener; in tests we proxy through
// to the real DOM listener so dispatchEvent() still triggers the handler).
// Mirrors the cast-funnel pattern from `SettingsTab.test.ts`.
interface PluginStub {
	addStatusBarItem: ReturnType<typeof vi.fn>;
	registerDomEvent: ReturnType<typeof vi.fn>;
}

function asPlugin(stub: PluginStub): Plugin {
	return stub as unknown as Plugin;
}

interface Harness {
	plugin: PluginStub;
	icon: StatusBarIcon;
	actions: StatusBarActions;
	getChosenInstanceName: ReturnType<typeof vi.fn>;
	onCopyToken: ReturnType<typeof vi.fn>;
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
		registerDomEvent: vi.fn(
			(el: HTMLElement, type: string, cb: EventListener) => {
				el.addEventListener(type, cb);
			},
		),
	};
	const actions = makeActions();
	const getChosenInstanceName = vi.fn(() => chosenId);
	const onCopyToken = vi.fn();
	const icon = new StatusBarIcon(asPlugin(plugin), actions, getChosenInstanceName, onCopyToken);
	icon.mount();
	return {
		plugin,
		icon,
		actions,
		getChosenInstanceName,
		onCopyToken,
		getRoot: () => {
			const root = created[0];
			if (root === undefined) throw new Error("status bar item not created");
			return root;
		},
	};
};

// --- combinedClass pure function tests ---------------------------------------

describe("combinedClass", () => {
	it("ide error wins over Docker connected → is-error", () => {
		const ide: IdeBridgeState = { kind: "error", reason: "port in use" };
		expect(combinedClass({ kind: "connected", instance: inst() }, ide)).toBe("is-error");
	});

	it("ide stopped + Docker connected → is-connected (regression: bridge disabled preserves Docker state)", () => {
		const ide: IdeBridgeState = { kind: "stopped" };
		expect(combinedClass({ kind: "connected", instance: inst() }, ide)).toBe("is-connected");
	});

	it("ide healthy (listening) + Docker disconnected → is-disconnected", () => {
		const ide: IdeBridgeState = { kind: "listening", port: 23027 };
		expect(combinedClass({ kind: "disconnected" }, ide)).toBe("is-disconnected");
	});

	it("ide healthy (connected) + Docker disconnected → is-disconnected", () => {
		const ide: IdeBridgeState = { kind: "connected", port: 23027, clientCount: 1 };
		expect(combinedClass({ kind: "disconnected" }, ide)).toBe("is-disconnected");
	});

	it("ide error wins over Docker disconnected → is-error", () => {
		const ide: IdeBridgeState = { kind: "error", reason: "crash" };
		expect(combinedClass({ kind: "disconnected" }, ide)).toBe("is-error");
	});

	it("ide stopped + Docker reconnecting → is-reconnecting", () => {
		const ide: IdeBridgeState = { kind: "stopped" };
		expect(combinedClass({ kind: "reconnecting", target: inst(), attempt: 1, nextDelayMs: 500 }, ide)).toBe("is-reconnecting");
	});

	it("ide stopped + Docker attaching → is-reconnecting", () => {
		const ide: IdeBridgeState = { kind: "stopped" };
		expect(combinedClass({ kind: "attaching", target: inst() }, ide)).toBe("is-reconnecting");
	});

	it("both healthy → is-connected", () => {
		const ide: IdeBridgeState = { kind: "connected", port: 23027, clientCount: 2 };
		expect(combinedClass({ kind: "connected", instance: inst() }, ide)).toBe("is-connected");
	});
});

// --- ideStatusLine pure function tests ---------------------------------------

describe("ideStatusLine", () => {
	it("stopped → 'IDE Bridge: stopped'", () => {
		expect(ideStatusLine({ kind: "stopped" })).toBe("IDE Bridge: stopped");
	});

	it("listening → 'IDE Bridge: listening :${port}'", () => {
		expect(ideStatusLine({ kind: "listening", port: 23027 })).toBe("IDE Bridge: listening :23027");
	});

	it("connected → 'IDE Bridge: connected(N) :${port}'", () => {
		expect(ideStatusLine({ kind: "connected", port: 23027, clientCount: 3 })).toBe("IDE Bridge: connected(3) :23027");
	});

	it("error → 'IDE Bridge: error — ${reason}'", () => {
		expect(ideStatusLine({ kind: "error", reason: "port 23027 in use" })).toBe("IDE Bridge: error — port 23027 in use");
	});
});

// --- copyAuthToken W2 tests --------------------------------------------------

describe("copyAuthToken", () => {
	it("writes the token to the clipboard and notifies success", async () => {
		const writeText = vi.fn(() => Promise.resolve());
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		});
		const notify = vi.fn();
		copyAuthToken(() => "my-token", notify);
		// Allow the resolved promise microtask to run
		await Promise.resolve();
		expect(writeText).toHaveBeenCalledWith("my-token");
		expect(notify).toHaveBeenCalledWith("Auth token copied");
	});

	it("shows a failure Notice when clipboard write is rejected (no unhandled rejection)", async () => {
		const writeText = vi.fn(() => Promise.reject(new Error("permission denied")));
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		});
		const notify = vi.fn();
		// Should not throw an unhandled rejection — the rejection is handled
		// in the .then second callback.
		copyAuthToken(() => "my-token", notify);
		await Promise.resolve();
		expect(notify).toHaveBeenCalledWith("Could not copy token — clipboard access denied");
	});
});

// --- StatusBarIcon integration tests ----------------------------------------

describe("StatusBarIcon", () => {
	beforeEach(() => {
		connectionStore.set({ kind: "disconnected" });
		ideBridgeStore.set({ kind: "stopped" });
		vi.clearAllMocks();
	});

	afterEach(() => {
		connectionStore.set({ kind: "disconnected" });
		ideBridgeStore.set({ kind: "stopped" });
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

	it("aria-live is 'assertive' when ide error state is active", () => {
		const h = mountIcon();
		connectionStore.set({ kind: "connected", instance: inst() });
		ideBridgeStore.set({ kind: "error", reason: "port in use" });
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

	it("ide error overrides Docker connected → is-error class applied", () => {
		const h = mountIcon();
		connectionStore.set({ kind: "connected", instance: inst() });
		ideBridgeStore.set({ kind: "error", reason: "port in use" });
		expect(h.getRoot().classList.contains("is-error")).toBe(true);
		expect(h.getRoot().classList.contains("is-connected")).toBe(false);
	});

	it("ide stopped does not change Docker-driven class (regression: bridge disabled)", () => {
		const h = mountIcon();
		connectionStore.set({ kind: "connected", instance: inst() });
		ideBridgeStore.set({ kind: "stopped" });
		expect(h.getRoot().classList.contains("is-connected")).toBe(true);
		expect(h.getRoot().classList.contains("is-error")).toBe(false);
	});

	it("ide error cleared → Docker state resumes", () => {
		const h = mountIcon();
		connectionStore.set({ kind: "connected", instance: inst() });
		ideBridgeStore.set({ kind: "error", reason: "crash" });
		expect(h.getRoot().classList.contains("is-error")).toBe(true);
		// Transition back to healthy
		ideBridgeStore.set({ kind: "stopped" });
		expect(h.getRoot().classList.contains("is-connected")).toBe(true);
		expect(h.getRoot().classList.contains("is-error")).toBe(false);
	});

	it("tooltip says 'Tomo: <name>' when connected with named instance", () => {
		const h = mountIcon();
		connectionStore.set({
			kind: "connected",
			instance: inst({ name: "my-tomo" }),
		});
		expect(h.getRoot().getAttribute("aria-label")).toContain("Tomo: my-tomo");
	});

	it("tooltip falls back to shortId when name is null", () => {
		const h = mountIcon();
		const i = inst({ name: null });
		connectionStore.set({ kind: "connected", instance: i });
		expect(h.getRoot().getAttribute("aria-label")).toContain(`Tomo: ${i.shortId}`);
	});

	it("tooltip says 'Reconnecting…' on reconnecting", () => {
		const h = mountIcon();
		connectionStore.set({
			kind: "reconnecting",
			target: inst(),
			attempt: 1,
			nextDelayMs: 1000,
		});
		expect(h.getRoot().getAttribute("aria-label")).toContain("Reconnecting…");
	});

	it("tooltip says 'Connecting…' on attaching", () => {
		const h = mountIcon();
		connectionStore.set({ kind: "attaching", target: inst() });
		expect(h.getRoot().getAttribute("aria-label")).toContain("Connecting…");
	});

	it("tooltip says 'Tomo: disconnected' on disconnected", () => {
		const h = mountIcon();
		expect(h.getRoot().getAttribute("aria-label")).toContain("Tomo: disconnected");
	});

	it("aria-label includes IDE status line when ide is not stopped", () => {
		const h = mountIcon();
		ideBridgeStore.set({ kind: "listening", port: 23027 });
		expect(h.getRoot().getAttribute("aria-label")).toContain("IDE Bridge: listening :23027");
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

	it("click passes ideStatusLine in popover actions", () => {
		const h = mountIcon("any-id");
		ideBridgeStore.set({ kind: "listening", port: 23027 });
		h.getRoot().dispatchEvent(new MouseEvent("click"));
		const callArgs = vi.mocked(openPopover).mock.calls[0];
		expect(callArgs).toBeDefined();
		const popoverActions = callArgs![1];
		expect(popoverActions.ideStatusLine).toBe("IDE Bridge: listening :23027");
	});

	it("click passes ideRunning=true when bridge is listening", () => {
		const h = mountIcon("any-id");
		ideBridgeStore.set({ kind: "listening", port: 23027 });
		h.getRoot().dispatchEvent(new MouseEvent("click"));
		const callArgs = vi.mocked(openPopover).mock.calls[0];
		expect(callArgs![1].ideRunning).toBe(true);
	});

	it("click passes ideRunning=true when bridge has connected client", () => {
		const h = mountIcon("any-id");
		ideBridgeStore.set({ kind: "connected", port: 23027, clientCount: 1 });
		h.getRoot().dispatchEvent(new MouseEvent("click"));
		const callArgs = vi.mocked(openPopover).mock.calls[0];
		expect(callArgs![1].ideRunning).toBe(true);
	});

	it("click passes ideRunning=false when bridge is stopped", () => {
		const h = mountIcon("any-id");
		ideBridgeStore.set({ kind: "stopped" });
		h.getRoot().dispatchEvent(new MouseEvent("click"));
		const callArgs = vi.mocked(openPopover).mock.calls[0];
		expect(callArgs![1].ideRunning).toBe(false);
	});

	it("click passes ideRunning=false when bridge is in error", () => {
		const h = mountIcon("any-id");
		ideBridgeStore.set({ kind: "error", reason: "crash" });
		h.getRoot().dispatchEvent(new MouseEvent("click"));
		const callArgs = vi.mocked(openPopover).mock.calls[0];
		expect(callArgs![1].ideRunning).toBe(false);
	});

	it("click passes onCopyToken callback that delegates to the injected callback", () => {
		const h = mountIcon("any-id");
		ideBridgeStore.set({ kind: "listening", port: 23027 });
		h.getRoot().dispatchEvent(new MouseEvent("click"));
		const callArgs = vi.mocked(openPopover).mock.calls[0];
		expect(callArgs).toBeDefined();
		const { onCopyToken } = callArgs![1];
		expect(onCopyToken).toBeTypeOf("function");
		// Invoking it should call the injected onCopyToken spy
		onCopyToken();
		expect(h.onCopyToken).toHaveBeenCalledTimes(1);
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

	it("unmount() unsubscribes from ideBridgeStore — ide store changes do NOT mutate element", () => {
		const h = mountIcon();
		connectionStore.set({ kind: "connected", instance: inst() });
		h.icon.unmount();
		const rootAtUnmount = h.getRoot();
		// Both stores fire after unmount — element must not change
		ideBridgeStore.set({ kind: "error", reason: "post-unmount error" });
		connectionStore.set({ kind: "disconnected" });
		// Still shows is-connected from before unmount
		expect(rootAtUnmount.classList.contains("is-connected")).toBe(true);
		expect(rootAtUnmount.classList.contains("is-error")).toBe(false);
		expect(rootAtUnmount.classList.contains("is-disconnected")).toBe(false);
	});
});
