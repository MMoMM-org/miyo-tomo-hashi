/**
 * Stub Proposed MOCs tab (T3.1 placeholder). Replaced by the real
 * rename/reparent/merge UI in T3.5 (SDD §6 Proposed MOCs). Empty in the
 * vendored `1115` fixture — exercises the view's generic empty state.
 */

import type { EditModel } from "../../../types/suggestions.js";
import type { EditorTab, TabContext } from "../tabContract.js";

export class ProposedMocsTab implements EditorTab {
	readonly id = "proposed";
	readonly label = "Proposed MOCs";

	count(model: EditModel): number {
		return model.doc.proposed_mocs.length;
	}

	render(container: HTMLElement, model: EditModel, _ctx: TabContext): void {
		container.createDiv({
			cls: "hashi-suggestions-editor-tab-stub",
			text: `${this.label} (${this.count(model)}) — coming soon`,
		});
	}
}
