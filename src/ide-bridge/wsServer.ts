/**
 * WebSocket transport server for the IDE Bridge — the runtime endpoint that
 * Claude Code connects to. It assembles the dependency-free Phase 1 pieces
 * (frame codec, handshake/auth helpers, JSON-RPC dispatch) into a live
 * `http.createServer` + `'upgrade'` pipeline, completes the MCP handshake,
 * broadcasts `selection_changed` notifications, and reaps dead clients with a
 * ping/pong keepalive loop.
 *
 * WHY this file exists separately from IdeBridge (T3.2): single-writer
 * discipline (ADR-3). This server is a pure transport — it NEVER touches
 * `ideBridgeStore`. It surfaces all state changes through two injected
 * callbacks, `onClientCountChange(n)` and `onListenError(reason)`, and lets
 * IdeBridge be the sole store writer. Keeping transport and store-orchestration
 * apart makes both unit-testable in isolation: this file against a raw TCP
 * loopback client, IdeBridge against a fake server.
 *
 * Constructor options shape ({@link WsServerOptions}) — all behaviour-shaping
 * knobs are injectable so tests run fast and deterministically:
 *   - `port`            : TCP port (0 = ephemeral, used by tests).
 *   - `host?`           : bind address; defaults to and is GUARDED at 127.0.0.1.
 *   - `getToken`        : getter for the live bearer token (owned by IdeBridge).
 *   - `registry`        : JSON-RPC tool HandlerRegistry (Phase 2); MCP handshake
 *                         methods are layered on top here.
 *   - `toolsList?`      : `tools/list` payload entries; defaults to [].
 *   - `serverInfo?`     : MCP serverInfo; defaults to the plugin identity.
 *   - `protocolVersion?`: MCP protocol version string.
 *   - `onClientCountChange(n)` / `onListenError(reason)` : the ONLY state surface.
 *   - `log`             : `{ debug, warn, error }`.
 *   - `pingIntervalMs?` : keepalive interval (default 30000).
 *   - `readdressRetryMs?`: EADDRINUSE single re-listen delay (default 500).
 *
 * Writes NO files (`outbound: []`): no fs import, no writeFile/mkdir.
 *
 * Spec: docs/XDD/specs/003-ide-bridge — SDD Implementation Examples (upgrade
 * auth), Runtime View (handshake), Error Handling; PRD F1/F4/F5/F9/F16.
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";

import {
	decodeFrames,
	encodeClose,
	encodePing,
	encodePong,
	encodeText,
} from "./frame";
import { isAuthorized, secWebSocketAccept } from "./handshake";
import { dispatch, parseMessage, type HandlerRegistry } from "./jsonRpc";
import type { RpcError } from "./protocol";

/** Loopback-only bind address. Any other value is refused in {@link listen}. */
const LOOPBACK = "127.0.0.1";

/** Default MCP protocol version negotiated with Claude Code. */
const DEFAULT_PROTOCOL_VERSION = "2024-11-05";

/** Default keepalive ping cadence (PRD F9). */
const DEFAULT_PING_INTERVAL_MS = 30_000;

/** Default single EADDRINUSE re-listen delay (Kado hot-reload race). */
const DEFAULT_READDRESS_RETRY_MS = 500;

/** The auth header Claude Code presents on the upgrade request. */
const AUTH_HEADER = "x-claude-code-ide-authorization";

/** Minimal logger surface (mirrors IdeBridge's `log`). */
export type WsLog = {
	debug: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
	error: (...args: unknown[]) => void;
};

/** A single `tools/list` wire entry. */
export type ToolListEntry = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
};

/** Constructor options — see file header for the full rationale. */
export type WsServerOptions = {
	port: number;
	host?: string;
	getToken: () => string;
	registry: HandlerRegistry;
	toolsList?: ToolListEntry[];
	serverInfo?: { name: string; version?: string };
	protocolVersion?: string;
	onClientCountChange: (count: number) => void;
	onListenError: (reason: string) => void;
	log: WsLog;
	pingIntervalMs?: number;
	readdressRetryMs?: number;
};

/** Per-connection bookkeeping for the framing read loop + keepalive. */
type Client = {
	socket: Duplex;
	/** Bytes not yet forming a complete frame; re-fed on the next chunk. */
	buffer: Buffer;
	/** Set true when we send a PING; cleared on PONG. Reaped if still set. */
	awaitingPong: boolean;
};

/** Build the MCP `initialize` result. */
function initializeResult(
	protocolVersion: string,
	serverInfo: { name: string; version?: string },
): Record<string, unknown> {
	return {
		protocolVersion,
		capabilities: { tools: {} },
		serverInfo,
	};
}

export class WsServer {
	private readonly host: string;
	private readonly pingIntervalMs: number;
	private readonly readdressRetryMs: number;
	private readonly clients = new Set<Client>();
	private server: Server | null = null;
	private pingTimer: ReturnType<typeof setInterval> | null = null;
	/** Combined registry: injected tool handlers + MCP handshake methods. */
	private readonly registry: HandlerRegistry;

	constructor(private readonly opts: WsServerOptions) {
		this.host = opts.host ?? LOOPBACK;
		this.pingIntervalMs = opts.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
		this.readdressRetryMs = opts.readdressRetryMs ?? DEFAULT_READDRESS_RETRY_MS;
		this.registry = this.buildRegistry();
	}

	/**
	 * Start listening. Resolves with the bound port (useful for ephemeral `0`).
	 * Rejects synchronously for a non-loopback host (Security/F4). On EADDRINUSE
	 * makes a SINGLE re-listen attempt after `readdressRetryMs`; if that also
	 * fails it fires `onListenError("port {p} in use")` and rejects.
	 */
	listen(): Promise<number> {
		if (this.host !== LOOPBACK) {
			return Promise.reject(
				new Error(`refusing to bind to non-loopback host: ${this.host}`),
			);
		}

		return new Promise<number>((resolve, reject) => {
			let retried = false;

			const server = createServer((_req, res) => {
				// Plain HTTP requests are not part of the contract — close them.
				res.statusCode = 426; // Upgrade Required
				res.end();
			});
			this.server = server;

			server.on("upgrade", (req, socket) => this.handleUpgrade(req, socket));

			const onError = (err: NodeJS.ErrnoException) => {
				if (err.code === "EADDRINUSE" && !retried) {
					retried = true;
					setTimeout(() => {
						try {
							server.listen(this.opts.port, this.host);
						} catch {
							/* surfaced via the next 'error' emission */
						}
					}, this.readdressRetryMs);
					return;
				}
				if (err.code === "EADDRINUSE") {
					const reason = `port ${this.opts.port} in use`;
					this.opts.onListenError(reason);
					reject(new Error(reason));
					return;
				}
				reject(err);
			};
			server.on("error", onError);

			server.listen(this.opts.port, this.host, () => {
				const addr = server.address();
				const port = typeof addr === "object" && addr ? addr.port : this.opts.port;
				// Listen succeeded — drop the startup error listener so the server's
				// lifecycle is unambiguous (a later error must not reject a settled
				// promise). Behaviourally a no-op, but it removes the dangling listener.
				server.removeListener("error", onError);
				this.startKeepalive();
				resolve(port);
			});
		});
	}

	/** Close every client then the HTTP server. Idempotent. */
	async stop(): Promise<void> {
		if (this.pingTimer !== null) {
			clearInterval(this.pingTimer);
			this.pingTimer = null;
		}
		for (const client of this.clients) {
			this.closeClient(client, false);
		}
		this.clients.clear();
		const server = this.server;
		this.server = null;
		if (server === null) return;
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}

	/** Frame `obj` as an UNMASKED TEXT JSON-RPC notification to every client. */
	broadcast(obj: unknown): void {
		const frame = encodeText(JSON.stringify(obj));
		for (const client of this.clients) {
			client.socket.write(frame);
		}
	}

	/** Current connected client count. */
	clientCount(): number {
		return this.clients.size;
	}

	// -----------------------------------------------------------------------
	// Upgrade / auth
	// -----------------------------------------------------------------------

	private handleUpgrade(req: IncomingMessage, socket: Duplex): void {
		const presented = req.headers[AUTH_HEADER];
		const token = this.opts.getToken();

		if (!isAuthorized(presented, token)) {
			// F16: log the rejected token, NEVER the remote address.
			this.opts.log.warn(`[hashi/ide] auth rejected: ${String(presented)}`);
			socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
			socket.destroy();
			return;
		}

		const key = req.headers["sec-websocket-key"];
		if (typeof key !== "string") {
			socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
			socket.destroy();
			return;
		}

		const accept = secWebSocketAccept(key);
		socket.write(
			"HTTP/1.1 101 Switching Protocols\r\n" +
				"Upgrade: websocket\r\n" +
				"Connection: Upgrade\r\n" +
				`Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
		);
		this.registerClient(socket);
	}

	private registerClient(socket: Duplex): void {
		const client: Client = { socket, buffer: Buffer.alloc(0), awaitingPong: false };
		this.clients.add(client);

		socket.on("data", (chunk: Buffer) => this.onClientData(client, chunk));
		socket.on("close", () => this.removeClient(client));
		socket.on("error", () => this.removeClient(client));

		this.opts.onClientCountChange(this.clients.size);
	}

	private removeClient(client: Client): void {
		if (!this.clients.delete(client)) return;
		this.opts.onClientCountChange(this.clients.size);
	}

	private closeClient(client: Client, recompute = true): void {
		try {
			client.socket.write(encodeClose(1000));
		} catch {
			/* socket may already be torn down */
		}
		client.socket.destroy();
		if (recompute) this.removeClient(client);
		else this.clients.delete(client);
	}

	// -----------------------------------------------------------------------
	// Per-client framing read loop
	// -----------------------------------------------------------------------

	private onClientData(client: Client, chunk: Buffer): void {
		client.buffer = Buffer.concat([client.buffer, chunk]);
		const { frames, rest } = decodeFrames(client.buffer);
		client.buffer = rest;

		for (const frame of frames) {
			switch (frame.kind) {
				case "text":
					// Routing is async; intentionally fire-and-forget. The handler
					// itself never throws (dispatch swallows everything), so an
					// unhandled rejection is impossible — but guard anyway.
					void this.routeText(client, frame.payload).catch((err) => {
						this.opts.log.error("[hashi/ide] unexpected route failure", err);
					});
					break;
				case "ping":
					client.socket.write(encodePong(frame.payload));
					break;
				case "pong":
					client.awaitingPong = false;
					break;
				case "close":
					this.closeClient(client);
					break;
				default:
					/* ignore binary/other opcodes (out of scope) */
					break;
			}
		}
	}

	/**
	 * Parse + dispatch a single TEXT message and, for requests, write the
	 * response frame. NEVER throws out of the read loop: parse errors map to a
	 * JSON-RPC error envelope, dispatch already swallows handler throws.
	 */
	private async routeText(client: Client, raw: string): Promise<void> {
		const parsed = parseMessage(raw);
		if ("code" in parsed) {
			// parseMessage returned an RpcError (no envelope) — wrap it. A parse
			// failure has no id to echo, so use null per JSON-RPC.
			this.writeResponse(client, this.errorEnvelope(parsed));
			return;
		}

		const response = await dispatch(parsed, this.registry);
		if (response !== null) {
			this.writeResponse(client, response);
		}
	}

	private errorEnvelope(error: RpcError): Record<string, unknown> {
		return { jsonrpc: "2.0", id: null, error };
	}

	private writeResponse(client: Client, response: unknown): void {
		try {
			client.socket.write(encodeText(JSON.stringify(response)));
		} catch (err) {
			this.opts.log.error("[hashi/ide] failed to write response", err);
		}
	}

	// -----------------------------------------------------------------------
	// MCP handshake + keepalive
	// -----------------------------------------------------------------------

	/** Layer the MCP handshake methods on top of the injected tool registry. */
	private buildRegistry(): HandlerRegistry {
		const protocolVersion = this.opts.protocolVersion ?? DEFAULT_PROTOCOL_VERSION;
		const serverInfo = this.opts.serverInfo ?? {
			name: "miyo-tomo-hashi",
		};
		const toolsList = this.opts.toolsList ?? [];

		const handshake: HandlerRegistry = {
			initialize: () => initializeResult(protocolVersion, serverInfo),
			// Notification (no id) → dispatch returns null, no response written.
			"notifications/initialized": () => undefined,
			"tools/list": () => ({ tools: toolsList }),
		};

		// Tool handlers must not shadow the MCP methods; handshake wins on clash.
		return { ...this.opts.registry, ...handshake };
	}

	private startKeepalive(): void {
		this.pingTimer = setInterval(() => this.sweep(), this.pingIntervalMs);
		// Do not keep the event loop alive solely for the ping timer.
		if (typeof this.pingTimer.unref === "function") this.pingTimer.unref();
	}

	/**
	 * One keepalive tick: reap any client that did not PONG since the last tick,
	 * then PING the survivors and mark them as awaiting a PONG.
	 */
	private sweep(): void {
		for (const client of [...this.clients]) {
			if (client.awaitingPong) {
				this.closeClient(client);
				continue;
			}
			client.awaitingPong = true;
			try {
				client.socket.write(encodePing());
			} catch {
				this.closeClient(client);
			}
		}
	}
}
