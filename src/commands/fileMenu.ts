/**
 * File-menu @file injection — registers an Obsidian `file-menu` event handler
 * that injects a "Open Tomo chat with @file reference" entry into the file
 * explorer's right-click menu. Clicking the entry opens the chat view and
 * writes `@<vault-relative-path> ` directly into the Docker session's stdin,
 * so it appears in the Tomo TUI as typed text.
 *
 * Intentionally decoupled from `TomoChatView`: callers wire the actual
 * open-and-inject closure via `FileMenuDeps`. Phase 5 supplies that closure
 * from the plugin entry point so this module stays a pure command-builder
 * testable in isolation.
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
	 * Opens the chat view (creating the leaf if missing) and writes the
	 * prefill text directly into the Docker session's stdin. If the Tomo
	 * connection is not active, the chat view is still revealed so the user
	 * can see the disconnected state and connect manually.
	 */
	openChatAndInject: (text: string) => Promise<void>;
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
							const safePath = stripControlChars(file.path);
							const text = `@${safePath} `;
							await deps.openChatAndInject(text);
						});
				});
			},
		),
	);
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
