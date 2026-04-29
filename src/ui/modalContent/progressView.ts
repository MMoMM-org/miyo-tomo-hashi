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

	createHeader(
		contentEl,
		`Running — ${state.currentIndex} of ${state.records.length} actions`,
	);

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
		for (const record of records) {
			const isCurrent =
				record.outcome === null &&
				indexByRecord.get(record) === state.currentIndex;
			const cls: string[] = ["hashi-execution-modal-row"];
			if (record.outcome?.kind === "applied") cls.push("is-applied");
			else if (record.outcome?.kind === "failed") cls.push("is-failed");
			const row = body.createDiv({ cls });
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
