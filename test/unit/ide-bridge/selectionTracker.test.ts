/**
 * Tests for SelectionTracker — debounce, dedup, broadcast (T2.6).
 *
 * Business rules under test (SDD F5):
 *   Rule 1 — non-editor context (null from adapter) produces no broadcast.
 *   Rule 2 — trailing-edge debounce at 100ms; new events reset the timer.
 *   Rule 3 — identical state is not re-broadcast.
 *   Rule 4 — text > 100KB is truncated; selection range is preserved.
 *   Rule 5 — active-leaf change triggers a broadcast of the new file's cursor.
 *   Rule 6 — selected text is never persisted (tested structurally, not here).
 *   Rule 7 — paths are plain vault-relative (adapter guarantees; tracker must not mutate).
 *
 * Fake-timer strategy: vi.useFakeTimers() patches globalThis.setTimeout /
 * clearTimeout which are also what activeWindow.{set,clear}Timeout resolve to
 * (the obsidian mock shims activeWindow = globalThis, same as activeDocument).
 */

import "obsidian";

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import { FakeEditorAdapter } from "../../../src/ide-bridge/FakeEditorAdapter";
import type { SelectionChangedParams } from "../../../src/ide-bridge/protocol";
import { createSelectionTracker } from "../../../src/ide-bridge/selectionTracker";
import type { SelectionTracker } from "../../../src/ide-bridge/selectionTracker";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeSelection(overrides: Partial<SelectionChangedParams> = {}): SelectionChangedParams {
	return {
		text: "hello",
		filePath: "notes/plan.md",
		fileUrl: "file:///notes/plan.md",
		selection: {
			start: { line: 0, character: 0 },
			end: { line: 0, character: 5 },
			isEmpty: false,
		},
		...overrides,
	};
}

function makeSelectionB(): SelectionChangedParams {
	return {
		text: "world",
		filePath: "notes/other.md",
		fileUrl: "file:///notes/other.md",
		selection: {
			start: { line: 3, character: 1 },
			end: { line: 3, character: 6 },
			isEmpty: false,
		},
	};
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface Harness {
	adapter: FakeEditorAdapter;
	broadcast: ReturnType<typeof vi.fn>;
	tracker: SelectionTracker;
}

function makeHarness(): Harness {
	const adapter = new FakeEditorAdapter();
	const broadcast = vi.fn();
	const tracker = createSelectionTracker(adapter, broadcast);
	return { adapter, broadcast, tracker };
}

const DEBOUNCE_MS = 100;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SelectionTracker", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// Rule 2 — trailing-edge debounce
	it("collapses rapid activity into ONE broadcast after 100ms (Rule 2)", () => {
		const { adapter, broadcast, tracker } = makeHarness();
		adapter.setActiveSelection(makeSelection());

		// Trigger 5 activity events — only the last should produce a broadcast.
		for (let i = 0; i < 5; i++) {
			tracker.onEditorActivity();
		}

		expect(broadcast).not.toHaveBeenCalled();

		vi.advanceTimersByTime(DEBOUNCE_MS);

		expect(broadcast).toHaveBeenCalledTimes(1);
	});

	// Rule 2 — timer resets on each new event
	it("resets the timer on each new event — no broadcast before 100ms has elapsed since the last call (Rule 2)", () => {
		const { adapter, broadcast, tracker } = makeHarness();
		adapter.setActiveSelection(makeSelection());

		tracker.onEditorActivity();
		vi.advanceTimersByTime(DEBOUNCE_MS - 1);
		tracker.onEditorActivity(); // resets timer
		vi.advanceTimersByTime(DEBOUNCE_MS - 1); // not yet 100ms since last call
		expect(broadcast).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1); // now 100ms since last call
		expect(broadcast).toHaveBeenCalledTimes(1);
	});

	// Rule 3 — dedup
	it("does NOT re-broadcast when state is identical to the previous broadcast (Rule 3)", () => {
		const { adapter, broadcast, tracker } = makeHarness();
		const sel = makeSelection();
		adapter.setActiveSelection(sel);

		// First settle cycle
		tracker.onEditorActivity();
		vi.advanceTimersByTime(DEBOUNCE_MS);
		expect(broadcast).toHaveBeenCalledTimes(1);

		// Second settle cycle — same selection
		tracker.onEditorActivity();
		vi.advanceTimersByTime(DEBOUNCE_MS);
		expect(broadcast).toHaveBeenCalledTimes(1); // still 1 — deduped
	});

	// Rule 1 — non-editor context
	it("produces NO broadcast when adapter returns null (Rule 1)", () => {
		const { adapter, broadcast, tracker } = makeHarness();
		// adapter has no active selection by default — getCurrentSelection returns null

		tracker.onEditorActivity();
		vi.advanceTimersByTime(DEBOUNCE_MS);

		expect(broadcast).not.toHaveBeenCalled();
	});

	// Rule 5 — active-leaf change broadcasts new file's cursor
	it("broadcasts the new file's cursor after a file switch (Rule 5)", () => {
		const { adapter, broadcast, tracker } = makeHarness();
		const selA = makeSelection();
		adapter.setActiveSelection(selA);

		// First settle cycle — file A
		tracker.onEditorActivity();
		vi.advanceTimersByTime(DEBOUNCE_MS);
		expect(broadcast).toHaveBeenCalledTimes(1);

		// Switch to file B — simulated by orchestrator calling onEditorActivity after leaf-change
		const selB = makeSelectionB();
		adapter.setActiveSelection(selB);
		tracker.onEditorActivity();
		vi.advanceTimersByTime(DEBOUNCE_MS);

		expect(broadcast).toHaveBeenCalledTimes(2);
		const secondCall = broadcast.mock.calls[1]?.[0] as { params?: SelectionChangedParams };
		expect(secondCall?.params?.filePath).toBe("notes/other.md");
	});

	// Rule 4 — text > 100KB truncated; selection range preserved
	it("truncates text > 100KB to exactly 100KB and preserves selection range (Rule 4)", () => {
		const { adapter, broadcast, tracker } = makeHarness();
		const MAX = 100_000;
		const longText = "x".repeat(MAX + 500);
		const sel = makeSelection({
			text: longText,
			selection: {
				start: { line: 0, character: 0 },
				end: { line: 0, character: MAX + 500 }, // full selection range
				isEmpty: false,
			},
		});
		adapter.setActiveSelection(sel);

		tracker.onEditorActivity();
		vi.advanceTimersByTime(DEBOUNCE_MS);

		expect(broadcast).toHaveBeenCalledTimes(1);
		const payload = broadcast.mock.calls[0]?.[0] as SelectionChangedParams & { params?: SelectionChangedParams };
		const params = payload.params ?? payload;
		expect(params.text.length).toBe(MAX);
		// Selection range must still reflect the original full range
		expect(params.selection.end.character).toBe(MAX + 500);
	});

	// getLatest before any broadcast
	it("getLatest returns null before any broadcast", () => {
		const { tracker } = makeHarness();
		expect(tracker.getLatest()).toBeNull();
	});

	// getLatest after a broadcast
	it("getLatest returns the last broadcast params after a settled cycle (Rule 6 feeds T2.2)", () => {
		const { adapter, tracker } = makeHarness();
		const sel = makeSelection();
		adapter.setActiveSelection(sel);

		tracker.onEditorActivity();
		vi.advanceTimersByTime(DEBOUNCE_MS);

		const latest = tracker.getLatest();
		expect(latest).not.toBeNull();
		expect(latest?.filePath).toBe("notes/plan.md");
		expect(latest?.text).toBe("hello");
	});

	// getLatest updates to the most recent broadcast
	it("getLatest reflects the most recent broadcast after a file switch", () => {
		const { adapter, tracker } = makeHarness();
		adapter.setActiveSelection(makeSelection());
		tracker.onEditorActivity();
		vi.advanceTimersByTime(DEBOUNCE_MS);

		const selB = makeSelectionB();
		adapter.setActiveSelection(selB);
		tracker.onEditorActivity();
		vi.advanceTimersByTime(DEBOUNCE_MS);

		expect(tracker.getLatest()?.filePath).toBe("notes/other.md");
	});

	// dispose — cancels pending timer
	it("dispose cancels a pending timer so no broadcast fires after disposal", () => {
		const { adapter, broadcast, tracker } = makeHarness();
		adapter.setActiveSelection(makeSelection());

		tracker.onEditorActivity();
		// dispose before the timer fires
		tracker.dispose();

		vi.advanceTimersByTime(DEBOUNCE_MS);

		expect(broadcast).not.toHaveBeenCalled();
	});

	// Broadcast envelope shape
	it("broadcast envelope is a JSON-RPC 2.0 notification with method selection_changed", () => {
		const { adapter, broadcast, tracker } = makeHarness();
		adapter.setActiveSelection(makeSelection());

		tracker.onEditorActivity();
		vi.advanceTimersByTime(DEBOUNCE_MS);

		expect(broadcast).toHaveBeenCalledTimes(1);
		const msg = broadcast.mock.calls[0]?.[0] as {
			jsonrpc: string;
			method: string;
			params: SelectionChangedParams;
		};
		expect(msg.jsonrpc).toBe("2.0");
		expect(msg.method).toBe("selection_changed");
		expect(msg.params).toBeDefined();
		expect(msg.params.filePath).toBe("notes/plan.md");
	});
});
