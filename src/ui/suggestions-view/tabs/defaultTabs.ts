/**
 * The Suggestions Editor's default tab set. Order (owner pre-live refinement):
 * **Daily, Suggestions, Proposed MOCs, Tag-Handler** — Daily leads because it
 * is the most-reviewed surface in a live run, and the view activates the first
 * tab by default (`SuggestionsEditorView` uses `tabs[0]`), so Daily also opens
 * active.
 */

import type { EditorTab } from "../tabContract.js";

import { DailyTab } from "./DailyTab.js";
import { ProposedMocsTab } from "./ProposedMocsTab.js";
import { SuggestionsTab } from "./SuggestionsTab.js";
import { TagHandlerTab } from "./TagHandlerTab.js";

export const DEFAULT_TABS: readonly EditorTab[] = [
	new DailyTab(),
	new SuggestionsTab(),
	new ProposedMocsTab(),
	new TagHandlerTab(),
];
