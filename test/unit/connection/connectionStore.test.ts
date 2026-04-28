import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	connectionStore,
	displayInstanceName,
} from "../../../src/connection/connectionStore";
import type { ConnectionState } from "../../../src/connection/state";
import type { ConnectionError, TomoInstance } from "../../../src/connection/types";

// Factory for TomoInstance fixtures. Defaults yield a named instance; pass
// overrides to vary fields (e.g. name=null).
const inst = (overrides: Partial<TomoInstance> = {}): TomoInstance => ({
	containerId: "abcdef0123456789".padEnd(64, "0"),
	shortId: "abcdef012345",
	name: "test-instance",
	startedAt: new Date("2026-04-28T10:00:00Z"),
	image: "miyo/tomo:0.7.0",
	...overrides,
});

describe("connectionStore", () => {
	// connectionStore is a module-level singleton; reset between tests so
	// they remain independent of each other's mutations.
	beforeEach(() => {
		connectionStore.set({ kind: "disconnected" });
	});

	it("has initial value { kind: 'disconnected' }", () => {
		expect(connectionStore.get()).toEqual({ kind: "disconnected" });
	});

	it("set + subscribe wiring fires immediately and on updates, and unsubscribe stops further notifications", () => {
		const listener = vi.fn();

		const unsubscribe = connectionStore.subscribe(listener);

		// Subscribe contract: listener fires immediately with current value.
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenLastCalledWith({ kind: "disconnected" });

		const next: ConnectionState = { kind: "attaching", target: inst() };
		connectionStore.set(next);

		expect(listener).toHaveBeenCalledTimes(2);
		expect(listener).toHaveBeenLastCalledWith(next);

		unsubscribe();
		connectionStore.set({ kind: "connected", instance: inst() });

		// Post-unsubscribe set must NOT fire the listener again.
		expect(listener).toHaveBeenCalledTimes(2);
	});
});

describe("displayInstanceName", () => {
	it("returns null when disconnected", () => {
		const state: ConnectionState = { kind: "disconnected" };
		expect(displayInstanceName(state)).toBeNull();
	});

	it("returns null when disconnected with a reason", () => {
		const reason: ConnectionError = {
			code: "daemon-unreachable",
			detail: "no socket",
		};
		const state: ConnectionState = { kind: "disconnected", reason };
		expect(displayInstanceName(state)).toBeNull();
	});

	it("returns instance.name when connected with a named instance", () => {
		const state: ConnectionState = {
			kind: "connected",
			instance: inst({ name: "alpha" }),
		};
		expect(displayInstanceName(state)).toBe("alpha");
	});

	it("returns instance.shortId when connected with name=null", () => {
		const state: ConnectionState = {
			kind: "connected",
			instance: inst({ name: null, shortId: "deadbeef0001" }),
		};
		expect(displayInstanceName(state)).toBe("deadbeef0001");
	});

	it("returns target.name when attaching with a named target", () => {
		const state: ConnectionState = {
			kind: "attaching",
			target: inst({ name: "beta" }),
		};
		expect(displayInstanceName(state)).toBe("beta");
	});

	it("returns target.shortId when attaching with name=null target", () => {
		const state: ConnectionState = {
			kind: "attaching",
			target: inst({ name: null, shortId: "deadbeef0002" }),
		};
		expect(displayInstanceName(state)).toBe("deadbeef0002");
	});

	it("returns target.name when reconnecting with a named target", () => {
		const state: ConnectionState = {
			kind: "reconnecting",
			target: inst({ name: "gamma" }),
			attempt: 1,
			nextDelayMs: 500,
		};
		expect(displayInstanceName(state)).toBe("gamma");
	});

	it("returns target.shortId when reconnecting with name=null target", () => {
		const state: ConnectionState = {
			kind: "reconnecting",
			target: inst({ name: null, shortId: "deadbeef0003" }),
			attempt: 2,
			nextDelayMs: 1000,
		};
		expect(displayInstanceName(state)).toBe("deadbeef0003");
	});

	it("returns null on disconnected even when a reason is carried", () => {
		// The previous v1.1 SDD had a separate `{ kind: "error"; ... }`
		// variant that this test exercised; the variant was removed in the
		// 2026-04-28 review-fix pass (see state.ts). The remaining failure
		// surface — `disconnected{reason}` — was already covered above; this
		// case asserts displayInstanceName returns null even when the reason
		// payload is non-trivial.
		const reason: ConnectionError = {
			code: "attach-failed",
			detail: "stream closed",
		};
		const state: ConnectionState = { kind: "disconnected", reason };
		expect(displayInstanceName(state)).toBeNull();
	});
});
