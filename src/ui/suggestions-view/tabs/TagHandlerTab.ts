/**
 * Stub Tag-Handler tab (T3.1 placeholder). Replaced by the real
 * approve/keep-source + read-only context UI in T3.7 (SDD §6 Tag-Handler).
 */

import type { EditModel } from "../../../types/suggestions.js";
import type { EditorTab, TabContext } from "../tabContract.js";

export class TagHandlerTab implements EditorTab {
	readonly id = "tag-handler";
	readonly label = "Tag-Handler";

	count(model: EditModel): number {
		return model.doc.tag_handler_groups.length;
	}

	render(container: HTMLElement, model: EditModel, _ctx: TabContext): void {
		container.createDiv({
			cls: "hashi-suggestions-editor-tab-stub",
			text: `${this.label} (${this.count(model)}) — coming soon`,
		});
	}
}
