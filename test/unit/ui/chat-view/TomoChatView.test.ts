/**
 * Unit tests for TomoChatView — Phase-4 T4.3 chat view.
 *
 * Spec refs: spec 001-session-view phase-4 T4.3; PRD F4 (chat view), F5
 * (bidirectional chat), F8 (force-reconnect parity); SDD ADR-2 (xterm.js
 * via Docker stream), ADR-6 (CSS classes only — theme-bound colors),
 * "UI Visualization / Chat view".
 *
 * The terminalHost module is mocked wholesale because xterm.js + jsdom is
 * unstable (Canvas/WebGL renderers, DOM-renderer measurement quirks). Tests
 * verify the contract — what TomoChatView calls — without driving real
 * xterm. A separate smoke test exercises the terminalHost module surface.
 */

// Side-effect import (not just `import type`) so the obsidian mock module
// loads and its HTMLElement prototype shim (createDiv / createEl / addClass /
// setAttr / setText) is installed before tests instantiate elements.
import "obsidian";
import { WorkspaceLeaf } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectionStore } from "../../../../src/connection/connectionStore";
import type { TomoConnection } from "../../../../src/connection/TomoConnection";
import type { TomoInstance } from "../../../../src/connection/types";
import { VIEW_TYPE_TOMO_CHAT } from "../../../../src/ui/chat-view/index";
import * as terminalHost from "../../../../src/ui/chat-view/terminalHost";
import { TomoChatView } from "../../../../src/ui/chat-view/TomoChatView";

// Per-test mutable hooks so individual tests can assert against the same
// terminal instance the view holds. Captured at createTerminal-time so the
// view code can call onData / onResize without indirection.
interface TerminalHooks {
	onDataCb: ((data: string) => void) | null;
	onResizeCb: ((dims: { rows: number; cols: number }) => void) | null;
	rows: number;
	cols: number;
}

const terminalHooks: TerminalHooks = {
	onDataCb: null,
	onResizeCb: null,
	rows: 24,
	cols: 80,
};

vi.mock("../../../../src/ui/chat-view/terminalHost", () => ({
	createTerminal: vi.fn(() => ({
		terminal: {
			write: vi.fn(),
			dispose: vi.fn(),
			// xterm-onData wiring (T7 fix): TomoChatView subscribes via
			// terminal.onData to forward keystrokes typed inside the xterm
			// area to the container's stdin. Mock returns a disposable.
			onData: vi.fn((cb: (data: string) => void) => {
				terminalHooks.onDataCb = cb;
				return { dispose: vi.fn() };
			}),
			onResize: vi.fn(
				(cb: (dims: { rows: number; cols: number }) => void) => {
					terminalHooks.onResizeCb = cb;
					return { dispose: vi.fn() };
				},
			),
			get rows() {
				return terminalHooks.rows;
			},
			get cols() {
				return terminalHooks.cols;
			},
		},
		fitAddon: { fit: vi.fn() },
	})),
	writeChunk: vi.fn(),
	fit: vi.fn(),
	dispose: vi.fn(),
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
		startedAt: new Date("2026-04-28T12:00:00Z"),
		image: "miyo/tomo:0.7.0",
		...overrides,
	};
};

interface FakeConnection {
	forceReconnect: ReturnType<typeof vi.fn>;
	write: ReturnType<typeof vi.fn>;
	onData: ReturnType<typeof vi.fn>;
	resize: ReturnType<typeof vi.fn>;
	disposeListener: ReturnType<typeof vi.fn>;
	fireData: (chunk: Uint8Array) => void;
}

function makeConnection(): FakeConnection {
	const dataListeners: Array<(chunk: Uint8Array) => void> = [];
	const disposeListener = vi.fn(() => {
		// emptied on dispose so subsequent fireData calls hit no listeners
		dataListeners.length = 0;
	});
	return {
		forceReconnect: vi.fn(async () => {}),
		write: vi.fn((_s: string) => {}),
		onData: vi.fn((cb: (chunk: Uint8Array) => void) => {
			dataListeners.push(cb);
			return { dispose: disposeListener };
		}),
		resize: vi.fn(async (_rows: number, _cols: number) => {}),
		disposeListener,
		fireData: (chunk: Uint8Array) => {
			for (const cb of dataListeners) cb(chunk);
		},
	};
}

function asConnection(c: FakeConnection): TomoConnection {
	return c as unknown as TomoConnection;
}

interface Harness {
	view: TomoChatView;
	connection: FakeConnection;
	chosenInstanceId: ReturnType<typeof vi.fn>;
	root: HTMLElement;
}

const mountView = async (chosenId: string | null = null): Promise<Harness> => {
	const leaf = new WorkspaceLeaf();
	const connection = makeConnection();
	const chosenInstanceId = vi.fn(() => chosenId);
	const view = new TomoChatView(leaf, asConnection(connection), chosenInstanceId);
	await view.onOpen();
	return { view, connection, chosenInstanceId, root: view.contentEl };
};

describe("TomoChatView — view-type metadata", () => {
	it("getViewType returns VIEW_TYPE_TOMO_CHAT", async () => {
		const h = await mountView();
		expect(h.view.getViewType()).toBe(VIEW_TYPE_TOMO_CHAT);
	});

	it("getDisplayText returns the chat-view label", async () => {
		const h = await mountView();
		expect(h.view.getDisplayText()).toBe("Tomo chat");
	});
});

describe("TomoChatView — DOM skeleton", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		connectionStore.set({ kind: "disconnected" });
	});

	afterEach(() => {
		connectionStore.set({ kind: "disconnected" });
	});

	it("onOpen builds the DOM skeleton (header, indicator, force-reconnect button, terminal host, input)", async () => {
		const h = await mountView();
		expect(h.root.classList.contains("hashi-chat-view")).toBe(true);
		expect(h.root.querySelector(".hashi-chat-view-header")).not.toBeNull();
		expect(h.root.querySelector(".hashi-chat-view-indicator")).not.toBeNull();
		expect(
			h.root.querySelector(".hashi-chat-view-force-reconnect"),
		).not.toBeNull();
		expect(
			h.root.querySelector(".hashi-chat-view-terminal-host"),
		).not.toBeNull();
		expect(h.root.querySelector(".hashi-chat-view-input")).not.toBeNull();
	});

	it("creates the terminal session via terminalHost.createTerminal on the terminal-host element", async () => {
		const h = await mountView();
		expect(terminalHost.createTerminal).toHaveBeenCalledTimes(1);
		const args = vi.mocked(terminalHost.createTerminal).mock.calls[0];
		expect(args).toBeDefined();
		const container = args![0];
		expect(container.classList.contains("hashi-chat-view-terminal-host")).toBe(
			true,
		);
	});

	it("subscribes connection.onData on mount", async () => {
		const h = await mountView();
		expect(h.connection.onData).toHaveBeenCalledTimes(1);
	});
});

describe("TomoChatView — input enabled/disabled gating", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		connectionStore.set({ kind: "disconnected" });
	});

	afterEach(() => {
		connectionStore.set({ kind: "disconnected" });
	});

	it("input is disabled when state is disconnected", async () => {
		const h = await mountView();
		const input = h.root.querySelector<HTMLInputElement>(
			".hashi-chat-view-input",
		);
		expect(input).not.toBeNull();
		expect(input!.disabled).toBe(true);
	});

	it("input is disabled when state is attaching", async () => {
		const h = await mountView();
		connectionStore.set({ kind: "attaching", target: inst() });
		const input = h.root.querySelector<HTMLInputElement>(
			".hashi-chat-view-input",
		);
		expect(input!.disabled).toBe(true);
	});

	it("input is disabled when state is reconnecting", async () => {
		const h = await mountView();
		connectionStore.set({
			kind: "reconnecting",
			target: inst(),
			attempt: 1,
			nextDelayMs: 500,
		});
		const input = h.root.querySelector<HTMLInputElement>(
			".hashi-chat-view-input",
		);
		expect(input!.disabled).toBe(true);
	});

	it("input is enabled when state transitions to connected", async () => {
		const h = await mountView();
		connectionStore.set({ kind: "connected", instance: inst() });
		const input = h.root.querySelector<HTMLInputElement>(
			".hashi-chat-view-input",
		);
		expect(input!.disabled).toBe(false);
	});

	it("input is focused when transitioning from disabled to enabled", async () => {
		const h = await mountView();
		// Append the contentEl into document.body so `focus()` actually moves
		// activeElement; jsdom requires a connected element.
		document.body.appendChild(h.root);
		connectionStore.set({ kind: "connected", instance: inst() });
		const input = h.root.querySelector<HTMLInputElement>(
			".hashi-chat-view-input",
		);
		expect(document.activeElement).toBe(input);
	});
});

describe("TomoChatView — message send", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		connectionStore.set({ kind: "disconnected" });
	});

	afterEach(() => {
		connectionStore.set({ kind: "disconnected" });
	});

	it("Enter key sends the input value with a trailing newline via connection.write", async () => {
		const h = await mountView();
		connectionStore.set({ kind: "connected", instance: inst() });
		const input = h.root.querySelector<HTMLInputElement>(
			".hashi-chat-view-input",
		);
		input!.value = "hello";
		input!.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
		expect(h.connection.write).toHaveBeenCalledTimes(1);
		expect(h.connection.write).toHaveBeenCalledWith("hello\n");
	});

	it("Enter clears the input field after sending", async () => {
		const h = await mountView();
		connectionStore.set({ kind: "connected", instance: inst() });
		const input = h.root.querySelector<HTMLInputElement>(
			".hashi-chat-view-input",
		);
		input!.value = "ping";
		input!.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
		expect(input!.value).toBe("");
	});

	it("empty input does not call connection.write", async () => {
		const h = await mountView();
		connectionStore.set({ kind: "connected", instance: inst() });
		const input = h.root.querySelector<HTMLInputElement>(
			".hashi-chat-view-input",
		);
		input!.value = "";
		input!.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
		expect(h.connection.write).not.toHaveBeenCalled();
	});

	it("Shift+Enter does not send", async () => {
		const h = await mountView();
		connectionStore.set({ kind: "connected", instance: inst() });
		const input = h.root.querySelector<HTMLInputElement>(
			".hashi-chat-view-input",
		);
		input!.value = "draft";
		input!.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Enter",
				shiftKey: true,
				bubbles: true,
			}),
		);
		expect(h.connection.write).not.toHaveBeenCalled();
	});
});

describe("TomoChatView — stream forwarding", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		connectionStore.set({ kind: "disconnected" });
	});

	afterEach(() => {
		connectionStore.set({ kind: "disconnected" });
	});

	it("forwards onData chunks to terminalHost.writeChunk", async () => {
		const h = await mountView();
		const chunk = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]); // "hello"
		h.connection.fireData(chunk);
		expect(terminalHost.writeChunk).toHaveBeenCalledTimes(1);
		const call = vi.mocked(terminalHost.writeChunk).mock.calls[0];
		expect(call).toBeDefined();
		expect(call![1]).toBe(chunk);
	});

	it("forwards multiple chunks in order", async () => {
		const h = await mountView();
		const a = new Uint8Array([0x61]);
		const b = new Uint8Array([0x62]);
		h.connection.fireData(a);
		h.connection.fireData(b);
		expect(terminalHost.writeChunk).toHaveBeenCalledTimes(2);
		const calls = vi.mocked(terminalHost.writeChunk).mock.calls;
		expect(calls[0]![1]).toBe(a);
		expect(calls[1]![1]).toBe(b);
	});
});

describe("TomoChatView — force reconnect button", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		connectionStore.set({ kind: "disconnected" });
	});

	afterEach(() => {
		connectionStore.set({ kind: "disconnected" });
	});

	it("click calls connection.forceReconnect()", async () => {
		const h = await mountView("instance-id-123");
		const btn = h.root.querySelector<HTMLButtonElement>(
			".hashi-chat-view-force-reconnect",
		);
		btn!.dispatchEvent(new MouseEvent("click"));
		expect(h.connection.forceReconnect).toHaveBeenCalledTimes(1);
	});

	it("is disabled when chosenInstanceId() returns null", async () => {
		const h = await mountView(null);
		const btn = h.root.querySelector<HTMLButtonElement>(
			".hashi-chat-view-force-reconnect",
		);
		expect(btn!.disabled).toBe(true);
	});

	it("is enabled when chosenInstanceId() returns a string", async () => {
		const h = await mountView("instance-id-123");
		const btn = h.root.querySelector<HTMLButtonElement>(
			".hashi-chat-view-force-reconnect",
		);
		expect(btn!.disabled).toBe(false);
	});
});

describe("TomoChatView — indicator", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		connectionStore.set({ kind: "disconnected" });
	});

	afterEach(() => {
		connectionStore.set({ kind: "disconnected" });
	});

	it("indicator shows 'Connected — <name>' on connected", async () => {
		const h = await mountView();
		connectionStore.set({
			kind: "connected",
			instance: inst({ name: "my-tomo" }),
		});
		const ind = h.root.querySelector(".hashi-chat-view-indicator");
		expect(ind!.textContent).toBe("Connected — my-tomo");
		expect(ind!.classList.contains("is-connected")).toBe(true);
	});

	it("indicator shows reconnecting attempt number", async () => {
		const h = await mountView();
		connectionStore.set({
			kind: "reconnecting",
			target: inst(),
			attempt: 3,
			nextDelayMs: 4000,
		});
		const ind = h.root.querySelector(".hashi-chat-view-indicator");
		expect(ind!.textContent).toContain("3");
		expect(ind!.classList.contains("is-reconnecting")).toBe(true);
	});

	it("indicator shows attaching label", async () => {
		const h = await mountView();
		connectionStore.set({
			kind: "attaching",
			target: inst({ name: "boot-tomo" }),
		});
		const ind = h.root.querySelector(".hashi-chat-view-indicator");
		expect(ind!.textContent).toContain("boot-tomo");
		expect(ind!.classList.contains("is-attaching")).toBe(true);
	});

	it("indicator shows disconnected label", async () => {
		const h = await mountView();
		connectionStore.set({ kind: "disconnected" });
		const ind = h.root.querySelector(".hashi-chat-view-indicator");
		expect(ind!.textContent).toBe("Disconnected");
		expect(ind!.classList.contains("is-disconnected")).toBe(true);
	});
});

describe("TomoChatView — pty resize wiring", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		connectionStore.set({ kind: "disconnected" });
		terminalHooks.onResizeCb = null;
		terminalHooks.onDataCb = null;
		terminalHooks.rows = 24;
		terminalHooks.cols = 80;
	});

	afterEach(() => {
		connectionStore.set({ kind: "disconnected" });
	});

	it("subscribes terminal.onResize and forwards rows/cols to connection.resize", async () => {
		// Without this, the container PTY stays at the docker-run -it default
		// (80x24) regardless of xterm's actual size. Claude Code in the
		// container draws TUI frames for the wrong geometry, leaving stale
		// animation frames as ghost lines in the chat view.
		const h = await mountView();
		expect(terminalHooks.onResizeCb).not.toBeNull();
		terminalHooks.onResizeCb!({ rows: 42, cols: 173 });
		expect(h.connection.resize).toHaveBeenCalledTimes(1);
		expect(h.connection.resize).toHaveBeenCalledWith(42, 173);
	});

	it("on transition to connected, fits and pushes current geometry to connection.resize", async () => {
		// Auto-reconnect / first-connect path: the container's new PTY starts
		// at 80x24. Pushing the cached xterm size right after Connected
		// resyncs the geometry without waiting for a layout change to fire
		// xterm's onResize.
		const h = await mountView();
		terminalHooks.rows = 50;
		terminalHooks.cols = 200;
		connectionStore.set({ kind: "connected", instance: inst() });
		// Allow the post-state hook to run (it may be async).
		await Promise.resolve();
		expect(h.connection.resize).toHaveBeenCalledWith(50, 200);
	});
});

describe("TomoChatView — onClose lifecycle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		connectionStore.set({ kind: "disconnected" });
	});

	afterEach(() => {
		connectionStore.set({ kind: "disconnected" });
	});

	it("onClose disposes the terminal session via terminalHost.dispose", async () => {
		const h = await mountView();
		await h.view.onClose();
		expect(terminalHost.dispose).toHaveBeenCalledTimes(1);
	});

	it("onClose disposes the onData subscription", async () => {
		const h = await mountView();
		await h.view.onClose();
		expect(h.connection.disposeListener).toHaveBeenCalledTimes(1);
	});

	it("onClose unsubscribes from connectionStore — later state changes don't update the indicator", async () => {
		const h = await mountView();
		// Capture indicator text after mount (state = disconnected)
		const ind = h.root.querySelector(".hashi-chat-view-indicator");
		const textBefore = ind!.textContent;
		await h.view.onClose();
		// Drive a state change after close — listener should be gone.
		connectionStore.set({ kind: "connected", instance: inst() });
		expect(ind!.textContent).toBe(textBefore);
	});
});

describe("TomoChatView — input accessors (T5.3 file-menu wiring)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		connectionStore.set({ kind: "disconnected" });
	});

	afterEach(() => {
		connectionStore.set({ kind: "disconnected" });
	});

	it("getInputElement returns the input element after onOpen", async () => {
		const h = await mountView();
		const input = h.view.getInputElement();
		expect(input).not.toBeNull();
		expect(input!.classList.contains("hashi-chat-view-input")).toBe(true);
	});

	it("setInputAndFocus sets value, focuses input, and places caret at end", async () => {
		const h = await mountView();
		document.body.appendChild(h.root);
		// Input must be enabled for jsdom focus() to move activeElement —
		// disabled inputs reject focus per WHATWG spec.
		connectionStore.set({ kind: "connected", instance: inst() });
		h.view.setInputAndFocus("@foo/bar.md ");
		const input = h.view.getInputElement();
		expect(input!.value).toBe("@foo/bar.md ");
		expect(document.activeElement).toBe(input);
		expect(input!.selectionStart).toBe("@foo/bar.md ".length);
		expect(input!.selectionEnd).toBe("@foo/bar.md ".length);
	});
});

describe("terminalHost module surface", () => {
	it("exports createTerminal, writeChunk, fit, dispose", async () => {
		// xterm's static module init touches HTMLCanvasElement.getContext (its
		// DOM renderer probes Canvas for color sampling) which jsdom logs as
		// "Not implemented". Stub it for the duration of the import so the
		// surface check runs quietly. The smoke test itself never calls
		// createTerminal — only verifies the four functions are exported.
		const proto = HTMLCanvasElement.prototype as unknown as {
			getContext?: () => null;
		};
		const original = proto.getContext;
		proto.getContext = () => null;
		try {
			const actual = await vi.importActual<
				typeof import("../../../../src/ui/chat-view/terminalHost")
			>("../../../../src/ui/chat-view/terminalHost");
			expect(typeof actual.createTerminal).toBe("function");
			expect(typeof actual.writeChunk).toBe("function");
			expect(typeof actual.fit).toBe("function");
			expect(typeof actual.dispose).toBe("function");
		} finally {
			proto.getContext = original;
		}
	});
});
