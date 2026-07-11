/**
 * Fuzzy picker over the OTHER proposed MOCs, used by the Proposed MOCs tab's
 * "⇄ Merge into…" control (owner pre-live refinement — merge a proposal into
 * any other proposal, not just an auto-detected same-name sibling). The owning
 * tab passes the candidate proposals as `{ id, name }` and wires `onChoose(id)`
 * to `mergeProposedMocs(sourceId, chosenTargetId)`.
 *
 * Not a `FuzzyFieldPicker` (that base is string-valued): the picker must
 * display each proposal's `name` while returning its stable `id`, so it
 * extends `FuzzySuggestModal` over the option object directly.
 */

import { type App, FuzzySuggestModal } from "obsidian";

export interface MergeTargetOption {
	readonly id: string;
	readonly name: string;
}

export class MergeTargetPicker extends FuzzySuggestModal<MergeTargetOption> {
	constructor(
		app: App,
		private readonly options: readonly MergeTargetOption[],
		private readonly onChoose: (targetId: string) => void,
	) {
		super(app);
		this.setPlaceholder("Merge into which proposed MOC?");
	}

	getItems(): MergeTargetOption[] {
		return [...this.options];
	}

	getItemText(item: MergeTargetOption): string {
		return item.name;
	}

	onChooseItem(item: MergeTargetOption, _evt: MouseEvent | KeyboardEvent): void {
		this.onChoose(item.id);
	}
}
