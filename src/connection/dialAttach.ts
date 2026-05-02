/**
 * Raw HTTP attach against the Docker daemon socket — extracted into its own
 * module so unit tests can `vi.mock("./dialAttach")` it without disturbing
 * the rest of `docker.ts`. Cross-module imports respect vi.mock; same-module
 * internal references do not.
 *
 * Why this exists instead of `container.attach()`:
 *
 * docker-modem 4.0.12 has two interacting bugs in its hijack-mode POST path:
 *
 * 1. modem.js:208 unconditionally JSON-stringifies the attach options as
 *    the request body. With `hijack: true` that body is then written to
 *    the upgraded socket (modem.js:367-368) — i.e. straight into the
 *    container's stdin. The user sees `{"stream":true,"stdout":true,...}`
 *    typed into bash/Claude on every connect.
 *
 * 2. Trying to suppress the body via `_body: {}` (which makes data evaluate
 *    to "{}" → matches the empty-body shortcut → data=undefined) causes a
 *    different bug at modem.js:376: with `openStdin=true` (which we always
 *    set), `req.end()` is never called, AND `req.write()` is never called
 *    either, so the request hangs forever waiting for the headers to flush.
 *
 * The third option — bypass modem entirely. POST to /containers/{id}/attach
 * with explicit Content-Length: 0 and an immediate req.end(). The headers
 * flush, the server returns 101 Switching Protocols, the upgrade event
 * fires, and we get back a clean raw socket with zero stdin pollution.
 *
 * Listed compatibility flags via querystring (Docker API contract):
 *   stream=1 → keep stream open (vs single response)
 *   stdout=1 stderr=1 stdin=1 → which streams to multiplex
 *   logs=0 → don't replay historical logs on attach
 */

import http from "node:http";
import process from "node:process";
import type { Duplex } from "node:stream";

/**
 * Single source of truth for the Docker daemon socket path. Re-exported
 * for `docker.ts` (which uses it to construct the dockerode client) so
 * the platform-detection lives in one place (review round 2 / L11).
 */
export const SOCKET_PATH: string =
	process.platform === "win32"
		? "\\\\.\\pipe\\docker_engine"
		: "/var/run/docker.sock";

/**
 * Connection target for dialAttach. Production uses a Unix-socket path
 * (or named pipe on Windows). Tests can pass `{ host, port }` to point
 * at a local TCP `http.Server` and exercise the full request → 101 →
 * upgrade path without Docker (review H3). Sandboxed test environments
 * block `listen()` on Unix sockets, so TCP loopback is the portable
 * test transport.
 */
export type DialTarget =
	| { readonly socketPath: string }
	| { readonly host: string; readonly port: number };

const DEFAULT_TARGET: DialTarget = { socketPath: SOCKET_PATH };

export function dialAttach(
	containerId: string,
	target: DialTarget = DEFAULT_TARGET,
): Promise<Duplex> {
	return new Promise<Duplex>((resolve, reject) => {
		const params = "stream=1&stdout=1&stderr=1&stdin=1&logs=0";
		const req = http.request({
			...("socketPath" in target
				? { socketPath: target.socketPath }
				: { host: target.host, port: target.port }),
			path: `/containers/${containerId}/attach?${params}`,
			method: "POST",
			headers: {
				"Content-Type": "application/vnd.docker.raw-stream",
				Connection: "Upgrade",
				Upgrade: "tcp",
				"Content-Length": "0",
			},
		});

		// M2 (review/spec-001): 10-second upgrade timeout. If the daemon
		// accepts the TCP connection but stalls before completing the 101
		// handshake (mid-restart, partial response, stuck upgrade), pre-fix
		// behavior was to hang indefinitely — neither resolve nor reject
		// fired. setTimeout fires the request's `error` event with a
		// timeout error which routes to reject() below.
		req.setTimeout(10_000, () => {
			req.destroy(new Error("dialAttach: Docker upgrade timeout"));
		});

		// 'upgrade' fires after Docker responds with 101 Switching Protocols.
		// `head` may carry initial bytes already received with the response —
		// unshift them back onto the socket so consumers see them in order.
		req.on("upgrade", (_res, socket, head) => {
			req.setTimeout(0); // clear the timeout once upgraded
			if (head.length > 0) socket.unshift(head);
			resolve(socket);
		});
		req.on("error", reject);
		// Critical: explicit req.end() is what flushes headers in this code
		// path. Modem's openStdin branch skipped this entirely (see comment
		// block above) which is why the previous workaround hung.
		req.end();
	});
}
