/**
 * Docker helpers — thin wrappers around dockerode used directly by
 * TomoConnection. Per ADR-5 v2 there is no `DockerClient` port, no adapter,
 * no fake: a single production implementation never benefits from a port,
 * and unit tests use `vi.mock("dockerode")` to script the small surface we
 * touch (listContainers, getContainer, container.inspect, container.attach,
 * modem.demuxStream). Live tests in `test/live/` exercise the real daemon.
 *
 * Spec: docs/XDD/specs/001-session-view — SDD "Docker Helpers (no port —
 * use dockerode directly)" + "Integration Points / Docker_Engine".
 *
 * --- Decisions made beyond the SDD ---
 *
 * 1. socketPath is explicit (ADR-1). dockerode is constructed with an
 *    explicit `socketPath` so it never follows `DOCKER_HOST` /
 *    `DOCKER_CONTEXT`. On Windows we use the named pipe, on every other
 *    platform the standard Unix socket. Windows is user-contribution tier;
 *    we do not assume POSIX in the path string itself.
 *
 * 2. `startedAt` is sourced from `ContainerInfo.Created` (epoch seconds),
 *    not `State.StartedAt`. The SDD discovery algorithm names
 *    `container.State.StartedAt`, but dockerode's `listContainers` returns
 *    `ContainerInfo` whose `State` is a string ("running"/"exited") and
 *    exposes only `Created` (epoch). True StartedAt only lives on
 *    `ContainerInspectInfo` and would cost N round trips to fetch for the
 *    picker. Created ≈ Started within seconds for our use case
 *    (sort + display). If we ever need exact StartedAt we'll add a
 *    second-pass inspect.
 *
 * 3. Lazy singleton dockerode client. Construction is cheap, but
 *    centralising it keeps the `socketPath` decision in one place and makes
 *    the unit-test mock surface trivial.
 */

import { Buffer } from "node:buffer";
import process from "node:process";
import { PassThrough, type Duplex, type Readable, type Writable } from "node:stream";

import Dockerode from "dockerode";

import type { ConnectionError, TomoInstance } from "./types";

// --- AttachSession contract --------------------------------------------------

/**
 * Stable surface returned from `attach()`. The view layer reads from `stdout`,
 * writes to `stdin`, registers a single `onClose` listener, and calls `close()`
 * to tear down. `close()` is idempotent; `onClose` fires exactly once.
 *
 * `resize(rows, cols)` forwards xterm's current geometry to the container's
 * PTY via Docker's resize endpoint. Required because `docker run -it` creates
 * a TTY with a fixed default size (80×24); without resize calls, every
 * dimension Claude Code (or any TUI) thinks it's drawing into is wrong, so
 * cursor backsteps and line-clears land on stale cells and animation frames
 * stack visibly in xterm. After `close()` resize is a silent no-op so view
 * code doesn't have to track session lifecycle.
 */
export interface AttachSession {
	readonly stdout: Readable;
	readonly stdin: Writable;
	close(): Promise<void>;
	onClose(cb: (reason: "user" | "remote" | "error") => void): void;
	resize(rows: number, cols: number): Promise<void>;
}

// --- internals ---------------------------------------------------------------

const DOCKER_LABEL_COMPONENT = "miyo.component=tomo";
const DOCKER_LABEL_INSTANCE_NAME = "miyo.tomo.instance-name";

const SOCKET_PATH: string =
	process.platform === "win32"
		? "\\\\.\\pipe\\docker_engine"
		: "/var/run/docker.sock";

let _client: Dockerode | undefined;

function client(): Dockerode {
	if (_client === undefined) {
		_client = new Dockerode({ socketPath: SOCKET_PATH });
	}
	return _client;
}

/**
 * Error thrown by the helpers when a `ConnectionError` needs to escape across
 * a Promise boundary. We carry the discriminated-union payload as a property
 * so callers can `instanceof ConnectionFailure` and pattern-match `.code`.
 */
export class ConnectionFailure extends Error {
	public readonly code: ConnectionError["code"];
	public readonly detail: string;
	constructor(error: ConnectionError) {
		super(error.detail);
		this.name = "ConnectionFailure";
		this.code = error.code;
		this.detail = error.detail;
	}
}

function attachFailed(detail: string): ConnectionFailure {
	return new ConnectionFailure({ code: "attach-failed", detail });
}

interface DockerErrorLike {
	statusCode?: number;
}

function isNotFound(err: unknown): boolean {
	if (typeof err !== "object" || err === null) return false;
	const code = (err as DockerErrorLike).statusCode;
	return code === 404;
}

// --- listTomoInstances -------------------------------------------------------

/**
 * Discover every running Tomo container reachable on the local Docker daemon.
 * Filters on label `miyo.component=tomo`. Returns instances sorted by
 * `startedAt` DESC (newest first) for picker UX.
 */
export async function listTomoInstances(): Promise<TomoInstance[]> {
	const containers = await client().listContainers({
		filters: { label: [DOCKER_LABEL_COMPONENT] },
	});

	const mapped: TomoInstance[] = containers.map((c: Dockerode.ContainerInfo) => {
		const containerId = c.Id;
		const shortId = containerId.slice(0, 12);
		const rawName = c.Labels?.[DOCKER_LABEL_INSTANCE_NAME];
		const name = typeof rawName === "string" && rawName.length > 0 ? rawName : null;
		// See module-header decision (2): Created (epoch seconds) → Date.
		const startedAt = new Date(c.Created * 1000);
		return {
			containerId,
			shortId,
			name,
			startedAt,
			image: c.Image,
		};
	});

	mapped.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
	return mapped;
}

// --- inspectContainer --------------------------------------------------------

/**
 * Inspect a container by id. Returns `null` when Docker reports 404 (container
 * gone). Rethrows every other error so the caller can map them onto a
 * `ConnectionError` with proper context.
 */
export async function inspectContainer(
	id: string,
): Promise<Dockerode.ContainerInspectInfo | null> {
	try {
		return await client().getContainer(id).inspect();
	} catch (err: unknown) {
		if (isNotFound(err)) return null;
		throw err;
	}
}

// --- attach ------------------------------------------------------------------

/**
 * Attach to a running container's stdio streams. TTY containers expose a
 * single duplex used for both directions; non-TTY containers send framed
 * stdout/stderr that must be demuxed via `modem.demuxStream`. Either way,
 * the returned `AttachSession.stdout` is a unified stream the view layer can
 * pipe into xterm without caring which mode the container runs in.
 */
export async function attach(id: string): Promise<AttachSession> {
	const info = await inspectContainer(id);
	if (info === null) {
		throw attachFailed(
			`Container ${id.slice(0, 12)} not found — it may have stopped.`,
		);
	}

	const tty: boolean = info.Config.Tty === true;
	const docker = client();
	const container = docker.getContainer(id);
	// `hijack: true` is REQUIRED when attaching with stdin so docker-modem
	// performs the HTTP-Upgrade handshake to a raw bidirectional socket.
	// Without it, output may still flow (initial response chunks) but writes
	// to stdin are dropped — the connection isn't hijacked, it's just an
	// HTTP response body. User-reported runtime bug 2026-04-28.
	const raw = (await container.attach({
		stream: true,
		stdout: true,
		stderr: true,
		stdin: true,
		hijack: true,
		logs: false,
	})) as Duplex;

	let stdoutStream: Readable;
	if (tty) {
		stdoutStream = raw;
	} else {
		const stdoutPT = new PassThrough();
		const stderrPT = new PassThrough();
		// Merge stderr into the same stream consumers see as stdout. Live
		// xterm rendering is byte-faithful enough that interleaving is fine.
		stderrPT.on("data", (chunk: Buffer | string) => {
			stdoutPT.write(chunk);
		});
		docker.modem.demuxStream(raw, stdoutPT, stderrPT);
		stdoutStream = stdoutPT;
	}

	const stdinStream: Writable = raw;

	let closed = false;
	let listener: ((reason: "user" | "remote" | "error") => void) | undefined;

	function fire(reason: "user" | "remote" | "error"): void {
		if (closed) return;
		closed = true;
		if (listener !== undefined) {
			const cb = listener;
			listener = undefined;
			try {
				cb(reason);
			} catch {
				// Listener errors must not crash the caller.
			}
		}
	}

	raw.on("end", () => fire("remote"));
	raw.on("error", () => fire("error"));

	return {
		stdout: stdoutStream,
		stdin: stdinStream,
		async close(): Promise<void> {
			if (closed) return;
			fire("user");
			raw.destroy();
		},
		onClose(cb): void {
			listener = cb;
		},
		async resize(rows, cols): Promise<void> {
			// Closed-session no-op: late resize events from a torn-down xterm
			// (ResizeObserver flushing during view dispose) must not hit
			// dockerode against a container reference that may already be
			// stale. Silent return keeps the caller — TomoConnection — from
			// having to wrap every call in a state check.
			if (closed) return;
			await container.resize({ h: rows, w: cols });
		},
	};
}
