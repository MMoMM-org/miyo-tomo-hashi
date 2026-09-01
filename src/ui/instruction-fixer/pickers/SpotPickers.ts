/**
 * The Instruction Fixer's target-note pickers: choose an anchor, an
 * `add_relationship` marker, or an `edit_frontmatter` property — always from
 * what the TARGET note actually has right now.
 *
 * The first two are the spec-006 follow-up (user request 2026-07-27 b + c);
 * the frontmatter one is the 2026-09-01 follow-up to `edit_frontmatter`.
 *
 * Thin `SuggestModal` wrappers, same shape as the Suggestions Editor's
 * `SpotPicker`: all the domain logic (what is offerable, which placements are
 * legal for which kind) lives in `instruction-fixer/noteSpots.ts` as pure
 * functions, and these classes only turn a row into a list item.
 *
 * Neither picker reads the vault. The caller resolves the target note and hands
 * the content in — partly so these stay testable without a vault, and partly
 * because resolution can FAIL in a way the modal has nothing useful to say
 * about: a target that no longer exists is the very failure the user came here
 * to repair, so the card reports it as a notice and never opens an empty
 * picker that implies the note is simply featureless.
 */

import { type App, SuggestModal } from "obsidian";

import type {
	AnchorSpot,
	FrontmatterProperty,
	MarkerSpot,
} from "../../../instruction-fixer/noteSpots.js";

/** Shared list-item rendering: primary label, secondary detail. */
function renderRow(el: HTMLElement, label: string, detail: string): void {
	el.addClass("hashi-if-spot-item");
	el.createSpan({ cls: "hashi-if-spot-label", text: label });
	el.createSpan({ cls: "hashi-if-spot-detail", text: detail });
}

export class AnchorSpotPicker extends SuggestModal<AnchorSpot> {
	private readonly spots: readonly AnchorSpot[];
	private readonly onPick: (spot: AnchorSpot) => void;

	constructor(app: App, spots: readonly AnchorSpot[], onPick: (spot: AnchorSpot) => void) {
		super(app);
		this.spots = spots;
		this.onPick = onPick;
		this.setPlaceholder(
			spots.length === 0
				? "This note has no heading, callout or line to anchor to"
				: "Choose an anchor…",
		);
	}

	getSuggestions(query: string): AnchorSpot[] {
		const q = query.trim().toLowerCase();
		if (q === "") return [...this.spots];
		return this.spots.filter((spot) => spot.label.toLowerCase().includes(q));
	}

	renderSuggestion(spot: AnchorSpot, el: HTMLElement): void {
		renderRow(el, spot.label, spot.detail);
	}

	onChooseSuggestion(spot: AnchorSpot): void {
		this.onPick(spot);
	}
}

export class MarkerSpotPicker extends SuggestModal<MarkerSpot> {
	private readonly spots: readonly MarkerSpot[];
	private readonly onPick: (spot: MarkerSpot) => void;

	constructor(app: App, spots: readonly MarkerSpot[], onPick: (spot: MarkerSpot) => void) {
		super(app);
		this.spots = spots;
		this.onPick = onPick;
		this.setPlaceholder(
			spots.length === 0 ? "This note has no line to use as a marker" : "Choose a marker…",
		);
	}

	getSuggestions(query: string): MarkerSpot[] {
		const q = query.trim().toLowerCase();
		if (q === "") return [...this.spots];
		return this.spots.filter((spot) => spot.label.toLowerCase().includes(q));
	}

	renderSuggestion(spot: MarkerSpot, el: HTMLElement): void {
		renderRow(el, spot.label, spot.detail);
	}

	onChooseSuggestion(spot: MarkerSpot): void {
		this.onPick(spot);
	}
}

/**
 * Choose a property out of the target note's frontmatter.
 *
 * Rows carry the parsed value, not just the key: the pick commits `property`
 * AND `expected` together (see `setFrontmatterProperty`), so the value has to
 * travel with the choice rather than be fetched again afterwards from a note
 * that may have moved on in between.
 */
export class FrontmatterPropertyPicker extends SuggestModal<FrontmatterProperty> {
	private readonly properties: readonly FrontmatterProperty[];
	private readonly onPick: (property: FrontmatterProperty) => void;

	constructor(
		app: App,
		properties: readonly FrontmatterProperty[],
		onPick: (property: FrontmatterProperty) => void,
	) {
		super(app);
		this.properties = properties;
		this.onPick = onPick;
		this.setPlaceholder("Choose a property…");
	}

	getSuggestions(query: string): FrontmatterProperty[] {
		const q = query.trim().toLowerCase();
		if (q === "") return [...this.properties];
		return this.properties.filter((p) => p.key.toLowerCase().includes(q));
	}

	renderSuggestion(property: FrontmatterProperty, el: HTMLElement): void {
		renderRow(el, property.key, property.preview);
	}

	onChooseSuggestion(property: FrontmatterProperty): void {
		this.onPick(property);
	}
}
