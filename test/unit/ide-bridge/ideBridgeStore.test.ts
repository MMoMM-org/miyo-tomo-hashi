import { beforeEach, describe, expect, it, vi } from "vitest";

import { ideBridgeStore } from "../../../src/ide-bridge/ideBridgeStore";
import type { IdeBridgeState } from "../../../src/ide-bridge/state";

describe("ideBridgeStore", () => {
	// ideBridgeStore is a module-level singleton; reset between tests so they
	// remain independent of each other's mutations.
	beforeEach(() => {
		ideBridgeStore.set({ kind: "stopped" });
	});

	it("has initial value { kind: 'stopped' }", () => {
		expect(ideBridgeStore.get()).toEqual({ kind: "stopped" });
	});

	it("notifies subscribers immediately and on set, and unsubscribe stops further notifications", () => {
		const listener = vi.fn();

		const unsubscribe = ideBridgeStore.subscribe(listener);

		// Subscribe contract: listener fires immediately with current value.
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenLastCalledWith({ kind: "stopped" });

		const next: IdeBridgeState = { kind: "listening", port: 23027 };
		ideBridgeStore.set(next);

		expect(listener).toHaveBeenCalledTimes(2);
		expect(listener).toHaveBeenLastCalledWith(next);

		unsubscribe();
		ideBridgeStore.set({ kind: "connected", port: 23027, clientCount: 1 });

		// Post-unsubscribe set must NOT fire the listener again.
		expect(listener).toHaveBeenCalledTimes(2);
	});
});
