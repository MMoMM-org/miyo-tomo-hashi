/**
 * Opening a target-note picker (spec-006 follow-up, user request 2026-07-27
 * b + c) — the async half the card cannot do inline: resolve the action's
 * target note, read it, derive the rows, then show the modal.
 *
 * Split out of `renderActionCard` because rendering is synchronous and this is
 * not: the read happens on the CLICK, never at render time. Reading every
 * card's target note up front would mean N file reads to draw a set the user
 * may not edit at all, and the content would be stale by the time a button was
 * pressed anyway.
 *
 * Reads through `vault.cachedRead` — Obsidian's read-only path — and derives
 * the rows from that content, never from the metadataCache. The cache rebuilds
 * asynchronously after every write, so a picker opened right after a repair
 * lands could otherwise enumerate the structure the note had BEFORE it
 * [miyo-tomo-hashi#68].
 *
 * Every failure ends in a `Notice` naming the target, because all of them mean
 * the same thing to the user — "there is nothing to pick from, and here is
 * which note is missing" — and silence at that point reads as a dead button.
 */

import { Notice, TFile, type App } from "obsidian";

import {
	computeAnchorSpots,
	computeFrontmatterProperties,
	computeMarkerSpots,
	spotSourcePath,
	type AnchorSpot,
	type AnchorSpotKind,
	type FrontmatterProperty,
	type MarkerSpot,
} from "../../../instruction-fixer/noteSpots.js";
import type { Action } from "../../../schema/types.js";

import {
	AnchorSpotPicker,
	FrontmatterPropertyPicker,
	MarkerSpotPicker,
} from "./SpotPickers.js";

/**
 * The action's target note content, or null when it cannot be read.
 *
 * `getFirstLinkpathDest` resolves both shapes the wire uses — a full path and a
 * bare stem (`link_to_moc.target_moc`) — which a plain `getAbstractFileByPath`
 * would not. Guarded by `typeof` so a host or mock without the method degrades
 * to "not found" rather than throwing, the same defence `noteNavigation.ts`
 * uses for the note links.
 */
async function readTargetNote(app: App, linktext: string): Promise<string | null> {
	if (typeof app.metadataCache.getFirstLinkpathDest !== "function") return null;
	const file = app.metadataCache.getFirstLinkpathDest(linktext, "");
	if (!(file instanceof TFile)) return null;
	try {
		return await app.vault.cachedRead(file);
	} catch {
		return null;
	}
}

/** Resolve + read + report — the shared preamble of both openers. */
async function targetContent(app: App, action: Action): Promise<string | null> {
	const path = spotSourcePath(action);
	if (path === null) return null;
	const content = await readTargetNote(app, path);
	if (content === null) {
		new Notice(`Can't read the target note: ${path}`);
		return null;
	}
	return content;
}

/**
 * Opens the anchor picker for `action`. `onPick` receives a row whose type,
 * value and placement are already a legal combination for `kind` — see
 * `noteSpots.placementsFor`.
 */
export async function openAnchorSpotPicker(
	app: App,
	action: Action,
	kind: AnchorSpotKind,
	onPick: (spot: AnchorSpot) => void,
): Promise<void> {
	const content = await targetContent(app, action);
	if (content === null) return;
	new AnchorSpotPicker(app, computeAnchorSpots(content, kind), onPick).open();
}

/** Opens the `add_relationship` marker picker for `action`. */
export async function openMarkerSpotPicker(
	app: App,
	action: Action,
	onPick: (spot: MarkerSpot) => void,
): Promise<void> {
	const content = await targetContent(app, action);
	if (content === null) return;
	new MarkerSpotPicker(app, computeMarkerSpots(content), onPick).open();
}

// ---------------------------------------------------------------------------
// edit_frontmatter — property picker and value refresh (2026-09-01)
// ---------------------------------------------------------------------------

/**
 * The target note's PARSED frontmatter, or null when it cannot be resolved.
 *
 * Reads the metadata cache rather than parsing content: Obsidian has already
 * done the YAML work, and this is a user-driven affordance where the staleness
 * risk that matters on the write path (the #68 rebuild race) does not — the
 * user sees the value in the row before committing it. `undefined` from the
 * cache means the note has no frontmatter block, which is a real answer and
 * distinct from "could not resolve the note at all".
 */
function targetFrontmatter(
	app: App,
	action: Action,
): { readonly fm: Record<string, unknown> | undefined } | null {
	const path = spotSourcePath(action);
	if (path === null) return null;
	if (typeof app.metadataCache.getFirstLinkpathDest !== "function") return null;
	const file = app.metadataCache.getFirstLinkpathDest(path, "");
	if (!(file instanceof TFile)) {
		new Notice(`Can't read the target note: ${path}`);
		return null;
	}
	const cache = app.metadataCache.getFileCache(file);
	return { fm: cache?.frontmatter };
}

/**
 * Opens the frontmatter property picker for `action`.
 *
 * A note with no frontmatter reports a notice instead of an empty modal — the
 * same call the other pickers make for an unresolvable target, and for the same
 * reason: an empty list reads as "this note has nothing to offer" when the
 * truth is "this note has no such block", and the user would be left guessing
 * which.
 */
export function openFrontmatterPropertyPicker(
	app: App,
	action: Action,
	onPick: (property: FrontmatterProperty) => void,
): void {
	const resolved = targetFrontmatter(app, action);
	if (resolved === null) return;

	const properties = computeFrontmatterProperties(resolved.fm);
	if (properties.length === 0) {
		new Notice("That note has no frontmatter properties yet");
		return;
	}
	new FrontmatterPropertyPicker(app, properties, onPick).open();
}

/**
 * Reads the CURRENT value of the property `action` already names, for the
 * `expected` refresh. No modal — one click, one field.
 *
 * `present` is reported separately from `current` because an absent key is not
 * a key holding null: `expected: null` is the wire's "must not exist"
 * sentinel, and collapsing the two here would make a refresh against a deleted
 * key indistinguishable from one against an explicit null.
 */
export function readFrontmatterExpected(
	app: App,
	action: Action,
): { readonly current: unknown; readonly present: boolean } | null {
	const resolved = targetFrontmatter(app, action);
	if (resolved === null) return null;
	if (action.action !== "edit_frontmatter") return null;

	const fm = resolved.fm;
	const present =
		fm !== undefined && Object.prototype.hasOwnProperty.call(fm, action.property);
	return { current: present && fm !== undefined ? fm[action.property] : undefined, present };
}
