/**
 * Status bar 橋 — color-state indicator driven by `executionStore`.
 *
 * Spec refs: docs/XDD/specs/002-instruction-executor/plan/phase-5.md T5.2;
 *   PRD F10 (all ACs); SDD ADR-6 (revised — color states only, no animation).
 *
 * Behaviour under test:
 *   - On mount, renders the 橋 kanji with class `is-idle` and a tooltip.
 *   - Subscribes to `executionStore`; class swaps to `is-running` /
 *     `is-error` / `is-idle` per the run state.
 *   - Tooltip text per state:
 *       idle    — "Hashi: idle"
 *       running — "Hashi: running — N of M actions"
 *       error   — "Hashi: last run had F failures — see <log filename>"
 *   - Click while running invokes the `onActiveModalFocus` callback.
 *   - Click while idle (and click while showing the post-failure error
 *     color) is a no-op.
 *   - Error state auto-returns to idle after ~10 seconds; a new run
 *     started before the timer fires cancels the timer.
 *   - ARIA: root has `role="status"` + `aria-live="polite"`; state changes
 *     append a brief text node ("Hashi running" / "Hashi error" / "Hashi
 *     idle") for screen-reader announcement.
 *   - No animation: no `animation` inline style, no class named to suggest
 *     a keyframe (no `pulse`, `spin`, etc.).
 *   - `unmount()` (or the returned teardown) unsubscribes from the store
 *     AND clears any pending error-timer so the listener can't fire on a
 *     detached element.
 */

import "obsidian";
import type { Plugin } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { executionStore } from "../../../src/executor/executionStore";
import type {
	ActionRecord,
	RunCounts,
	RunState,
} from "../../../src/executor/state";
import { mountStatusBar } from "../../../src/ui/statusBar";

// --- factories --------------------------------------------------------------

function record(overrides: Partial<ActionRecord> = {}): ActionRecord {
	return {
		fileId: "2026-04-29_inbox-review.json",
		id: "I01",
		kind: "create_moc",
		summary: "create MOC at MOCs/Project.md",
		outcome: null,
		...overrides,
	};
}

function counts(overrides: Partial<RunCounts> = {}): RunCounts {
	return {
		applied: 0,
		"skipped-already": 0,
		"skipped-dependency": 0,
		"skipped-cancelled": 0,
		failed: 0,
		pending: 0,
		durationMs: 0,
		...overrides,
	};
}

interface PluginStub {
	addStatusBarItem: ReturnType<typeof vi.fn>;
}

function asPlugin(stub: PluginStub): Plugin {
	return stub as unknown as Plugin;
}

interface Harness {
	plugin: PluginStub;
	teardown: () => void;
	onActiveModalFocus: ReturnType<typeof vi.fn>;
	getRoot: () => HTMLElement;
}

function mount(): Harness {
	const created: HTMLElement[] = [];
	const plugin: PluginStub = {
		addStatusBarItem: vi.fn(() => {
			const el = document.createElement("div");
			document.body.appendChild(el);
			created.push(el);
			return el;
		}),
	};
	const onActiveModalFocus = vi.fn();
	const teardown = mountStatusBar(asPlugin(plugin), {
		onActiveModalFocus,
	});
	return {
		plugin,
		teardown,
		onActiveModalFocus,
		getRoot: () => {
			const root = created[0];
			if (root === undefined) throw new Error("status bar item not created");
			return root;
		},
	};
}

// --- tests ------------------------------------------------------------------

describe("statusBar — initial render", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		executionStore.set({ kind: "idle" });
	});

	afterEach(() => {
		executionStore.set({ kind: "idle" });
		document.body.innerHTML = "";
		vi.useRealTimers();
	});

	it("creates a status bar item via plugin.addStatusBarItem", () => {
		const h = mount();
		expect(h.plugin.addStatusBarItem).toHaveBeenCalledTimes(1);
	});

	it("root element has the hashi-status-bar-bridge class", () => {
		const h = mount();
		expect(h.getRoot().classList.contains("hashi-status-bar-bridge")).toBe(true);
	});

	it("renders the 橋 kanji glyph", () => {
		const h = mount();
		expect(h.getRoot().textContent).toContain("橋");
	});

	it("starts in is-idle state", () => {
		const h = mount();
		expect(h.getRoot().classList.contains("is-idle")).toBe(true);
		expect(h.getRoot().classList.contains("is-running")).toBe(false);
		expect(h.getRoot().classList.contains("is-error")).toBe(false);
	});

	it("idle tooltip says 'Hashi: idle'", () => {
		const h = mount();
		expect(h.getRoot().getAttribute("aria-label")).toBe("Hashi: idle");
		expect(h.getRoot().getAttribute("title")).toBe("Hashi: idle");
	});

	it("has role='status' which implies aria-live='polite' (review round 2 / L33)", () => {
		// role=status carries an implicit aria-live=polite per the ARIA
		// spec; the previously-explicit aria-live attribute was removed
		// to avoid the inconsistency M12 corrected on the chat-view
		// indicator (where the explicit role+aria-live caused AT
		// escalation overrides). The status bar relies on the implicit
		// politeness from role=status alone.
		const h = mount();
		expect(h.getRoot().getAttribute("role")).toBe("status");
		expect(h.getRoot().getAttribute("aria-live")).toBeNull();
	});
});

describe("statusBar — running state", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		executionStore.set({ kind: "idle" });
	});

	afterEach(() => {
		executionStore.set({ kind: "idle" });
		document.body.innerHTML = "";
		vi.useRealTimers();
	});

	it("swaps to is-running on running state", () => {
		const h = mount();
		const records = [record({ id: "I01" }), record({ id: "I02" })];
		executionStore.set({
			kind: "running",
			mode: "confirm",
			records,
			currentIndex: 0,
		});
		expect(h.getRoot().classList.contains("is-running")).toBe(true);
		expect(h.getRoot().classList.contains("is-idle")).toBe(false);
		expect(h.getRoot().classList.contains("is-error")).toBe(false);
	});

	it("running tooltip shows 'running — N of M actions'", () => {
		const h = mount();
		const records = [
			record({ id: "I01" }),
			record({ id: "I02" }),
			record({ id: "I03" }),
		];
		executionStore.set({
			kind: "running",
			mode: "confirm",
			records,
			currentIndex: 1,
		});
		const tooltip = h.getRoot().getAttribute("aria-label") ?? "";
		expect(tooltip).toContain("running");
		expect(tooltip).toContain("1");
		expect(tooltip).toContain("3");
		expect(h.getRoot().getAttribute("title")).toBe(tooltip);
	});

	it("appends 'Hashi running' announcement for screen readers", () => {
		const h = mount();
		const records = [record({ id: "I01" })];
		executionStore.set({
			kind: "running",
			mode: "confirm",
			records,
			currentIndex: 0,
		});
		const announcer = h.getRoot().querySelector(".hashi-status-bar-bridge-sr");
		expect(announcer).not.toBeNull();
		expect(announcer?.textContent).toContain("Hashi running");
	});
});

describe("statusBar — summary clean (zero failures)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		executionStore.set({ kind: "idle" });
	});

	afterEach(() => {
		executionStore.set({ kind: "idle" });
		document.body.innerHTML = "";
		vi.useRealTimers();
	});

	it("returns directly to is-idle when run ends with zero failures", () => {
		const h = mount();
		// Drive into running first, then summary with 0 failures.
		executionStore.set({
			kind: "running",
			mode: "confirm",
			records: [record()],
			currentIndex: 0,
		});
		executionStore.set({
			kind: "summary",
			mode: "confirm",
			records: [record({ outcome: { kind: "applied" } })],
			counts: counts({ applied: 1, durationMs: 1000 }),
			logFilePath: "tomo-inbox/tomo-hashi-run-log_2026-04-29T1430.md",
		});
		expect(h.getRoot().classList.contains("is-idle")).toBe(true);
		expect(h.getRoot().classList.contains("is-error")).toBe(false);
		expect(h.getRoot().classList.contains("is-running")).toBe(false);
	});

	it("clean-summary tooltip reverts to 'Hashi: idle'", () => {
		const h = mount();
		executionStore.set({
			kind: "summary",
			mode: "confirm",
			records: [record({ outcome: { kind: "applied" } })],
			counts: counts({ applied: 1, durationMs: 1000 }),
			logFilePath: null,
		});
		expect(h.getRoot().getAttribute("aria-label")).toBe("Hashi: idle");
	});
});

describe("statusBar — summary with failures (error window)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		executionStore.set({ kind: "idle" });
	});

	afterEach(() => {
		executionStore.set({ kind: "idle" });
		document.body.innerHTML = "";
		vi.useRealTimers();
	});

	it("swaps to is-error when run ends with at least one failure", () => {
		const h = mount();
		executionStore.set({
			kind: "summary",
			mode: "confirm",
			records: [record({ outcome: { kind: "failed", reason: "boom" } })],
			counts: counts({ failed: 1, durationMs: 1000 }),
			logFilePath: "tomo-inbox/tomo-hashi-run-log_2026-04-29T1430.md",
		});
		expect(h.getRoot().classList.contains("is-error")).toBe(true);
		expect(h.getRoot().classList.contains("is-idle")).toBe(false);
	});

	it("error tooltip shows 'last run had F failures — see <log filename>'", () => {
		const h = mount();
		executionStore.set({
			kind: "summary",
			mode: "confirm",
			records: [
				record({ id: "I01", outcome: { kind: "failed", reason: "x" } }),
				record({ id: "I02", outcome: { kind: "failed", reason: "y" } }),
			],
			counts: counts({ failed: 2, durationMs: 1000 }),
			logFilePath: "tomo-inbox/tomo-hashi-run-log_2026-04-29T1430.md",
		});
		const tooltip = h.getRoot().getAttribute("aria-label") ?? "";
		expect(tooltip).toContain("last run had 2 failures");
		expect(tooltip).toContain("tomo-hashi-run-log_2026-04-29T1430.md");
	});

	it("appends 'Hashi error' announcement for screen readers", () => {
		const h = mount();
		executionStore.set({
			kind: "summary",
			mode: "confirm",
			records: [record({ outcome: { kind: "failed", reason: "boom" } })],
			counts: counts({ failed: 1, durationMs: 1000 }),
			logFilePath: null,
		});
		const announcer = h.getRoot().querySelector(".hashi-status-bar-bridge-sr");
		expect(announcer?.textContent).toContain("Hashi error");
	});

	it("auto-returns to is-idle after ~10 seconds in error state", () => {
		const h = mount();
		executionStore.set({
			kind: "summary",
			mode: "confirm",
			records: [record({ outcome: { kind: "failed", reason: "boom" } })],
			counts: counts({ failed: 1, durationMs: 1000 }),
			logFilePath: "log.md",
		});
		expect(h.getRoot().classList.contains("is-error")).toBe(true);

		// Just before the 10-second mark — still in error.
		vi.advanceTimersByTime(9000);
		expect(h.getRoot().classList.contains("is-error")).toBe(true);

		// At 10 seconds — back to idle.
		vi.advanceTimersByTime(2000);
		expect(h.getRoot().classList.contains("is-error")).toBe(false);
		expect(h.getRoot().classList.contains("is-idle")).toBe(true);
		expect(h.getRoot().getAttribute("aria-label")).toBe("Hashi: idle");
	});

	it("a new run starting before the error window expires cancels the timer", () => {
		const h = mount();
		executionStore.set({
			kind: "summary",
			mode: "confirm",
			records: [record({ outcome: { kind: "failed", reason: "boom" } })],
			counts: counts({ failed: 1, durationMs: 1000 }),
			logFilePath: "log.md",
		});
		expect(h.getRoot().classList.contains("is-error")).toBe(true);

		// New run starts before the 10-second timer fires.
		vi.advanceTimersByTime(3000);
		executionStore.set({
			kind: "running",
			mode: "confirm",
			records: [record()],
			currentIndex: 0,
		});
		expect(h.getRoot().classList.contains("is-running")).toBe(true);
		expect(h.getRoot().classList.contains("is-error")).toBe(false);

		// Advance past the original 10-second window — must NOT swap to idle
		// while still running.
		vi.advanceTimersByTime(15000);
		expect(h.getRoot().classList.contains("is-running")).toBe(true);
		expect(h.getRoot().classList.contains("is-idle")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// H9 — keyboard reachability
// ---------------------------------------------------------------------------

describe("statusBar — keyboard reachability (H9)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		executionStore.set({ kind: "idle" });
	});

	afterEach(() => {
		executionStore.set({ kind: "idle" });
		document.body.innerHTML = "";
		vi.useRealTimers();
	});

	it("root has tabindex='0' so keyboard users can focus it", () => {
		const h = mount();
		expect(h.getRoot().getAttribute("tabindex")).toBe("0");
	});

	it("keydown Enter while running invokes onActiveModalFocus", () => {
		const h = mount();
		executionStore.set({
			kind: "running",
			mode: "confirm",
			records: [record()],
			currentIndex: 0,
		});
		h.getRoot().dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
		expect(h.onActiveModalFocus).toHaveBeenCalledTimes(1);
	});

	it("keydown Space while running invokes onActiveModalFocus", () => {
		const h = mount();
		executionStore.set({
			kind: "running",
			mode: "confirm",
			records: [record()],
			currentIndex: 0,
		});
		h.getRoot().dispatchEvent(
			new KeyboardEvent("keydown", { key: " ", bubbles: true }),
		);
		expect(h.onActiveModalFocus).toHaveBeenCalledTimes(1);
	});

	it("keydown Enter while idle is a no-op (matches click semantics)", () => {
		const h = mount();
		h.getRoot().dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
		expect(h.onActiveModalFocus).not.toHaveBeenCalled();
	});

	it("keydown of a non-activation key while running is a no-op", () => {
		const h = mount();
		executionStore.set({
			kind: "running",
			mode: "confirm",
			records: [record()],
			currentIndex: 0,
		});
		h.getRoot().dispatchEvent(
			new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
		);
		expect(h.onActiveModalFocus).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// H10 — glyph aria-hidden so SR doesn't read CJK + announcement together
// ---------------------------------------------------------------------------

describe("statusBar — glyph aria-hidden (H10)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		executionStore.set({ kind: "idle" });
	});

	afterEach(() => {
		executionStore.set({ kind: "idle" });
		document.body.innerHTML = "";
		vi.useRealTimers();
	});

	it("the visible 橋 glyph span carries aria-hidden='true'", () => {
		const h = mount();
		const glyph = h.getRoot().querySelector(".hashi-status-bar-bridge-glyph");
		expect(glyph).not.toBeNull();
		expect(glyph?.getAttribute("aria-hidden")).toBe("true");
	});
});

describe("statusBar — click handling", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		executionStore.set({ kind: "idle" });
	});

	afterEach(() => {
		executionStore.set({ kind: "idle" });
		document.body.innerHTML = "";
		vi.useRealTimers();
	});

	it("click while running invokes onActiveModalFocus", () => {
		const h = mount();
		executionStore.set({
			kind: "running",
			mode: "confirm",
			records: [record()],
			currentIndex: 0,
		});
		h.getRoot().dispatchEvent(new MouseEvent("click"));
		expect(h.onActiveModalFocus).toHaveBeenCalledTimes(1);
	});

	it("click while idle is a no-op", () => {
		const h = mount();
		h.getRoot().dispatchEvent(new MouseEvent("click"));
		expect(h.onActiveModalFocus).not.toHaveBeenCalled();
	});

	it("click while in error state is a no-op", () => {
		const h = mount();
		executionStore.set({
			kind: "summary",
			mode: "confirm",
			records: [record({ outcome: { kind: "failed", reason: "x" } })],
			counts: counts({ failed: 1, durationMs: 1000 }),
			logFilePath: "log.md",
		});
		h.getRoot().dispatchEvent(new MouseEvent("click"));
		expect(h.onActiveModalFocus).not.toHaveBeenCalled();
	});
});

describe("statusBar — no animation (ADR-6)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		executionStore.set({ kind: "idle" });
	});

	afterEach(() => {
		executionStore.set({ kind: "idle" });
		document.body.innerHTML = "";
		vi.useRealTimers();
	});

	it("root element has no inline animation style across all states", () => {
		const h = mount();
		const states: RunState[] = [
			{ kind: "idle" },
			{
				kind: "running",
				mode: "confirm",
				records: [record()],
				currentIndex: 0,
			},
			{
				kind: "summary",
				mode: "confirm",
				records: [record({ outcome: { kind: "failed", reason: "x" } })],
				counts: counts({ failed: 1, durationMs: 1000 }),
				logFilePath: null,
			},
		];
		for (const state of states) {
			executionStore.set(state);
			expect(h.getRoot().style.animation).toBe("");
			expect(h.getRoot().style.transition).toBe("");
		}
	});

	it("does not apply any class whose name suggests an animation (pulse/spin/blink)", () => {
		const h = mount();
		executionStore.set({
			kind: "running",
			mode: "confirm",
			records: [record()],
			currentIndex: 0,
		});
		const classes = Array.from(h.getRoot().classList);
		expect(classes.some((c) => /pulse|spin|blink/i.test(c))).toBe(false);
	});
});

describe("statusBar — teardown", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		executionStore.set({ kind: "idle" });
	});

	afterEach(() => {
		executionStore.set({ kind: "idle" });
		document.body.innerHTML = "";
		vi.useRealTimers();
	});

	it("teardown unsubscribes from executionStore (no further class swaps)", () => {
		const h = mount();
		const root = h.getRoot();
		// Confirm subscription is live.
		executionStore.set({
			kind: "running",
			mode: "confirm",
			records: [record()],
			currentIndex: 0,
		});
		expect(root.classList.contains("is-running")).toBe(true);

		h.teardown();

		// After teardown, the listener must not fire — the running class
		// remains as it was at teardown.
		executionStore.set({ kind: "idle" });
		expect(root.classList.contains("is-running")).toBe(true);
		expect(root.classList.contains("is-idle")).toBe(false);
	});

	it("teardown clears the pending error-window timer", () => {
		const h = mount();
		executionStore.set({
			kind: "summary",
			mode: "confirm",
			records: [record({ outcome: { kind: "failed", reason: "boom" } })],
			counts: counts({ failed: 1, durationMs: 1000 }),
			logFilePath: "log.md",
		});
		expect(h.getRoot().classList.contains("is-error")).toBe(true);

		h.teardown();
		const root = h.getRoot();

		// Advancing past the 10-second window must not mutate the detached
		// element.
		vi.advanceTimersByTime(15000);
		expect(root.classList.contains("is-error")).toBe(true);
		expect(root.classList.contains("is-idle")).toBe(false);
	});
});
