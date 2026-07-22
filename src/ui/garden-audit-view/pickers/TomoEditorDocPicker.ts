/**
 * Combined fuzzy picker over BOTH doc families — garden-audit AND
 * suggestions runs (spec-005 Phase 3, T3.2; ADR-6). Shown by the unified
 * "Open Tomo editor" command when neither is the active file: the
 * dispatcher (src/commands/registerCommands.ts) supplies the merged, sorted
 * doc list and routes the chosen path back to the right opener by suffix
 * (`GARDEN_AUDIT_JSON_RE`) — this picker itself is content-agnostic, a thin
 * `FuzzyFieldPicker` subclass mirroring the base's other concrete pickers
 * (e.g. `src/ui/suggestions-view/pickers/MocPicker.ts`).
 */

import type { App } from "obsidian";

import { FuzzyFieldPicker } from "../../suggestions-view/pickers/FuzzyFieldPicker.js";

export class TomoEditorDocPicker extends FuzzyFieldPicker {
	constructor(
		app: App,
		private readonly docs: readonly string[],
		onChoose: (docPath: string) => void,
	) {
		super(app, onChoose, "Choose a Tomo run to open…");
	}

	getItems(): string[] {
		return [...this.docs];
	}
}
