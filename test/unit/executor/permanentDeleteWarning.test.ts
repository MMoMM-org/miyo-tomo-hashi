/**
 * permanentDeleteWarning — one-shot permanent-delete warning gate.
 *
 * Covers BOTH the authorize path (warning fires + flag persisted) AND every
 * rejection path (no delete_source / already warned / not permanent), per
 * Constitution §Testing L1 — this is a safety-relevant guard.
 *
 * [ref: Kokoro decision 2026-06-12; Spec 002 F4 trash-semantics amendment]
 */

import { describe, expect, it, vi } from "vitest";
import {
	maybeWarnPermanentDelete,
	PERMANENT_DELETE_WARNING,
	type PermanentDeleteWarningDeps,
} from "../../../src/executor/permanentDeleteWarning.js";

const makeDeps = (
	overrides?: Partial<PermanentDeleteWarningDeps>,
): {
	deps: PermanentDeleteWarningDeps;
	notify: ReturnType<typeof vi.fn>;
	markWarned: ReturnType<typeof vi.fn>;
} => {
	const notify = vi.fn<(message: string) => void>();
	const markWarned = vi.fn<() => Promise<void>>(async () => {});
	const deps: PermanentDeleteWarningDeps = {
		isPermanent: () => true,
		hasWarned: () => false,
		markWarned,
		notify,
		...overrides,
	};
	return { deps, notify, markWarned };
};

describe("maybeWarnPermanentDelete", () => {
	it("warns and persists the flag when delete_source + permanent + not-yet-warned", async () => {
		const { deps, notify, markWarned } = makeDeps();

		const warned = await maybeWarnPermanentDelete(true, deps);

		expect(warned).toBe(true);
		expect(notify).toHaveBeenCalledOnce();
		expect(notify).toHaveBeenCalledWith(PERMANENT_DELETE_WARNING);
		expect(markWarned).toHaveBeenCalledOnce();
	});

	it("does NOT warn when the run has no delete_source action", async () => {
		const { deps, notify, markWarned } = makeDeps();

		const warned = await maybeWarnPermanentDelete(false, deps);

		expect(warned).toBe(false);
		expect(notify).not.toHaveBeenCalled();
		expect(markWarned).not.toHaveBeenCalled();
	});

	it("does NOT warn again once the one-shot flag is already set", async () => {
		const { deps, notify, markWarned } = makeDeps({ hasWarned: () => true });

		const warned = await maybeWarnPermanentDelete(true, deps);

		expect(warned).toBe(false);
		expect(notify).not.toHaveBeenCalled();
		expect(markWarned).not.toHaveBeenCalled();
	});

	it("does NOT warn when the trash preference is not permanent", async () => {
		const { deps, notify, markWarned } = makeDeps({ isPermanent: () => false });

		const warned = await maybeWarnPermanentDelete(true, deps);

		expect(warned).toBe(false);
		expect(notify).not.toHaveBeenCalled();
		expect(markWarned).not.toHaveBeenCalled();
	});
});
