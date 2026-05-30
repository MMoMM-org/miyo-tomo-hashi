/**
 * End-to-end integration test for the IDE Bridge protocol (T5.1).
 *
 * Drives a REAL IdeBridge (REAL WsServer + REAL selectionTracker) on a loopback
 * ephemeral port. The only injection is a FakeEditorAdapter so editor/selection
 * state is fully controllable without Obsidian.
 *
 * Client infra is copied from test/unit/ide-bridge/wsServer.test.ts — raw TCP
 * sockets speaking hand-rolled RFC 6455 frames, the same masking helpers, and
 * the same waitFor/findResponse utilities.
 *
 * 18 guardian-approved scenarios:
 *   Auth     (1) missing token → 401; (2) wrong token → 401;
 *            (3) valid token → 101.
 *   MCP      (4) initialize; (5) notifications/initialized silent;
 *            (6) tools/list exact names (no openDiff/executeCode).
 *   Broadcast (7) selection_changed carries plain vault-relative filePath.
 *   Tools    (8) getCurrentSelection; (9) getLatestSelection;
 *            (10) getOpenEditors; (11) getWorkspaceFolders → [];
 *            (12) openFile happy; (13) openFile absolute → -32602;
 *            (14) openFile traversal → -32602; (15) unknown method → -32601.
 *   Keepalive (16) PING→PONG; (17) non-responding client reaped.
 *   Lifecycle (18) stop() frees port, re-start succeeds.
 *
 * Spec: docs/XDD/specs/003-ide-bridge — T5.1.
 */

// Side-effect import: installs the jsdom HTMLElement.prototype shim used across
// the ide-bridge suite (see memory note on obsidian mock side-effect import).
import "obsidian";

import { createConnection, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IdeBridge, type IdeBridgeDeps } from "../../src/ide-bridge/IdeBridge";
import { FakeEditorAdapter } from "../../src/ide-bridge/FakeEditorAdapter";
import { decodeFrames, type DecodedFrame } from "../../src/ide-bridge/frame";
import { secWebSocketAccept } from "../../src/ide-bridge/handshake";
import type { PluginSettings } from "../../src/types/index";
import type { SelectionChangedParams } from "../../src/ide-bridge/protocol";
import { buildToolsList } from "../../src/ide-bridge/tools/index";

// ---------------------------------------------------------------------------
// Raw TCP + WebSocket client helpers (modelled on wsServer.test.ts)
// ---------------------------------------------------------------------------

/** Mask a client→server frame per RFC 6455 §5.3 (clients MUST mask). */
function maskedFrame(opcode: number, payload: Buffer): Buffer {
	const len = payload.length;
	let header: Buffer;
	if (len < 126) {
		header = Buffer.from([0x80 | opcode, 0x80 | len]);
	} else {
		header = Buffer.alloc(4);
		header[0] = 0x80 | opcode;
		header[1] = 0x80 | 126;
		header.writeUInt16BE(len, 2);
	}
	const maskKey = randomBytes(4);
	const masked = Buffer.alloc(len);
	for (let i = 0; i < len; i++) {
		masked[i] = (payload[i] ?? 0) ^ (maskKey[i % 4] ?? 0);
	}
	return Buffer.concat([header, maskKey, masked]);
}

function maskedText(s: string): Buffer {
	return maskedFrame(0x1, Buffer.from(s, "utf8"));
}

type RawClient = {
	socket: Socket;
	raw: () => Buffer;
	frames: () => DecodedFrame[];
	send: (buf: Buffer) => void;
	waitFor: (pred: (raw: Buffer) => boolean, ms?: number) => Promise<void>;
	close: () => void;
};

/**
 * Open a raw TCP connection and send a WebSocket upgrade request.
 * `auth` of undefined omits the auth header entirely.
 */
function connectClient(
	port: number,
	auth: string | undefined,
	key = "dGhlIHNhbXBsZSBub25jZQ==",
): RawClient {
	const socket = createConnection({ host: "127.0.0.1", port });
	let received = Buffer.alloc(0);
	let frameBuf = Buffer.alloc(0);
	const decoded: DecodedFrame[] = [];
	let headerDone = false;

	socket.on("data", (chunk: Buffer) => {
		received = Buffer.concat([received, chunk]);
		if (!headerDone) {
			const idx = received.indexOf("\r\n\r\n");
			if (idx === -1) return;
			headerDone = true;
			frameBuf = received.subarray(idx + 4);
		} else {
			frameBuf = Buffer.concat([frameBuf, chunk]);
		}
		const { frames, rest } = decodeFrames(frameBuf);
		decoded.push(...frames);
		frameBuf = rest;
	});

	const lines = [
		"GET / HTTP/1.1",
		"Host: 127.0.0.1",
		"Upgrade: websocket",
		"Connection: Upgrade",
		`Sec-WebSocket-Key: ${key}`,
		"Sec-WebSocket-Version: 13",
	];
	if (auth !== undefined) {
		lines.push(`x-claude-code-ide-authorization: ${auth}`);
	}
	socket.on("connect", () => {
		socket.write(lines.join("\r\n") + "\r\n\r\n");
	});

	return {
		socket,
		raw: () => received,
		frames: () => decoded,
		send: (buf) => socket.write(buf),
		waitFor: (pred, ms = 2000) =>
			new Promise<void>((resolve, reject) => {
				const t = setInterval(() => {
					if (pred(received)) {
						clearInterval(t);
						resolve();
					}
				}, 5);
				setTimeout(() => {
					clearInterval(t);
					reject(
						new Error(
							`waitFor timed out; got: ${received.toString("utf8").slice(0, 300)}`,
						),
					);
				}, ms);
			}),
		close: () => socket.destroy(),
	};
}

/** Find the first decoded TEXT frame whose parsed JSON has the given id. */
function findResponse(
	frames: DecodedFrame[],
	id: number | null,
): Record<string, unknown> | undefined {
	for (const f of frames) {
		if (f.kind !== "text") continue;
		try {
			const obj = JSON.parse(f.payload) as Record<string, unknown>;
			if (obj.id === id) return obj;
		} catch {
			/* ignore non-JSON */
		}
	}
	return undefined;
}

/** Find the first decoded TEXT frame whose JSON has the given method (notification). */
function findNotification(
	frames: DecodedFrame[],
	method: string,
): Record<string, unknown> | undefined {
	for (const f of frames) {
		if (f.kind !== "text") continue;
		try {
			const obj = JSON.parse(f.payload) as Record<string, unknown>;
			if (obj.method === method) return obj;
		} catch {
			/* ignore non-JSON */
		}
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Bridge + adapter factory helpers
// ---------------------------------------------------------------------------

function makeDefaultSettings(): PluginSettings {
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
		ideBridgePort: 0, // ephemeral — WsServer uses 0 for OS-assigned port
		ideBridgeAuthToken: "",
	};
}

interface E2EHarness {
	bridge: IdeBridge;
	adapter: FakeEditorAdapter;
}

/**
 * Build an IdeBridge wired with the real WsServer and real selectionTracker,
 * but with a FakeEditorAdapter for controllable editor state.
 */
function makeHarness(): E2EHarness {
	const adapter = new FakeEditorAdapter();
	let settings = makeDefaultSettings();
	const deps: IdeBridgeDeps = {
		app: {} as IdeBridgeDeps["app"],
		getSettings: () => settings,
		persist: async (next) => {
			settings = next as typeof settings;
		},
		log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
		makeAdapter: () => adapter,
		// makeServer and makeTracker use the real defaults
	};
	return { bridge: new IdeBridge(deps), adapter };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("IdeBridge — end-to-end protocol integration (T5.1)", () => {
	const clients: RawClient[] = [];
	const bridges: IdeBridge[] = [];

	function trackClient(c: RawClient): RawClient {
		clients.push(c);
		return c;
	}

	function trackBridge(h: E2EHarness): E2EHarness {
		bridges.push(h.bridge);
		return h;
	}

	afterEach(async () => {
		for (const c of clients) c.close();
		clients.length = 0;
		for (const b of bridges) await b.stop();
		bridges.length = 0;
		vi.useRealTimers();
	});

	// -------------------------------------------------------------------------
	// Auth scenarios (1-3)
	// -------------------------------------------------------------------------

	it("(1) missing auth header → HTTP 401, no upgrade", async () => {
		const { bridge } = trackBridge(makeHarness());
		await bridge.start();

		// Extract the bound port from the bridge's token getter — the port is
		// accessible by starting and checking the store, but the simplest approach
		// is to start on port 0 and derive the bound port from a refused upgrade.
		// We connect without auth and check the 401.
		const { ideBridgeStore } = await import(
			"../../src/ide-bridge/ideBridgeStore"
		);
		const state = ideBridgeStore.get();
		if (state.kind !== "listening" && state.kind !== "connected") {
			throw new Error(`Bridge not listening, got: ${state.kind}`);
		}
		const port = state.port;

		const client = trackClient(connectClient(port, undefined));
		await client.waitFor((b) => b.includes("\r\n\r\n"));
		expect(client.raw().toString("utf8")).toMatch(/^HTTP\/1\.1 401/);
	});

	it("(2) wrong token → HTTP 401, no upgrade", async () => {
		const { bridge } = trackBridge(makeHarness());
		await bridge.start();

		const { ideBridgeStore } = await import(
			"../../src/ide-bridge/ideBridgeStore"
		);
		const state = ideBridgeStore.get();
		if (state.kind !== "listening" && state.kind !== "connected") {
			throw new Error(`Bridge not listening`);
		}

		const client = trackClient(connectClient(state.port, "hashi_wrong-token-xxxx"));
		await client.waitFor((b) => b.includes("\r\n\r\n"));
		expect(client.raw().toString("utf8")).toMatch(/^HTTP\/1\.1 401/);
	});

	it("(3) valid token → 101 Switching Protocols with correct Sec-WebSocket-Accept", async () => {
		const { bridge } = trackBridge(makeHarness());
		await bridge.start();

		const token = bridge.getToken();
		const { ideBridgeStore } = await import(
			"../../src/ide-bridge/ideBridgeStore"
		);
		const state = ideBridgeStore.get();
		if (state.kind !== "listening" && state.kind !== "connected") {
			throw new Error(`Bridge not listening`);
		}

		const wsKey = "x3JJHMbDL1EzLkh9GBhXDw==";
		const client = trackClient(connectClient(state.port, token, wsKey));
		await client.waitFor((b) => b.includes("\r\n\r\n"));

		const head = client.raw().toString("utf8");
		expect(head).toMatch(/^HTTP\/1\.1 101 Switching Protocols/);
		expect(head).toContain(
			`Sec-WebSocket-Accept: ${secWebSocketAccept(wsKey)}`,
		);
	});

	// -------------------------------------------------------------------------
	// MCP handshake scenarios (4-6)
	// -------------------------------------------------------------------------

	it("(4) initialize → valid MCP result with protocolVersion, capabilities, serverInfo", async () => {
		const { bridge } = trackBridge(makeHarness());
		await bridge.start();

		const token = bridge.getToken();
		const { ideBridgeStore } = await import(
			"../../src/ide-bridge/ideBridgeStore"
		);
		const state = ideBridgeStore.get();
		if (state.kind !== "listening" && state.kind !== "connected") throw new Error("not listening");

		const client = trackClient(connectClient(state.port, token));
		await client.waitFor((b) => b.includes("\r\n\r\n"));

		client.send(
			maskedText(
				JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
			),
		);
		await client.waitFor(
			() => findResponse(client.frames(), 1) !== undefined,
		);

		const resp = findResponse(client.frames(), 1);
		const result = resp?.result as Record<string, unknown>;
		expect(result.protocolVersion).toBeTypeOf("string");
		expect(result.capabilities).toEqual({ tools: {} });
		expect(result.serverInfo).toMatchObject({ name: expect.any(String) });
	});

	it("(5) notifications/initialized → NO reply frame", async () => {
		const { bridge } = trackBridge(makeHarness());
		await bridge.start();

		const token = bridge.getToken();
		const { ideBridgeStore } = await import(
			"../../src/ide-bridge/ideBridgeStore"
		);
		const state = ideBridgeStore.get();
		if (state.kind !== "listening" && state.kind !== "connected") throw new Error("not listening");

		const client = trackClient(connectClient(state.port, token));
		await client.waitFor((b) => b.includes("\r\n\r\n"));

		const before = client.frames().length;
		client.send(
			maskedText(
				JSON.stringify({
					jsonrpc: "2.0",
					method: "notifications/initialized",
				}),
			),
		);
		// Send a probe request with a unique id so we know when messages after the
		// notification have been processed without relying on a fixed sleep.
		client.send(
			maskedText(
				JSON.stringify({ jsonrpc: "2.0", id: 999, method: "initialize" }),
			),
		);
		await client.waitFor(
			() => findResponse(client.frames(), 999) !== undefined,
		);

		// The notification must NOT have produced any id-bearing response between
		// the before snapshot and the probe response.
		const newFrames = client.frames().slice(before);
		const idResponses = newFrames.filter((f) => {
			if (f.kind !== "text") return false;
			try {
				const o = JSON.parse(f.payload) as Record<string, unknown>;
				return o.id !== undefined && o.id !== 999;
			} catch {
				return false;
			}
		});
		expect(idResponses).toHaveLength(0);
	});

	it("(6) tools/list → exactly the in-scope tools; openDiff and executeCode absent", async () => {
		const { bridge } = trackBridge(makeHarness());
		await bridge.start();

		const token = bridge.getToken();
		const { ideBridgeStore } = await import(
			"../../src/ide-bridge/ideBridgeStore"
		);
		const state = ideBridgeStore.get();
		if (state.kind !== "listening" && state.kind !== "connected") throw new Error("not listening");

		const client = trackClient(connectClient(state.port, token));
		await client.waitFor((b) => b.includes("\r\n\r\n"));

		client.send(
			maskedText(
				JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
			),
		);
		await client.waitFor(
			() => findResponse(client.frames(), 2) !== undefined,
		);

		const resp = findResponse(client.frames(), 2);
		const result = resp?.result as { tools: Array<{ name: string }> };
		const names = result.tools.map((t) => t.name);

		// Must contain exactly the in-scope tools from buildToolsList
		const expected = buildToolsList().map((t) => t.name);
		expect(names.sort()).toEqual(expected.sort());

		// The two out-of-scope tools must never appear
		expect(names).not.toContain("openDiff");
		expect(names).not.toContain("executeCode");
	});

	// -------------------------------------------------------------------------
	// Broadcast scenario (7)
	// -------------------------------------------------------------------------

	it("(7) editor selection pushed through tracker → client receives selection_changed with plain vault-relative filePath", async () => {
		const { bridge, adapter } = trackBridge(makeHarness());
		await bridge.start();

		const token = bridge.getToken();
		const { ideBridgeStore } = await import(
			"../../src/ide-bridge/ideBridgeStore"
		);
		const state = ideBridgeStore.get();
		if (state.kind !== "listening" && state.kind !== "connected") throw new Error("not listening");

		const client = trackClient(connectClient(state.port, token));
		await client.waitFor((b) => b.includes("\r\n\r\n"));

		const selection: SelectionChangedParams = {
			text: "hello world",
			filePath: "notes/daily.md",
			fileUrl: "file://notes/daily.md",
			selection: {
				start: { line: 0, character: 0 },
				end: { line: 0, character: 11 },
				isEmpty: false,
			},
		};
		adapter.setActiveSelection(selection);
		bridge.onEditorActivity();

		// The selectionTracker debounces by 100ms before broadcasting. Wait for
		// the notification to arrive over the real socket (real timers throughout).
		await client.waitFor(
			() =>
				findNotification(client.frames(), "selection_changed") !== undefined,
			2000,
		);

		const notif = findNotification(client.frames(), "selection_changed");
		expect(notif).toBeDefined();
		const params = notif?.params as Record<string, unknown>;
		expect(params.filePath).toBe("notes/daily.md");
		// Must NOT be a host-absolute path
		expect(params.filePath as string).not.toMatch(/^\//);
		expect(params.filePath as string).not.toMatch(/^[A-Za-z]:\\/);
	});

	// -------------------------------------------------------------------------
	// Tools via tools/call (8-15)
	// -------------------------------------------------------------------------

	/**
	 * Helper: connect, call a tool by its direct JSON-RPC method name, and await
	 * the response. Tools are registered by name in the HandlerRegistry (e.g.
	 * "getCurrentSelection"), NOT via a "tools/call" wrapper method.
	 */
	async function callTool(
		port: number,
		token: string,
		id: number,
		toolName: string,
		toolParams?: unknown,
	): Promise<Record<string, unknown>> {
		const client = trackClient(connectClient(port, token));
		await client.waitFor((b) => b.includes("\r\n\r\n"));
		client.send(
			maskedText(
				JSON.stringify({
					jsonrpc: "2.0",
					id,
					method: toolName,
					params: toolParams ?? {},
				}),
			),
		);
		await client.waitFor(
			() => findResponse(client.frames(), id) !== undefined,
			3000,
		);
		const resp = findResponse(client.frames(), id);
		if (!resp) throw new Error(`No response for id ${id}`);
		return resp;
	}

	it("(8) getCurrentSelection → result: null when no active selection", async () => {
		const { bridge, adapter } = trackBridge(makeHarness());
		await bridge.start();
		adapter.setActiveSelection(null);

		const token = bridge.getToken();
		const { ideBridgeStore } = await import(
			"../../src/ide-bridge/ideBridgeStore"
		);
		const state = ideBridgeStore.get();
		if (state.kind !== "listening" && state.kind !== "connected") throw new Error("not listening");

		const resp = await callTool(state.port, token, 10, "getCurrentSelection");
		expect(resp.result).toBeNull();
		expect(resp.error).toBeUndefined();
	});

	it("(9) getLatestSelection → result: null before any broadcast", async () => {
		const { bridge } = trackBridge(makeHarness());
		await bridge.start();

		const token = bridge.getToken();
		const { ideBridgeStore } = await import(
			"../../src/ide-bridge/ideBridgeStore"
		);
		const state = ideBridgeStore.get();
		if (state.kind !== "listening" && state.kind !== "connected") throw new Error("not listening");

		const resp = await callTool(state.port, token, 11, "getLatestSelection");
		expect(resp.result).toBeNull();
	});

	it("(10) getOpenEditors → tabs array with the fake adapter's open files", async () => {
		const { bridge, adapter } = trackBridge(makeHarness());
		adapter.files.add("notes/todo.md");
		await bridge.start();

		const token = bridge.getToken();
		const { ideBridgeStore } = await import(
			"../../src/ide-bridge/ideBridgeStore"
		);
		const state = ideBridgeStore.get();
		if (state.kind !== "listening" && state.kind !== "connected") throw new Error("not listening");

		const resp = await callTool(state.port, token, 12, "getOpenEditors");
		const result = resp.result as { tabs: Array<{ filePath: string; isDirty: boolean }> };
		expect(result.tabs).toHaveLength(1);
		expect(result.tabs[0]?.filePath).toBe("notes/todo.md");
		expect(result.tabs[0]?.isDirty).toBe(false);
	});

	it("(11) getWorkspaceFolders → result with empty workspaceFolders array", async () => {
		const { bridge } = trackBridge(makeHarness());
		await bridge.start();

		const token = bridge.getToken();
		const { ideBridgeStore } = await import(
			"../../src/ide-bridge/ideBridgeStore"
		);
		const state = ideBridgeStore.get();
		if (state.kind !== "listening" && state.kind !== "connected") throw new Error("not listening");

		const resp = await callTool(state.port, token, 13, "getWorkspaceFolders");
		const result = resp.result as { workspaceFolders: unknown[] };
		expect(result.workspaceFolders).toEqual([]);
	});

	it("(12) openFile happy path → invokes adapter.openFile with vault-relative path, result: { success: true }", async () => {
		const { bridge, adapter } = trackBridge(makeHarness());
		adapter.files.add("notes/plan.md");
		await bridge.start();

		const token = bridge.getToken();
		const { ideBridgeStore } = await import(
			"../../src/ide-bridge/ideBridgeStore"
		);
		const state = ideBridgeStore.get();
		if (state.kind !== "listening" && state.kind !== "connected") throw new Error("not listening");

		const resp = await callTool(state.port, token, 14, "openFile", {
			filePath: "notes/plan.md",
		});
		expect(resp.error).toBeUndefined();
		expect(resp.result).toEqual({ success: true });
		expect(adapter.opened).toContain("notes/plan.md");
	});

	it("(13) openFile with absolute path → JSON-RPC error -32602", async () => {
		const { bridge } = trackBridge(makeHarness());
		await bridge.start();

		const token = bridge.getToken();
		const { ideBridgeStore } = await import(
			"../../src/ide-bridge/ideBridgeStore"
		);
		const state = ideBridgeStore.get();
		if (state.kind !== "listening" && state.kind !== "connected") throw new Error("not listening");

		const resp = await callTool(state.port, token, 15, "openFile", {
			filePath: "/absolute/path/file.md",
		});
		expect(resp.result).toBeUndefined();
		const error = resp.error as { code: number; message: string };
		expect(error.code).toBe(-32602);
	});

	it("(14) openFile with .. traversal path → JSON-RPC error -32602", async () => {
		const { bridge } = trackBridge(makeHarness());
		await bridge.start();

		const token = bridge.getToken();
		const { ideBridgeStore } = await import(
			"../../src/ide-bridge/ideBridgeStore"
		);
		const state = ideBridgeStore.get();
		if (state.kind !== "listening" && state.kind !== "connected") throw new Error("not listening");

		const resp = await callTool(state.port, token, 16, "openFile", {
			filePath: "../outside/vault.md",
		});
		expect(resp.result).toBeUndefined();
		const error = resp.error as { code: number; message: string };
		expect(error.code).toBe(-32602);
	});

	it("(15) unknown method → JSON-RPC error -32601 method not found", async () => {
		const { bridge } = trackBridge(makeHarness());
		await bridge.start();

		const token = bridge.getToken();
		const { ideBridgeStore } = await import(
			"../../src/ide-bridge/ideBridgeStore"
		);
		const state = ideBridgeStore.get();
		if (state.kind !== "listening" && state.kind !== "connected") throw new Error("not listening");

		const client = trackClient(connectClient(state.port, token));
		await client.waitFor((b) => b.includes("\r\n\r\n"));

		client.send(
			maskedText(
				JSON.stringify({
					jsonrpc: "2.0",
					id: 17,
					method: "no_such_method_xyz",
				}),
			),
		);
		await client.waitFor(
			() => findResponse(client.frames(), 17) !== undefined,
		);
		const resp = findResponse(client.frames(), 17);
		const error = resp?.error as { code: number };
		expect(error.code).toBe(-32601);
	});

	// -------------------------------------------------------------------------
	// Keepalive scenarios (16-17)
	// -------------------------------------------------------------------------

	it("(16) client PING → server responds with PONG carrying the same payload", async () => {
		const { bridge } = trackBridge(makeHarness());
		await bridge.start();

		const token = bridge.getToken();
		const { ideBridgeStore } = await import(
			"../../src/ide-bridge/ideBridgeStore"
		);
		const state = ideBridgeStore.get();
		if (state.kind !== "listening" && state.kind !== "connected") throw new Error("not listening");

		const client = trackClient(connectClient(state.port, token));
		await client.waitFor((b) => b.includes("\r\n\r\n"));

		const pingPayload = Buffer.from("ping-check");
		client.send(maskedFrame(0x9, pingPayload));

		await client.waitFor(
			() => client.frames().some((f) => f.kind === "pong"),
			2000,
		);
		const pong = client.frames().find((f) => f.kind === "pong");
		expect(pong?.kind).toBe("pong");
		expect((pong as { payload: Buffer }).payload).toEqual(pingPayload);
	});

	it("(17) non-responding client is reaped after keepalive interval", async () => {
		// Build a harness with a short ping interval to avoid a long test.
		// We inject a custom makeServer that wraps the real WsServer with a short
		// pingIntervalMs, keeping the real transport.
		const adapter = new FakeEditorAdapter();
		let settings = makeDefaultSettings();
		let onCountChange: ((n: number) => void) = () => {};
		const { WsServer } = await import("../../src/ide-bridge/wsServer");

		const deps: IdeBridgeDeps = {
			app: {} as IdeBridgeDeps["app"],
			getSettings: () => settings,
			persist: async (next) => {
				settings = next as typeof settings;
			},
			log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
			makeAdapter: () => adapter,
			makeServer: (opts) => {
				const server = new WsServer({
					...opts,
					pingIntervalMs: 40,
					onClientCountChange: (n) => {
						onCountChange(n);
						opts.onClientCountChange(n);
					},
				});
				return server;
			},
		};

		const bridge = new IdeBridge(deps);
		bridges.push(bridge);
		await bridge.start();

		const token = bridge.getToken();
		const { ideBridgeStore } = await import(
			"../../src/ide-bridge/ideBridgeStore"
		);
		const state = ideBridgeStore.get();
		if (state.kind !== "listening" && state.kind !== "connected") throw new Error("not listening");

		let countDroppedToZero = false;
		onCountChange = (n: number) => {
			if (n === 0) countDroppedToZero = true;
		};

		const client = trackClient(connectClient(state.port, token));
		await client.waitFor((b) => b.includes("\r\n\r\n"));

		// Do NOT respond to pings. After two intervals (~80ms) the server reaps us.
		await new Promise<void>((resolve, reject) => {
			const deadline = setTimeout(
				() => reject(new Error("client was not reaped within timeout")),
				2000,
			);
			const poll = setInterval(() => {
				if (countDroppedToZero) {
					clearInterval(poll);
					clearTimeout(deadline);
					resolve();
				}
			}, 10);
		});

		expect(countDroppedToZero).toBe(true);
	});

	// -------------------------------------------------------------------------
	// Lifecycle scenario (18)
	// -------------------------------------------------------------------------

	it("(18) stop() frees the port; a subsequent start() succeeds on a fresh ephemeral port", async () => {
		const { bridge } = trackBridge(makeHarness());
		await bridge.start();

		const { ideBridgeStore } = await import(
			"../../src/ide-bridge/ideBridgeStore"
		);
		const state1 = ideBridgeStore.get();
		if (state1.kind !== "listening" && state1.kind !== "connected")
			throw new Error("not listening after first start");
		const port1 = state1.port;
		expect(port1).toBeGreaterThan(0);

		await bridge.stop();
		expect(ideBridgeStore.get().kind).toBe("stopped");

		// Start again — should succeed without EADDRINUSE.
		// (Port 0 picks a fresh ephemeral port each time.)
		await bridge.start();
		const state2 = ideBridgeStore.get();
		expect(state2.kind).toMatch(/^(listening|connected)$/);

		// A second bridge on the same (now freed) original port also works.
		// This proves no leaked handle on port1.
		const { WsServer } = await import("../../src/ide-bridge/wsServer");
		const probe = new WsServer({
			port: port1,
			getToken: () => "probe_token",
			registry: {},
			onClientCountChange: () => {},
			onListenError: vi.fn(),
			log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
		});
		const probePort = await probe.listen();
		expect(probePort).toBe(port1);
		await probe.stop();
	});
});
