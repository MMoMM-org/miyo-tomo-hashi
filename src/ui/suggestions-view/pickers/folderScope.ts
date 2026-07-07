/**
 * Folder-scoping helpers shared by the Suggestions Editor's Template and
 * Location pickers. The owner can limit those pickers to configured
 * folder(s) (`settings.suggestionsTemplateFolder` /
 * `suggestionsLocationFolders`); these helpers decide whether a given
 * vault-relative path falls inside such a scope. Kept separate from the
 * pickers so the containment rule is defined and tested once.
 */

/** Strip a single trailing "/" so `"Atlas/"` and `"Atlas"` scope identically. */
function normalizeFolder(folder: string): string {
	return folder.endsWith("/") ? folder.slice(0, -1) : folder;
}

/**
 * True when `path` is the folder `folder` itself or nested under it. An empty
 * `folder` (the vault root) contains every path. Used for both files (a file
 * directly in the folder matches via the `folder/` prefix) and subfolders.
 */
export function isUnderFolder(path: string, folder: string): boolean {
	const base = normalizeFolder(folder);
	if (base === "") return true;
	return path === base || path.startsWith(`${base}/`);
}

/** True when `path` falls under ANY of the configured `folders`. */
export function isUnderAnyFolder(path: string, folders: readonly string[]): boolean {
	return folders.some((folder) => isUnderFolder(path, folder));
}
