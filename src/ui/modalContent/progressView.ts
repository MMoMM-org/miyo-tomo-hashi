/**
 * progressView — pure DOM render for the running state.
 *
 * Renders header (current/total), sticky error banner accumulating failures,
 * per-row glyphs (advancing as outcomes flow in), and a Cancel button.
 *
 * [ref: PRD/F3, F7; SDD/ADR-5]
 */

import type { ActionRecord, RunState } from "../../executor/state";

import type { ModalCallbacks } from "./types";
import {
	createButtonRow,
	createHeader,
	createRowGlyph,
	glyphForOutcome,
	groupByFile,
	rowAriaLabel,
} from "./shared";

function isRunning(
	state: RunState,
): state is Extract<RunState, { kind: "running" }> {
	return state.kind === "running";
}

// review round 2 / L38: cache the per-row HTMLElement list on the
// contentEl via a WeakMap so updateProgressView can index directly into
// the array instead of re-running querySelectorAll on every store tick.
// renderProgressView populates the array; updateProgressView reads it.
// WeakMap entry is dropped naturally when the modal's contentEl is
// garbage-collected.
const rowCache = new WeakMap<HTMLElement, HTMLElement[]>();

export function renderProgressView(
	contentEl: HTMLElement,
	state: RunState,
	callbacks: ModalCallbacks,
): void {
	contentEl.empty();
	contentEl.addClass("hashi-execution-modal");

	if (!isRunning(state)) return;

	const header = createHeader(
		contentEl,
		`Running — ${state.currentIndex} of ${state.records.length} actions`,
	);
	// H11: announce progress changes to assistive tech. The fast-path
	// updateProgressView only swaps text via setText, which preserves
	// the aria-live attribute. review round 2 / L36: aria-atomic was
	// dropped — `setText` replaces the entire text node, so the polite
	// region naturally announces the full new text without aria-atomic
	// forcing the entire subtree to be re-spoken.
	header.setAttr("aria-live", "polite");

	// Sticky error banner — accumulates every failure outcome seen so far.
	// review round 2 / L37: replaced two-pass map+filter with a single
	// for-loop accumulating into a pre-sized array.
	const failures = collectFailures(state.records);
	if (failures.length > 0) {
		const banner = contentEl.createDiv({
			cls: "hashi-execution-modal-error-banner",
		});
		banner.setAttr("aria-live", "assertive");
		const lines = failures.map((f) => f.reason).join(" · ");
		banner.setText(`${failures.length} failed: ${lines}`);
	}

	const body = contentEl.createDiv({ cls: "hashi-execution-modal-body" });
	// Build a record→index map once so the per-file render loop knows which
	// row is currently executing without an O(n) indexOf per row.
	const indexByRecord = new Map<ActionRecord, number>();
	state.records.forEach((r, i) => indexByRecord.set(r, i));

	// review round 2 / L38: build the row array in render order (same
	// order as state.records) so updateProgressView can index by record
	// position. The grouping by file changes the visual nesting but
	// preserves the action sequence, so rows[i] === records[i].
	const rows: HTMLElement[] = new Array<HTMLElement>(state.records.length);

	for (const [fileId, records] of groupByFile(state.records)) {
		body.createEl("h3", {
			cls: "hashi-execution-modal-file-heading",
			text: fileId,
		});
		// M10: list semantics for AT navigation + count.
		const list = body.createEl("ul", {
			cls: "hashi-execution-modal-row-list",
			attr: { role: "list" },
		});
		for (const record of records) {
			const isCurrent =
				record.outcome === null &&
				indexByRecord.get(record) === state.currentIndex;
			const cls: string[] = ["hashi-execution-modal-row"];
			if (record.outcome?.kind === "applied") cls.push("is-applied");
			else if (record.outcome?.kind === "failed") cls.push("is-failed");
			const row = list.createEl("li", {
				cls,
				attr: { "aria-label": rowAriaLabel(record, isCurrent) },
			});
			createRowGlyph(row, glyphForOutcome(record, isCurrent));
			row.createSpan({
				cls: "hashi-execution-modal-row-id",
				text: record.id,
			});
			row.createSpan({
				cls: "hashi-execution-modal-row-kind",
				text: record.kind,
			});
			row.createSpan({
				cls: "hashi-execution-modal-row-summary",
				text: record.summary,
			});
			const idx = indexByRecord.get(record);
			if (idx !== undefined) rows[idx] = row;
		}
	}
	rowCache.set(contentEl, rows);

	const btnRow = createButtonRow(contentEl);
	const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
	cancelBtn.addEventListener("click", () => {
		callbacks.onCancel?.();
	});
}

/**
 * In-place tick update for an existing progress view (review H4).
 *
 * Used by ExecutionModal's fast path when state transitions running →
 * running with the same `records` array reference. Avoids the per-tick
 * teardown+rebuild of N×5 DOM elements that would otherwise run on
 * Obsidian's main thread between awaits.
 *
 * Safe to call at any time after `renderProgressView` has built the view.
 * Updates header text, error banner, and per-row glyph/class only — no
 * structural changes.
 */
export function updateProgressView(
	contentEl: HTMLElement,
	state: Extract<RunState, { kind: "running" }>,
): void {
	const header = contentEl.querySelector<HTMLElement>(
		".hashi-execution-modal-header",
	);
	if (header !== null) {
		header.setText(
			`Running — ${state.currentIndex} of ${state.records.length} actions`,
		);
	}

	updateErrorBanner(contentEl, state);

	// review round 2 / L38: read the cached row array populated by
	// renderProgressView instead of re-running querySelectorAll on every
	// tick. Falls back to a one-time DOM query if the cache is missing
	// (defensive — in practice updateProgressView is only called between
	// a render and the next render).
	let rows = rowCache.get(contentEl);
	if (rows === undefined) {
		rows = Array.from(
			contentEl.querySelectorAll<HTMLElement>(
				".hashi-execution-modal-row",
			),
		);
		rowCache.set(contentEl, rows);
	}
	const rowList = rows;
	state.records.forEach((record, i) => {
		const row = rowList[i];
		if (row === undefined) return;
		row.classList.toggle("is-applied", record.outcome?.kind === "applied");
		row.classList.toggle("is-failed", record.outcome?.kind === "failed");
		const isCurrent =
			record.outcome === null && i === state.currentIndex;
		// M11: keep aria-label in sync with the new outcome state on each
		// in-place tick so AT users hear advancing progress without a
		// full DOM rebuild.
		row.setAttr("aria-label", rowAriaLabel(record, isCurrent));
		const glyphEl = row.querySelector<HTMLElement>(
			".hashi-execution-modal-row-glyph",
		);
		if (glyphEl !== null) {
			glyphEl.setText(glyphForOutcome(record, isCurrent));
		}
	});
}

function updateErrorBanner(
	contentEl: HTMLElement,
	state: Extract<RunState, { kind: "running" }>,
): void {
	// review round 2 / L37: single-pass collect, no intermediate map array.
	const failures = collectFailures(state.records);
	let banner = contentEl.querySelector<HTMLElement>(
		".hashi-execution-modal-error-banner",
	);
	if (failures.length === 0) {
		if (banner !== null) banner.remove();
		return;
	}
	const lines = failures.map((f) => f.reason).join(" · ");
	const text = `${failures.length} failed: ${lines}`;
	if (banner === null) {
		// review round 2 / L35: build the banner with text + aria-live
		// already set BEFORE inserting into the live region. Inserting an
		// empty assertive region first and then setting text after caused
		// some AT to announce the empty insertion before the actual
		// failure text on first failure.
		banner = activeDocument.createElement("div");
		banner.classList.add("hashi-execution-modal-error-banner");
		banner.setAttribute("aria-live", "assertive");
		banner.textContent = text;
		const headerEl = contentEl.querySelector(
			".hashi-execution-modal-header",
		);
		if (headerEl !== null && headerEl.nextSibling !== null) {
			contentEl.insertBefore(banner, headerEl.nextSibling);
		} else {
			contentEl.appendChild(banner);
		}
		return;
	}
	banner.setText(text);
}

/**
 * Single-pass collector for failed-outcome records (review round 2 /
 * L37). Pre-fix used a chained `.map(r => r.outcome).filter(...)` which
 * allocated an intermediate array of N outcomes per call; for a 50-row
 * progress view this fired on every store tick (one per action
 * completion) so the wasted allocations added up across a full run.
 */
function collectFailures(
	records: readonly ActionRecord[],
): { kind: "failed"; reason: string }[] {
	const failures: { kind: "failed"; reason: string }[] = [];
	for (const r of records) {
		const o = r.outcome;
		if (o !== null && o.kind === "failed") {
			failures.push(o);
		}
	}
	return failures;
}
