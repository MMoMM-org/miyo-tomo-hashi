/**
 * Public surface of the instruction-fixer view module — the registered
 * view-type id, the view class, the card contract T3.2 builds to, the opener,
 * and the Phase-2 outcome source. Mirrors
 * `src/ui/garden-audit-view/index.ts`'s re-export shape.
 */

export const VIEW_TYPE_INSTRUCTION_FIXER = "miyo-instruction-fixer";

export {
	InstructionFixerView,
	type InstructionFixerViewDeps,
} from "./InstructionFixerView.js";
export type { FixerCardContext, FixerCardRenderer } from "./fixerContract.js";
export { openInstructionFixer } from "./openInstructionFixer.js";
export {
	editGate,
	NO_TRUSTED_SIGNAL,
	resolveOutcomes,
	type ActionId,
	type EditGateResult,
	type OutcomeResolution,
	type OutcomeSourceDeps,
} from "./outcomeSource.js";
