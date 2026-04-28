import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReconnectLoop } from "../../../src/connection/reconnectLoop";

describe("ReconnectLoop", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("happy path: succeeds on 3rd attempt", async () => {
		const loop = new ReconnectLoop();
		const attempts: number[] = [];
		const onAttempt = vi.fn();
		const attempt = vi.fn(async (n: number) => {
			attempts.push(n);
			return n === 3; // succeed on 3rd
		});

		const runPromise = loop.run(attempt, onAttempt);

		// Advance through 500 ms wait → attempt 1 (false)
		await vi.advanceTimersByTimeAsync(500);
		// Advance through 1000 ms wait → attempt 2 (false)
		await vi.advanceTimersByTimeAsync(1000);
		// Advance through 2000 ms wait → attempt 3 (true → success)
		await vi.advanceTimersByTimeAsync(2000);

		await expect(runPromise).resolves.toBe("success");
		expect(attempts).toEqual([1, 2, 3]);
		expect(onAttempt).toHaveBeenCalledTimes(3);
		expect(onAttempt).toHaveBeenNthCalledWith(1, 1, 500);
		expect(onAttempt).toHaveBeenNthCalledWith(2, 2, 1000);
		expect(onAttempt).toHaveBeenNthCalledWith(3, 3, 2000);
	});

	it("exhaustion: 5 attempts all fail → 'exhausted'", async () => {
		const loop = new ReconnectLoop();
		const onAttempt = vi.fn();
		const attempt = vi.fn(async () => false);

		const runPromise = loop.run(attempt, onAttempt);

		// Burn through all 5 delays
		await vi.advanceTimersByTimeAsync(500);
		await vi.advanceTimersByTimeAsync(1000);
		await vi.advanceTimersByTimeAsync(2000);
		await vi.advanceTimersByTimeAsync(4000);
		await vi.advanceTimersByTimeAsync(8000);

		await expect(runPromise).resolves.toBe("exhausted");
		expect(attempt).toHaveBeenCalledTimes(5);
		expect(onAttempt).toHaveBeenCalledTimes(5);
	});

	it("cancel during wait: returns 'cancelled' immediately, no further attempts", async () => {
		const loop = new ReconnectLoop();
		const onAttempt = vi.fn();
		const attempt = vi.fn(async () => false);

		const runPromise = loop.run(attempt, onAttempt);

		// Let the first onAttempt fire (synchronous before wait)
		await vi.advanceTimersByTimeAsync(0);
		expect(onAttempt).toHaveBeenCalledTimes(1);

		// Cancel during the 500ms wait — attempt() should NEVER run
		loop.cancel();

		await expect(runPromise).resolves.toBe("cancelled");
		expect(attempt).not.toHaveBeenCalled();
	});

	it("cancel after attempt rejects but before next wait", async () => {
		const loop = new ReconnectLoop();
		let attemptCount = 0;
		const attempt = vi.fn(async () => {
			attemptCount += 1;
			// After the first failed attempt, schedule a cancel before the next iteration begins
			if (attemptCount === 1) loop.cancel();
			return false;
		});
		const onAttempt = vi.fn();

		const runPromise = loop.run(attempt, onAttempt);

		// First wait + first attempt
		await vi.advanceTimersByTimeAsync(500);
		// Run microtasks so the attempt resolves and the loop checks cancelled
		await vi.advanceTimersByTimeAsync(0);

		await expect(runPromise).resolves.toBe("cancelled");
		expect(attempt).toHaveBeenCalledTimes(1);
	});

	it("cancel after attempt resolves successfully: success wins", async () => {
		const loop = new ReconnectLoop();
		const attempt = vi.fn(async () => true); // first attempt succeeds
		const onAttempt = vi.fn();

		const runPromise = loop.run(attempt, onAttempt);

		await vi.advanceTimersByTimeAsync(500); // wait done; attempt about to resolve
		// Race: cancel concurrent with success
		loop.cancel();
		await vi.advanceTimersByTimeAsync(0); // flush microtasks

		await expect(runPromise).resolves.toBe("success");
	});
});

describe("ReconnectLoop (real timer smoke)", () => {
	it("non-cancelled run with one immediate-success attempt completes under real timers", async () => {
		const loop = new ReconnectLoop();
		const start = Date.now();
		const result = await loop.run(
			async () => true,
			() => {},
		);
		const elapsed = Date.now() - start;
		expect(result).toBe("success");
		// First attempt waits 500ms before running
		expect(elapsed).toBeGreaterThanOrEqual(450);
		expect(elapsed).toBeLessThan(2000);
	}, 5000);
});
