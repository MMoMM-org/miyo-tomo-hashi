/**
 * Cancellable reconnect loop with fixed backoff schedule.
 *
 * Per SDD "Implementation Examples — Reconnect Backoff" (spec 001-session-view),
 * ADR-7 (Backoff Schedule), and PRD F8/AC2:
 *   - 5 attempts maximum, delays [500, 1000, 2000, 4000, 8000] ms.
 *   - Total wall-clock budget = 15.5 s before "exhausted".
 *   - cancel() must resolve the pending wait() so the loop's cancellation
 *     check at the head of the next iteration runs immediately. Without
 *     resolving the stored resolve ref, a Disconnect during backoff would
 *     leave the wait promise dangling (resource leak). This is the gotcha
 *     called out in the SDD's traced walkthrough.
 *   - Concurrent cancel-vs-success: if cancel() fires while attempt() is
 *     resolving with `true`, the success path wins because the loop has
 *     already passed its head-of-iteration `cancelled` check.
 */

const DELAYS_MS = [500, 1000, 2000, 4000, 8000] as const;

export class ReconnectLoop {
	private cancelled = false;
	private currentTimer: ReturnType<typeof setTimeout> | null = null;
	private currentResolve: (() => void) | null = null;

	async run(
		attempt: (attemptNumber: number) => Promise<boolean>,
		onAttempt: (attemptNumber: number, nextDelayMs: number) => void,
	): Promise<"success" | "exhausted" | "cancelled"> {
		for (let i = 0; i < DELAYS_MS.length; i++) {
			if (this.cancelled) return "cancelled";
			const delay = DELAYS_MS[i]!; // bounded by loop guard
			onAttempt(i + 1, delay);
			await this.wait(delay);
			if (this.cancelled) return "cancelled";
			const ok = await attempt(i + 1);
			if (ok) return "success";
		}
		return "exhausted";
	}

	cancel(): void {
		this.cancelled = true;
		if (this.currentTimer) {
			clearTimeout(this.currentTimer);
			this.currentTimer = null;
		}
		if (this.currentResolve) {
			this.currentResolve();
			this.currentResolve = null;
		}
	}

	private wait(ms: number): Promise<void> {
		return new Promise<void>((resolve) => {
			this.currentResolve = resolve;
			this.currentTimer = setTimeout(() => {
				this.currentTimer = null;
				this.currentResolve = null;
				resolve();
			}, ms);
		});
	}
}
