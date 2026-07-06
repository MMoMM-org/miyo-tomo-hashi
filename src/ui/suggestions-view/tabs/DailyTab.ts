/**
 * Stub Daily tab (T3.1 placeholder). Replaced by the real per-date log
 * entry / log link / tracker editing UI in T3.6 (SDD §6 Daily).
 */

import type { EditModel } from "../../../types/suggestions.js";
import type { EditorTab, TabContext } from "../tabContract.js";

export class DailyTab implements EditorTab {
	readonly id = "daily";
	readonly label = "Daily";

	count(model: EditModel): number {
		return model.doc.daily_updates.length;
	}

	render(container: HTMLElement, model: EditModel, _ctx: TabContext): void {
		container.createDiv({
			cls: "hashi-suggestions-editor-tab-stub",
			text: `${this.label} (${this.count(model)}) — coming soon`,
		});
	}
}
