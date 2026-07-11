/**
 * SuggestionsStore (T1.9) — observable store holding the current Suggestions
 * Editor `EditModel`. Sits between the `SuggestionsDoc` adapter and the view
 * (SDD §2): the adapter's `load()` seeds the initial model, the view
 * subscribes for re-render and dispatches transform intents via `apply`.
 *
 * Wraps the generic `Store<T>` (src/util/store.ts) — the same idiom already
 * used by connectionStore/ideBridgeStore/executionStore — rather than
 * reimplementing subscribe/notify. `Store.set`'s `Object.is` dedup is
 * exactly the no-op signal every suggestions transform (transforms/*.ts,
 * T1.3-T1.8) already produces: a transform returns the SAME `EditModel`
 * reference to mean "nothing changed", so routing `apply`'s result through
 * `Store.set` gives "adopt + notify on a real change, stay silent on a
 * no-op" for free, with no separately-tracked dirty flag — `dirty` is just
 * a field on whichever model the store currently holds.
 *
 * Unlike the three singleton stores above, this one is NOT a module-level
 * singleton: the Suggestions Editor view opens one `EditModel` per vault
 * document, so callers construct a `SuggestionsStore` per open document.
 *
 * Framework-free: no `obsidian` import, no I/O.
 */

import { Store } from "../util/store.js";
import type { EditModel } from "../types/suggestions.js";

export class SuggestionsStore {
	private readonly store: Store<EditModel>;

	constructor(initialModel: EditModel) {
		this.store = new Store<EditModel>(initialModel);
	}

	/** The current model. `dirty` lives on the model itself — see file header. */
	getModel(): EditModel {
		return this.store.get();
	}

	/** Fires immediately with the current model, then on every real change. */
	subscribe(listener: (model: EditModel) => void): () => void {
		return this.store.subscribe(listener);
	}

	/**
	 * Runs `transform` against the current model and adopts the result.
	 * A transform that returns the SAME model reference (its no-op signal)
	 * leaves state and subscribers untouched.
	 */
	apply(transform: (model: EditModel) => EditModel): void {
		const next = transform(this.store.get());
		this.store.set(next);
	}
}
