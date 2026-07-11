/**
 * SpotPicker — op 2 (SDD §7, PRD F3): choose WHERE inside an existing MOC a
 * link should be anchored, using the note's REAL current structure parsed
 * fresh from content (`markdownStructure.parseHeadings`, race-safe per #68 —
 * never the async metadataCache), gated through `validPlacements` so the
 * modal can never offer a placement the executor's `anchorResolver` would
 * hard-fail on (`inside` is callout-only).
 *
 * A PROPOSED MOC has no structure yet, so it offers no spot options at all —
 * `computeSpotOptions` returns `[]` and callers render that as
 * "membership/ordering only" (no anchor picking is possible before the MOC
 * exists).
 *
 * Design for testability (T3.3): `computeSpotOptions` and `buildAnchorWire`
 * are pure functions holding ALL of the placement logic. `SpotPicker` itself
 * is a thin `SuggestModal` wrapper: it flattens options × their offered
 * placements into single-choice rows (`SpotChoice`) so one `onChooseSuggestion`
 * always yields one concrete, legal `AnchorWire` — no separate "pick a
 * placement" step needed on top.
 *
 * Callout enumeration: `markdownStructure.findCallout` searches for ONE
 * already-known `{type, title}` pair; it has no "list every callout" export
 * because no other caller has needed that. SpotPicker does, so it reuses the
 * exported `fencedLineMask` (same fenced-code-block exclusion as the rest of
 * markdownStructure) and matches callout openers locally with the same
 * `> [!type] Title` shape `findCallout`/`anchorResolver` use — this does not
 * modify markdownStructure.ts, it composes with its exported primitive.
 *
 * Spec refs: spec-004 SDD §7; PRD F3; plan/phase-3.md T3.3.
 */

import { type App, SuggestModal } from "obsidian";

import { fencedLineMask, parseHeadings } from "../../../actions/markdownStructure.js";
import { validPlacements, type Placement } from "../../../suggestions/validPlacements.js";
import type { AnchorWire } from "../../../types/suggestions.js";

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------

/** Same opener shape as `markdownStructure`'s `CALLOUT_FIRST_LINE_RE`/
 * `anchorResolver`'s `ANCHOR_VALUE_PREFIX_RE` — `> [!type] Title`. */
const CALLOUT_OPENER_RE = /^>\s*\[!(\w+)\]\s*(.*)$/;

export type SpotOptionType = "heading" | "callout" | "line";

export interface SpotOption {
	readonly type: SpotOptionType;
	/** `AnchorWire.value` for heading/callout (callout uses the `[!type] Title`
	 * shape `anchorResolver.resolveCallout` parses); null for line/new_section —
	 * there is no fixed text to match against. */
	readonly value: string | null;
	/** Display label for the suggestion list. */
	readonly label: string;
	/** Offered placements — ALWAYS `validPlacements(type)`; never includes
	 * `inside` for heading/line. */
	readonly placements: readonly Placement[];
	/** True for the synthetic "create a new section" option. */
	readonly isNewSection: boolean;
}

export type SpotOptions = readonly SpotOption[];

/**
 * The placement options for a MOC's content.
 *
 * - `kind: "existing"` — parses `content` for real headings/callouts and
 *   always adds a generic "line" option plus a "new section" option, so a
 *   MOC with no headings/callouts at all still offers a choosable spot.
 * - `kind: "proposed"` — no structure exists yet; returns `[]` (membership /
 *   ordering only — render this as a sentinel, don't open a spot picker).
 */
export function computeSpotOptions(
	content: string,
	kind: "existing" | "proposed",
): SpotOptions {
	if (kind === "proposed") return [];

	const lines = content.split("\n");
	const options: SpotOption[] = [];

	for (const heading of parseHeadings(lines)) {
		options.push({
			type: "heading",
			value: heading.heading,
			label: `Heading: ${heading.heading}`,
			placements: validPlacements("heading"),
			isNewSection: false,
		});
	}

	for (const callout of enumerateCallouts(lines)) {
		options.push({
			type: "callout",
			value: `[!${callout.type}] ${callout.title}`,
			label: `Callout: ${callout.title}`,
			placements: validPlacements("callout"),
			isNewSection: false,
		});
	}

	options.push({
		type: "line",
		value: null,
		label: "End of note",
		placements: validPlacements("line"),
		isNewSection: false,
	});

	options.push({
		type: "line",
		value: null,
		label: "New section",
		placements: validPlacements("line"),
		isNewSection: true,
	});

	return options;
}

interface CalloutOpener {
	readonly type: string;
	readonly title: string;
}

/** Every callout opener line in `lines` (outside fenced code blocks), in
 * document order. Reuses `fencedLineMask` — see file header. */
function enumerateCallouts(lines: readonly string[]): CalloutOpener[] {
	const fenced = fencedLineMask(lines);
	const callouts: CalloutOpener[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (fenced[i]) continue;
		const m = CALLOUT_OPENER_RE.exec(lines[i] ?? "");
		if (m === null) continue;
		callouts.push({ type: m[1]!, title: m[2]!.trim() });
	}
	return callouts;
}

/** One concrete, choosable row in the picker's suggestion list: an option
 * paired with ONE of its own offered placements. */
export interface SpotChoice {
	readonly option: SpotOption;
	readonly placement: Placement;
}

/** Flatten options × their offered placements into single-choice rows. */
export function flattenSpotChoices(options: SpotOptions): readonly SpotChoice[] {
	return options.flatMap((option) =>
		option.placements.map((placement) => ({ option, placement })),
	);
}

/**
 * Build the `AnchorWire` the executor expects from a chosen spot. `placement`
 * always comes from `choice.option.placements` (never a caller-supplied raw
 * value) — this is the guarantee that `inside` never reaches a heading/line
 * anchor. `newSectionTitle` names the new section when the option is the
 * synthetic "new section" choice; falls back to a generic title when blank
 * so the wire never carries an empty `new_section` string.
 */
export function buildAnchorWire(
	choice: SpotChoice,
	newSectionTitle?: string,
): AnchorWire {
	const { option, placement } = choice;
	if (!option.placements.includes(placement)) {
		throw new Error(
			`SpotPicker: placement "${placement}" is not valid for anchor type "${option.type}"`,
		);
	}

	return {
		type: option.type,
		value: option.value,
		placement,
		new_section: option.isNewSection
			? (newSectionTitle?.trim() || "New section")
			: null,
	};
}

// ---------------------------------------------------------------------------
// Thin SuggestModal wrapper
// ---------------------------------------------------------------------------

export interface SpotPickerOptions {
	/** The MOC's current file content — SpotPicker never reads the vault
	 * itself; the caller (tab/view) fetches it via the adapter/VaultFS. */
	readonly content: string;
	readonly kind: "existing" | "proposed";
	readonly onPick: (anchor: AnchorWire) => void;
}

export class SpotPicker extends SuggestModal<SpotChoice> {
	private readonly choices: readonly SpotChoice[];
	private readonly onPick: (anchor: AnchorWire) => void;

	constructor(app: App, opts: SpotPickerOptions) {
		super(app);
		this.choices = flattenSpotChoices(computeSpotOptions(opts.content, opts.kind));
		this.onPick = opts.onPick;
		this.setPlaceholder(
			this.choices.length === 0
				? "No spot to pick — membership/ordering only"
				: "Choose a spot…",
		);
	}

	getSuggestions(query: string): SpotChoice[] {
		const q = query.trim().toLowerCase();
		if (q === "") return [...this.choices];
		return this.choices.filter((choice) =>
			choice.option.label.toLowerCase().includes(q),
		);
	}

	renderSuggestion(choice: SpotChoice, el: HTMLElement): void {
		el.addClass("hashi-spot-picker-item");
		el.createSpan({ cls: "hashi-spot-picker-label", text: choice.option.label });
		el.createSpan({
			cls: "hashi-spot-picker-placement",
			text: choice.placement,
		});
	}

	onChooseSuggestion(
		choice: SpotChoice,
		_evt: MouseEvent | KeyboardEvent,
	): void {
		const newSectionTitle = choice.option.isNewSection
			? this.inputEl.value
			: undefined;
		this.onPick(buildAnchorWire(choice, newSectionTitle));
	}
}
