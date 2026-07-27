/**
 * summaryView — pure DOM render for summary and validation-failed states.
 *
 * Summary: stats line "✓ A · ⊘ S · ✗ F (Xs)" + View errors (when failed > 0)
 * + Open Instruction Fixer (one per failing source, when ≥1 failed/skipped
 * action) + Close. Validation-failed: tabular per-file errors + Close.
 *
 * [ref: PRD/F1-AC2, F3, F7; SDD/ADR-3, ADR-5]
 */

import type { ActionOutcome, ActionRecord, RunState } from "../../executor/state";

import type { ModalCallbacks } from "./types";
import {
	createButtonRow,
	createHeader,
	GLYPH_APPLIED,
	GLYPH_FAILED,
	GLYPH_SKIPPED,
	groupByFile,
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

	// M12: the visible glyph text reads as "check mark five middle dot
	// prohibition sign two ..." in a screen reader. Wrap the visible
	// version aria-hidden and provide a human aria-label on a role="img"
	// container so AT announces "5 applied, 2 skipped, 0 failed,
	// 1.2 seconds" instead.
	const stats = contentEl.createDiv({
		cls: "hashi-execution-modal-stats",
		attr: {
			role: "img",
			"aria-label": `${state.counts.applied} applied, ${skipped} skipped, ${state.counts.failed} failed, ${seconds} seconds`,
		},
	});
	stats.createSpan({
		text: `${GLYPH_APPLIED} ${state.counts.applied} · ${GLYPH_SKIPPED} ${skipped} · ${GLYPH_FAILED} ${state.counts.failed} (${seconds}s)`,
		attr: { "aria-hidden": "true" },
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

	// [ref: SDD/ADR-3a, PRD/F1-AC2] one option per source that has ≥1
	// failed/skipped-* action — derived straight from the records, so a
	// zero-failure run naturally offers nothing (no separate flag to drift
	// out of sync with the data).
	//
	// code-quality review W2: a multi-source run can have an unbounded number
	// of these buttons, each keyed to a full vault path. `.hashi-execution-
	// modal-buttons` wraps (styles.css) so a long row can never push Close out
	// of reach, and the label itself uses the basename (full path on `title`,
	// same disclosure pattern as a filesystem breadcrumb) so the common case
	// doesn't need to wrap at all.
	//
	// review follow-up: a basename is only unique-enough to READ by if it's
	// actually unique among this run's failing sources — vaults repeat
	// filenames across folders (`100 Inbox/x.json` vs. `200 Archive/x.json`).
	// Disambiguate ONLY the sources whose basename collides, falling back to
	// the full path for those; a source with a one-of-a-kind basename keeps
	// the short label. `title` always carries the full path regardless.
	const fixerSources = failingSourcePaths(state.records);
	const basenameCounts = countBasenames(fixerSources);
	for (const sourcePath of fixerSources) {
		const label = fixerButtonLabel(sourcePath, fixerSources.length, basenameCounts);
		const fixerBtn = btnRow.createEl("button", { text: label });
		if (fixerSources.length > 1) {
			fixerBtn.setAttribute("title", sourcePath);
		}
		fixerBtn.addEventListener("click", () => {
			callbacks.onOpenInstructionFixer?.(sourcePath);
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

/** Last path segment, for the multi-source button label (full path on `title`). */
function basename(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? path : path.slice(slash + 1);
}

/** How many of `paths` share each basename — collisions need a longer label. */
function countBasenames(paths: readonly string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const path of paths) {
		const name = basename(path);
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	return counts;
}

/**
 * `"Open Instruction Fixer"` when it's the only failing source; otherwise
 * `"Open Instruction Fixer: <name>"`, where `<name>` is the basename UNLESS
 * it collides with another failing source's basename, in which case the full
 * path is used instead — two buttons must never read identically on the
 * screen whose job is "pick the set you want to repair".
 */
function fixerButtonLabel(
	sourcePath: string,
	sourceCount: number,
	basenameCounts: ReadonlyMap<string, number>,
): string {
	if (sourceCount === 1) return "Open Instruction Fixer";
	const name = basename(sourcePath);
	const disambiguated = (basenameCounts.get(name) ?? 0) > 1 ? sourcePath : name;
	return `Open Instruction Fixer: ${disambiguated}`;
}

/**
 * Distinct `fileId`s (source paths) that carry at least one failed/skipped-*
 * outcome, in first-seen order. Reuses `groupByFile` rather than a bespoke
 * Set scan so this stays consistent with how previewView/progressView already
 * group records by source.
 */
function failingSourcePaths(records: readonly ActionRecord[]): string[] {
	const result: string[] = [];
	for (const [fileId, fileRecords] of groupByFile(records)) {
		if (fileRecords.some((r) => r.outcome !== null && isFailedOrSkipped(r.outcome))) {
			result.push(fileId);
		}
	}
	return result;
}

/**
 * Exhaustive switch (not a string-prefix test) so a future 6th
 * `ActionOutcome` variant is a compile error here, not a silent
 * fall-through — same discipline as `editGate` (outcomeSource.ts).
 */
function isFailedOrSkipped(outcome: ActionOutcome): boolean {
	switch (outcome.kind) {
		case "failed":
		case "skipped-already":
		case "skipped-dependency":
		case "skipped-cancelled":
			return true;
		case "applied":
			return false;
	}
}
