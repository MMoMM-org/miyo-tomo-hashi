/**
 * The card-render contract for the Instruction Fixer (spec-006 Phase 3, T3.1).
 * Mirrors `src/ui/garden-audit-view/tabContract.ts`'s `TabContext`/`TabSpec`
 * idiom, narrowed to what this view actually needs.
 *
 * Where the seam sits — the split is "view owns what the OUTCOME says, the card
 * owns what the KIND says":
 *
 *   - `InstructionFixerView` renders the section grouping, each card's shell
 *     and header (`I07 · link_to_moc`, the outcome badge, the frozen/read-only
 *     tag) and the outcome's failure reason. All of that is derived from the
 *     Phase-2 outcome resolution + gate, which only the view holds.
 *   - The `FixerCardRenderer` (T3.2) fills the card BODY: the plain-text intent
 *     line, the per-kind `TargetControl` fields, and the note link. All of that
 *     is derived from `action.action`, which only the card dispatcher knows.
 *
 * There is exactly ONE renderer for every kind (dispatch happens inside it),
 * so this is a single injected collaborator rather than a registry — the same
 * shape as the garden-audit editor's single `tab` dep, and the same reason:
 * it is the view's one test seam.
 */

import type { App } from "obsidian";

import type { ActionOutcome } from "../../executor/state.js";
import type { Action } from "../../schema/types.js";
import type { InstructionFixerModel } from "../../vault/InstructionSetDoc.js";

import type { EditGateResult } from "./outcomeSource.js";

/** Per-card context handed to the renderer's `render()`. */
export interface FixerCardContext {
	/** For pickers (T3.2's `TargetControl`) and note navigation. */
	readonly app: App;
	/**
	 * This action's fail-closed edit gate (ADR-4). `editable` is the ONLY value
	 * that may expose a writable control; everything else renders read-only.
	 * Always derived from THIS action's own `applied` flag — never a sibling's.
	 */
	readonly gate: EditGateResult;
	/**
	 * The trusted outcome for this action, or `null` when there is none (never
	 * attempted, or no trusted signal at all). The view already renders the
	 * badge + failure reason from it; the card gets it for any kind-specific
	 * detail it wants to add.
	 */
	readonly outcome: ActionOutcome | null;
	/**
	 * Dispatches a domain transform through the view's
	 * `Store<InstructionFixerModel>`. A transform returning the SAME model
	 * reference is a no-op (store convention — see `src/util/store.ts` and
	 * `src/instruction-fixer/transforms.ts`): no re-render, no dirty flip.
	 */
	apply(transform: (model: InstructionFixerModel) => InstructionFixerModel): void;
}

/** Renders one action's card body. Implemented by T3.2's `renderActionCard`. */
export interface FixerCardRenderer {
	render(body: HTMLElement, action: Action, ctx: FixerCardContext): void;
}
