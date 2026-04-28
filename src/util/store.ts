/**
 * Minimal reactive store. Subscribers fire immediately with the current value
 * and on every `set(next)` where `!Object.is(prev, next)`. Derived values are
 * computed inline by subscribers — no `derived<T,U>` helper, no `Readable<T>`
 * interface (per ADR-4 v3, 2026-04-25 simplification).
 */
export class Store<T> {
	private listeners = new Set<(value: T) => void>();

	constructor(private value: T) {}

	get(): T {
		return this.value;
	}

	set(next: T): void {
		if (Object.is(this.value, next)) return;
		this.value = next;
		// Snapshot the listener set before iteration. A subscriber that
		// adds a new listener mid-iteration would otherwise have the new
		// listener fire on the same `set()` call (Set iteration order
		// includes additions). With the snapshot, additions are deferred to
		// the next `set()` — predictable semantics. Removals (a listener
		// that calls its own unsubscribe) still take effect immediately on
		// the live set; the snapshot is only consulted for who-to-notify.
		// The "listeners must not call store.set()" convention is enforced
		// by code review, not the snapshot — this just contains the blast
		// radius if it happens.
		const snapshot = Array.from(this.listeners);
		for (const listener of snapshot) listener(next);
	}

	subscribe(listener: (value: T) => void): () => void {
		listener(this.value);
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
}
