/**
 * File-menu @file prefill — registers an Obsidian `file-menu` event handler
 * that injects a "Open Tomo chat with @file reference" entry into the file
 * explorer's right-click menu. Clicking the entry either inserts the
 * reference at the caret of the open chat input, or opens the chat view and
 * prefills the input with `@<vault-relative-path> `.
 *
 * Intentionally decoupled from `TomoChatView`: callers wire the actual
 * input-lookup and view-open closures via `FileMenuDeps`. Phase 5 supplies
 * those closures from the plugin entry point so this module stays a pure
 * command-builder testable in isolation.
 *
 * Spec refs: spec 001-session-view phase-4 T4.4; PRD FS1 (all ACs);
 * SDD "Directory Map / src/commands/fileMenu.ts".
 */

import type { Menu, Plugin, TAbstractFile } from "obsidian";

export interface FileMenuDeps {
	/**
	 * Returns the active TomoChatView's input element if the view is currently
	 * open, or `null` if it isn't. Phase 5 wires this to a workspace lookup
	 * via `app.workspace.getLeavesOfType(VIEW_TYPE_TOMO_CHAT)` that pulls the
	 * inputEl ref off the view. Tests use `vi.fn(() => input | null)`.
	 */
	getOpenChatInput: () => HTMLInputElement | null;

	/**
	 * Opens the TomoChat view (creating the leaf if missing), focuses the
	 * input, and inserts the prefill text. Resolves once the input is
	 * focused. Phase 5 wires this to `app.workspace.getRightLeaf(false)` +
	 * `setViewState({ type: VIEW_TYPE_TOMO_CHAT })` then sets `input.value`
	 * and calls `input.focus()`.
	 *
	 * The fileMenu does NOT gate on connection state — `openChatViewAndPrefill`
	 * always receives the prefill verbatim. The Not-Connected screen (rendered
	 * by `TomoChatView` when disconnected) keeps the prefill in the input so
	 * the user can press Connect and send.
	 */
	openChatViewAndPrefill: (text: string) => Promise<void>;
}

const ENTRY_LABEL = "Open Tomo chat with @file reference";
const ENTRY_ICON = "message-square";

/**
 * Strip control characters that could act as command separators when the
 * inserted reference is later sent to the container's stdin. macOS and Linux
 * filesystems both allow `\n`, `\r`, and `\0` in filenames; a file named
 * `foo\nrm -rf /` would inject a newline and a second command into the
 * Tomo session. Vanishingly unlikely in practice but cheap to defend
 * against, and aligns with the PRD's "container input is opaque bytes
 * from the user" trust model: the user did not type those control bytes,
 * the filesystem did.
 *
 * Stripped (not escaped) — escape sequences would render visibly in the
 * terminal where the user's preview expects literal `@vault/path` text.
 *
 * Spec ref: spec 001-session-view requirements.md FS1; review-fix M3
 * (2026-04-28).
 */
function stripControlChars(path: string): string {
	// `\n` (newline), `\r` (carriage return), `\0` (NUL). Leaving tabs alone —
	// not a separator, doesn't break the @-mention boundary.
	return path.replace(/[\n\r\0]/g, "");
}

export function registerFileMenu(plugin: Plugin, deps: FileMenuDeps): void {
	plugin.registerEvent(
		plugin.app.workspace.on(
			"file-menu",
			(menu: Menu, file: TAbstractFile) => {
				menu.addItem((item) => {
					item
						.setTitle(ENTRY_LABEL)
						.setIcon(ENTRY_ICON)
						.onClick(async () => {
							// `file.path` is already vault-relative in Obsidian — no
							// resolution needed. Trailing space matches PRD FS1: lets
							// the user start typing immediately after the reference.
							const safePath = stripControlChars(file.path);
							const text = `@${safePath} `;
							const input = deps.getOpenChatInput();
							if (input !== null) {
								insertAtCaret(input, text);
								input.focus();
								return;
							}
							await deps.openChatViewAndPrefill(text);
						});
				});
			},
		),
	);
}

/**
 * Inserts `text` at the input's current caret position, replacing any
 * selection. Caret is positioned after the inserted text. When
 * `selectionStart`/`selectionEnd` are `null` (input never focused) falls back
 * to end-of-value so the reference is appended.
 */
function insertAtCaret(input: HTMLInputElement, text: string): void {
	const start = input.selectionStart ?? input.value.length;
	const end = input.selectionEnd ?? input.value.length;
	const before = input.value.slice(0, start);
	const after = input.value.slice(end);
	input.value = before + text + after;
	const newCaret = start + text.length;
	input.setSelectionRange(newCaret, newCaret);
}
