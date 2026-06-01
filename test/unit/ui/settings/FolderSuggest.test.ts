/**
 * Unit tests for the folder-autocomplete helper that backs the inbox-folder
 * and hooks-directory path settings.
 *
 * The Obsidian-coupled `FolderSuggest` class is thin glue over
 * `AbstractInputSuggest`; the testable logic is the pure `filterFolderPaths`
 * function (per src/CLAUDE.md TDD + constitution "fakes over real Obsidian").
 */

import { App, type TFolder } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { FolderSuggest, filterFolderPaths } from "../../../../src/settings/FolderSuggest";

const folders = (...paths: string[]): TFolder[] =>
	paths.map((path) => ({ path }) as unknown as TFolder);

// getSuggestions is protected on the Obsidian base; tests reach it directly.
type SuggestProbe = { getSuggestions(query: string): TFolder[] };

describe("filterFolderPaths", () => {
	it("matches a case-insensitive substring of the path", () => {
		const paths = ["Inbox", "inbox/tomo", "Notes"];
		expect(filterFolderPaths(paths, "tomo")).toEqual(["inbox/tomo"]);
	});

	it("is case-insensitive on the query", () => {
		const paths = ["Inbox", "inbox/tomo", "Notes"];
		// Both "Inbox" and "inbox/tomo" contain "inbox"; shorter path first.
		expect(filterFolderPaths(paths, "INBOX")).toEqual(["Inbox", "inbox/tomo"]);
	});

	it("excludes non-matching paths", () => {
		const paths = ["inbox/tomo", "notes/drafts"];
		expect(filterFolderPaths(paths, "archive")).toEqual([]);
	});

	it("surfaces parent folders before their descendants", () => {
		const paths = ["a/b/c", "a", "a/b"];
		expect(filterFolderPaths(paths, "a")).toEqual(["a", "a/b", "a/b/c"]);
	});

	it("returns every path (sorted) for an empty query", () => {
		const paths = ["zeta", "a", "mid/child"];
		expect(filterFolderPaths(paths, "")).toEqual(["a", "zeta", "mid/child"]);
	});
});

describe("FolderSuggest", () => {
	function makeSuggest(
		vaultFolders: TFolder[],
		onSelect: (path: string) => void = () => {},
	): { suggest: FolderSuggest; input: HTMLInputElement } {
		const app = new App();
		app.vault.getAllFolders = vi.fn(() => vaultFolders);
		const input = document.createElement("input");
		return { suggest: new FolderSuggest(app, input, onSelect), input };
	}

	it("suggests vault folders filtered by the typed query", () => {
		const { suggest } = makeSuggest(folders("inbox", "inbox/tomo", "notes"));

		const result = (suggest as unknown as SuggestProbe)
			.getSuggestions("tomo")
			.map((f) => f.path);

		expect(result).toEqual(["inbox/tomo"]);
	});

	it("selecting a folder fills the input and reports the path", () => {
		const onSelect = vi.fn();
		const [picked] = folders("inbox/tomo");
		const { suggest, input } = makeSuggest([picked as TFolder], onSelect);

		suggest.selectSuggestion(picked as TFolder);

		expect(input.value).toBe("inbox/tomo");
		expect(onSelect).toHaveBeenCalledWith("inbox/tomo");
	});
});
