/**
 * previewView — pure DOM render for the previewing state.
 *
 * Renders banner (partial-resume), per-source-file headings, action rows
 * (with already-applied rendering), footer disclosure, and Execute + Cancel
 * buttons. Execute is disabled when remaining === 0 (PRD F6 line 193).
 *
 * [ref: PRD/F3, F6; SDD/ADR-5; SDD/Component States]
 */

import type { ActionRecord, RunState } from "../../executor/state";

import type { ModalCallbacks } from "./types";
import {
	createButtonRow,
	createFooter,
	createHeader,
	createRowGlyph,
	GLYPH_APPLIED,
	GLYPH_PENDING,
	groupByFile,
	rowAriaLabel,
} from "./shared";

interface PreviewState {
	readonly records: readonly ActionRecord[];
	readonly remaining: number;
	readonly total: number;
}

function isPreviewing(
	state: RunState,
): state is Extract<RunState, { kind: "previewing" }> {
	return state.kind === "previewing";
}

export function renderPreviewView(
	contentEl: HTMLElement,
	state: RunState,
	callbacks: ModalCallbacks,
): void {
	contentEl.empty();
	contentEl.addClass("hashi-execution-modal");

	if (!isPreviewing(state)) return;
	const ps: PreviewState = state;

	// Header — file count
	const fileCount = countDistinctFiles(ps.records);
	createHeader(contentEl, `${fileCount} ${fileCount === 1 ? "file" : "files"} · ${ps.records.length} actions`);

	// Banner — partial-resume / 0-of-M
	if (ps.remaining < ps.total) {
		const bannerText =
			ps.remaining === 0
				? `0 of ${ps.total} remaining — all actions already applied`
				: `${ps.remaining} of ${ps.total} remaining (${ps.total - ps.remaining} already applied — re-run safe)`;
		contentEl.createDiv({
			cls: "hashi-execution-modal-banner",
			text: bannerText,
		});
	}

	// Body — per-file groups (M10: action rows are <ul role="list"> + <li>
	// so AT can announce item count and navigate by list shortcuts)
	const body = contentEl.createDiv({ cls: "hashi-execution-modal-body" });
	for (const [fileId, records] of groupByFile(ps.records)) {
		body.createEl("h3", {
			cls: "hashi-execution-modal-file-heading",
			text: fileId,
		});
		const list = body.createEl("ul", {
			cls: "hashi-execution-modal-row-list",
			attr: { role: "list" },
		});
		for (const record of records) {
			renderRow(list, record);
		}
	}

	// Footer — disclosure
	createFooter(
		contentEl,
		"Approval lives in Tomo's review step. This preview is informational.",
	);

	// Buttons — Execute + Cancel
	const btnRow = createButtonRow(contentEl);
	const execBtn = btnRow.createEl("button", { text: "Execute" });
	execBtn.addClass("mod-cta");
	if (ps.remaining === 0) {
		execBtn.disabled = true;
	}
	execBtn.addEventListener("click", () => {
		callbacks.onExecute?.();
	});

	const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
	cancelBtn.addEventListener("click", () => {
		callbacks.onCancel?.();
	});
}

function renderRow(parent: HTMLElement, record: ActionRecord): void {
	const isApplied = record.outcome?.kind === "applied" || record.outcome?.kind === "skipped-already";
	const cls = isApplied
		? ["hashi-execution-modal-row", "is-applied"]
		: ["hashi-execution-modal-row"];
	const row = parent.createEl("li", {
		cls,
		attr: { "aria-label": rowAriaLabel(record) },
	});
	createRowGlyph(row, isApplied ? GLYPH_APPLIED : GLYPH_PENDING);
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

function countDistinctFiles(records: readonly ActionRecord[]): number {
	const ids = new Set<string>();
	for (const r of records) ids.add(r.fileId);
	return ids.size;
}
