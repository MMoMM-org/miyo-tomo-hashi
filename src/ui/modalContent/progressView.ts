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
	// these attributes — so announcements continue across in-place ticks.
	header.setAttr("aria-live", "polite");
	header.setAttr("aria-atomic", "true");

	// Sticky error banner — accumulates every failure outcome seen so far
	const failures = state.records
		.map((r) => r.outcome)
		.filter((o): o is { kind: "failed"; reason: string } =>
			o !== null && o.kind === "failed",
		);
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
		}
	}

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

	const rows = contentEl.querySelectorAll<HTMLElement>(
		".hashi-execution-modal-row",
	);
	state.records.forEach((record, i) => {
		const row = rows.item(i);
		if (row === null) return;
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
	const failures = state.records
		.map((r) => r.outcome)
		.filter((o): o is { kind: "failed"; reason: string } =>
			o !== null && o.kind === "failed",
		);
	let banner = contentEl.querySelector<HTMLElement>(
		".hashi-execution-modal-error-banner",
	);
	if (failures.length === 0) {
		if (banner !== null) banner.remove();
		return;
	}
	if (banner === null) {
		banner = contentEl.createDiv({
			cls: "hashi-execution-modal-error-banner",
		});
		banner.setAttr("aria-live", "assertive");
		const headerEl = contentEl.querySelector(
			".hashi-execution-modal-header",
		);
		if (headerEl !== null && headerEl.nextSibling !== null) {
			contentEl.insertBefore(banner, headerEl.nextSibling);
		}
	}
	const lines = failures.map((f) => f.reason).join(" · ");
	banner.setText(`${failures.length} failed: ${lines}`);
}
