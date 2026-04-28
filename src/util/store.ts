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
		for (const listener of this.listeners) listener(next);
	}

	subscribe(listener: (value: T) => void): () => void {
		listener(this.value);
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
}
