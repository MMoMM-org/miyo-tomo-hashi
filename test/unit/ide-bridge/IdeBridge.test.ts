/**
 * Tests for IdeBridge — lifecycle orchestrator + sole writer of ideBridgeStore (T3.2).
 *
 * Strategy: inject a FAKE WsServer (via the `makeServer` factory seam), a FAKE
 * editor adapter, and a FAKE selection tracker. Drive store transitions through
 * the server's onClientCountChange / onListenError callbacks and assert that
 * IdeBridge is the ONLY writer of ideBridgeStore (ADR-3).
 *
 * Spec: docs/XDD/specs/003-ide-bridge — SDD lines 294-298 (state machine),
 *       323-339 (orchestrator API), 685 (getter-vs-snapshot gotcha).
 */

import "obsidian";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeEditorAdapter } from "../../../src/ide-bridge/FakeEditorAdapter";
import { IdeBridge } from "../../../src/ide-bridge/IdeBridge";
import type { IdeBridgeDeps, WsServerLike } from "../../../src/ide-bridge/IdeBridge";
import { ideBridgeStore } from "../../../src/ide-bridge/ideBridgeStore";
import type { IdeBridgeState } from "../../../src/ide-bridge/state";
import type { SelectionTracker } from "../../../src/ide-bridge/selectionTracker";
import type { PluginSettings } from "../../../src/types";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type ServerOpts = {
	port: number;
	getToken: () => string;
	onClientCountChange: (count: number) => void;
	onListenError: (reason: string) => void;
};

/**
 * A controllable fake of the WsServer public surface IdeBridge consumes.
 * Records calls, captures the wired callbacks so a test can fire them, and
 * lets a test arm a listen() rejection (EADDRINUSE simulation).
 */
class FakeWsServer implements WsServerLike {
	listenCalls = 0;
	stopCalls = 0;
	broadcasts: unknown[] = [];
	clients = 0;
	listening = false;
	/** When set, listen() fires onListenError(this.listenError) and rejects. */
	listenError: string | null = null;
	/**
	 * When set, listen() rejects WITHOUT firing onListenError — simulating a
	 * rejection the server does not surface through its callback. Exercises
	 * IdeBridge's fallback transitionError branch.
	 */
	rejectWithoutCallback: string | null = null;
	readonly opts: ServerOpts;

	constructor(opts: ServerOpts) {
		this.opts = opts;
	}

	async listen(): Promise<number> {
		this.listenCalls += 1;
		if (this.rejectWithoutCallback !== null) {
			throw new Error(this.rejectWithoutCallback);
		}
		if (this.listenError !== null) {
			const reason = this.listenError;
			this.opts.onListenError(reason);
			throw new Error(reason);
		}
		this.listening = true;
		return this.opts.port;
	}

	async stop(): Promise<void> {
		this.stopCalls += 1;
		this.listening = false;
		this.clients = 0;
	}

	broadcast(obj: unknown): void {
		this.broadcasts.push(obj);
	}

	clientCount(): number {
		return this.clients;
	}

	/** Test helper — simulate a client count change as the real server would. */
	fireClientCount(n: number): void {
		this.clients = n;
		this.opts.onClientCountChange(n);
	}
}

interface Harness {
	bridge: IdeBridge;
	servers: FakeWsServer[];
	persist: ReturnType<typeof vi.fn>;
	settings: PluginSettings & { ideBridgePort: number; ideBridgeAuthToken: string };
	getSettings: () => PluginSettings;
	tracker: { onEditorActivity: ReturnType<typeof vi.fn>; getLatest: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
	setSettings: (next: PluginSettings & { ideBridgePort: number; ideBridgeAuthToken: string }) => void;
}

function makeSettings(
	overrides: Partial<{ ideBridgePort: number; ideBridgeAuthToken: string }> = {},
): PluginSettings & { ideBridgePort: number; ideBridgeAuthToken: string } {
	return {
		settings_version: 2,
		chosenInstanceName: null,
		zoomLevel: 1,
		tomoInboxFolder: "",
		executionMode: "confirm",
		runLogRetention: "always",
		hooksDir: ".tomo-hashi/hooks",
		hooksPolicy: "ask",
		debugLogging: false,
		ideBridgeEnabled: true,
		ideBridgePort: 23027,
		ideBridgeAuthToken: "",
		...overrides,
	} as PluginSettings & { ideBridgePort: number; ideBridgeAuthToken: string };
}

function makeHarness(): Harness {
	const servers: FakeWsServer[] = [];
	let settings = makeSettings();
	const getSettings = (): PluginSettings => settings;
	const setSettings = (next: PluginSettings & { ideBridgePort: number; ideBridgeAuthToken: string }): void => {
		settings = next;
	};
	const persist = vi.fn(async () => {});
	const adapter = new FakeEditorAdapter();
	const tracker = {
		onEditorActivity: vi.fn(),
		getLatest: vi.fn(() => null),
		dispose: vi.fn(),
	};

	const deps: IdeBridgeDeps = {
		// App is only forwarded to the (overridden) adapter factory; an empty
		// object is fine because makeAdapter is injected below.
		app: {} as IdeBridgeDeps["app"],
		getSettings,
		persist,
		log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
		makeServer: (opts) => {
			const s = new FakeWsServer(opts as ServerOpts);
			servers.push(s);
			return s;
		},
		makeAdapter: () => adapter,
		makeTracker: () => tracker as unknown as SelectionTracker,
	};

	const bridge = new IdeBridge(deps);
	return { bridge, servers, persist, settings, getSettings, tracker, setSettings };
}

function currentState(): IdeBridgeState {
	return ideBridgeStore.get();
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("IdeBridge", () => {
	beforeEach(() => {
		ideBridgeStore.set({ kind: "stopped" });
	});

	afterEach(() => {
		ideBridgeStore.set({ kind: "stopped" });
		vi.restoreAllMocks();
	});

	it("start() ensures a token, listens, and sets store to listening{port}", async () => {
		const h = makeHarness();
		await h.bridge.start();

		expect(h.servers).toHaveLength(1);
		expect(h.servers[0]?.listenCalls).toBe(1);
		expect(currentState()).toEqual({ kind: "listening", port: 23027 });
		// token was empty → minted → persisted
		expect(h.bridge.getToken()).toMatch(/^hashi_[0-9a-f-]{36}$/);
		expect(h.persist).toHaveBeenCalledTimes(1);
	});

	it("start() is idempotent — a second call is a no-op (listen called once)", async () => {
		const h = makeHarness();
		await h.bridge.start();
		await h.bridge.start();

		expect(h.servers).toHaveLength(1);
		expect(h.servers[0]?.listenCalls).toBe(1);
	});

	it("start() on listen error fires onListenError → store error{reason} and disposes the tracker", async () => {
		const reason = "port 23027 in use";
		const { bridge, tracker } = makeArmedBridge(reason);
		await bridge.start();

		expect(currentState()).toEqual({ kind: "error", reason });
		expect(bridge.isRunning()).toBe(false);
		// Failed-start teardown must dispose the half-built tracker (no leaked timer).
		expect(tracker.dispose).toHaveBeenCalledTimes(1);
	});

	it("start() when listen() rejects WITHOUT firing onListenError → fallback error{reason}", async () => {
		const reason = "boom: socket bind failed";
		const { bridge, tracker } = makeArmedBridge(reason, "silent");
		await bridge.start();

		// The fallback branch records the rejection reason since no callback fired.
		expect(currentState()).toEqual({ kind: "error", reason });
		expect(bridge.isRunning()).toBe(false);
		expect(tracker.dispose).toHaveBeenCalledTimes(1);
	});

	it("stop() closes the server and sets store stopped; idempotent", async () => {
		const h = makeHarness();
		await h.bridge.start();
		await h.bridge.stop();

		expect(h.servers[0]?.stopCalls).toBe(1);
		expect(currentState()).toEqual({ kind: "stopped" });

		await h.bridge.stop(); // idempotent — no second stop
		expect(h.servers[0]?.stopCalls).toBe(1);
	});

	it("stop() disposes the selection tracker", async () => {
		const h = makeHarness();
		await h.bridge.start();
		await h.bridge.stop();

		expect(h.tracker.dispose).toHaveBeenCalledTimes(1);
	});

	it("isRunning() reflects lifecycle state", async () => {
		const h = makeHarness();
		expect(h.bridge.isRunning()).toBe(false);
		await h.bridge.start();
		expect(h.bridge.isRunning()).toBe(true);
		await h.bridge.stop();
		expect(h.bridge.isRunning()).toBe(false);
	});

	it("getToken() returns the current token", async () => {
		const h = makeHarness();
		await h.bridge.start();
		const tok = h.bridge.getToken();
		expect(tok).toMatch(/^hashi_/);
	});

	it("regenerateToken() mints a NEW token, persists it, drops clients, writes no fs", async () => {
		const h = makeHarness();
		await h.bridge.start();
		const before = h.bridge.getToken();
		h.persist.mockClear();

		await h.bridge.regenerateToken();
		const after = h.bridge.getToken();

		expect(after).not.toBe(before);
		expect(after).toMatch(/^hashi_[0-9a-f-]{36}$/);
		expect(h.persist).toHaveBeenCalledTimes(1);
		// dropping clients while running = stop()+listen() → a second server built
		expect(h.servers).toHaveLength(2);
		expect(h.servers[0]?.stopCalls).toBe(1);
		expect(h.servers[1]?.listenCalls).toBe(1);
		// the regenerated server sees the new token through the live getter
		expect(h.servers[1]?.opts.getToken()).toBe(after);
	});

	it("regenerateToken() while stopped persists the new token without starting a server", async () => {
		const h = makeHarness();
		await h.bridge.regenerateToken();

		expect(h.bridge.getToken()).toMatch(/^hashi_[0-9a-f-]{36}$/);
		expect(h.persist).toHaveBeenCalledTimes(1);
		expect(h.servers).toHaveLength(0); // nothing was running → no restart
	});

	it("store: onClientCountChange(1) → connected{port,1}", async () => {
		const h = makeHarness();
		await h.bridge.start();
		h.servers[0]?.fireClientCount(1);
		expect(currentState()).toEqual({ kind: "connected", port: 23027, clientCount: 1 });
	});

	it("store: onClientCountChange(2) → connected{port,2}", async () => {
		const h = makeHarness();
		await h.bridge.start();
		h.servers[0]?.fireClientCount(2);
		expect(currentState()).toEqual({ kind: "connected", port: 23027, clientCount: 2 });
	});

	it("store: onClientCountChange(0) → back to listening{port}", async () => {
		const h = makeHarness();
		await h.bridge.start();
		h.servers[0]?.fireClientCount(1);
		h.servers[0]?.fireClientCount(0);
		expect(currentState()).toEqual({ kind: "listening", port: 23027 });
	});

	it("store: onListenError(reason) → error{reason}", async () => {
		const reason = "port 23027 in use";
		const { bridge } = makeArmedBridge(reason);
		await bridge.start();
		expect(currentState()).toEqual({ kind: "error", reason });
	});

	it("reads settings through the GETTER each time — a reassigned port is observed on next start", async () => {
		const h = makeHarness();
		await h.bridge.start();
		expect(h.servers[0]?.opts.port).toBe(23027);
		await h.bridge.stop();

		// Reassign the settings object the getter returns (Gotcha line 685).
		h.setSettings(makeSettings({ ideBridgePort: 23099, ideBridgeAuthToken: h.bridge.getToken() }));
		await h.bridge.start();
		expect(h.servers[1]?.opts.port).toBe(23099);
	});

	it("single-writer: the fake server never touches the store — only IdeBridge writes", async () => {
		const h = makeHarness();
		const setSpy = vi.spyOn(ideBridgeStore, "set");
		await h.bridge.start();
		// Every observed set must originate from IdeBridge transitions; the fake
		// server has no store reference, so the only writes are the bridge's.
		const kinds = setSpy.mock.calls.map((c) => (c[0] as IdeBridgeState).kind);
		expect(kinds).toEqual(["listening"]);
		h.servers[0]?.fireClientCount(1);
		expect(setSpy.mock.calls.at(-1)?.[0]).toEqual({
			kind: "connected",
			port: 23027,
			clientCount: 1,
		});
	});

	it("onEditorActivity() forwards to the tracker (for T4.5 wiring)", async () => {
		const h = makeHarness();
		await h.bridge.start();
		h.bridge.onEditorActivity();
		expect(h.tracker.onEditorActivity).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// Local helper: a bridge whose server rejects on listen (EADDRINUSE)
// ---------------------------------------------------------------------------

interface ArmedHarness {
	bridge: IdeBridge;
	tracker: { onEditorActivity: ReturnType<typeof vi.fn>; getLatest: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
}

/**
 * Build a bridge whose server fails to listen.
 * - mode "callback" (default): listen() fires onListenError(reason) then rejects.
 * - mode "silent": listen() rejects WITHOUT firing onListenError — exercises
 *   IdeBridge's fallback transitionError branch.
 */
function makeArmedBridge(reason: string, mode: "callback" | "silent" = "callback"): ArmedHarness {
	const adapter = new FakeEditorAdapter();
	const tracker = {
		onEditorActivity: vi.fn(),
		getLatest: vi.fn(() => null),
		dispose: vi.fn(),
	};
	let settings = makeSettings();
	const deps: IdeBridgeDeps = {
		app: {} as IdeBridgeDeps["app"],
		getSettings: () => settings,
		persist: vi.fn(async () => {
			settings = { ...settings };
		}),
		log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
		makeServer: (opts) => {
			const s = new FakeWsServer(opts as ServerOpts);
			if (mode === "silent") {
				s.rejectWithoutCallback = reason;
			} else {
				s.listenError = reason;
			}
			return s;
		},
		makeAdapter: () => adapter,
		makeTracker: () => tracker as unknown as SelectionTracker,
	};
	return { bridge: new IdeBridge(deps), tracker };
}
