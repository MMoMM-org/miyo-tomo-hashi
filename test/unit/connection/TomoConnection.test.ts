/**
 * Unit tests for TomoConnection — the connection state machine that owns
 * connectionStore and orchestrates docker helpers + ReconnectLoop.
 *
 * Approach: per ADR-5 v2, the docker helpers (./docker) are mocked at the
 * module boundary. No FakeDockerClient port. Tests script
 * listTomoInstances / inspectContainer / attach per scenario and assert the
 * state-store transitions plus settings persistence.
 *
 * Spec: docs/XDD/specs/001-session-view — SDD "TomoConnection Service Surface"
 * + Runtime View sequence diagrams; PRD F1, F2, F5, F8, FS2.
 */

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
	type MockInstance,
} from "vitest";

import * as docker from "../../../src/connection/docker";
import { connectionStore } from "../../../src/connection/connectionStore";
import type { ConnectionState } from "../../../src/connection/state";
import type { TomoInstance } from "../../../src/connection/types";
import type { PluginSettings } from "../../../src/types";

// The shape our state machine actually consumes from inspectContainer is
// "non-null vs null" — we never read individual fields. Declare a relaxed
// stand-in here so tests don't have to satisfy the full dockerode
// ContainerInspectInfo type just to assert presence.
type InspectStub = { Id: string; Image: string };

// Module-level mock for the docker helpers. Per the task brief: keep
// AttachSession + ConnectionFailure types from the real module while
// scripting listTomoInstances / inspectContainer / attach per test.
// inspectContainer is re-typed to InspectStub | null so the mock surface
// stays ergonomic without compromising the production signature.
vi.mock("../../../src/connection/docker", async (importActual) => {
	const actual =
		await importActual<typeof import("../../../src/connection/docker")>();
	return {
		...actual,
		listTomoInstances: vi.fn<() => Promise<TomoInstance[]>>(),
		inspectContainer: vi.fn<(id: string) => Promise<InspectStub | null>>(),
		attach: vi.fn<(id: string) => Promise<docker.AttachSession>>(),
	};
});

// Lazy-imported under test (after mock is in place).
import { TomoConnection } from "../../../src/connection/TomoConnection";

// --- helpers -----------------------------------------------------------------

const mockedList = vi.mocked(docker.listTomoInstances);
const mockedAttach = vi.mocked(docker.attach);

// inspectContainer's production return type is dockerode's
// ContainerInspectInfo. Our state machine only checks non-null vs null,
// so the mock factory above resolves with `InspectStub | null`. The cast
// here narrows vitest's MockInstance generic to that relaxed signature so
// tests can pass the lightweight stub without satisfying dockerode's full
// 18-field interface. Single-step structural widen — no `as unknown as`,
// no `any`, no `@ts-ignore`.
const mockedInspect = vi.mocked(docker.inspectContainer) as MockInstance<
	(id: string) => Promise<InspectStub | null>
>;

// TomoInstance factory. Distinct ids per call so equality by containerId works.
let _instCounter = 0;
const inst = (overrides: Partial<TomoInstance> = {}): TomoInstance => {
	_instCounter += 1;
	const seed = `abcdef${_instCounter.toString().padStart(6, "0")}`;
	const containerId = seed.padEnd(64, "0");
	return {
		containerId,
		shortId: containerId.slice(0, 12),
		name: "test-instance",
		startedAt: new Date("2026-04-28T10:00:00Z"),
		image: "miyo/tomo:0.7.0",
		...overrides,
	};
};

// Minimal inspect resolved value. State machine only checks non-null; the
// stub satisfies the relaxed mock signature declared above.
function makeInspectInfo(id: string): InspectStub {
	return { Id: id, Image: "miyo/tomo:0.7.0" };
}

// Fake AttachSession with controllable close-source (user / remote / error).
interface FakeSession {
	session: docker.AttachSession;
	stdout: PassThrough;
	stdin: PassThrough;
	fireRemoteClose: () => void;
	fireError: () => void;
	closedByUser: () => boolean;
	closeCalls: () => number;
}

function makeFakeSession(): FakeSession {
	const stdout = new PassThrough();
	const stdin = new PassThrough();
	const emitter = new EventEmitter();
	let closed = false;
	let closeByUser = false;
	let closeCalls = 0;

	const session: docker.AttachSession = {
		stdout,
		stdin,
		async close(): Promise<void> {
			closeCalls += 1;
			if (closed) return;
			closed = true;
			closeByUser = true;
			emitter.emit("close", "user");
		},
		onClose(cb): void {
			emitter.on("close", cb);
		},
	};

	return {
		session,
		stdout,
		stdin,
		fireRemoteClose: (): void => {
			if (closed) return;
			closed = true;
			emitter.emit("close", "remote");
		},
		fireError: (): void => {
			if (closed) return;
			closed = true;
			emitter.emit("close", "error");
		},
		closedByUser: (): boolean => closeByUser,
		closeCalls: (): number => closeCalls,
	};
}

function recordStates(): { states: ConnectionState[]; unsub: () => void } {
	const states: ConnectionState[] = [];
	const unsub = connectionStore.subscribe((s) => {
		states.push(s);
	});
	return { states, unsub };
}

function settings(initial: Partial<PluginSettings> = {}): PluginSettings {
	return { chosenInstanceId: null, ...initial };
}

// --- suite -------------------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks();
	connectionStore.set({ kind: "disconnected" });
});

afterEach(() => {
	vi.useRealTimers();
});

describe("TomoConnection.openPicker()", () => {
	it("returns the instance list from the docker helper", async () => {
		const a = inst({ name: "a" });
		const b = inst({ name: "b" });
		mockedList.mockResolvedValue([a, b]);

		const conn = new TomoConnection(settings());
		const result = await conn.openPicker();

		expect(result).toHaveLength(2);
		expect(result[0]?.name).toBe("a");
		expect(result[1]?.name).toBe("b");
		expect(mockedList).toHaveBeenCalledTimes(1);
	});
});

describe("TomoConnection.connect()", () => {
	it("transitions Disconnected → Attaching → Connected and persists chosenInstanceId", async () => {
		const target = inst();
		const fake = makeFakeSession();
		mockedAttach.mockResolvedValue(fake.session);

		const s = settings();
		const conn = new TomoConnection(s);
		const { states, unsub } = recordStates();

		await conn.connect(target);

		// initial subscribe pushes "disconnected"; then attaching; then connected.
		expect(states.map((x) => x.kind)).toEqual([
			"disconnected",
			"attaching",
			"connected",
		]);
		const attaching = states[1];
		const connected = states[2];
		if (attaching?.kind !== "attaching") throw new Error("expected attaching");
		if (connected?.kind !== "connected") throw new Error("expected connected");
		expect(attaching.target.containerId).toBe(target.containerId);
		expect(connected.instance.containerId).toBe(target.containerId);

		expect(s.chosenInstanceId).toBe(target.containerId);
		expect(conn.state.kind).toBe("connected");
		expect(conn.instanceName).toBe(target.name);

		unsub();
		await conn.dispose();
	});

	it("on daemon-unreachable error transitions to Disconnected{daemon-unreachable}; does not persist", async () => {
		const target = inst();
		mockedAttach.mockRejectedValue(
			new docker.ConnectionFailure({
				code: "daemon-unreachable",
				detail: "ECONNREFUSED on /var/run/docker.sock",
			}),
		);

		const s = settings();
		const conn = new TomoConnection(s);

		await conn.connect(target);

		const state = conn.state;
		expect(state.kind).toBe("disconnected");
		if (state.kind !== "disconnected") throw new Error("expected disconnected");
		expect(state.reason?.code).toBe("daemon-unreachable");
		expect(s.chosenInstanceId).toBeNull();
	});

	it("on socket-permission-denied error transitions to Disconnected{socket-permission-denied}", async () => {
		const target = inst();
		mockedAttach.mockRejectedValue(
			new docker.ConnectionFailure({
				code: "socket-permission-denied",
				detail: "EACCES on /var/run/docker.sock",
			}),
		);

		const s = settings();
		const conn = new TomoConnection(s);

		await conn.connect(target);

		const state = conn.state;
		expect(state.kind).toBe("disconnected");
		if (state.kind !== "disconnected") throw new Error("expected disconnected");
		expect(state.reason?.code).toBe("socket-permission-denied");
		expect(s.chosenInstanceId).toBeNull();
	});
});

describe("TomoConnection.disconnect()", () => {
	it("transitions Connected → Disconnected, closes session, does NOT call any stop helper, idempotent", async () => {
		const target = inst();
		const fake = makeFakeSession();
		mockedAttach.mockResolvedValue(fake.session);

		const conn = new TomoConnection(settings());
		await conn.connect(target);

		await conn.disconnect();
		expect(conn.state.kind).toBe("disconnected");
		expect(fake.closedByUser()).toBe(true);
		// docker has no "stop" helper exported; assert listTomoInstances /
		// inspectContainer were not surreptitiously called as part of teardown.
		expect(mockedList).not.toHaveBeenCalled();
		expect(mockedInspect).not.toHaveBeenCalled();

		// Idempotent: second disconnect() must not throw and must not re-fire.
		const callsBefore = fake.closeCalls();
		await expect(conn.disconnect()).resolves.toBeUndefined();
		expect(conn.state.kind).toBe("disconnected");
		expect(fake.closeCalls()).toBe(callsBefore);
	});
});

describe("TomoConnection.forceReconnect()", () => {
	it("while Connected: closes existing stream, re-attaches, stays Connected on success", async () => {
		const target = inst();
		const first = makeFakeSession();
		const second = makeFakeSession();
		mockedAttach.mockResolvedValueOnce(first.session);
		mockedInspect.mockResolvedValueOnce(makeInspectInfo(target.containerId));
		mockedAttach.mockResolvedValueOnce(second.session);

		const conn = new TomoConnection(settings());
		await conn.connect(target);
		expect(conn.state.kind).toBe("connected");

		await conn.forceReconnect();

		expect(first.closedByUser()).toBe(true);
		expect(mockedAttach).toHaveBeenCalledTimes(2);
		expect(conn.state.kind).toBe("connected");
		const after = conn.state;
		if (after.kind !== "connected") throw new Error("expected connected");
		expect(after.instance.containerId).toBe(target.containerId);

		await conn.dispose();
	});

	it("when chosen instance is gone: stays Disconnected{attach-failed/chosen-instance-gone}; never opens picker", async () => {
		const target = inst();
		const first = makeFakeSession();
		mockedAttach.mockResolvedValueOnce(first.session);
		// Second pass: inspect returns null → container vanished.
		mockedInspect.mockResolvedValueOnce(null);

		const conn = new TomoConnection(settings());
		await conn.connect(target);

		await conn.forceReconnect();

		const state = conn.state;
		expect(state.kind).toBe("disconnected");
		if (state.kind !== "disconnected") throw new Error("expected disconnected");
		expect(state.reason?.code).toBe("attach-failed");
		expect(state.reason?.detail).toContain("no longer exists");
		// Picker NEVER opens from forceReconnect:
		expect(mockedList).not.toHaveBeenCalled();
		// And we never tried to attach a second time:
		expect(mockedAttach).toHaveBeenCalledTimes(1);
	});
});

describe("TomoConnection — stream close auto-reconnect", () => {
	it("remote close while Connected → Reconnecting → Connected on success", async () => {
		vi.useFakeTimers();
		const target = inst();
		const first = makeFakeSession();
		const second = makeFakeSession();
		mockedAttach.mockResolvedValueOnce(first.session);
		mockedInspect.mockResolvedValue(makeInspectInfo(target.containerId));
		mockedAttach.mockResolvedValueOnce(second.session);

		const conn = new TomoConnection(settings());
		await conn.connect(target);
		expect(conn.state.kind).toBe("connected");

		const { states, unsub } = recordStates();
		// initial replay = connected (current state at subscribe time)

		first.fireRemoteClose();

		// Yield once so the close handler runs and sets Reconnecting.
		await Promise.resolve();
		expect(conn.state.kind).toBe("reconnecting");

		// Drive the 500 ms backoff for attempt #1.
		await vi.advanceTimersByTimeAsync(500);
		// Microtasks for the attempt promise + state update
		await vi.advanceTimersByTimeAsync(0);

		expect(conn.state.kind).toBe("connected");
		const kinds = states.map((x) => x.kind);
		expect(kinds).toContain("reconnecting");
		expect(kinds[kinds.length - 1]).toBe("connected");

		unsub();
		await conn.dispose();
	});

	it("error close while Connected → all 5 attempts fail → Disconnected{reconnect-exhausted}", async () => {
		vi.useFakeTimers();
		const target = inst();
		const first = makeFakeSession();
		mockedAttach.mockResolvedValueOnce(first.session);
		// Five reconnect attempts: each inspect resolves OK but attach rejects.
		mockedInspect.mockResolvedValue(makeInspectInfo(target.containerId));
		mockedAttach.mockRejectedValue(
			new docker.ConnectionFailure({
				code: "attach-failed",
				detail: "stream error: container restart",
			}),
		);

		const conn = new TomoConnection(settings());
		await conn.connect(target);

		first.fireError();
		await Promise.resolve();
		expect(conn.state.kind).toBe("reconnecting");

		// Burn through all 5 backoff windows: 500 + 1000 + 2000 + 4000 + 8000.
		await vi.advanceTimersByTimeAsync(500);
		await vi.advanceTimersByTimeAsync(1000);
		await vi.advanceTimersByTimeAsync(2000);
		await vi.advanceTimersByTimeAsync(4000);
		await vi.advanceTimersByTimeAsync(8000);
		// Flush microtasks that resolve after the final wait.
		await vi.advanceTimersByTimeAsync(0);

		const state = conn.state;
		expect(state.kind).toBe("disconnected");
		if (state.kind !== "disconnected") throw new Error("expected disconnected");
		expect(state.reason?.code).toBe("attach-failed");
		expect(state.reason?.detail.toLowerCase()).toContain("reconnect");
	});
});

describe("TomoConnection.autoReconnectIfRemembered()", () => {
	it("auto-reconnects when settings.chosenInstanceId is set and container exists", async () => {
		const target = inst();
		const fake = makeFakeSession();
		mockedInspect.mockResolvedValueOnce(makeInspectInfo(target.containerId));
		// listTomoInstances called to find the TomoInstance descriptor for the id.
		mockedList.mockResolvedValueOnce([target]);
		mockedAttach.mockResolvedValueOnce(fake.session);

		const s = settings({ chosenInstanceId: target.containerId });
		const conn = new TomoConnection(s);

		await conn.autoReconnectIfRemembered();

		expect(conn.state.kind).toBe("connected");
		await conn.dispose();
	});

	it("stays Disconnected{chosen-instance-gone} when container is missing; does NOT open picker", async () => {
		mockedInspect.mockResolvedValueOnce(null);

		const s = settings({ chosenInstanceId: "z".repeat(64) });
		const conn = new TomoConnection(s);

		await conn.autoReconnectIfRemembered();

		const state = conn.state;
		expect(state.kind).toBe("disconnected");
		if (state.kind !== "disconnected") throw new Error("expected disconnected");
		expect(state.reason?.code).toBe("attach-failed");
		expect(state.reason?.detail).toContain("no longer exists");
		expect(mockedList).not.toHaveBeenCalled();
		expect(mockedAttach).not.toHaveBeenCalled();
	});

	it("no-ops when settings.chosenInstanceId is null", async () => {
		const conn = new TomoConnection(settings());
		await conn.autoReconnectIfRemembered();
		expect(conn.state.kind).toBe("disconnected");
		expect(mockedInspect).not.toHaveBeenCalled();
		expect(mockedAttach).not.toHaveBeenCalled();
		expect(mockedList).not.toHaveBeenCalled();
	});
});

describe("TomoConnection.write() / onData() / dispose()", () => {
	it("write() while Connected forwards to stdin; onData() receives stdout chunks", async () => {
		const target = inst();
		const fake = makeFakeSession();
		mockedAttach.mockResolvedValueOnce(fake.session);

		const conn = new TomoConnection(settings());
		await conn.connect(target);

		const stdinSeen: Buffer[] = [];
		fake.stdin.on("data", (chunk: Buffer) => stdinSeen.push(chunk));
		conn.write("hello\n");
		await new Promise((r) => setImmediate(r));
		expect(Buffer.concat(stdinSeen).toString()).toBe("hello\n");

		const dataChunks: Uint8Array[] = [];
		const sub = conn.onData((chunk) => dataChunks.push(chunk));
		fake.stdout.write(Buffer.from("server-out"));
		await new Promise((r) => setImmediate(r));
		expect(dataChunks.length).toBeGreaterThan(0);
		expect(Buffer.from(dataChunks[0]!).toString()).toContain("server-out");

		sub.dispose();
		await conn.dispose();
	});

	it("write() while not Connected throws", async () => {
		const conn = new TomoConnection(settings());
		expect(() => conn.write("x")).toThrow();
	});

	it("dispose() closes any active session and unsubscribes", async () => {
		const target = inst();
		const fake = makeFakeSession();
		mockedAttach.mockResolvedValueOnce(fake.session);

		const conn = new TomoConnection(settings());
		await conn.connect(target);

		await conn.dispose();
		expect(fake.closedByUser()).toBe(true);
		expect(conn.state.kind).toBe("disconnected");
		// write() after dispose throws (no longer connected).
		expect(() => conn.write("x")).toThrow();
	});
});
