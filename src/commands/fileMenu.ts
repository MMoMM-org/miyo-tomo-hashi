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

import type { InstructionExecutor } from "../executor/InstructionExecutor";
import type { VaultFS } from "../vault/VaultFS";
import type { PluginSettings } from "../types/index";

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
							const text = `@${file.path} `;
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

// ---------------------------------------------------------------------------
// 002 spec — instruction-executor file-menu entry
// ---------------------------------------------------------------------------
//
// Spec refs: 002-instruction-executor phase-6 T6.1; PRD F1 ACs:
//   - Right-click on `.md` peer (sibling `_instructions.json` exists) → entry
//     "Execute instructions…" present.
//   - Right-click on `_instructions.json` → entry NOT present (user does
//     not normally interact with the JSON directly).
//   - Right-click on any other file → entry NOT present.
//
// Decisions:
//
// 1. The file-menu handler is async-aware: deciding whether the file is a
//    peer requires `vault.exists` on the sibling `.json`. We register the
//    entry inside an `addItem` callback only after the existence check
//    resolves; menus in Obsidian render synchronously, so we run the check
//    BEFORE addItem. Tests await one or two microtasks before asserting.
//
// 2. Click handler uses the SAME `resolveActiveInvocation` rules — by the
//    time the user clicks the menu item, the file path is known and we
//    dispatch a deterministic `{ kind: "single-file", sourcePath }`. We do
//    NOT route through `resolveActiveInvocation` (which reads
//    workspace.getActiveFile()) because the file-menu target may differ
//    from the active editor file.

const EXECUTE_INSTRUCTIONS_MENU_LABEL = "Execute instructions…";
const EXECUTE_INSTRUCTIONS_MENU_ICON = "play-circle";

export interface ExecutorFileMenuDeps {
	/** Narrow surface of `InstructionExecutor` — only `execute()` is needed. */
	readonly executor: Pick<InstructionExecutor, "execute">;
	/** Vault adapter for sibling-file existence check. */
	readonly vault: Pick<VaultFS, "exists">;
	/** Plugin settings — carried for parity with the palette command. */
	readonly settings: PluginSettings;
}

export function registerExecutorFileMenu(
	plugin: Plugin,
	deps: ExecutorFileMenuDeps,
): void {
	plugin.registerEvent(
		plugin.app.workspace.on(
			"file-menu",
			(menu: Menu, file: TAbstractFile) => {
				void maybeAddExecutorEntry(menu, file, deps);
			},
		),
	);
}

async function maybeAddExecutorEntry(
	menu: Menu,
	file: TAbstractFile,
	deps: ExecutorFileMenuDeps,
): Promise<void> {
	const sourcePath = await peerSourcePath(deps.vault, file.path);
	if (sourcePath === null) return;

	menu.addItem((item) => {
		item
			.setTitle(EXECUTE_INSTRUCTIONS_MENU_LABEL)
			.setIcon(EXECUTE_INSTRUCTIONS_MENU_ICON)
			.onClick(() => {
				void deps.executor.execute({
					kind: "single-file",
					sourcePath,
				});
			});
	});
}

/**
 * Returns the `_instructions.json` path that backs `path`, or null when
 * `path` is not a `.md` peer of an existing instruction set.
 *
 * PRD F1 explicit rules:
 *   - `.json` files NEVER surface the entry — return null.
 *   - `.md` files surface the entry iff sibling `<stem>.json` exists.
 *   - All other extensions return null.
 */
async function peerSourcePath(
	vault: Pick<VaultFS, "exists">,
	path: string,
): Promise<string | null> {
	if (path.endsWith(".json")) return null;
	if (!path.endsWith(".md")) return null;
	const sibling = path.slice(0, -3) + ".json";
	return (await vault.exists(sibling)) ? sibling : null;
}
