/**
 * The Suggestions Editor's default tab set, in SDD §3 table order:
 * Suggestions, Proposed MOCs, Daily, Tag-Handler. Each task T3.2/T3.5/T3.6/
 * T3.7 replaces its own stub file in place — this list doesn't change shape,
 * only which class each entry points at.
 */

import type { EditorTab } from "../tabContract.js";

import { DailyTab } from "./DailyTab.js";
import { ProposedMocsTab } from "./ProposedMocsTab.js";
import { SuggestionsTab } from "./SuggestionsTab.js";
import { TagHandlerTab } from "./TagHandlerTab.js";

export const DEFAULT_TABS: readonly EditorTab[] = [
	new SuggestionsTab(),
	new ProposedMocsTab(),
	new DailyTab(),
	new TagHandlerTab(),
];
