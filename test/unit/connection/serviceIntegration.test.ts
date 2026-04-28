/**
 * Phase 3 service integration — observable state flow.
 *
 * Unlike TomoConnection.test.ts (which inspects `conn.state` directly), this
 * test asserts only what an outside subscriber to `connectionStore` would
 * observe. It proves that every transition inside `TomoConnection`
 * propagates to `connectionStore` subscribers, which is what UI surfaces
 * (Phase 4) will rely on.
 *
 * Lifecycle exercised end-to-end:
 *   disconnected → attaching → connected
 *               → reconnecting → connected   (after remote stream close)
 *               → disconnected               (explicit user disconnect)
 *
 * Spec: docs/XDD/specs/001-session-view — Plan T3.5; SDD Solution Strategy
 *   ("single source of truth"); ADR-4 v3 (only TomoConnection writes).
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

// Same relaxed stand-in for inspectContainer's resolved value as the T3.3
// suite uses — the state machine only cares about non-null vs null.
type InspectStub = { Id: string; Image: string };

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

const mockedAttach = vi.mocked(docker.attach);
const mockedInspect = vi.mocked(docker.inspectContainer) as MockInstance<
	(id: string) => Promise<InspectStub | null>
>;

// --- helpers (mirrors TomoConnection.test.ts patterns) -----------------------

const inst = (overrides: Partial<TomoInstance> = {}): TomoInstance => {
	const containerId = "abcdef0123456789".padEnd(64, "0");
	return {
		containerId,
		shortId: containerId.slice(0, 12),
		name: "tomo-a",
		startedAt: new Date("2026-04-28T10:00:00Z"),
		image: "miyo/tomo:0.7.0",
		...overrides,
	};
};

function makeInspectInfo(id: string): InspectStub {
	return { Id: id, Image: "miyo/tomo:0.7.0" };
}

interface FakeSession {
	session: docker.AttachSession;
	stdout: PassThrough;
	stdin: PassThrough;
	fireRemoteClose: () => void;
}

function makeFakeSession(): FakeSession {
	const stdout = new PassThrough();
	const stdin = new PassThrough();
	const emitter = new EventEmitter();
	let closed = false;

	const session: docker.AttachSession = {
		stdout,
		stdin,
		async close(): Promise<void> {
			if (closed) return;
			closed = true;
			emitter.emit("close", "user");
		},
		onClose(cb): void {
			emitter.on("close", cb);
		},
		async resize(_rows: number, _cols: number): Promise<void> {
			// no-op stub — this integration test does not exercise PTY resize
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
	};
}

function settings(initial: Partial<PluginSettings> = {}): PluginSettings {
	return { chosenInstanceId: null, zoomLevel: 1, ...initial };
}

// --- suite -------------------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks();
	connectionStore.set({ kind: "disconnected" });
});

afterEach(() => {
	vi.useRealTimers();
});

describe("Phase 3 service integration — observable state flow", () => {
	it("connect → stream-close → auto-reconnect → connected → disconnect, observed entirely from connectionStore", async () => {
		const observed: ConnectionState[] = [];
		const unsubscribe = connectionStore.subscribe((s) => {
			observed.push(s);
		});
		// Subscribe replays current value: observed[0] === { kind: "disconnected" }.

		const target = inst();

		// Script: attach #1 succeeds (initial connect),
		//         inspect resolves OK (auto-reconnect presence check),
		//         attach #2 succeeds (reconnect after stream close).
		const session1 = makeFakeSession();
		const session2 = makeFakeSession();
		mockedAttach.mockResolvedValueOnce(session1.session);
		mockedInspect.mockResolvedValueOnce(makeInspectInfo(target.containerId));
		mockedAttach.mockResolvedValueOnce(session2.session);

		const conn = new TomoConnection(settings());

		// === connect ===
		await conn.connect(target);

		expect(observed.map((s) => s.kind)).toEqual([
			"disconnected",
			"attaching",
			"connected",
		]);
		const connectedState = observed.at(-1);
		if (connectedState?.kind !== "connected") {
			throw new Error("expected connected at end of connect()");
		}
		expect(connectedState.instance.containerId).toBe(target.containerId);

		// === stream close → auto-reconnect ===
		vi.useFakeTimers();
		session1.fireRemoteClose();

		// Yield once so the close handler runs and sets Reconnecting.
		await Promise.resolve();
		// Drive the 500 ms backoff for attempt #1, then flush microtasks.
		await vi.advanceTimersByTimeAsync(500);
		await vi.advanceTimersByTimeAsync(0);
		vi.useRealTimers();

		// Key transitions present in order: connected → reconnecting → connected.
		// (We assert presence + last-state rather than exhaustive equality
		// because the reconnect path emits intermediate "reconnecting" frames
		// whose count is timing-dependent.)
		const kindsAfterClose = observed.map((s) => s.kind);
		expect(kindsAfterClose).toContain("reconnecting");
		expect(kindsAfterClose.at(-1)).toBe("connected");

		const reconnectedState = observed.at(-1);
		if (reconnectedState?.kind !== "connected") {
			throw new Error("expected connected after auto-reconnect");
		}
		expect(reconnectedState.instance.containerId).toBe(target.containerId);

		// === disconnect ===
		await conn.disconnect();

		expect(observed.at(-1)).toEqual({ kind: "disconnected" });

		// Full key-transition arc, in order, observable purely from the store:
		//   disconnected → attaching → connected → reconnecting → connected → disconnected
		const distinct: ConnectionState["kind"][] = [];
		for (const s of observed) {
			if (distinct.at(-1) !== s.kind) distinct.push(s.kind);
		}
		expect(distinct).toEqual([
			"disconnected",
			"attaching",
			"connected",
			"reconnecting",
			"connected",
			"disconnected",
		]);

		unsubscribe();
		await conn.dispose();
	});
});
