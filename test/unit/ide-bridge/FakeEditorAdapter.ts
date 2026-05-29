/**
 * FakeEditorAdapter — in-memory EditorAdapter for tests.
 *
 * Implements EditorAdapter with settable state so unit tests can exercise
 * tool and tracker logic without a live Obsidian instance (Constitution L1/L3).
 * Co-located with the adapter tests it serves.
 */

import type { EditorAdapter } from "../../../src/ide-bridge/ObsidianEditorAdapter.js";
import type { SelectionChangedParams } from "../../../src/ide-bridge/protocol.js";

export class FakeEditorAdapter implements EditorAdapter {
	/** Settable active selection. null means no active MarkdownView. */
	private activeSelection: SelectionChangedParams | null = null;

	/** Simulated open markdown files (vault-relative paths). */
	readonly files: Set<string> = new Set();

	/** Capture of every openFile() call, in order. */
	readonly opened: string[] = [];

	private readonly _workspaceRoot: string;

	constructor(workspaceRoot = "") {
		this._workspaceRoot = workspaceRoot;
	}

	/** Test helper — set or clear the active selection. */
	setActiveSelection(params: SelectionChangedParams | null): void {
		this.activeSelection = params;
	}

	getCurrentSelection(): SelectionChangedParams | null {
		return this.activeSelection;
	}

	getOpenEditors(): { filePath: string; isDirty: false }[] {
		return [...this.files].map((filePath) => ({ filePath, isDirty: false as const }));
	}

	openFile(vaultRelativePath: string): void {
		this.opened.push(vaultRelativePath);
	}

	workspaceRoot(): string {
		return this._workspaceRoot;
	}
}
