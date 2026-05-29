// Side-effect import: installs the jsdom HTMLElement.prototype shim used across
// the ide-bridge suite. Type-only imports erase before resolution, so this must
// be a value import even though wsServer itself touches no DOM (see memory note).
import "obsidian";

import { createConnection, type Socket } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WsServer, type WsServerOptions } from "../../../src/ide-bridge/wsServer";
import type { HandlerRegistry } from "../../../src/ide-bridge/jsonRpc";
import { decodeFrames, type DecodedFrame } from "../../../src/ide-bridge/frame";

// ---------------------------------------------------------------------------
// Test helpers — a raw TCP client speaking just enough WebSocket to drive the
// server end-to-end on a loopback port.
// ---------------------------------------------------------------------------

const TOKEN = "hashi_test-token-0000";

/** Quiet log spy capturing warn/error/debug calls. */
function makeLog() {
	return { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** A registry with a single echo handler plus the real handshake wiring. */
function makeRegistry(): HandlerRegistry {
	return {
		echo: (params) => params,
	};
}

/** Compute the Sec-WebSocket-Accept the server must return for a given key. */
function expectedAccept(key: string): string {
	return createHash("sha1")
		.update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
		.digest("base64");
}

/** Mask a client→server frame per RFC 6455 (clients MUST mask). */
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
	/** Raw bytes received so far (HTTP response prefix + any frames). */
	raw: () => Buffer;
	/** Decoded WS frames received after the 101 handshake. */
	frames: () => DecodedFrame[];
	send: (buf: Buffer) => void;
	/** Resolve once the predicate over received text holds (or reject on timeout). */
	waitFor: (pred: (raw: Buffer) => boolean, ms?: number) => Promise<void>;
	close: () => void;
};

/**
 * Open a raw TCP connection and send a WebSocket upgrade request. `auth` of
 * `undefined` omits the header entirely; a string sends it verbatim.
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
		waitFor: (pred, ms = 1000) =>
			new Promise<void>((resolve, reject) => {
				const t = setInterval(() => {
					if (pred(received)) {
						clearInterval(t);
						resolve();
					}
				}, 5);
				setTimeout(() => {
					clearInterval(t);
					reject(new Error(`waitFor timed out; got: ${received.toString("utf8").slice(0, 200)}`));
				}, ms);
			}),
		close: () => socket.destroy(),
	};
}

/** Find the first decoded TEXT frame whose JSON has the given id, parsed. */
function findResponse(frames: DecodedFrame[], id: number | null): Record<string, unknown> | undefined {
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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("WsServer", () => {
	let servers: WsServer[] = [];
	let clients: RawClient[] = [];

	function build(overrides: Partial<WsServerOptions> = {}): WsServer {
		const s = new WsServer({
			port: 0,
			getToken: () => TOKEN,
			registry: makeRegistry(),
			onClientCountChange: vi.fn(),
			onListenError: vi.fn(),
			log: makeLog(),
			...overrides,
		});
		servers.push(s);
		return s;
	}

	function track(c: RawClient): RawClient {
		clients.push(c);
		return c;
	}

	afterEach(async () => {
		for (const c of clients) c.close();
		clients = [];
		for (const s of servers) await s.stop();
		servers = [];
	});

	it("rejects an upgrade with NO auth header → HTTP 401, no upgrade", async () => {
		const onCount = vi.fn();
		const server = build({ onClientCountChange: onCount });
		const port = await server.listen();

		const client = track(connectClient(port, undefined));
		await client.waitFor((b) => b.includes("\r\n\r\n"));

		expect(client.raw().toString("utf8")).toMatch(/^HTTP\/1\.1 401/);
		expect(onCount).not.toHaveBeenCalled();
	});

	it("rejects a WRONG token → 401, no upgrade, warn log with token but NO remote address", async () => {
		const log = makeLog();
		const server = build({ log });
		const port = await server.listen();

		const client = track(connectClient(port, "hashi_wrong-token"));
		await client.waitFor((b) => b.includes("\r\n\r\n"));

		expect(client.raw().toString("utf8")).toMatch(/^HTTP\/1\.1 401/);
		expect(log.warn).toHaveBeenCalled();
		const warned = log.warn.mock.calls.map((c) => String(c[0])).join("\n");
		expect(warned).toContain("hashi_wrong-token");
		expect(warned).not.toMatch(/127\.0\.0\.1|::1|\d+\.\d+\.\d+\.\d+/);
	});

	it("accepts a VALID token → 101 with correct Sec-WebSocket-Accept and fires onClientCountChange(1)", async () => {
		const onCount = vi.fn();
		const server = build({ onClientCountChange: onCount });
		const port = await server.listen();

		const key = "x3JJHMbDL1EzLkh9GBhXDw==";
		const client = track(connectClient(port, TOKEN, key));
		await client.waitFor((b) => b.includes("\r\n\r\n"));

		const head = client.raw().toString("utf8");
		expect(head).toMatch(/^HTTP\/1\.1 101 Switching Protocols/);
		expect(head).toContain(`Sec-WebSocket-Accept: ${expectedAccept(key)}`);
		expect(onCount).toHaveBeenCalledWith(1);
	});

	it("completes the MCP handshake: initialize, notifications/initialized (silent), tools/list", async () => {
		const tools: HandlerRegistry = {
			getOpenEditors: () => ({ tabs: [] }),
		};
		const toolsList = [
			{ name: "getOpenEditors", description: "List open editors", inputSchema: { type: "object", properties: {} } },
		];
		const server = build({ registry: tools, toolsList });
		const port = await server.listen();

		const client = track(connectClient(port, TOKEN));
		await client.waitFor((b) => b.includes("\r\n\r\n"));

		client.send(maskedText(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })));
		await client.waitFor(() => findResponse(client.frames(), 1) !== undefined);
		const init = findResponse(client.frames(), 1);
		const result = init?.result as Record<string, unknown>;
		expect(result.protocolVersion).toBeTypeOf("string");
		expect(result.capabilities).toEqual({ tools: {} });
		expect(result.serverInfo).toMatchObject({ name: expect.any(String) });

		// notifications/initialized has no id → must produce NO response frame.
		const before = client.frames().length;
		client.send(maskedText(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })));
		client.send(maskedText(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })));
		await client.waitFor(() => findResponse(client.frames(), 2) !== undefined);
		const list = findResponse(client.frames(), 2);
		const listResult = list?.result as { tools: Array<{ name: string }> };
		expect(listResult.tools.map((t) => t.name)).toContain("getOpenEditors");
		// Only one new id-bearing response (tools/list); the notification produced none.
		const idResponses = client
			.frames()
			.slice(before)
			.filter((f) => f.kind === "text" && JSON.parse(f.payload).id !== undefined);
		expect(idResponses).toHaveLength(1);
	});

	it("broadcast frames an UNMASKED TEXT JSON-RPC notification to every client", async () => {
		const server = build();
		const port = await server.listen();

		const a = track(connectClient(port, TOKEN));
		const b = track(connectClient(port, TOKEN));
		await a.waitFor((x) => x.includes("\r\n\r\n"));
		await b.waitFor((x) => x.includes("\r\n\r\n"));

		server.broadcast({ jsonrpc: "2.0", method: "selection_changed", params: { hello: 1 } });

		await a.waitFor(() => a.frames().some((f) => f.kind === "text"));
		await b.waitFor(() => b.frames().some((f) => f.kind === "text"));

		for (const c of [a, b]) {
			const text = c.frames().find((f) => f.kind === "text");
			expect(text?.kind).toBe("text");
			const obj = JSON.parse((text as { payload: string }).payload);
			expect(obj.method).toBe("selection_changed");
		}
		// Server→client frames are never masked: first frame byte after the HTTP
		// header has the mask bit (0x80 of byte1) clear. decodeFrames already
		// verified parse; assert the raw mask bit explicitly on client a.
		const idx = a.raw().indexOf("\r\n\r\n");
		const firstFrameByte1 = a.raw()[idx + 4 + 1] as number;
		expect(firstFrameByte1 & 0x80).toBe(0);
	});

	it("reaps a client that never PONGs and recomputes the count; server stays listening at zero", async () => {
		const onCount = vi.fn();
		const server = build({ onClientCountChange: onCount, pingIntervalMs: 40 });
		const port = await server.listen();

		const client = track(connectClient(port, TOKEN));
		await client.waitFor((b) => b.includes("\r\n\r\n"));
		expect(onCount).toHaveBeenLastCalledWith(1);

		// Never answer the ping. After two intervals (~80ms) the server should
		// close us for not ponging.
		await client.waitFor(
			() => onCount.mock.calls.some((c) => c[0] === 0),
			1000,
		);
		expect(onCount).toHaveBeenLastCalledWith(0);
		// Server still accepts a fresh connection → it kept listening.
		const fresh = track(connectClient(port, TOKEN));
		await fresh.waitFor((b) => b.includes("\r\n\r\n"));
		expect(fresh.raw().toString("utf8")).toMatch(/^HTTP\/1\.1 101/);
	});

	it("keeps a client that DOES pong alive across intervals", async () => {
		const onCount = vi.fn();
		const server = build({ onClientCountChange: onCount, pingIntervalMs: 40 });
		const port = await server.listen();

		const client = track(connectClient(port, TOKEN));
		await client.waitFor((b) => b.includes("\r\n\r\n"));
		// Answer every PING with a PONG.
		client.socket.on("data", () => {
			for (const f of client.frames()) {
				if (f.kind === "ping") {
					client.send(maskedFrame(0xa, f.payload));
				}
			}
		});
		// Wait through several intervals.
		await new Promise((r) => setTimeout(r, 200));
		expect(onCount.mock.calls.every((c) => c[0] !== 0)).toBe(true);
	});

	it("refuses to bind to a non-loopback address", async () => {
		const server = build({ host: "0.0.0.0" });
		await expect(server.listen()).rejects.toThrow();
	});

	it("on EADDRINUSE fires onListenError after a single re-listen attempt", async () => {
		const holder = build();
		const port = await holder.listen();

		const onListenError = vi.fn();
		const second = build({ port, onListenError, readdressRetryMs: 20 });
		await second.listen().catch(() => {
			/* listen may reject or resolve via the error callback path */
		});

		await vi.waitFor(
			() => expect(onListenError).toHaveBeenCalledWith(`port ${port} in use`),
			{ timeout: 1000 },
		);
	});

	it("maps malformed JSON over the socket to a JSON-RPC error and never throws out of the loop", async () => {
		const log = makeLog();
		const server = build({ log });
		const port = await server.listen();

		const client = track(connectClient(port, TOKEN));
		await client.waitFor((b) => b.includes("\r\n\r\n"));

		// Garbage that is not valid JSON → -32700 parse error (id null).
		client.send(maskedText("{ not json"));
		// Unknown method → -32601.
		client.send(maskedText(JSON.stringify({ jsonrpc: "2.0", id: 77, method: "no_such_method" })));

		await client.waitFor(() => findResponse(client.frames(), 77) !== undefined);
		const notFound = findResponse(client.frames(), 77);
		expect((notFound?.error as { code: number }).code).toBe(-32601);

		// The malformed frame produced an id:null parse-error envelope (-32700).
		const parseErr = findResponse(client.frames(), null);
		expect(parseErr).toBeDefined();
		expect((parseErr?.error as { code: number }).code).toBe(-32700);

		// The server is still alive — a subsequent valid request works.
		client.send(maskedText(JSON.stringify({ jsonrpc: "2.0", id: 78, method: "echo", params: { ok: true } })));
		await client.waitFor(() => findResponse(client.frames(), 78) !== undefined);
		const echo = findResponse(client.frames(), 78);
		expect(echo?.result).toEqual({ ok: true });
		expect(log.error).not.toHaveBeenCalled();
	});

	it("answers a client PING with a PONG carrying the same payload", async () => {
		const server = build();
		const port = await server.listen();

		const client = track(connectClient(port, TOKEN));
		await client.waitFor((b) => b.includes("\r\n\r\n"));

		const pingPayload = Buffer.from("hello");
		client.send(maskedFrame(0x9, pingPayload));

		await client.waitFor(() => client.frames().some((f) => f.kind === "pong"));
		const pong = client.frames().find((f) => f.kind === "pong");
		expect(pong?.kind).toBe("pong");
		expect((pong as { payload: Buffer }).payload).toEqual(pingPayload);
	});

	it("tears down the connection and fires onClientCountChange(0) on a client CLOSE frame", async () => {
		const onCount = vi.fn();
		const server = build({ onClientCountChange: onCount });
		const port = await server.listen();

		const client = track(connectClient(port, TOKEN));
		await client.waitFor((b) => b.includes("\r\n\r\n"));
		expect(onCount).toHaveBeenLastCalledWith(1);

		client.send(maskedFrame(0x8, Buffer.alloc(0)));

		await vi.waitFor(
			() => expect(onCount.mock.calls.some((c) => c[0] === 0)).toBe(true),
			{ timeout: 1000 },
		);
		expect(client.socket.destroyed).toBe(true);
	});
});
