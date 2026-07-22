/**
 * GardenAuditEditorView — PLACEHOLDER leaf `ItemView` for the Garden-Audit
 * Editor (spec-005 Phase 3, T3.3). This is JUST enough scaffolding for
 * `registerView` + `openGardenAuditEditor` to work end-to-end — the leaf
 * opens without error and tracks its `docPath` via Obsidian's view-state
 * mechanism. The real tab UI (findings grouped by tier, Apply + target
 * control + candidates + suggest toggle — SDD "Runtime View") is built in
 * Phase 4; this file is expected to grow substantially there.
 *
 * Mirrors SuggestionsEditorView's constructor/deps/setState shape (adapter
 * injected, docPath optional + settable later via `setState`) so Phase 4
 * can extend this in place rather than re-plumb the view-state wiring.
 */

import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";

import type { GardenAuditDoc } from "../../vault/GardenAuditDoc.js";

import { VIEW_TYPE_GARDEN_AUDIT_EDITOR } from "./index.js";

export interface GardenAuditEditorViewDeps {
	/** The only wire-aware collaborator — owns all JSON/vault I/O. Unused by
	 * this Phase-3 placeholder; Phase 4 wires load/save through it. */
	readonly adapter: GardenAuditDoc;
	/**
	 * Vault-relative path of the `_garden-audit.json` document to open.
	 * Optional — production leaves this unset and supplies the path later via
	 * `setState` (mirrors SuggestionsEditorView's registerView-factory gotcha:
	 * the factory signature is `(leaf) => View`, so it cannot receive a
	 * per-open docPath).
	 */
	readonly docPath?: string;
}

/** Narrow, defensive read of `state.docPath` — never throws on a malformed state. */
function extractDocPath(state: unknown): string | null {
	if (typeof state !== "object" || state === null) return null;
	const docPath = (state as Record<string, unknown>).docPath;
	return typeof docPath === "string" ? docPath : null;
}

export class GardenAuditEditorView extends ItemView {
	private docPath: string;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly deps: GardenAuditEditorViewDeps,
	) {
		super(leaf);
		this.docPath = deps.docPath ?? "";
	}

	override getViewType(): string {
		return VIEW_TYPE_GARDEN_AUDIT_EDITOR;
	}

	override getDisplayText(): string {
		return "Garden-audit editor";
	}

	override getIcon(): string {
		return "list-checks";
	}

	override async onOpen(): Promise<void> {
		this.render();
	}

	override getState(): Record<string, unknown> {
		return { docPath: this.docPath };
	}

	override async setState(
		state: unknown,
		_result: ViewStateResult,
	): Promise<void> {
		const docPath = extractDocPath(state);
		if (docPath !== null) this.docPath = docPath;
		this.render();
	}

	// Phase-4 placeholder — real tab UI (tier sections, finding cards, Save/
	// Revert chrome) lands there, mirroring SuggestionsEditorView's render().
	// This renders just enough to prove the leaf opened for the right doc.
	private render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("hashi-garden-audit-editor-view");
		root.createEl("p", {
			text: this.docPath === ""
				? "No garden-audit document chosen yet."
				: `Garden-audit editor (Phase 4 pending) — ${this.docPath}`,
		});
	}
}
