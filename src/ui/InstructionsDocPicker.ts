/**
 * Fuzzy picker over the Tomo inbox's `*_instructions.json` docs, shown by the
 * "Execute instructions document" command when the active file is NOT itself
 * an instructions doc (a suggestions doc, a plain note, or nothing) — so the
 * user picks what to run instead of the command misrouting the active file
 * into the executor (a `_suggestions.json` would fail instructions-schema
 * validation).
 *
 * The first entry is a synthetic "run the whole inbox" batch choice so batch
 * mode stays reachable from this command; every following entry is one
 * instruction doc. Selection maps to the `Invocation` the executor expects.
 * The item list is passed in (the command/main.ts gathers + sorts the paths)
 * rather than derived here — keeps the vault query in one place.
 */

import { type App, FuzzySuggestModal } from "obsidian";

import type { Invocation } from "../executor/InstructionExecutor";

type InstructionsChoice = { readonly kind: "batch" } | { readonly kind: "doc"; readonly path: string };

const BATCH_LABEL = "▸ Run the whole inbox (batch)";

export class InstructionsDocPicker extends FuzzySuggestModal<InstructionsChoice> {
	constructor(
		app: App,
		private readonly docs: readonly string[],
		private readonly onPick: (invocation: Invocation) => void,
	) {
		super(app);
		this.setPlaceholder("Choose an _instructions.json to run…");
	}

	getItems(): InstructionsChoice[] {
		return [{ kind: "batch" }, ...this.docs.map((path) => ({ kind: "doc", path }) as const)];
	}

	getItemText(item: InstructionsChoice): string {
		return item.kind === "batch" ? BATCH_LABEL : item.path;
	}

	onChooseItem(item: InstructionsChoice, _evt: MouseEvent | KeyboardEvent): void {
		this.onPick(
			item.kind === "batch"
				? { kind: "batch" }
				: { kind: "single-file", sourcePath: item.path },
		);
	}
}
