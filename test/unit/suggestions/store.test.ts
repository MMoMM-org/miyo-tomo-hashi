/**
 * SuggestionsStore (T1.9) — observable store holding the current
 * Suggestions Editor `EditModel`. Sits between the `SuggestionsDoc` adapter
 * and the view (SDD §2): the view subscribes for re-render and dispatches
 * transform intents via `apply`.
 *
 * Seeded through `FakeSuggestionsDoc` (a real Tomo emission, T1.2) rather
 * than a hand-rolled fixture — same real-data precedent as the transform
 * tests. `setDecision` (T1.3) is used as the representative real-change /
 * no-op transform pair: every suggestion in the seed starts at
 * `decision: "skip"`, so `setDecision(model, id, "skip")` is a no-op
 * (returns the SAME model reference) and `setDecision(model, id, "approve")`
 * is a real change (returns a NEW reference, `dirty: true`).
 *
 * Follows the `Store<T>` idiom (src/util/store.ts, exercised in
 * test/unit/util/store.test.ts): `subscribe` fires immediately with the
 * current model, so call counts below include that initial fire — matching
 * the assertion style already established for `Store<T>`.
 */

import { describe, expect, it, vi } from "vitest";

import { SuggestionsStore } from "../../../src/suggestions/store.js";
import { setDecision } from "../../../src/suggestions/transforms/suggestion.js";
import { FakeSuggestionsDoc } from "../../__mocks__/FakeSuggestionsDoc.js";

const SUGGESTION_ID = "S01"; // seed decision: "skip"

describe("SuggestionsStore", () => {
	it("getModel() returns the initial model, freshly-loaded dirty:false", async () => {
		const model = await new FakeSuggestionsDoc().load("x");
		expect(model.dirty).toBe(false);

		const store = new SuggestionsStore(model);

		expect(store.getModel()).toBe(model);
		expect(store.getModel().dirty).toBe(false);
	});

	it("notifies subscribers when apply runs a real transform", async () => {
		const model = await new FakeSuggestionsDoc().load("x");
		const store = new SuggestionsStore(model);
		const listener = vi.fn();

		store.subscribe(listener); // immediate fire with the initial model

		store.apply((m) => setDecision(m, SUGGESTION_ID, "approve"));

		// 1 (initial) + 1 (real change) = 2 calls.
		expect(listener).toHaveBeenCalledTimes(2);
		expect(listener).toHaveBeenLastCalledWith(store.getModel());
	});

	it("dirty reflects real edits", async () => {
		const model = await new FakeSuggestionsDoc().load("x");
		const store = new SuggestionsStore(model);

		store.apply((m) => setDecision(m, SUGGESTION_ID, "approve"));

		expect(store.getModel().dirty).toBe(true);
	});

	it("a no-op transform (same reference) does not adopt state and does not notify", async () => {
		const model = await new FakeSuggestionsDoc().load("x");
		const store = new SuggestionsStore(model);
		const listener = vi.fn();

		store.subscribe(listener); // immediate fire — call count 1

		// S01 already decided "skip" in the seed — setDecision returns the
		// SAME model reference (transforms/suggestion.ts no-op guard).
		store.apply((m) => setDecision(m, SUGGESTION_ID, "skip"));

		expect(listener).toHaveBeenCalledTimes(1); // no additional notify
		expect(store.getModel()).toBe(model); // reference unchanged — no adoption
		expect(store.getModel().dirty).toBe(false);
	});

	it("unsubscribe stops further notifications", async () => {
		const model = await new FakeSuggestionsDoc().load("x");
		const store = new SuggestionsStore(model);
		const listener = vi.fn();

		const unsubscribe = store.subscribe(listener); // immediate fire — call count 1
		unsubscribe();

		store.apply((m) => setDecision(m, SUGGESTION_ID, "approve"));

		expect(listener).toHaveBeenCalledTimes(1); // no further calls after dispose
	});

	it("notifies multiple subscribers", async () => {
		const model = await new FakeSuggestionsDoc().load("x");
		const store = new SuggestionsStore(model);
		const listenerA = vi.fn();
		const listenerB = vi.fn();

		store.subscribe(listenerA); // immediate — count 1
		store.subscribe(listenerB); // immediate — count 1

		store.apply((m) => setDecision(m, SUGGESTION_ID, "approve"));

		expect(listenerA).toHaveBeenCalledTimes(2);
		expect(listenerB).toHaveBeenCalledTimes(2);
	});
});
