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

/**
 * One loaded document: where it lives, and the pristine deep copy `save()`
 * diffs against to derive its field patches.
 *
 * Adapter-private on purpose — the SDD pins `InstructionFixerModel` to
 * `{doc, dirty}`, so change tracking cannot live on the model. `pristine`
 * advances in place after each successful save (a second save then only writes
 * what changed since the first), while the TOKEN ITSELF stays put for the whole
 * life of one `load()` — so holding a reference to it is the same thing as
 * holding onto that particular load.
 */
interface ActiveDoc {
	readonly docPath: string;
	pristine: InstructionSet;
}

/**
 * Every rejection `save()` produces, carrying HOW MUCH of the save landed
 * (spec-006 T3.1 review).
 *
 * Why the count is on the error: `save()` writes one atomic patch per changed
 * action, so a rejection can mean either "nothing was written" (no active doc,
 * schema-invalid document, or a structural edit the patch path can't express —
 * all of which reject before the write loop starts) or "k of n patches landed,
 * retry to finish". Only this adapter knows which, because only it knows where
 * in the loop it was. The view has to tell the user, and it must not re-derive
 * the answer from a second copy of this invariant — that copy would drift.
 *
 * `landedPatchCount === 0` therefore means "the document on disk is exactly as
 * it was"; anything higher means the set is partially repaired (always
 * schema-valid) and re-saving the same still-dirty model converges.
 */
export class InstructionSetSaveError extends Error {
	/** Patches that were written before the failure. 0 = nothing landed. */
	readonly landedPatchCount: number;
	/** Patches this save had to write. 0 when the failure preceded derivation. */
	readonly totalPatchCount: number;
	/** The underlying failure, when this error wraps one (the write-loop case). */
	readonly reason: unknown;

	constructor(
		message: string,
		landedPatchCount: number,
		totalPatchCount: number,
		reason?: unknown,
	) {
		super(message);
		this.name = "InstructionSetSaveError";
		this.landedPatchCount = landedPatchCount;
		this.totalPatchCount = totalPatchCount;
		this.reason = reason;
	}
}

export class ObsidianInstructionSetDoc implements InstructionSetDoc {
	/**
	 * The one active document, replaced wholesale by every `load()` — never
	 * mutated in place, which is what makes the replacement observable.
	 *
	 * `save()` captures this token at entry and works through the capture for
	 * the rest of its run, so a save still in flight when the view retargets
	 * the leaf can neither write to the new document nor advance its baseline:
	 * the token it holds is simply no longer anyone's (T3.1 review). This is
	 * per-LOAD, not per-path — a retarget can legitimately land back on the
	 * same `docPath`, and that reload is still a different baseline.
	 */
	private active: ActiveDoc | null = null;

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
		// A FRESH token per load — never a mutation of the previous one, so an
		// in-flight save still holds (and can still recognise) the document it
		// was started against.
		this.active = { docPath, pristine: deepCopy(result.data) };
		return { doc: result.data, dirty: false };
	}

	async save(model: InstructionFixerModel): Promise<void> {
		// Dirty gate: an untouched doc stays byte-stable. This function never
		// assigns to `model` on any path, success or failure — "rebuild-and-
		// replace" is free.
		if (!model.dirty) return;
		// Bound at entry: everything below targets THIS document, whatever the
		// adapter is pointed at by the time the awaits resolve.
		const active = this.requireActiveDoc();
		const { docPath, pristine } = active;

		// PRD F4-AC2 / SDD "Error Handling": validate the WHOLE edited document
		// before touching the file, so an invalid edit is rejected with the
		// validator's message rather than written and only discovered on the
		// next load(). No Notice here — this is a caller-visible rejection the
		// view renders next to the pending edit; `notify` stays reserved for
		// I/O failures, which have no other channel.
		const result = validate(model.doc);
		if (!result.ok) {
			throw new InstructionSetSaveError(
				`ObsidianInstructionSetDoc.save(${docPath}): ${result.message}`,
				0,
				0,
			);
		}

		// ADR-7: no courtesy `.md` write — the JSON wire is the only write, and
		// the `.md` peer's `tomo.sources` block is never touched.
		const patches = this.derivePatches(pristine, model.doc, docPath);

		// Counts patches that actually reached disk, so the rejection below can
		// state how much of the save landed instead of leaving the caller to
		// guess (see InstructionSetSaveError).
		let landed = 0;
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
				landed += 1;
			}
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			this.notify(`Could not save instruction set to ${docPath}: ${reason}`);
			// Re-thrown as an InstructionSetSaveError carrying `landed` — this is
			// the only point in the system that knows how much of the save reached
			// disk. The message stays the underlying failure's, verbatim, so the
			// user still sees what actually went wrong.
			throw new InstructionSetSaveError(reason, landed, patches.length, err);
		}

		// Advance the baseline through the token captured at entry, never through
		// `this` — that is the whole invariant. A `load()` landing mid-save
		// replaces `this.active` wholesale, which orphans this token, so the
		// advance is then inert by construction and the newly-loaded document
		// keeps the baseline its own `load()` installed. Assigning to
		// `this.pristine` instead would leave the NEW document diffing against
		// the OLD one's content — deriving patches for fields the user never
		// edited, or rejecting every further save until a reload.
		active.pristine = deepCopy(model.doc);
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

	/**
	 * The active document's token — path and baseline in one object, so a
	 * caller binds both at once and cannot later drift onto a different
	 * document's state by reading `this` again.
	 */
	private requireActiveDoc(): ActiveDoc {
		const active = this.active;
		if (active === null) {
			throw new InstructionSetSaveError(
				"ObsidianInstructionSetDoc.save(): no active document — call load() first",
				0,
				0,
			);
		}
		return active;
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

/**
 * Rejects a schema-VALID edit that the per-action patch path still cannot
 * express. Raised by `derivePatches`, i.e. strictly before the write loop —
 * hence `landedPatchCount: 0`, which is what lets the view say "nothing was
 * written" instead of inviting a retry that cannot help.
 */
function unsupportedEdit(docPath: string, what: string): InstructionSetSaveError {
	return new InstructionSetSaveError(
		`ObsidianInstructionSetDoc.save(${docPath}): unsupported edit — the Fixer writes ` +
			`per-action field patches only (ADR-9), but ${what} changed since load()`,
		0,
		0,
	);
}
