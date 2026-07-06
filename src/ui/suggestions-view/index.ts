/**
 * Public surface of the suggestions-view module — the registered view-type
 * id, the view class, and the tab contract later tab tasks (T3.2/T3.5/T3.6/
 * T3.7) build to. Mirrors `src/ui/chat-view/index.ts`'s re-export shape.
 *
 * Spec refs: spec-004 SDD §3; plan/phase-3.md T3.1.
 */

export const VIEW_TYPE_SUGGESTIONS_EDITOR = "miyo-suggestions-editor";

export {
	SuggestionsEditorView,
	type SuggestionsEditorViewDeps,
} from "./SuggestionsEditorView.js";
export type { EditorTab, TabContext } from "./tabContract.js";
export { DEFAULT_TABS } from "./tabs/defaultTabs.js";
export { openSuggestionsEditor } from "./openSuggestionsEditor.js";
