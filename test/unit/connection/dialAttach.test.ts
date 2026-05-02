/**
 * @vitest-environment node
 *
 * Node environment (not jsdom) — this file uses real http.createServer +
 * raw TCP listen on loopback. jsdom's http intercepts break the upgrade
 * handshake.
 *
 * Unit tests for `dialAttach` — review/spec-001 H3.
 *
 * Pre-fix: every consumer test mocked `dialAttach` wholesale via
 * `vi.mock("../../../src/connection/dialAttach")`. The raw-HTTP attach
 * code paths (head-bytes `unshift`, `req.on('error')`, the upgrade
 * handler) were exercised only by `test/live/**` which is intentionally
 * manual. This file covers the function in CI by pointing it at a local
 * `http.Server` listening on TCP loopback — no Docker required.
 *
 * TCP rather than Unix socket because sandboxed test environments
 * commonly block `listen()` on Unix sockets even within $TMPDIR. The
 * upgrade handshake is identical on either transport; the path-routing
 * branch in dialAttach is small and exercised by the production code
 * via the `socketPath` default. The TCP path is exercised here.
 *
 * Server lifecycle: bound to a single shared server in `beforeAll` /
 * `afterAll` rather than per-test. vitest's worker has trouble with
 * per-test http.Server.close() — the upgraded socket lingers and the
 * `close()` callback is delayed past vitest's hook timeout. One server
 * shared across the suite avoids the problem entirely; the upgrade
 * handler is rebuilt per test via a switchable handler reference.
 */

import * as http from "node:http";
import type { AddressInfo } from "node:net";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "vitest";

import { dialAttach } from "../../../src/connection/dialAttach";

let server: http.Server;
let target: { host: string; port: number };
type UpgradeHandler = (
	req: http.IncomingMessage,
	socket: import("node:stream").Duplex,
	head: Buffer,
) => void;
let currentHandler: UpgradeHandler = () => {};

beforeAll(async () => {
	server = http.createServer();
	server.on("upgrade", (req, socket, head) => {
		currentHandler(req, socket, head);
	});
	await new Promise<void>((resolve) =>
		server.listen(0, "127.0.0.1", resolve),
	);
	const addr = server.address() as AddressInfo;
	target = { host: "127.0.0.1", port: addr.port };
});

afterAll(() => {
	// Best-effort cleanup. server.close() in vitest's worker reliably hangs
	// past the hook timeout even after closeAllConnections, so we force-
	// close connections and let the worker exit on idle. unref() drops the
	// server's hold on the event loop.
	server.closeAllConnections();
	server.close();
	server.unref();
});

beforeEach(() => {
	currentHandler = () => {};
});

describe("dialAttach — happy path (101 Switching Protocols)", () => {
	it("resolves to a Duplex when the server completes the upgrade", async () => {
		currentHandler = (_req, socket) => {
			socket.write(
				"HTTP/1.1 101 Switching Protocols\r\n" +
					"Connection: Upgrade\r\n" +
					"Upgrade: tcp\r\n" +
					"\r\n",
			);
		};
		const stream = await dialAttach("abc123", target);
		expect(stream).toBeDefined();
		stream.destroy();
	});
});

describe("dialAttach — head-bytes preserved", () => {
	it("preserves bytes that arrive in the same packet as the 101 headers", async () => {
		// Docker can send the first stream chunk in the same TCP packet as
		// the 101 response. Node's parser captures any bytes after the
		// headers as the `head` argument to upgrade — dialAttach must
		// `socket.unshift(head)` so consumers see them in order.
		const initialPayload = "FIRST_BYTES_FROM_CONTAINER";
		currentHandler = (_req, socket) => {
			socket.write(
				"HTTP/1.1 101 Switching Protocols\r\n" +
					"Connection: Upgrade\r\n" +
					"Upgrade: tcp\r\n" +
					"\r\n" +
					initialPayload,
			);
		};
		const stream = await dialAttach("abc123", target);
		const received: Buffer[] = [];
		stream.on("data", (chunk: Buffer) => received.push(chunk));

		// Wait one tick for the unshift'd bytes to be re-emitted as 'data'.
		await new Promise<void>((resolve) => setImmediate(resolve));

		const combined = Buffer.concat(received).toString("utf8");
		expect(combined).toContain(initialPayload);
		stream.destroy();
	});
});

describe("dialAttach — error path", () => {
	it("rejects when no server is listening on the target port", async () => {
		// Connect to a closed port on loopback — kernel returns ECONNREFUSED
		// immediately, exercising the req.on('error', reject) branch.
		await expect(
			dialAttach("abc123", { host: "127.0.0.1", port: 1 }),
		).rejects.toThrow();
	});
});
