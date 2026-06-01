/**
 * Folder autocomplete for the vault-relative path settings (Tomo inbox folder,
 * Hooks directory). Attaches an Obsidian type-ahead to a text input so users
 * pick an existing vault folder instead of typing a path blind.
 *
 * The class is thin glue over `AbstractInputSuggest`; the matching/ordering
 * logic lives in the pure `filterFolderPaths` helper so it is unit-testable
 * without an Obsidian DOM (constitution: prefer fakes over real Obsidian).
 *
 * Picking a suggestion routes the chosen path back through the same
 * path-safety guard as typing — see `addPathSetting` in `SettingsTab.ts`.
 */

import { AbstractInputSuggest, type App, type TFolder } from "obsidian";

/**
 * Filter and order folder paths for the suggestion dropdown.
 *
 * Case-insensitive substring match; an empty query matches everything.
 * Results are ordered shortest-path-first (parents above their descendants),
 * with an alphabetical tie-break for stability.
 */
export function filterFolderPaths(paths: string[], query: string): string[] {
	const q = query.toLowerCase();
	const matched =
		q === "" ? [...paths] : paths.filter((p) => p.toLowerCase().includes(q));
	return matched.sort((a, b) => a.length - b.length || a.localeCompare(b));
}

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private readonly onSelectPath: (path: string) => void,
	) {
		super(app, inputEl);
	}

	protected getSuggestions(query: string): TFolder[] {
		const byPath = new Map<string, TFolder>(
			this.app.vault.getAllFolders(true).map((f) => [f.path, f]),
		);
		return filterFolderPaths([...byPath.keys()], query)
			.map((p) => byPath.get(p))
			.filter((f): f is TFolder => f !== undefined);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path || "/");
	}

	selectSuggestion(folder: TFolder): void {
		this.setValue(folder.path);
		this.onSelectPath(folder.path);
		this.close();
	}
}
