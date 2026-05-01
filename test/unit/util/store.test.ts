import { describe, expect, it, vi } from "vitest";

import { Store } from "../../../src/util/store";

describe("Store<T>", () => {
	it("get() returns initial value", () => {
		const store = new Store<number>(42);
		expect(store.get()).toBe(42);
	});

	it("subscribe fires immediately with current value", () => {
		const store = new Store<string>("hello");
		const listener = vi.fn();

		store.subscribe(listener);

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith("hello");
	});

	it("subscribe fires on set(next) when !Object.is(prev, next)", () => {
		const store = new Store<number>(1);
		const listener = vi.fn();
		store.subscribe(listener); // immediate fire with 1

		store.set(2);
		store.set(3);

		// 1 (initial) + 2 + 3 = 3 calls
		expect(listener).toHaveBeenCalledTimes(3);
		expect(listener).toHaveBeenNthCalledWith(1, 1);
		expect(listener).toHaveBeenNthCalledWith(2, 2);
		expect(listener).toHaveBeenNthCalledWith(3, 3);

		// Different object references — Object.is is false even when shape matches
		const objStore = new Store<{ count: number }>({ count: 0 });
		const objListener = vi.fn();
		objStore.subscribe(objListener); // immediate
		objStore.set({ count: 0 }); // structurally equal but different reference
		expect(objListener).toHaveBeenCalledTimes(2);
	});

	it("subscribe does NOT fire on set(next) when Object.is(prev, next) is true", () => {
		const store = new Store<number>(7);
		const listener = vi.fn();
		store.subscribe(listener); // immediate fire

		store.set(7); // same primitive — Object.is true, dedup
		expect(listener).toHaveBeenCalledTimes(1);

		// Same object reference — Object.is true, dedup
		const ref = { value: "x" };
		const objStore = new Store<{ value: string }>(ref);
		const objListener = vi.fn();
		objStore.subscribe(objListener); // immediate
		objStore.set(ref);
		expect(objListener).toHaveBeenCalledTimes(1);
	});

	it("snapshots listeners before iteration: a listener added during set() does NOT fire until the next set() (review-fix H13)", () => {
		// Without the snapshot, a subscriber that subscribes a new listener
		// from inside its own callback would have the new listener fire on
		// the same set() — confusing (depends on Set insertion order) and
		// easy to misuse. Snapshot semantics: each set() notifies exactly
		// the listeners present when set() was called.
		const store = new Store<number>(0);
		const lateListener = vi.fn();
		const earlyListener = vi.fn((value: number) => {
			if (value === 1) {
				// Subscribe lateListener mid-iteration. Snapshot must hide it
				// from this set() — the listener fires immediately (subscribe
				// always fires immediately) but NOT a second time as part of
				// the in-flight set().
				store.subscribe(lateListener);
			}
		});

		store.subscribe(earlyListener); // immediate fire with 0
		store.set(1); // earlyListener fires; lateListener subscribes mid-iter

		// earlyListener: initial 0 + set 1 = 2
		expect(earlyListener).toHaveBeenCalledTimes(2);
		// lateListener: subscribe-immediate fire only (with current value 1).
		// Did NOT fire as part of the in-flight set().
		expect(lateListener).toHaveBeenCalledTimes(1);
		expect(lateListener).toHaveBeenCalledWith(1);

		// Next set() — both listeners fire.
		store.set(2);
		expect(earlyListener).toHaveBeenCalledTimes(3);
		expect(lateListener).toHaveBeenCalledTimes(2);
		expect(lateListener).toHaveBeenLastCalledWith(2);
	});

	it("subscribe returns an unsubscribe function; disposed listener no longer fires", () => {
		const store = new Store<number>(0);
		const listener = vi.fn();

		const unsubscribe = store.subscribe(listener); // fires immediately with 0
		store.set(1); // fires with 1
		expect(listener).toHaveBeenCalledTimes(2);

		unsubscribe();

		store.set(2);
		store.set(3);
		expect(listener).toHaveBeenCalledTimes(2); // no further calls after dispose
	});
});
