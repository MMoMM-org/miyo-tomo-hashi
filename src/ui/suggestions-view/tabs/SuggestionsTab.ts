/**
 * Stub Suggestions tab (T3.1 placeholder). Replaced by the real worthy /
 * suppressed card UI in T3.2 (SDD §6 Suggestions). Exists so
 * `SuggestionsEditorView` has a full four-tab surface to render and test
 * now, without blocking on the card implementation.
 */

import type { EditModel } from "../../../types/suggestions.js";
import type { EditorTab, TabContext } from "../tabContract.js";

export class SuggestionsTab implements EditorTab {
	readonly id = "suggestions";
	readonly label = "Suggestions";

	count(model: EditModel): number {
		return model.doc.suggestions.length;
	}

	render(container: HTMLElement, model: EditModel, _ctx: TabContext): void {
		container.createDiv({
			cls: "hashi-suggestions-editor-tab-stub",
			text: `${this.label} (${this.count(model)}) — coming soon`,
		});
	}
}
