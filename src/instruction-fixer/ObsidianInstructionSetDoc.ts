/**
 * ObsidianInstructionSetDoc — the real InstructionSetDoc adapter (spec-006
 * Phase 1, T1.1; SDD ADR-1/ADR-2/ADR-7).
 *
 * Mirrors src/garden-audit/ObsidianGardenAuditDoc.ts's load->validate->
 * `{doc,dirty}` / dirty-gated-save shape exactly: ADR-1 reuses the EXISTING
 * instruction wire/validator (`src/schema/types.ts`, `src/schema/validator.ts`)
 * as-is — no new editor wire, no schema_version bump. ADR-7: there is no
 * sibling `.md` write — `save()` persists the JSON wire only and never
 * touches the `.md` peer or its `tomo.sources` block.
 *
 * Depends on the `VaultFS` port (constructor-injected), never on raw
 * `app.vault` — keeps this unit-testable against `FakeVaultFS` without a
 * real Obsidian app (Constitution L1). The only `obsidian` import is
 * `Notice`, and even that is injectable so tests never need the real
 * Obsidian `Notice`.
 *
 * One adapter instance per open document (mirrors the garden-audit editor's
 * "one active doc" convention). `save()` writes to the most-recently-loaded
 * `docPath` — `InstructionFixerModel` carries no path identity of its own,
 * so the caller (the editor view) owns the single-active-doc invariant.
 */

import { Notice } from "obsidian";

import type { InstructionSet } from "../schema/types.js";
import { validate } from "../schema/validator.js";
import type {
	InstructionFixerModel,
	InstructionSetDoc,
} from "../vault/InstructionSetDoc.js";
import type { VaultFS } from "../vault/VaultFS.js";

export class ObsidianInstructionSetDoc implements InstructionSetDoc {
	// Stateful — one active doc at a time. Set by load(), read by save() so
	// the caller never has to re-pass the path.
	private docPath: string | null = null;

	constructor(
		private readonly vault: VaultFS,
		private readonly notify: (msg: string) => void = (m) => {
			new Notice(m);
		},
	) {}

	async load(docPath: string): Promise<{ doc: InstructionSet; dirty: false }> {
		const raw = await this.readAndParse(docPath);
		const result = validate(raw);
		if (!result.ok) {
			// Fail loud (Constitution L1 denial path) — this adapter's job is
			// only to refuse to hand back a doc that doesn't match the pinned
			// wire schema.
			throw new Error(`ObsidianInstructionSetDoc.load(${docPath}): ${result.message}`);
		}
		this.docPath = docPath;
		return { doc: result.data, dirty: false };
	}

	async save(model: InstructionFixerModel): Promise<void> {
		// Dirty gate: an untouched doc stays byte-stable. This function never
		// assigns to `model` on any path, success or failure — "rebuild-and-
		// replace" is free.
		if (!model.dirty) return;
		const docPath = this.requireActiveDocPath();

		// ADR-7: no courtesy `.md` write — the JSON wire is the only write,
		// and the `.md` peer's `tomo.sources` block is never touched. `doc`
		// is written VERBATIM — own the whole document (additionalProperties
		// is false on every action and at the top level, so a dropped field
		// would fail re-validation on the next load).
		const toWrite: InstructionSet = { ...model.doc };
		const json = JSON.stringify(toWrite, null, 2) + "\n";

		try {
			await this.writeFile(docPath, json);
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			this.notify(`Could not save instruction set to ${docPath}: ${reason}`);
			throw err;
		}
	}

	private requireActiveDocPath(): string {
		if (this.docPath === null) {
			throw new Error(
				"ObsidianInstructionSetDoc.save(): no active document — call load() first",
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
				`ObsidianInstructionSetDoc.load(${docPath}): invalid JSON — ${reason}`,
			);
		}
	}

	/**
	 * Upsert write: `VaultFS.process` requires the file to already exist and
	 * `VaultFS.create` requires that it does NOT — there is no single upsert
	 * primitive on the port (same gotcha as ObsidianGardenAuditDoc).
	 */
	private async writeFile(path: string, content: string): Promise<void> {
		if (await this.vault.exists(path)) await this.vault.process(path, () => content);
		else await this.vault.create(path, content);
	}
}
