/**
 * summaryView — pure DOM render for summary and validation-failed states.
 *
 * Summary: stats line "✓ A · ⊘ S · ✗ F (Xs)" + View errors (when failed > 0)
 * + Close. Validation-failed: tabular per-file errors + Close.
 *
 * [ref: PRD/F3, F7; SDD/ADR-5]
 */

import type { RunState } from "../../executor/state";

import type { ModalCallbacks } from "./types";
import {
	createButtonRow,
	createHeader,
	GLYPH_APPLIED,
	GLYPH_FAILED,
	GLYPH_SKIPPED,
} from "./shared";

export function renderSummaryView(
	contentEl: HTMLElement,
	state: RunState,
	callbacks: ModalCallbacks,
): void {
	contentEl.empty();
	contentEl.addClass("hashi-execution-modal");

	if (state.kind === "summary") {
		renderSummary(contentEl, state, callbacks);
		return;
	}
	if (state.kind === "validation-failed") {
		renderValidationFailed(contentEl, state, callbacks);
	}
}

function renderSummary(
	contentEl: HTMLElement,
	state: Extract<RunState, { kind: "summary" }>,
	callbacks: ModalCallbacks,
): void {
	createHeader(contentEl, "Run complete");

	const skipped =
		state.counts["skipped-already"] +
		state.counts["skipped-dependency"] +
		state.counts["skipped-cancelled"];

	const seconds = (state.counts.durationMs / 1000).toFixed(1);

	contentEl.createDiv({
		cls: "hashi-execution-modal-stats",
		text: `${GLYPH_APPLIED} ${state.counts.applied} · ${GLYPH_SKIPPED} ${skipped} · ${GLYPH_FAILED} ${state.counts.failed} (${seconds}s)`,
	});

	if (state.logFilePath !== null) {
		contentEl.createDiv({
			cls: "hashi-execution-modal-log-link",
			text: `Run log: ${state.logFilePath}`,
		});
	}

	const btnRow = createButtonRow(contentEl);

	if (state.counts.failed > 0) {
		const viewErrorsBtn = btnRow.createEl("button", { text: "View errors" });
		viewErrorsBtn.addEventListener("click", () => {
			callbacks.onViewErrors?.(state.logFilePath);
		});
	}

	const closeBtn = btnRow.createEl("button", { text: "Close" });
	closeBtn.addClass("mod-cta");
	closeBtn.addEventListener("click", () => {
		callbacks.onClose?.();
	});
}

function renderValidationFailed(
	contentEl: HTMLElement,
	state: Extract<RunState, { kind: "validation-failed" }>,
	callbacks: ModalCallbacks,
): void {
	createHeader(contentEl, "Validation failed");

	const table = contentEl.createEl("table", {
		cls: "hashi-execution-modal-validation-table",
	});
	const thead = table.createEl("thead");
	const headerRow = thead.createEl("tr");
	headerRow.createEl("th", { text: "File" });
	headerRow.createEl("th", { text: "Error" });

	const tbody = table.createEl("tbody");
	for (const [fileId, message] of state.perFileFailures) {
		const tr = tbody.createEl("tr");
		tr.createEl("td", { text: fileId });
		tr.createEl("td", { text: message });
	}

	const btnRow = createButtonRow(contentEl);
	const closeBtn = btnRow.createEl("button", { text: "Close" });
	closeBtn.addClass("mod-cta");
	closeBtn.addEventListener("click", () => {
		callbacks.onClose?.();
	});
}
