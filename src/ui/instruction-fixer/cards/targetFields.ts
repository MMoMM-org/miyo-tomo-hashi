/**
 * `targetFields` — the Instruction Fixer's per-kind repair-field descriptor map
 * (spec-006 Phase 3, T3.2; SDD ADR-5).
 *
 * Why this file exists: `TARGET_FIELD_WHITELIST` (Phase 1) decides WHICH
 * (kind, field) pairs a repair may write. It says nothing about how to show
 * one — what to call it, what a value looks like, and whether a vault-note
 * picker even makes sense for it (it does for `edit_note_text.path`; it does
 * not for `edit_note_text.match`, a literal substring). This map supplies
 * exactly that presentation layer, and nothing else: no second roster.
 *
 * The map's TYPE is derived from the whitelist (`TargetFieldMap` below), so a
 * kind or field added to the ADR-5 roster without a descriptor here is a
 * COMPILE error, and a descriptor for a field the whitelist would reject is
 * equally impossible. That is the whole reason the whitelist is exported.
 *
 * It is also the generalization vehicle for `TargetControl`: the widget core
 * (`renderTargetControlCore`) now takes caption/placeholder/pick-mode as plain
 * options, and these descriptors are what supplies them for the Fixer — the
 * `Record<FindingCheck, …>` caption maps stay behind garden-audit's own
 * wrapper and never reach this editor.
 *
 * Caption wording note: garden-audit's captions all describe what an EMPTY
 * commit means, because every one of its fields has a meaningful empty state.
 * The Fixer's fields mostly do not (an empty `target_path` is simply invalid),
 * so a caption here states the expected VALUE SHAPE instead — except for the
 * two fields where empty genuinely carries meaning (`edit_note_text.replace` =
 * delete the match, `resolve_dead_link.replace` = unlink), which say so.
 */

import { TARGET_FIELD_WHITELIST } from "../../../instruction-fixer/transforms.js";
import type { Action } from "../../../schema/types.js";
import type { TargetPickMode } from "../../garden-audit-view/TargetControl.js";

/** The 7 kinds carrying a repairable target field (ADR-5). */
export type RepairKind = keyof typeof TARGET_FIELD_WHITELIST;

type FieldKeyOf<K extends RepairKind> = (typeof TARGET_FIELD_WHITELIST)[K][number];

/** How one repair field presents itself. */
export interface TargetFieldSpec {
	/** Control label, sentence case. */
	readonly label: string;
	/** Trailing caption naming the expected value shape. `""` renders none. */
	readonly caption: string;
	/** Native tooltip on the caption. */
	readonly captionTooltip: string;
	readonly placeholder: string;
	/** What a picked vault note commits as — or `none` for a free-text field. */
	readonly pick: TargetPickMode;
	/**
	 * A second picker sourced from the action's own TARGET note rather than
	 * from the vault at large (2026-07-27 follow-up):
	 *   - `anchor-spot` — the note's headings/callouts/lines, committing
	 *     `anchor.type` + `anchor.value` + `placement` together;
	 *   - `marker` — the note's Dataview field openers and body lines.
	 *
	 * Absent means free text only. This is the presentation-layer flag; what
	 * each pick may WRITE is still decided by `transforms.ts` (`setAnchorSpot`'s
	 * ADR-5 amendment, and `TARGET_FIELD_WHITELIST` for the marker).
	 */
	readonly docPick?: "anchor-spot" | "marker";
}

/**
 * Descriptor per (kind, field), keyed exactly like `TARGET_FIELD_WHITELIST`.
 * The mapped type is what makes drift a compile error — see the file header.
 */
export type TargetFieldMap = {
	readonly [K in RepairKind]: { readonly [F in FieldKeyOf<K>]: TargetFieldSpec };
};

const ANCHOR_TOOLTIP =
	"The heading, callout or line text the action looks for in the target note. Matched literally — an anchor that no longer exists is the most common mechanical failure.";

const PATH_TOOLTIP = "Vault-relative path, including the .md extension.";

export const TARGET_FIELDS: TargetFieldMap = {
	link_to_moc: {
		target_moc: {
			label: "Target MOC",
			caption: "stem",
			captionTooltip: "Bare note stem — Tomo resolves it to a MOC in the vault.",
			placeholder: "Type or pick a MOC…",
			pick: "stem",
		},
		target_moc_path: {
			label: "Target MOC path",
			caption: "path",
			captionTooltip: `${PATH_TOOLTIP} Takes precedence over the stem above when set.`,
			placeholder: "Type or pick a note…",
			pick: "path",
		},
		anchor: {
			label: "Anchor",
			caption: "match text",
			captionTooltip: ANCHOR_TOOLTIP,
			placeholder: "Heading, callout or line text…",
			pick: "none",
			docPick: "anchor-spot",
		},
	},
	insert_under_marker: {
		target_path: {
			label: "Target note",
			caption: "path",
			captionTooltip: PATH_TOOLTIP,
			placeholder: "Type or pick a note…",
			pick: "path",
		},
		anchor: {
			label: "Anchor",
			caption: "match text",
			captionTooltip: ANCHOR_TOOLTIP,
			placeholder: "Heading, callout or line text…",
			pick: "none",
			docPick: "anchor-spot",
		},
	},
	replace_section: {
		target_path: {
			label: "Target note",
			caption: "path",
			captionTooltip: PATH_TOOLTIP,
			placeholder: "Type or pick a note…",
			pick: "path",
		},
		anchor: {
			label: "Section heading",
			caption: "heading text",
			captionTooltip:
				"Heading text without the leading #. The heading line itself is kept; only its body is replaced.",
			placeholder: "Heading text…",
			pick: "none",
			docPick: "anchor-spot",
		},
	},
	add_relationship: {
		target_moc_path: {
			label: "Target MOC path",
			caption: "path",
			captionTooltip: PATH_TOOLTIP,
			placeholder: "Type or pick a note…",
			pick: "path",
		},
		marker: {
			label: "Marker",
			caption: "match text",
			captionTooltip:
				"The relationship line the new entry is written under — matched the same way an anchor is.",
			placeholder: "Marker line to match…",
			pick: "none",
			docPick: "marker",
		},
		line: {
			label: "Line",
			caption: "written verbatim",
			captionTooltip: "The line added under the marker, verbatim.",
			placeholder: "Line to add…",
			pick: "none",
		},
	},
	edit_note_text: {
		path: {
			label: "Note",
			caption: "path",
			captionTooltip: PATH_TOOLTIP,
			placeholder: "Type or pick a note…",
			pick: "path",
		},
		match: {
			label: "Match",
			caption: "literal text",
			captionTooltip:
				"Literal text to find in the note body — not a pattern. Leading and trailing whitespace is part of the match.",
			placeholder: "Text to find…",
			pick: "none",
		},
		replace: {
			label: "Replace",
			caption: "empty = delete the match",
			captionTooltip:
				"Replacement text, written verbatim. Empty deletes the matched text (a whole-line match collapses the line).",
			placeholder: "Replacement text…",
			pick: "none",
		},
	},
	remove_up_link: {
		path: {
			label: "Note",
			caption: "path",
			captionTooltip: PATH_TOOLTIP,
			placeholder: "Type or pick a note…",
			pick: "path",
		},
		link: {
			label: "Link",
			caption: "stem",
			captionTooltip:
				"Bare stem of the link to remove from the up:: line. The up:: field itself is never deleted.",
			placeholder: "Type or pick a note…",
			pick: "stem",
		},
	},
	resolve_dead_link: {
		path: {
			label: "Note",
			caption: "path",
			captionTooltip: PATH_TOOLTIP,
			placeholder: "Type or pick a note…",
			pick: "path",
		},
		target: {
			label: "Dead link",
			caption: "stem",
			captionTooltip:
				"Bare stem of the dead link. Every occurrence is resolved, including aliased and embedded forms.",
			placeholder: "Type or pick a note…",
			pick: "stem",
		},
		replace: {
			label: "Replace",
			caption: "empty = unlink",
			captionTooltip:
				"Empty unlinks (the brackets go, the display text stays). A [[Note]] value repoints every occurrence instead.",
			// A picked stem would commit a bare stem where the wire wants the
			// full `[[Note]]` form, so this field takes no picker.
			placeholder: "[[Replacement note]] or empty…",
			pick: "none",
		},
	},
};

/** One repair field of one action: its key, how to show it, and its value. */
export interface TargetField {
	readonly key: string;
	readonly spec: TargetFieldSpec;
	readonly value: string;
}

/**
 * The repair fields of `action`, in `TARGET_FIELD_WHITELIST` order — empty for
 * every view-only kind. Order comes from the whitelist rather than from
 * `Object.keys` of the descriptor so the roster stays the single source of
 * both membership AND sequence.
 */
export function targetFieldsFor(action: Action): readonly TargetField[] {
	const whitelist: readonly string[] | undefined = (
		TARGET_FIELD_WHITELIST as Partial<Record<Action["action"], readonly string[]>>
	)[action.action];
	if (whitelist === undefined) return [];

	const specs = (TARGET_FIELDS as Record<string, Record<string, TargetFieldSpec>>)[action.action];
	if (specs === undefined) return [];

	const fields: TargetField[] = [];
	for (const key of whitelist) {
		const spec = specs[key];
		if (spec === undefined) continue; // unreachable — the mapped type forbids it
		fields.push({ key, spec, value: readTargetFieldValue(action, key) });
	}
	return fields;
}

/**
 * The current value of one repair field as a string the control can hold.
 *
 * `anchor` is the one whitelisted field that isn't a plain string (it nests in
 * `Anchor`) — the same single exception `setTargetField` makes on the write
 * side. A null `anchor.value` (Tomo's "unresolved at emission" state) reads as
 * empty, never as the string "null": that value is precisely what the user is
 * here to repair, and the control must not offer it back as literal text.
 */
export function readTargetFieldValue(action: Action, key: string): string {
	if (key === "anchor" && "anchor" in action) return action.anchor.value ?? "";
	const value = (action as unknown as Record<string, unknown>)[key];
	return typeof value === "string" ? value : "";
}
