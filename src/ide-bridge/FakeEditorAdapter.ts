/**
 * FakeEditorAdapter — in-memory EditorAdapter for tests.
 *
 * Implements EditorAdapter with settable state so unit tests can exercise
 * tool and tracker logic without a live Obsidian instance (Constitution L1/L3).
 * Mirrors the FakeVaultFS pattern: lives in src/ alongside the production
 * adapter so the interface and fake travel together, but is never imported
 * by the production graph (main.ts → ...).
 */

import type { EditorAdapter } from "./ObsidianEditorAdapter";
import type { SelectionChangedParams } from "./protocol";

export class FakeEditorAdapter implements EditorAdapter {
	/** Settable active selection. null means no active MarkdownView. */
	private activeSelection: SelectionChangedParams | null = null;

	/** Simulated open markdown files (vault-relative paths). */
	readonly files: Set<string> = new Set();

	/** Capture of every openFile() call, in order. */
	readonly opened: string[] = [];

	constructor(private readonly workspaceRootValue = "") {}

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
		return this.workspaceRootValue;
	}
}
