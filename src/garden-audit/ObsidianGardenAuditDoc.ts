/**
 * ObsidianGardenAuditDoc — the real GardenAuditDoc adapter (spec-005 Phase 2,
 * T2.1; SDD ADR-2/ADR-6).
 *
 * Mirrors src/suggestions/ObsidianSuggestionsDoc.ts's load→validate→
 * `{doc,dirty}` / dirty-gated-save shape exactly, with one deliberate
 * divergence (ADR-6): there is no sibling `.md` write in v1 — `save()`
 * persists the JSON wire only.
 *
 * Depends on the `VaultFS` port (constructor-injected), never on raw
 * `app.vault` — keeps this unit-testable against `FakeVaultFS` without a
 * real Obsidian app (Constitution L1). The only `obsidian` import is
 * `Notice`, and even that is injectable so tests never need the real
 * Obsidian `Notice`.
 *
 * One adapter instance per open document (mirrors the suggestions editor's
 * "one active doc" convention). `save()` writes to the most-recently-loaded
 * `docPath` — `GardenAuditModel` carries no path identity of its own, so the
 * caller (the editor view) owns the single-active-doc invariant.
 */

import { Notice } from "obsidian";

import type { GardenAuditModel, GardenAuditWire } from "../types/garden-audit.js";
import { validate } from "../schema/garden-audit-validator.js";
import type { GardenAuditDoc } from "../vault/GardenAuditDoc.js";
import type { VaultFS } from "../vault/VaultFS.js";

export class ObsidianGardenAuditDoc implements GardenAuditDoc {
	// Stateful — one active doc at a time. Set by load(), read by save() so
	// the caller never has to re-pass the path.
	private docPath: string | null = null;

	constructor(
		private readonly vault: VaultFS,
		private readonly notify: (msg: string) => void = (m) => {
			new Notice(m);
		},
	) {}

	async load(docPath: string): Promise<GardenAuditModel> {
		const raw = await this.readAndParse(docPath);
		const result = validate(raw);
		if (!result.ok) {
			// Fail loud (Constitution L1 denial path) — this adapter's job is
			// only to refuse to hand back a doc that doesn't match the pinned
			// wire schema.
			throw new Error(`ObsidianGardenAuditDoc.load(${docPath}): ${result.message}`);
		}
		this.docPath = docPath;
		return { doc: result.data, dirty: false };
	}

	async save(model: GardenAuditModel): Promise<void> {
		// Dirty gate: an untouched doc stays byte-stable. This function never
		// assigns to `model` on any path, success or failure — "rebuild-and-
		// replace" is free.
		if (!model.dirty) return;
		const docPath = this.requireActiveDocPath();

		// ADR-6: no courtesy `.md` write in v1 — the JSON wire is the only
		// write. ADR-2 (2026-07-24 suggest_pending gate): the adapter writes
		// `model.doc` VERBATIM — the view now owns `approved`/`suggest_pending`
		// (GardenAuditEditorView.handleSave, via transforms.applyApprovalGate),
		// mirroring how normalizeBrokenUpActions already lives in the view, not
		// here. emit_digest and every other read-only/passthrough field ride
		// along verbatim because this function never touches them.
		const toWrite: GardenAuditWire = { ...model.doc };
		const json = JSON.stringify(toWrite, null, 2) + "\n";

		try {
			await this.writeFile(docPath, json);
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			this.notify(`Could not save garden-audit to ${docPath}: ${reason}`);
			throw err;
		}
	}

	private requireActiveDocPath(): string {
		if (this.docPath === null) {
			throw new Error(
				"ObsidianGardenAuditDoc.save(): no active document — call load() first",
			);
		}
		return this.docPath;
	}

	private async readAndParse(docPath: string): Promise<unknown> {
		const text = await this.vault.read(docPath);
		try {
			return JSON.parse(text);
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			throw new Error(
				`ObsidianGardenAuditDoc.load(${docPath}): invalid JSON — ${reason}`,
			);
		}
	}

	/**
	 * Upsert write: `VaultFS.process` requires the file to already exist and
	 * `VaultFS.create` requires that it does NOT — there is no single upsert
	 * primitive on the port (same gotcha as ObsidianSuggestionsDoc).
	 */
	private async writeFile(path: string, content: string): Promise<void> {
		if (await this.vault.exists(path)) await this.vault.process(path, () => content);
		else await this.vault.create(path, content);
	}
}
