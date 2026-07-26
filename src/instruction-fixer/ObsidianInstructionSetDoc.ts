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
 *
 * ADR-9 — single writer: `save()` does NOT stringify the in-memory document
 * over the file. It diffs the edited model against the pristine snapshot
 * taken at `load()` and applies the resulting per-action field patches
 * through `markActionFields`, the executor's own atomic `processJSON` path.
 * A whole-document write would revert any `applied: true` the executor
 * flushed in the load→save window, breaking the monotonic-`applied`
 * guarantee that makes re-runs idempotent (a reverted flag = the action runs
 * twice). Patching also *strengthens* the verbatim round-trip: untouched
 * fields ride along from the current on-disk document by construction,
 * instead of being replayed from a possibly-stale snapshot.
 */

import { Notice } from "obsidian";

import { markActionFields } from "../executor/jsonAppliedWriter.js";
import type { Action, InstructionSet } from "../schema/types.js";
import { validate } from "../schema/validator.js";
import type {
	InstructionFixerModel,
	InstructionSetDoc,
} from "../vault/InstructionSetDoc.js";
import type { VaultFS } from "../vault/VaultFS.js";

/** One action's changed fields, as handed to `markActionFields`. */
interface ActionPatch {
	readonly actionId: string;
	readonly patch: Partial<Action>;
}

export class ObsidianInstructionSetDoc implements InstructionSetDoc {
	// Stateful — one active doc at a time. Set by load(), read by save() so
	// the caller never has to re-pass the path.
	private docPath: string | null = null;

	// Pristine deep copy of the document as loaded — the baseline save()
	// diffs against to derive its field patches. Adapter-private on purpose:
	// the SDD pins `InstructionFixerModel` to `{doc, dirty}`, so change
	// tracking cannot live on the model. Advanced after every successful
	// save so a second save only writes what changed since the first.
	private pristine: InstructionSet | null = null;

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
		this.pristine = deepCopy(result.data);
		return { doc: result.data, dirty: false };
	}

	async save(model: InstructionFixerModel): Promise<void> {
		// Dirty gate: an untouched doc stays byte-stable. This function never
		// assigns to `model` on any path, success or failure — "rebuild-and-
		// replace" is free.
		if (!model.dirty) return;
		const { docPath, pristine } = this.requireActiveDoc();

		// PRD F4-AC2 / SDD "Error Handling": validate the WHOLE edited document
		// before touching the file, so an invalid edit is rejected with the
		// validator's message rather than written and only discovered on the
		// next load(). No Notice here — this is a caller-visible rejection the
		// view renders next to the pending edit; `notify` stays reserved for
		// I/O failures, which have no other channel.
		const result = validate(model.doc);
		if (!result.ok) {
			throw new Error(
				`ObsidianInstructionSetDoc.save(${docPath}): ${result.message}`,
			);
		}

		// ADR-7: no courtesy `.md` write — the JSON wire is the only write, and
		// the `.md` peer's `tomo.sources` block is never touched.
		const patches = this.derivePatches(pristine, model.doc, docPath);

		try {
			// Serialized per-path by processJSON, so N patches = N atomic
			// cycles rather than one — acceptable because a repair session
			// touches a handful of actions, and it keeps the Fixer on the
			// executor's single write path (ADR-9) instead of forking a
			// batched variant.
			//
			// Atomicity is therefore per ACTION, not per save: if patch #k
			// throws, patches 1..k-1 have already landed. That leaves the
			// document schema-valid but only partially repaired — never
			// corrupt — and it is deliberately recoverable rather than
			// rolled back: `pristine` is NOT advanced below on the throw
			// path, so it still describes the state the pending edits were
			// computed against. Re-saving the same (still-dirty) model
			// re-derives ALL patches; the ones that already landed rewrite
			// identical values and the failed one finally applies, so a
			// retry converges. Reloading recovers just as cleanly, since
			// load() re-baselines `pristine` on what is actually on disk.
			for (const { actionId, patch } of patches) {
				await markActionFields(this.vault, docPath, actionId, patch);
			}
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			this.notify(`Could not save instruction set to ${docPath}: ${reason}`);
			throw err;
		}

		this.pristine = deepCopy(model.doc);
	}

	/**
	 * Diff the edited document against the load-time snapshot into one patch
	 * per changed action.
	 *
	 * Only per-action field edits are writable (ADR-5/ADR-6 — the Fixer's whole
	 * edit surface is `setTargetField`). Anything structural (a changed
	 * top-level field, an added/removed/reordered action) is rejected loudly
	 * rather than silently dropped: a save that reports success while losing
	 * the edit is the failure mode `markActionFields`'s own no-match throw
	 * exists to prevent.
	 */
	private derivePatches(
		pristine: InstructionSet,
		next: InstructionSet,
		docPath: string,
	): ActionPatch[] {
		const changedTopLevel = topLevelChanges(pristine, next);
		if (changedTopLevel.length > 0) {
			throw unsupportedEdit(docPath, `top-level field(s) ${changedTopLevel.join(", ")}`);
		}
		if (pristine.actions.length !== next.actions.length) {
			throw unsupportedEdit(docPath, "the number of actions");
		}

		const patches: ActionPatch[] = [];
		for (const [index, after] of next.actions.entries()) {
			const before = pristine.actions[index];
			if (before === undefined) throw unsupportedEdit(docPath, "the number of actions");
			if (before.id !== after.id) {
				throw unsupportedEdit(docPath, `the action at index ${index} (id changed)`);
			}
			const patch = fieldDiff(before, after);
			if (patch !== null) patches.push({ actionId: after.id, patch });
		}
		return patches;
	}

	/** `docPath` + `pristine` are always set together by load(), so one guard covers both. */
	private requireActiveDoc(): { docPath: string; pristine: InstructionSet } {
		if (this.docPath === null || this.pristine === null) {
			throw new Error(
				"ObsidianInstructionSetDoc.save(): no active document — call load() first",
			);
		}
		return { docPath: this.docPath, pristine: this.pristine };
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
}

// ---------------------------------------------------------------------------
// Change derivation helpers — pure, module-local. No upsert/`create` path:
// `save()` only ever patches a document a prior `load()` read off disk, so the
// file is known to exist and `processJSON` is always the right primitive.
// ---------------------------------------------------------------------------

/**
 * JSON deep copy — the document is JSON by definition (it round-trips through
 * the wire file), so this is total, and it keeps the snapshot immune to later
 * in-place mutation of the returned model.
 */
function deepCopy(set: InstructionSet): InstructionSet {
	return JSON.parse(JSON.stringify(set)) as InstructionSet;
}

/** Names of the non-`actions` top-level fields that differ between the two documents. */
function topLevelChanges(before: InstructionSet, after: InstructionSet): string[] {
	const b = before as unknown as Record<string, unknown>;
	const a = after as unknown as Record<string, unknown>;
	const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
	keys.delete("actions");
	return [...keys].filter((key) => !deepEqual(b[key], a[key]));
}

/**
 * The changed fields of one action, or null when nothing changed. A key
 * dropped by the edit maps to `undefined`, which `markActionFields` spreads
 * over the on-disk action and JSON.stringify then omits.
 */
function fieldDiff(before: Action, after: Action): Partial<Action> | null {
	const b = before as unknown as Record<string, unknown>;
	const a = after as unknown as Record<string, unknown>;
	const patch: Record<string, unknown> = {};
	let changed = false;
	for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
		if (deepEqual(b[key], a[key])) continue;
		patch[key] = a[key];
		changed = true;
	}
	return changed ? (patch as Partial<Action>) : null;
}

/**
 * Structural deep equality over JSON values. Hand-rolled rather than
 * `JSON.stringify` comparison so key ORDER differences don't register as
 * edits — a spurious patch would rewrite a field the user never touched.
 */
function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a === null || b === null) return false;
	if (typeof a !== "object" || typeof b !== "object") return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((item, i) => deepEqual(item, b[i]));
	}
	const ao = a as Record<string, unknown>;
	const bo = b as Record<string, unknown>;
	const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
	for (const key of keys) if (!deepEqual(ao[key], bo[key])) return false;
	return true;
}

function unsupportedEdit(docPath: string, what: string): Error {
	return new Error(
		`ObsidianInstructionSetDoc.save(${docPath}): unsupported edit — the Fixer writes ` +
			`per-action field patches only (ADR-9), but ${what} changed since load()`,
	);
}
