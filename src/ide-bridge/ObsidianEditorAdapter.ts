/**
 * ObsidianEditorAdapter — Obsidian-facing seam for editor state queries.
 *
 * Defines the EditorAdapter interface (port) and its production implementation.
 * All tool and tracker logic in Phase 2 depends on this interface, not the
 * concrete Obsidian API, so that tools are testable without a live Obsidian
 * instance (Constitution L1/L3 — FakeEditorAdapter satisfies the interface).
 *
 * ADR-7 / Kokoro ADR-019 §2.3:
 *   - filePath is ALWAYS the plain vault-relative path (e.g. "notes/plan.md").
 *   - fileUrl is "file://" + vault-relative path (no host-absolute prefix).
 *   - workspaceRoot() returns "" — the vault root is never exposed to Claude Code.
 *
 * Seam decision — openFile existence check:
 *   The adapter calls workspace.openLinkText unconditionally. Existence
 *   checking (e.g. app.vault.getAbstractFileByPath) belongs to the openFile
 *   TOOL layer (T2.3), not here. This keeps the adapter thin and prevents the
 *   Obsidian API surface from leaking into the tool protocol layer.
 *
 * Spec: docs/XDD/specs/003-ide-bridge — SDD "Application Data Models".
 */

import { MarkdownView } from "obsidian";
import type { App } from "obsidian";
import type { SelectionChangedParams } from "./protocol.js";

// ---------------------------------------------------------------------------
// Port — EditorAdapter interface
// ---------------------------------------------------------------------------

export interface EditorAdapter {
	/**
	 * Return the current editor selection, or null when no MarkdownView is
	 * active. filePath is vault-relative; fileUrl uses vault-relative path
	 * (ADR-7). The adapter returns raw text — the tracker caps at 100KB.
	 */
	getCurrentSelection(): SelectionChangedParams | null;

	/**
	 * List all open markdown editors by vault-relative path.
	 * isDirty is always false — Obsidian does not expose a reliable
	 * per-leaf dirty flag without hooking vault events; the tool contract
	 * documents this as a v0.1 limitation.
	 */
	getOpenEditors(): { filePath: string; isDirty: false }[];

	/**
	 * Open a file by vault-relative path via workspace.openLinkText.
	 * Existence checking is the responsibility of the openFile tool (T2.3).
	 */
	openFile(vaultRelativePath: string): void;

	/**
	 * Returns the vault root identifier used in workspaceFolders responses.
	 * Per ADR-7, this is always an empty string — the host filesystem path
	 * is never exposed. The SDD lists getWorkspaceFolders for completeness;
	 * the tool always returns { workspaceFolders: [] }.
	 */
	workspaceRoot(): string;
}

// ---------------------------------------------------------------------------
// Adapter — production implementation
// ---------------------------------------------------------------------------

export class ObsidianEditorAdapter implements EditorAdapter {
	constructor(private readonly app: App) {}

	getCurrentSelection(): SelectionChangedParams | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view === null || view === undefined) return null;

		const editor = view.editor;
		const file = view.file;
		if (file === null || file === undefined) return null;

		const from = editor.getCursor("from");
		const to = editor.getCursor("to");
		const text = editor.getSelection();

		// TFile.path is already vault-relative in Obsidian.
		const filePath = file.path;
		// ADR-7: fileUrl path is the vault-relative path, never host-absolute.
		const fileUrl = `file:///${filePath}`;

		return {
			text,
			filePath,
			fileUrl,
			selection: {
				start: { line: from.line, character: from.ch },
				end: { line: to.line, character: to.ch },
				isEmpty: text.length === 0,
			},
		};
	}

	getOpenEditors(): { filePath: string; isDirty: false }[] {
		const leaves = this.app.workspace.getLeavesOfType("markdown");
		const result: { filePath: string; isDirty: false }[] = [];

		for (const leaf of leaves) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;
			const file = view.file;
			if (file === null || file === undefined) continue;
			result.push({ filePath: file.path, isDirty: false });
		}

		return result;
	}

	openFile(vaultRelativePath: string): void {
		// openLinkText(linktext, sourcePath, newLeaf?) — source is "" when there
		// is no originating note. Existence check is deferred to the tool layer.
		void this.app.workspace.openLinkText(vaultRelativePath, "", false);
	}

	workspaceRoot(): string {
		// ADR-7: return "" — host filesystem paths are never exposed.
		return "";
	}
}
