/**
 * Fuzzy picker over the run's suggestions that are not yet members of one
 * proposed MOC, used by the Proposed MOCs tab's "＋ note" control (#84). The
 * owning tab passes the candidates as `{ id, title }` and wires `onChoose(id)`
 * to `addMemberToProposedMoc(mocId, chosenSuggestionId)`.
 *
 * Same shape as `MergeTargetPicker`: it displays a title but returns the stable
 * S## id, so it extends `FuzzySuggestModal` over the option object directly
 * rather than the string-valued `FuzzyFieldPicker`.
 */

import { type App, FuzzySuggestModal } from "obsidian";

export interface MemberOption {
	readonly id: string;
	readonly title: string;
}

export class MemberPicker extends FuzzySuggestModal<MemberOption> {
	constructor(
		app: App,
		private readonly options: readonly MemberOption[],
		private readonly onChoose: (suggestionId: string) => void,
	) {
		super(app);
		this.setPlaceholder("Add which note to this MOC?");
	}

	getItems(): MemberOption[] {
		return [...this.options];
	}

	getItemText(item: MemberOption): string {
		return item.title;
	}

	onChooseItem(item: MemberOption, _evt: MouseEvent | KeyboardEvent): void {
		this.onChoose(item.id);
	}
}
