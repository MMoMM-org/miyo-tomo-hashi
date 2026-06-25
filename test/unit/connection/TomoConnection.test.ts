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
import { DEFAULT_SETTINGS } from "../../../src/types";
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
		findInstanceByName: vi.fn<
			(name: string) => Promise<TomoInstance | null>
		>(),
		inspectContainer: vi.fn<(id: string) => Promise<InspectStub | null>>(),
		attach: vi.fn<(id: string) => Promise<docker.AttachSession>>(),
	};
});

// Lazy-imported under test (after mock is in place).
import { TomoConnection } from "../../../src/connection/TomoConnection";

// --- helpers -----------------------------------------------------------------

const mockedList = vi.mocked(docker.listTomoInstances);
const mockedFindByName = vi.mocked(docker.findInstanceByName);
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

interface FakeSessionExtras {
	resizeCalls: () => Array<{ rows: number; cols: number }>;
	resizeRejection: (err: Error) => void;
}

function makeFakeSession(): FakeSession & FakeSessionExtras {
	const stdout = new PassThrough();
	const stdin = new PassThrough();
	let closed = false;
	let closeByUser = false;
	let closeCalls = 0;
	const resizeCalls: Array<{ rows: number; cols: number }> = [];
	let resizeReject: Error | null = null;
	// M9: match the real AttachSession contract — onClose stores a SINGLE
	// listener (last cb wins). Pre-fix the fake used EventEmitter.on which
	// accumulated callbacks; a divergent fake silently masked any
	// production regression that started firing every registered cb.
	let listener: ((reason: "user" | "remote" | "error") => void) | null = null;

	function fire(reason: "user" | "remote" | "error"): void {
		if (closed) return;
		closed = true;
		if (listener !== null) {
			const cb = listener;
			listener = null;
			try {
				cb(reason);
			} catch {
				// swallow — match real session behavior
			}
		}
	}

	const session: docker.AttachSession = {
		stdout,
		stdin,
		async close(): Promise<void> {
			closeCalls += 1;
			if (closed) return;
			closeByUser = true;
			fire("user");
		},
		onClose(cb): void {
			listener = cb;
		},
		async resize(rows: number, cols: number): Promise<void> {
			if (closed) return;
			resizeCalls.push({ rows, cols });
			if (resizeReject !== null) throw resizeReject;
		},
	};

	return {
		session,
		stdout,
		stdin,
		fireRemoteClose: (): void => fire("remote"),
		fireError: (): void => fire("error"),
		closedByUser: (): boolean => closeByUser,
		closeCalls: (): number => closeCalls,
		resizeCalls: (): Array<{ rows: number; cols: number }> => resizeCalls,
		resizeRejection: (err: Error): void => {
			resizeReject = err;
		},
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
	return { ...DEFAULT_SETTINGS, ...initial };
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
	it("transitions Disconnected → Attaching → Connected and persists chosenInstanceName", async () => {
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

		// FS2 now persists by stable instance name (target.name), not the
		// container ID — survives docker stop+start. Container ID would be
		// regenerated on every restart, breaking auto-reconnect.
		expect(s.chosenInstanceName).toBe(target.name);
		expect(conn.state.kind).toBe("connected");
		expect(conn.instanceName).toBe(target.name);

		unsub();
		await conn.dispose();
	});

	it("on Connected transition, persist callback is called with the updated settings (FS2)", async () => {
		const target = inst();
		const fake = makeFakeSession();
		mockedAttach.mockResolvedValueOnce(fake.session);

		const persist = vi.fn(async (_s: PluginSettings) => {});
		const s = settings();
		const conn = new TomoConnection(s, persist);

		await conn.connect(target);

		expect(persist).toHaveBeenCalledTimes(1);
		expect(persist).toHaveBeenCalledWith({
			...DEFAULT_SETTINGS,
			chosenInstanceName: target.name,
		});
		// Must reference the live settings object (mutation visible to caller).
		expect(persist.mock.calls[0]?.[0]).toBe(s);

		await conn.dispose();
	});

	it("disconnect() does NOT clear chosenInstanceName nor invoke persist with null (FS2 semantics)", async () => {
		const target = inst();
		const fake = makeFakeSession();
		mockedAttach.mockResolvedValueOnce(fake.session);

		const persist = vi.fn(async (_s: PluginSettings) => {});
		const s = settings();
		const conn = new TomoConnection(s, persist);

		await conn.connect(target);
		expect(s.chosenInstanceName).toBe(target.name);

		await conn.disconnect();

		// Disconnect path leaves settings untouched and never re-persists.
		expect(conn.state.kind).toBe("disconnected");
		expect(s.chosenInstanceName).toBe(target.name);
		expect(persist).toHaveBeenCalledTimes(1); // only the connect call
		expect(persist).not.toHaveBeenCalledWith({ chosenInstanceName: null });
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
		expect(s.chosenInstanceName).toBeNull();
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
		expect(s.chosenInstanceName).toBeNull();
	});

	// --- raw OS/socket error classification ---------------------------------
	// When the daemon is down or the socket is unreadable, the dial rejects with
	// a RAW Node error (`code: "ENOENT"` etc.), not a pre-built ConnectionFailure.
	// These must be classified into the friendly daemon-unreachable /
	// socket-permission-denied codes — otherwise the user sees a raw
	// "Stream error: connect ENOENT /var/run/docker.sock" AND the reconnect loop
	// wastes its full backoff on an error that will never resolve by retrying.

	const rawErr = (code: string, message: string): Error => {
		const e = new Error(message) as Error & { code: string };
		e.code = code;
		return e;
	};

	it("classifies a raw ENOENT (daemon not running) as daemon-unreachable, not a raw stream error", async () => {
		const target = inst();
		mockedAttach.mockRejectedValue(rawErr("ENOENT", "connect ENOENT /var/run/docker.sock"));

		const s = settings();
		const conn = new TomoConnection(s);

		await conn.connect(target);

		const state = conn.state;
		expect(state.kind).toBe("disconnected");
		if (state.kind !== "disconnected") throw new Error("expected disconnected");
		expect(state.reason?.code).toBe("daemon-unreachable");
		// The raw socket path must NOT leak into the user-facing detail.
		expect(state.reason?.detail).not.toContain("ENOENT");
		expect(state.reason?.detail).not.toMatch(/Stream error/);
	});

	it("classifies a raw ECONNREFUSED as daemon-unreachable", async () => {
		const target = inst();
		mockedAttach.mockRejectedValue(rawErr("ECONNREFUSED", "connect ECONNREFUSED /var/run/docker.sock"));

		const s = settings();
		const conn = new TomoConnection(s);

		await conn.connect(target);

		const state = conn.state;
		if (state.kind !== "disconnected") throw new Error("expected disconnected");
		expect(state.reason?.code).toBe("daemon-unreachable");
	});

	it("classifies a raw EACCES as socket-permission-denied", async () => {
		const target = inst();
		mockedAttach.mockRejectedValue(rawErr("EACCES", "connect EACCES /var/run/docker.sock"));

		const s = settings();
		const conn = new TomoConnection(s);

		await conn.connect(target);

		const state = conn.state;
		if (state.kind !== "disconnected") throw new Error("expected disconnected");
		expect(state.reason?.code).toBe("socket-permission-denied");
	});

	it("leaves an unclassified raw error as attach-failed with the stream-error detail", async () => {
		const target = inst();
		mockedAttach.mockRejectedValue(rawErr("EPIPE", "write EPIPE"));

		const s = settings();
		const conn = new TomoConnection(s);

		await conn.connect(target);

		const state = conn.state;
		if (state.kind !== "disconnected") throw new Error("expected disconnected");
		expect(state.reason?.code).toBe("attach-failed");
		expect(state.reason?.detail).toMatch(/Stream error/);
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
	it("while Connected: closes existing stream, re-attaches via name lookup, stays Connected", async () => {
		// After the FS2 rework, force-reconnect resolves the live container
		// by instance-name label (not the cached ID) so a stop+start in
		// between produces a fresh attach against whatever ID is now running.
		const target = inst();
		const restarted = inst({ name: target.name }); // same name, different ID
		const first = makeFakeSession();
		const second = makeFakeSession();
		mockedAttach.mockResolvedValueOnce(first.session);
		mockedFindByName.mockResolvedValueOnce(restarted);
		mockedAttach.mockResolvedValueOnce(second.session);

		const conn = new TomoConnection(settings());
		await conn.connect(target);
		expect(conn.state.kind).toBe("connected");

		await conn.forceReconnect();

		expect(first.closedByUser()).toBe(true);
		expect(mockedAttach).toHaveBeenCalledTimes(2);
		// Second attach uses the freshly-resolved ID, not the original.
		expect(mockedAttach).toHaveBeenLastCalledWith(restarted.containerId);
		expect(conn.state.kind).toBe("connected");
		const after = conn.state;
		if (after.kind !== "connected") throw new Error("expected connected");
		expect(after.instance.containerId).toBe(restarted.containerId);

		await conn.dispose();
	});

	it("when chosen instance is gone: stays Disconnected{attach-failed/chosen-instance-gone}; never opens picker", async () => {
		const target = inst();
		const first = makeFakeSession();
		mockedAttach.mockResolvedValueOnce(first.session);
		// Name no longer resolves — the container is gone.
		mockedFindByName.mockResolvedValueOnce(null);

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
		// Name resolution returns the same target (or a new ID if container
		// was restarted) — both are valid post-FS2-rework scenarios.
		mockedFindByName.mockResolvedValue(target);
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

	it("auto-reconnect short-circuits on socket-permission-denied (review-fix M2 / PRD F1/AC12)", async () => {
		// A socket-permission-denied error will not resolve by waiting; the
		// loop must NOT run all 5 attempts × 15.5 s for a non-transient
		// error. The user needs the named error within ~500 ms (after the
		// first reconnect wait).
		vi.useFakeTimers();
		const target = inst();
		const first = makeFakeSession();
		mockedAttach.mockResolvedValueOnce(first.session);
		mockedFindByName.mockResolvedValue(target);
		// First reconnect attempt rejects with the non-transient error.
		mockedAttach.mockRejectedValueOnce(
			new docker.ConnectionFailure({
				code: "socket-permission-denied",
				detail: "EACCES on /var/run/docker.sock",
			}),
		);

		const conn = new TomoConnection(settings());
		await conn.connect(target);

		first.fireError();
		await Promise.resolve();
		expect(conn.state.kind).toBe("reconnecting");

		// Single backoff window — the loop should short-circuit, NOT
		// continue through 1s/2s/4s/8s.
		await vi.advanceTimersByTimeAsync(500);
		await vi.advanceTimersByTimeAsync(0);

		const state = conn.state;
		expect(state.kind).toBe("disconnected");
		if (state.kind !== "disconnected") throw new Error("expected disconnected");
		expect(state.reason?.code).toBe("socket-permission-denied");

		// Definitive: no further attempts after the first short-circuit.
		// Advance by the remaining ~14 s and verify the state didn't change.
		const callsAfterShort = mockedAttach.mock.calls.length;
		await vi.advanceTimersByTimeAsync(15_000);
		expect(mockedAttach.mock.calls.length).toBe(callsAfterShort);
		expect(conn.state.kind).toBe("disconnected");
	});

	it("auto-reconnect short-circuits on daemon-unreachable (review-fix M2 / PRD F1/AC12)", async () => {
		vi.useFakeTimers();
		const target = inst();
		const first = makeFakeSession();
		mockedAttach.mockResolvedValueOnce(first.session);
		mockedFindByName.mockResolvedValue(target);
		mockedAttach.mockRejectedValueOnce(
			new docker.ConnectionFailure({
				code: "daemon-unreachable",
				detail: "ECONNREFUSED",
			}),
		);

		const conn = new TomoConnection(settings());
		await conn.connect(target);
		first.fireError();
		await Promise.resolve();

		await vi.advanceTimersByTimeAsync(500);
		await vi.advanceTimersByTimeAsync(0);

		const state = conn.state;
		expect(state.kind).toBe("disconnected");
		if (state.kind !== "disconnected") throw new Error("expected disconnected");
		expect(state.reason?.code).toBe("daemon-unreachable");
	});

	it("auto-reconnect short-circuits on no-instances (review round 2 / M2 — defensive)", async () => {
		// `no-instances` is not currently thrown into the reconnect path by
		// any in-tree code, but the short-circuit lists it alongside
		// socket-permission-denied / daemon-unreachable so that if a future
		// caller ever throws ConnectionFailure({code:"no-instances"}) the
		// loop will not waste 15 s waiting for containers that are not
		// coming back. This test pins the contract.
		vi.useFakeTimers();
		const target = inst();
		const first = makeFakeSession();
		mockedAttach.mockResolvedValueOnce(first.session);
		mockedFindByName.mockResolvedValue(target);
		mockedAttach.mockRejectedValueOnce(
			new docker.ConnectionFailure({
				code: "no-instances",
				detail: "No Tomo instance seems to be running — start one and try again.",
			}),
		);

		const conn = new TomoConnection(settings());
		await conn.connect(target);
		first.fireError();
		await Promise.resolve();
		expect(conn.state.kind).toBe("reconnecting");

		await vi.advanceTimersByTimeAsync(500);
		await vi.advanceTimersByTimeAsync(0);

		const state = conn.state;
		expect(state.kind).toBe("disconnected");
		if (state.kind !== "disconnected") throw new Error("expected disconnected");
		expect(state.reason?.code).toBe("no-instances");

		// Definitive: no further attempts after the first short-circuit.
		const callsAfterShort = mockedAttach.mock.calls.length;
		await vi.advanceTimersByTimeAsync(15_000);
		expect(mockedAttach.mock.calls.length).toBe(callsAfterShort);
	});

	it("error close while Connected → all 5 attempts fail → Disconnected{reconnect-exhausted}", async () => {
		vi.useFakeTimers();
		const target = inst();
		const first = makeFakeSession();
		mockedAttach.mockResolvedValueOnce(first.session);
		// Five reconnect attempts: each name lookup resolves OK but attach rejects.
		mockedFindByName.mockResolvedValue(target);
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
	it("auto-reconnects when settings.chosenInstanceName is set and a container with that name is running", async () => {
		const target = inst();
		const fake = makeFakeSession();
		mockedFindByName.mockResolvedValueOnce(target);
		mockedAttach.mockResolvedValueOnce(fake.session);

		const s = settings({ chosenInstanceName: target.name });
		const conn = new TomoConnection(s);

		await conn.autoReconnectIfRemembered();

		expect(conn.state.kind).toBe("connected");
		expect(mockedAttach).toHaveBeenCalledWith(target.containerId);
		await conn.dispose();
	});

	it("survives docker stop+start: the same name resolves to a fresh container ID", async () => {
		// FS2's whole point post-rework: persisting the stable instance-name
		// label (not the container ID) means a `docker stop && docker run`
		// in between sessions doesn't force the user back into the picker.
		const restarted = inst({ name: "tomo-instance" });
		const fake = makeFakeSession();
		mockedFindByName.mockResolvedValueOnce(restarted);
		mockedAttach.mockResolvedValueOnce(fake.session);

		const s = settings({ chosenInstanceName: "tomo-instance" });
		const conn = new TomoConnection(s);

		await conn.autoReconnectIfRemembered();

		expect(mockedFindByName).toHaveBeenCalledWith("tomo-instance");
		expect(mockedAttach).toHaveBeenCalledWith(restarted.containerId);
		expect(conn.state.kind).toBe("connected");
		await conn.dispose();
	});

	it("stays Disconnected{chosen-instance-gone} when no container has that name; does NOT open picker", async () => {
		mockedFindByName.mockResolvedValueOnce(null);

		const s = settings({ chosenInstanceName: "tomo-instance" });
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

	it("no-ops when settings.chosenInstanceName is null", async () => {
		const conn = new TomoConnection(settings());
		await conn.autoReconnectIfRemembered();
		expect(conn.state.kind).toBe("disconnected");
		expect(mockedFindByName).not.toHaveBeenCalled();
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

describe("TomoConnection.resize()", () => {
	// PTY-resize bug context: docker run -it gives the container a fixed
	// default TTY size (80x24). xterm renders at the actual viewport size,
	// so any TUI animation in the container draws frames for the wrong
	// geometry — cursor backsteps and line-clears miss, animation frames
	// stack visibly. resize() forwards xterm's geometry to the container.

	it("forwards rows/cols to the active session while Connected", async () => {
		const target = inst();
		const fake = makeFakeSession();
		mockedAttach.mockResolvedValueOnce(fake.session);

		const conn = new TomoConnection(settings());
		await conn.connect(target);

		await conn.resize(40, 160);

		expect(fake.resizeCalls()).toEqual([{ rows: 40, cols: 160 }]);
		await conn.dispose();
	});

	it("is a silent no-op when not Connected (xterm fits before attach completes)", async () => {
		const conn = new TomoConnection(settings());
		// Disconnected — must not throw and must not require a session.
		await expect(conn.resize(24, 80)).resolves.toBeUndefined();
	});

	it("re-applies the last known size on the next attach (auto-reconnect path)", async () => {
		// xterm fires onResize once when the view layout settles. After a
		// reconnect, the new container PTY would otherwise be back to its
		// 80x24 default — the cached size means TomoConnection re-syncs the
		// new session without the view layer having to remember anything.
		vi.useFakeTimers();
		const target = inst();
		const first = makeFakeSession();
		const second = makeFakeSession();
		mockedAttach.mockResolvedValueOnce(first.session);
		mockedInspect.mockResolvedValue(makeInspectInfo(target.containerId));
		mockedAttach.mockResolvedValueOnce(second.session);

		const conn = new TomoConnection(settings());
		await conn.connect(target);
		await conn.resize(50, 200);
		expect(first.resizeCalls()).toEqual([{ rows: 50, cols: 200 }]);

		first.fireRemoteClose();
		await Promise.resolve();
		await vi.advanceTimersByTimeAsync(500);
		await vi.advanceTimersByTimeAsync(0);

		expect(conn.state.kind).toBe("connected");
		// New session got resized automatically with the cached geometry.
		expect(second.resizeCalls()).toEqual([{ rows: 50, cols: 200 }]);

		await conn.dispose();
	});

	it("swallows resize errors so a transient docker hiccup does not propagate", async () => {
		// Best-effort semantics: if a resize fails (e.g. container in the
		// middle of stop), the next xterm-resize event will retry. Exposing
		// the error to the view layer would be noise — there's nothing the
		// user can act on.
		const target = inst();
		const fake = makeFakeSession();
		mockedAttach.mockResolvedValueOnce(fake.session);
		fake.resizeRejection(new Error("HTTP 500"));

		const conn = new TomoConnection(settings());
		await conn.connect(target);

		await expect(conn.resize(24, 80)).resolves.toBeUndefined();
		await conn.dispose();
	});
});

// ---------------------------------------------------------------------------
// M8 — Epoch race: disconnect mid-attach must close the in-flight session.
// ---------------------------------------------------------------------------

describe("TomoConnection — epoch race during attach (M8)", () => {
	it("disconnect() while attach() is mid-flight closes the late session and lands disconnected", async () => {
		// Pre-fix the epoch guard was the documented motivating scenario for
		// the whole epoch design (see TomoConnection source comments) but no
		// test drove it. A regression that removed or mis-ordered the
		// `epoch !== this.epoch` check would merge silently.
		const target = inst();
		const fake = makeFakeSession();

		// Hold attach() open with a controlled promise so disconnect() can
		// fire while it's still pending.
		let releaseAttach!: (s: docker.AttachSession) => void;
		mockedAttach.mockImplementationOnce(
			() =>
				new Promise<docker.AttachSession>((resolve) => {
					releaseAttach = resolve;
				}),
		);

		const conn = new TomoConnection(settings());
		const connectPromise = conn.connect(target);

		// Yield once so connect() runs through to the awaited attach()
		// boundary; state is now `attaching`.
		await Promise.resolve();
		expect(conn.state.kind).toBe("attaching");

		// Fire disconnect — bumps epoch and lands state at disconnected.
		await conn.disconnect();
		expect(conn.state.kind).toBe("disconnected");

		// Now release the in-flight attach. The session was created AFTER
		// the epoch bump, so the post-attach epoch check must close it
		// quietly without restoring connected.
		releaseAttach(fake.session);
		await connectPromise;

		expect(conn.state.kind).toBe("disconnected");
		// The late session is closed exactly once (close() called by the
		// stale-epoch branch in attemptAttach).
		expect(fake.closeCalls()).toBeGreaterThanOrEqual(1);
		// And it was NOT installed — write() should reject.
		expect(() => conn.write("oops")).toThrow();
	});
});

// ---------------------------------------------------------------------------
// M9 — AttachSession contract: onClose is one-shot (latest cb wins).
// ---------------------------------------------------------------------------

describe("AttachSession contract — onClose semantics (M9)", () => {
	it("only the most-recently-registered onClose callback fires (latest wins)", async () => {
		// The real AttachSession in src/connection/docker.ts stores onClose
		// as a SINGLE listener (`listener = cb` overwrites). The test fake
		// must match — a divergent fake (e.g., emitter accumulation) would
		// silently mask a regression where the production code starts
		// firing every registered callback.
		const fake = makeFakeSession();
		const cb1 = vi.fn();
		const cb2 = vi.fn();

		fake.session.onClose(cb1);
		fake.session.onClose(cb2); // overwrites cb1
		fake.fireRemoteClose();

		// Yield so the emitter delivers.
		await Promise.resolve();

		expect(cb2).toHaveBeenCalledTimes(1);
		expect(cb1).not.toHaveBeenCalled();
	});

	it("onClose fires exactly once even if both 'remote' and 'error' would fire", async () => {
		// fire() in the real session is idempotent via a `closed` flag.
		// The fake mirrors this — once a close-of-any-kind fires, further
		// fireXxx() calls are no-ops.
		const fake = makeFakeSession();
		const cb = vi.fn();
		fake.session.onClose(cb);

		fake.fireRemoteClose();
		fake.fireError(); // would-be second close

		await Promise.resolve();
		expect(cb).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// M10 — startAutoReconnect chosen-gone mid-loop untested
// ---------------------------------------------------------------------------

describe("TomoConnection — auto-reconnect resolves to gone (M10)", () => {
	it("stream-close-triggered loop transitions to disconnected{chosen-gone} and stops the loop", async () => {
		// Pre-fix this exact scenario was tested for forceReconnect and
		// autoReconnectIfRemembered, but NOT for the loop driven by
		// handleSessionClose → startAutoReconnect. Same resolveLiveInstance
		// helper, separate code path. Regression in the "null → disconnect
		// + cancel" branch would pass all existing tests.
		vi.useFakeTimers();
		const target = inst({ name: "going-away" });
		const first = makeFakeSession();
		mockedAttach.mockResolvedValueOnce(first.session);
		// findByName returns the target on initial connect (via openPicker
		// path) — but the loop calls findByName on each attempt. Make
		// attempt #1 of the reconnect loop find nothing.
		mockedFindByName
			.mockResolvedValueOnce(null); // attempt 1 inside the reconnect loop

		const s = settings();
		const conn = new TomoConnection(s);
		await conn.connect(target);
		expect(conn.state.kind).toBe("connected");

		// Fire remote close → handleSessionClose → startAutoReconnect.
		first.fireRemoteClose();
		await Promise.resolve();
		expect(conn.state.kind).toBe("reconnecting");

		// Drive the 500 ms backoff for attempt #1.
		await vi.advanceTimersByTimeAsync(500);
		await vi.advanceTimersByTimeAsync(0);

		// findByName returned null → disconnected{chosen-gone}.
		const state = conn.state;
		expect(state.kind).toBe("disconnected");
		if (state.kind !== "disconnected") throw new Error("expected disconnected");
		expect(state.reason?.code).toBe("attach-failed");
		expect(state.reason?.detail).toContain("no longer exists");

		// Loop should have terminated — no further mockedAttach calls
		// for subsequent attempts. (1 call: the initial connect.)
		expect(mockedAttach).toHaveBeenCalledTimes(1);

		await conn.dispose();
	});
});
