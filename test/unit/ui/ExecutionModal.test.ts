/**
 * ExecutionModal — state-machine UI driven by `executionStore` (RunState).
 *
 * Spec refs: docs/XDD/specs/002-instruction-executor/plan/phase-5.md T5.1;
 *   PRD F3 (tri-state mode + button labels), F6 (banner + 0-of-M-remaining),
 *   F7 (sticky error banner during run); SDD ADR-5 + Component States.
 *
 * Behaviour under test:
 *   - subscribes to a Store<RunState> on onOpen; unsubscribes on onClose
 *     (no leaked listeners — asserted via Store internals).
 *   - renders the appropriate subview for each `RunState` kind without
 *     close+open between phases.
 *   - preview subview (mode=confirm + previewing): banner / per-file headers
 *     / row glyphs / footer disclosure / Execute + Cancel.
 *   - preview subview (mode=auto-run + running): banner present; Cancel only.
 *   - progress subview: row glyphs reflect outcomes; sticky error banner.
 *   - summary subview: stats line + View errors (when failures) + Close.
 *   - validation-failed: tabular per-file errors; Close only.
 *   - 0-of-M-remaining: Execute is disabled (PRD F6 line 193).
 *   - Esc key mapping: preview/running → cancel; summary/validation-failed → close.
 *   - Cancel during preview does NOT call executor.cancel(); during running
 *     does call it exactly once.
 */

import { App, Modal } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { ExecutionModal } from "../../../src/ui/ExecutionModal";
import { Store } from "../../../src/util/store";
import type {
	ActionRecord,
	RunCounts,
	RunState,
} from "../../../src/executor/state";

// --- factories --------------------------------------------------------------

function record(overrides: Partial<ActionRecord> = {}): ActionRecord {
	return {
		fileId: "2026-04-25_inbox-review.json",
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

interface FakeExecutor {
	state: Store<RunState>;
	cancel: Mock<() => void>;
	proceed: Mock<() => void>;
}

function makeExecutor(initial: RunState = { kind: "idle" }): FakeExecutor {
	return {
		state: new Store<RunState>(initial),
		cancel: vi.fn<() => void>(),
		proceed: vi.fn<() => void>(),
	};
}

function listenerCount(store: Store<RunState>): number {
	// Reach into the private listeners set; this is a test-only contract used
	// elsewhere (see store.ts) to confirm no leaked subscriptions.
	const listeners = (store as unknown as { listeners: Set<unknown> }).listeners;
	return listeners.size;
}

// --- tests ------------------------------------------------------------------

describe("ExecutionModal — sanity & subscription wiring", () => {
	let app: App;

	beforeEach(() => {
		vi.clearAllMocks();
		app = new App();
	});

	afterEach(() => {
		// nothing global to tear down
	});

	it("is an Obsidian Modal subclass", () => {
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		expect(modal).toBeInstanceOf(Modal);
	});

	it("subscribes to executor.state on onOpen and unsubscribes on onClose", () => {
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});

		const before = listenerCount(exec.state);
		modal.onOpen();
		expect(listenerCount(exec.state)).toBe(before + 1);

		modal.onClose();
		expect(listenerCount(exec.state)).toBe(before);
	});

	it("re-renders contentEl on each store state change without close+open", () => {
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		const closeSpy = vi.spyOn(modal, "close");

		modal.onOpen();

		// Drive multiple transitions through the store
		exec.state.set({
			kind: "previewing",
			mode: "confirm",
			records: [record()],
			remaining: 1,
			total: 1,
		});
		exec.state.set({
			kind: "running",
			mode: "confirm",
			records: [record()],
			currentIndex: 0,
		});
		exec.state.set({
			kind: "summary",
			mode: "confirm",
			records: [record({ outcome: { kind: "applied" } })],
			counts: counts({ applied: 1, durationMs: 1000 }),
			logFilePath: null,
		});

		// close() is the public Modal API; modal must NOT have called it itself
		// across the phase transitions.
		expect(closeSpy).not.toHaveBeenCalled();
	});
});

describe("ExecutionModal — preview subview (confirm mode)", () => {
	let app: App;

	beforeEach(() => {
		vi.clearAllMocks();
		app = new App();
	});

	function preview(records: ActionRecord[], remaining: number, total: number): RunState {
		return {
			kind: "previewing",
			mode: "confirm",
			records,
			remaining,
			total,
		};
	}

	it("renders source-file count in the header", () => {
		const records = [
			record({ fileId: "a.json", id: "I01" }),
			record({ fileId: "a.json", id: "I02" }),
			record({ fileId: "b.json", id: "I01" }),
		];
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set(preview(records, 3, 3));

		const header = modal.contentEl.querySelector(".hashi-execution-modal-header");
		expect(header).not.toBeNull();
		expect(header?.textContent).toMatch(/2 file|2 source/i);
	});

	it("renders partial-resume banner when remaining < total", () => {
		const records = [
			record({ id: "I01", outcome: { kind: "applied" } }),
			record({ id: "I02" }),
		];
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set(preview(records, 1, 2));

		const banner = modal.contentEl.querySelector(".hashi-execution-modal-banner");
		expect(banner).not.toBeNull();
		expect(banner?.textContent).toMatch(/1 of 2 remaining/i);
	});

	it("groups action rows under per-source-file ## <filename> headers", () => {
		const records = [
			record({ fileId: "alpha.json", id: "I01" }),
			record({ fileId: "alpha.json", id: "I02" }),
			record({ fileId: "beta.json", id: "I01" }),
		];
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set(preview(records, 3, 3));

		const headings = modal.contentEl.querySelectorAll(
			".hashi-execution-modal-file-heading",
		);
		expect(headings.length).toBe(2);
		expect(headings[0]?.textContent).toContain("alpha.json");
		expect(headings[1]?.textContent).toContain("beta.json");
	});

	it("each action row shows glyph + I## + kind + summary", () => {
		const records = [
			record({ id: "I07", kind: "move_note", summary: "move foo to bar" }),
		];
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set(preview(records, 1, 1));

		const row = modal.contentEl.querySelector(".hashi-execution-modal-row");
		expect(row).not.toBeNull();
		const text = row?.textContent ?? "";
		expect(text).toContain("I07");
		expect(text).toContain("move_note");
		expect(text).toContain("move foo to bar");
		// glyph slot present
		expect(row?.querySelector(".hashi-execution-modal-row-glyph")).not.toBeNull();
	});

	it("already-applied rows render with is-applied class and ✓ glyph", () => {
		const records = [
			record({ id: "I01", outcome: { kind: "applied" } }),
			record({ id: "I02" }),
		];
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set(preview(records, 1, 2));

		const rows = modal.contentEl.querySelectorAll(".hashi-execution-modal-row");
		expect(rows.length).toBe(2);
		expect(rows[0]?.classList.contains("is-applied")).toBe(true);
		const firstGlyph = rows[0]?.querySelector(".hashi-execution-modal-row-glyph");
		expect(firstGlyph?.textContent).toBe("✓"); // ✓
	});

	it("renders the footer disclosure verbatim", () => {
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set(preview([record()], 1, 1));

		const footer = modal.contentEl.querySelector(".hashi-execution-modal-footer");
		expect(footer).not.toBeNull();
		expect(footer?.textContent).toContain(
			"Approval lives in Tomo's review step. This preview is informational.",
		);
	});

	it("shows Execute primary + Cancel buttons (no Dismiss)", () => {
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set(preview([record()], 1, 1));

		const buttons = modal.contentEl.querySelectorAll("button");
		const labels = Array.from(buttons).map((b) => b.textContent ?? "");
		expect(labels).toContain("Execute");
		expect(labels).toContain("Cancel");
		expect(labels).not.toContain("Dismiss");

		const execBtn = Array.from(buttons).find((b) => b.textContent === "Execute");
		expect(execBtn?.classList.contains("mod-cta")).toBe(true);
	});

	it("clicking Execute fires onExecute callback", () => {
		const onExecute = vi.fn();
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, { onExecute });
		modal.onOpen();
		exec.state.set(preview([record()], 1, 1));

		const execBtn = Array.from(
			modal.contentEl.querySelectorAll("button"),
		).find((b) => b.textContent === "Execute") as HTMLButtonElement | undefined;
		execBtn?.click();

		expect(onExecute).toHaveBeenCalledTimes(1);
	});

	it("Cancel during preview does NOT call executor.cancel and DOES call onCancel", () => {
		const onCancel = vi.fn();
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, { onCancel });
		modal.onOpen();
		exec.state.set(preview([record()], 1, 1));

		const cancelBtn = Array.from(
			modal.contentEl.querySelectorAll("button"),
		).find((b) => b.textContent === "Cancel") as HTMLButtonElement | undefined;
		cancelBtn?.click();

		expect(exec.cancel).not.toHaveBeenCalled();
		expect(onCancel).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// H2 — onClose lifecycle: native dismiss must drain the executor
// ---------------------------------------------------------------------------

describe("ExecutionModal — onClose lifecycle (H2: native-dismiss safety)", () => {
	let app: App;

	beforeEach(() => {
		vi.clearAllMocks();
		app = new App();
	});

	it("calls executor.cancel when native onClose fires while previewing", () => {
		// Obsidian's framework Scope handles Esc and the X chrome before
		// any of our contentEl listeners fire — only the lifecycle onClose
		// runs. If a run is gated at proceedResolve, missing this drain
		// leaves the lock held until plugin reload.
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set({
			kind: "previewing",
			mode: "confirm",
			records: [record()],
			remaining: 1,
			total: 1,
		});

		modal.onClose();

		expect(exec.cancel).toHaveBeenCalledTimes(1);
	});

	it("calls executor.cancel when native onClose fires while running", () => {
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set({
			kind: "running",
			mode: "confirm",
			records: [record()],
			currentIndex: 0,
		});

		modal.onClose();

		expect(exec.cancel).toHaveBeenCalledTimes(1);
	});

	it("does NOT call executor.cancel when native onClose fires from summary", () => {
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set({
			kind: "summary",
			mode: "confirm",
			records: [record({ outcome: { kind: "applied" } })],
			counts: counts({ applied: 1 }),
			logFilePath: null,
		});

		modal.onClose();

		expect(exec.cancel).not.toHaveBeenCalled();
	});

	it("does NOT call executor.cancel when native onClose fires from idle", () => {
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();

		modal.onClose();

		expect(exec.cancel).not.toHaveBeenCalled();
	});

	it("forwards callbacks.onClose when canceling so consumer can drive idle", () => {
		// After cancel, the executor transitions to summary with no modal to
		// close it — main.ts's onClose hook drives the idle transition.
		// Mirror that wiring here so the executor doesn't end up parked at
		// summary forever.
		const onCloseCb = vi.fn();
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, { onClose: onCloseCb });
		modal.onOpen();
		exec.state.set({
			kind: "previewing",
			mode: "confirm",
			records: [record()],
			remaining: 1,
			total: 1,
		});

		modal.onClose();

		expect(exec.cancel).toHaveBeenCalledTimes(1);
		expect(onCloseCb).toHaveBeenCalledTimes(1);
	});
});

describe("ExecutionModal — preview subview (auto-run, state=running)", () => {
	let app: App;

	beforeEach(() => {
		vi.clearAllMocks();
		app = new App();
	});

	it("renders Cancel only (no Execute) when state.kind is running and mode is auto-run", () => {
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set({
			kind: "running",
			mode: "auto-run",
			records: [record()],
			currentIndex: 0,
		});

		const buttons = modal.contentEl.querySelectorAll("button");
		const labels = Array.from(buttons).map((b) => b.textContent ?? "");
		expect(labels).toContain("Cancel");
		expect(labels).not.toContain("Execute");
	});
});

describe("ExecutionModal — progress subview (state=running)", () => {
	let app: App;

	beforeEach(() => {
		vi.clearAllMocks();
		app = new App();
	});

	function running(records: ActionRecord[], idx: number): RunState {
		return {
			kind: "running",
			mode: "confirm",
			records,
			currentIndex: idx,
		};
	}

	it("action rows are <li> inside a <ul role=list> for AT navigation (M10)", () => {
		const records = [record({ id: "I01" }), record({ id: "I02" })];
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set(running(records, 0));

		const list = modal.contentEl.querySelector(
			"ul.hashi-execution-modal-row-list",
		);
		expect(list).not.toBeNull();
		expect(list?.getAttribute("role")).toBe("list");
		const items = list?.querySelectorAll("li.hashi-execution-modal-row");
		expect(items?.length).toBe(2);
	});

	it("each row glyph is aria-hidden + row carries an aria-label with state + id + kind (M11)", () => {
		const records = [
			record({ id: "I01", outcome: { kind: "applied" } }),
			record({ id: "I02" }),
		];
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set(running(records, 1));

		const rows = modal.contentEl.querySelectorAll(".hashi-execution-modal-row");
		expect(rows.length).toBe(2);
		// applied row
		expect(rows[0]?.getAttribute("aria-label")).toContain("applied");
		expect(rows[0]?.getAttribute("aria-label")).toContain("I01");
		expect(rows[0]?.getAttribute("aria-label")).toContain("create_moc");
		// running row
		expect(rows[1]?.getAttribute("aria-label")).toContain("running");
		expect(rows[1]?.getAttribute("aria-label")).toContain("I02");
		// glyphs aria-hidden
		const glyphs = modal.contentEl.querySelectorAll(
			".hashi-execution-modal-row-glyph",
		);
		expect(glyphs.length).toBe(2);
		glyphs.forEach((g) => {
			expect(g.getAttribute("aria-hidden")).toBe("true");
		});
	});

	it("in-place update keeps row aria-label in sync with new outcome (M11)", () => {
		const records = [record({ id: "I01" }), record({ id: "I02" })];
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set(running(records, 0));

		// Tick: I01 completes as applied, advance currentIndex
		(records[0] as ActionRecord).outcome = { kind: "applied" };
		exec.state.set(running(records, 1));

		const rows = modal.contentEl.querySelectorAll(".hashi-execution-modal-row");
		expect(rows[0]?.getAttribute("aria-label")).toContain("applied");
		expect(rows[1]?.getAttribute("aria-label")).toContain("running");
	});

	it("progress header is an aria-live region (H11 + review round 2 / L36)", () => {
		// Per-tick text changes ("3 of 10" → "4 of 10") must be announced.
		// review round 2 / L36: aria-atomic was dropped — `setText`
		// replaces the entire text node, so polite-region semantics
		// re-announce the full string without aria-atomic forcing the
		// subtree to be re-spoken (which can produce duplicate
		// announcements on some AT).
		const records = [record({ id: "I01" }), record({ id: "I02" })];
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set(running(records, 0));

		const header = modal.contentEl.querySelector(
			".hashi-execution-modal-header",
		);
		expect(header?.getAttribute("aria-live")).toBe("polite");
		expect(header?.getAttribute("aria-atomic")).toBeNull();
	});

	it("running→running with same records updates DOM in place (H4)", () => {
		// Pre-fix code rebuilt contentEl on every store tick — N×5 element
		// teardown+rebuild per iteration on Obsidian's main thread between
		// awaits. The fast path detects same-records-different-index and
		// updates in place. This test pins the in-place behavior by tagging
		// the body element and verifying its identity survives the next
		// tick.
		const records = [record({ id: "I01" }), record({ id: "I02" })];
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set(running(records, 0));

		const bodyBefore = modal.contentEl.querySelector(
			".hashi-execution-modal-body",
		) as HTMLElement | null;
		expect(bodyBefore).not.toBeNull();
		bodyBefore?.setAttribute("data-test-marker", "phase1");

		// Advance index — same `records` array reference
		exec.state.set(running(records, 1));

		const bodyAfter = modal.contentEl.querySelector(
			".hashi-execution-modal-body",
		) as HTMLElement | null;
		expect(bodyAfter).toBe(bodyBefore);
		expect(bodyAfter?.getAttribute("data-test-marker")).toBe("phase1");

		// Header text reflects the new index
		const header = modal.contentEl.querySelector(
			".hashi-execution-modal-header",
		);
		expect(header?.textContent).toContain("1 of 2");
	});

	it("running→running with a different records array does a full rebuild", () => {
		// New run: records identity differs. Must rebuild from scratch
		// (otherwise stale DOM rows from the previous run survive).
		const records1 = [record({ id: "I01" })];
		const records2 = [record({ id: "X01" }), record({ id: "X02" })];
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set(running(records1, 0));

		const bodyBefore = modal.contentEl.querySelector(
			".hashi-execution-modal-body",
		);
		bodyBefore?.setAttribute("data-test-marker", "phase1");

		exec.state.set(running(records2, 0));

		const bodyAfter = modal.contentEl.querySelector(
			".hashi-execution-modal-body",
		);
		expect(bodyAfter).not.toBe(bodyBefore);
		expect(bodyAfter?.getAttribute("data-test-marker")).toBeNull();
		expect(
			modal.contentEl.querySelectorAll(".hashi-execution-modal-row").length,
		).toBe(2);
	});

	it("row glyphs advance as outcomes arrive", () => {
		const records = [
			record({ id: "I01" }),
			record({ id: "I02" }),
			record({ id: "I03" }),
		];
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set(running(records, 0));

		// At index 0, no outcomes yet — pending glyph for all
		let rows = modal.contentEl.querySelectorAll(".hashi-execution-modal-row");
		expect(rows.length).toBe(3);

		// Mutate outcomes (records is a readonly array of mutable ActionRecord
		// per state.ts) and re-publish
		(records[0] as ActionRecord).outcome = { kind: "applied" };
		(records[1] as ActionRecord).outcome = {
			kind: "failed",
			reason: "boom",
		};
		exec.state.set(running(records, 2));

		rows = modal.contentEl.querySelectorAll(".hashi-execution-modal-row");
		const g0 = rows[0]?.querySelector(".hashi-execution-modal-row-glyph");
		const g1 = rows[1]?.querySelector(".hashi-execution-modal-row-glyph");
		const g2 = rows[2]?.querySelector(".hashi-execution-modal-row-glyph");
		expect(g0?.textContent).toBe("✓"); // ✓
		expect(g1?.textContent).toBe("✗"); // ✗
		// pending row still shows the active/pending glyph (⏺ or ⟳)
		expect(g2?.textContent).toMatch(/[⏺⟳]/);
	});

	it("accumulates failures into the sticky error banner", () => {
		const records = [
			record({
				id: "I01",
				outcome: { kind: "failed", reason: "missing target" },
			}),
			record({
				id: "I02",
				outcome: { kind: "failed", reason: "deny-list" },
			}),
			record({ id: "I03" }),
		];
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set(running(records, 2));

		const errBanner = modal.contentEl.querySelector(
			".hashi-execution-modal-error-banner",
		);
		expect(errBanner).not.toBeNull();
		expect(errBanner?.textContent).toContain("missing target");
		expect(errBanner?.textContent).toContain("deny-list");
	});

	it("Cancel during running calls executor.cancel exactly once", () => {
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set(running([record()], 0));

		const cancelBtn = Array.from(
			modal.contentEl.querySelectorAll("button"),
		).find((b) => b.textContent === "Cancel") as HTMLButtonElement | undefined;
		cancelBtn?.click();

		expect(exec.cancel).toHaveBeenCalledTimes(1);
	});
});

describe("ExecutionModal — summary subview a11y (M12, M13)", () => {
	let app: App;

	beforeEach(() => {
		vi.clearAllMocks();
		app = new App();
	});

	it("stats row has role=img + human aria-label; glyph text is aria-hidden (M12)", () => {
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set({
			kind: "summary",
			mode: "confirm",
			records: [record({ outcome: { kind: "applied" } })],
			counts: counts({ applied: 5, "skipped-already": 2, failed: 0, durationMs: 1200 }),
			logFilePath: null,
		});

		const stats = modal.contentEl.querySelector(
			".hashi-execution-modal-stats",
		);
		expect(stats).not.toBeNull();
		expect(stats?.getAttribute("role")).toBe("img");
		const label = stats?.getAttribute("aria-label") ?? "";
		expect(label).toContain("5 applied");
		expect(label).toContain("2 skipped");
		expect(label).toContain("0 failed");
		expect(label).toContain("1.2 seconds");

		const visibleSpan = stats?.querySelector("span");
		expect(visibleSpan?.getAttribute("aria-hidden")).toBe("true");
	});

	it("phase transition moves focus to the new view's primary button (M13)", () => {
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		// Focus restoration requires contentEl in document
		document.body.appendChild(modal.contentEl);
		try {
			modal.onOpen();
			// Transition into preview
			exec.state.set({
				kind: "previewing",
				mode: "confirm",
				records: [record()],
				remaining: 1,
				total: 1,
			});
			// Execute is the .mod-cta in preview view
			const execute = Array.from(
				modal.contentEl.querySelectorAll("button"),
			).find((b) => b.textContent === "Execute");
			expect(document.activeElement).toBe(execute);

			// Transition into summary
			exec.state.set({
				kind: "summary",
				mode: "confirm",
				records: [record({ outcome: { kind: "applied" } })],
				counts: counts({ applied: 1, durationMs: 100 }),
				logFilePath: null,
			});
			// Close is the .mod-cta in summary view
			const closeBtn = Array.from(
				modal.contentEl.querySelectorAll("button"),
			).find((b) => b.textContent === "Close");
			expect(document.activeElement).toBe(closeBtn);
		} finally {
			document.body.removeChild(modal.contentEl);
		}
	});
});

describe("ExecutionModal — summary subview (state=summary)", () => {
	let app: App;

	beforeEach(() => {
		vi.clearAllMocks();
		app = new App();
	});

	it('renders the stats line "✓ A · ⊘ S · ✗ F (Xs)"', () => {
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set({
			kind: "summary",
			mode: "confirm",
			records: [record({ outcome: { kind: "applied" } })],
			counts: counts({
				applied: 5,
				"skipped-already": 2,
				failed: 1,
				durationMs: 4321,
			}),
			logFilePath: null,
		});

		const stats = modal.contentEl.querySelector(".hashi-execution-modal-stats");
		expect(stats).not.toBeNull();
		const text = stats?.textContent ?? "";
		expect(text).toContain("✓ 5"); // ✓ 5 applied
		expect(text).toContain("⊘ 2"); // ⊘ 2 skipped (skipped-already)
		expect(text).toContain("✗ 1"); // ✗ 1 failed
		expect(text).toContain("4.3"); // duration in seconds
		expect(text).toContain("s)");
	});

	it("View errors button is present when failed > 0", () => {
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set({
			kind: "summary",
			mode: "confirm",
			records: [
				record({ outcome: { kind: "failed", reason: "x" } }),
			],
			counts: counts({ failed: 1, durationMs: 100 }),
			logFilePath: null,
		});

		const buttons = modal.contentEl.querySelectorAll("button");
		const labels = Array.from(buttons).map((b) => b.textContent ?? "");
		expect(labels).toContain("View errors");
		expect(labels).toContain("Close");
	});

	it("clicking View errors invokes onViewErrors with the logFilePath", () => {
		const onViewErrorsCb = vi.fn();
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, { onViewErrors: onViewErrorsCb });
		modal.onOpen();
		exec.state.set({
			kind: "summary",
			mode: "confirm",
			records: [record({ outcome: { kind: "failed", reason: "x" } })],
			counts: counts({ failed: 1, durationMs: 100 }),
			logFilePath: "100 Inbox/tomo-hashi-run-log_2026-04-30T1131.md",
		});

		const buttons = modal.contentEl.querySelectorAll("button");
		const viewErrorsBtn = Array.from(buttons).find(
			(b) => (b.textContent ?? "") === "View errors",
		);
		expect(viewErrorsBtn).toBeDefined();
		viewErrorsBtn!.dispatchEvent(new Event("click"));
		expect(onViewErrorsCb).toHaveBeenCalledWith(
			"100 Inbox/tomo-hashi-run-log_2026-04-30T1131.md",
		);
	});

	it("clicking View errors with null logFilePath still invokes onViewErrors with null", () => {
		const onViewErrorsCb = vi.fn();
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, { onViewErrors: onViewErrorsCb });
		modal.onOpen();
		exec.state.set({
			kind: "summary",
			mode: "confirm",
			records: [record({ outcome: { kind: "failed", reason: "x" } })],
			counts: counts({ failed: 1, durationMs: 100 }),
			logFilePath: null,
		});

		const buttons = modal.contentEl.querySelectorAll("button");
		const viewErrorsBtn = Array.from(buttons).find(
			(b) => (b.textContent ?? "") === "View errors",
		);
		viewErrorsBtn!.dispatchEvent(new Event("click"));
		expect(onViewErrorsCb).toHaveBeenCalledWith(null);
	});

	it("View errors button is absent when failed == 0", () => {
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set({
			kind: "summary",
			mode: "confirm",
			records: [record({ outcome: { kind: "applied" } })],
			counts: counts({ applied: 1, durationMs: 100 }),
			logFilePath: null,
		});

		const buttons = modal.contentEl.querySelectorAll("button");
		const labels = Array.from(buttons).map((b) => b.textContent ?? "");
		expect(labels).not.toContain("View errors");
		expect(labels).toContain("Close");
	});

	it("clicking Close fires onClose callback", () => {
		const onCloseCb = vi.fn();
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, { onClose: onCloseCb });
		modal.onOpen();
		exec.state.set({
			kind: "summary",
			mode: "confirm",
			records: [],
			counts: counts({ durationMs: 100 }),
			logFilePath: null,
		});

		const closeBtn = Array.from(
			modal.contentEl.querySelectorAll("button"),
		).find((b) => b.textContent === "Close") as HTMLButtonElement | undefined;
		closeBtn?.click();

		expect(onCloseCb).toHaveBeenCalledTimes(1);
	});
});

describe("ExecutionModal — 0-of-M-remaining (PRD F6 line 193)", () => {
	let app: App;

	beforeEach(() => {
		vi.clearAllMocks();
		app = new App();
	});

	it("shows 0-of-M banner and disables Execute in confirm mode", () => {
		const records = [
			record({ id: "I01", outcome: { kind: "applied" } }),
			record({ id: "I02", outcome: { kind: "applied" } }),
			record({ id: "I03", outcome: { kind: "applied" } }),
		];
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set({
			kind: "previewing",
			mode: "confirm",
			records,
			remaining: 0,
			total: 3,
		});

		const banner = modal.contentEl.querySelector(
			".hashi-execution-modal-banner",
		);
		expect(banner?.textContent).toMatch(/0 of 3 remaining/i);
		expect(banner?.textContent?.toLowerCase()).toContain("already applied");

		const execBtn = Array.from(
			modal.contentEl.querySelectorAll("button"),
		).find((b) => b.textContent === "Execute") as HTMLButtonElement | undefined;
		expect(execBtn).toBeDefined();
		expect(execBtn?.disabled).toBe(true);
	});
});

describe("ExecutionModal — validation-failed subview", () => {
	let app: App;

	beforeEach(() => {
		vi.clearAllMocks();
		app = new App();
	});

	it("renders per-file errors in a table; Close button only", () => {
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		const failures = new Map<string, string>([
			["alpha.json", "Schema version mismatch — expected 1, got 2"],
			["beta.json", "Unexpected EOF"],
		]);
		exec.state.set({
			kind: "validation-failed",
			mode: "confirm",
			perFileFailures: failures,
		});

		const table = modal.contentEl.querySelector(
			".hashi-execution-modal-validation-table",
		);
		expect(table).not.toBeNull();
		const rows = table?.querySelectorAll("tr") ?? [];
		// 2 data rows (header optional but rows must include both files)
		const rowText = Array.from(rows).map((r) => r.textContent ?? "");
		expect(rowText.some((t) => t.includes("alpha.json"))).toBe(true);
		expect(
			rowText.some((t) => t.includes("Schema version mismatch")),
		).toBe(true);
		expect(rowText.some((t) => t.includes("beta.json"))).toBe(true);
		expect(rowText.some((t) => t.includes("Unexpected EOF"))).toBe(true);

		const buttons = modal.contentEl.querySelectorAll("button");
		const labels = Array.from(buttons).map((b) => b.textContent ?? "");
		expect(labels).toContain("Close");
		expect(labels).not.toContain("Execute");
		expect(labels).not.toContain("Cancel");
	});
});

describe("ExecutionModal — Esc key handling", () => {
	let app: App;

	beforeEach(() => {
		vi.clearAllMocks();
		app = new App();
	});

	function fireEsc(modal: ExecutionModal): void {
		const evt = new KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: true,
			cancelable: true,
		});
		modal.contentEl.dispatchEvent(evt);
	}

	it("Esc during preview triggers Cancel (onCancel called, executor.cancel not called)", () => {
		const onCancel = vi.fn();
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, { onCancel });
		modal.onOpen();
		exec.state.set({
			kind: "previewing",
			mode: "confirm",
			records: [record()],
			remaining: 1,
			total: 1,
		});

		fireEsc(modal);

		expect(onCancel).toHaveBeenCalledTimes(1);
		expect(exec.cancel).not.toHaveBeenCalled();
	});

	it("Esc during running calls executor.cancel exactly once", () => {
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, {});
		modal.onOpen();
		exec.state.set({
			kind: "running",
			mode: "confirm",
			records: [record()],
			currentIndex: 0,
		});

		fireEsc(modal);

		expect(exec.cancel).toHaveBeenCalledTimes(1);
	});

	it("Esc during summary fires onClose (close path, not cancel)", () => {
		const onCloseCb = vi.fn();
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, { onClose: onCloseCb });
		modal.onOpen();
		exec.state.set({
			kind: "summary",
			mode: "confirm",
			records: [],
			counts: counts({ durationMs: 100 }),
			logFilePath: null,
		});

		fireEsc(modal);

		expect(onCloseCb).toHaveBeenCalledTimes(1);
		expect(exec.cancel).not.toHaveBeenCalled();
	});

	it("Esc during validation-failed fires onClose (close path)", () => {
		const onCloseCb = vi.fn();
		const exec = makeExecutor();
		const modal = new ExecutionModal(app, exec, { onClose: onCloseCb });
		modal.onOpen();
		exec.state.set({
			kind: "validation-failed",
			mode: "confirm",
			perFileFailures: new Map([["a.json", "boom"]]),
		});

		fireEsc(modal);

		expect(onCloseCb).toHaveBeenCalledTimes(1);
		expect(exec.cancel).not.toHaveBeenCalled();
	});
});
