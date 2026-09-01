/**
 * Shared fixtures for the Instruction Fixer card tests (spec-006 T3.2).
 *
 * `SAMPLES` holds ONE action per wire kind, typed as `Record<ActionKind, …>`
 * so a new kind on the wire fails to compile here rather than quietly escaping
 * the per-kind sweeps. `repairKinds()`/`VIEW_ONLY_KINDS` split that roster the
 * same way `TARGET_FIELD_WHITELIST` does — the whitelist is the source, never
 * a hand-copied list.
 */

import { TARGET_FIELD_WHITELIST } from "../../../../../src/instruction-fixer/transforms";
import type { Action, ActionKind, InstructionSet } from "../../../../../src/schema/types";
import type { RepairKind } from "../../../../../src/ui/instruction-fixer/cards/targetFields";

/** The 7 repair kinds, read off the whitelist so the sweep cannot drift. */
export function repairKinds(): readonly RepairKind[] {
	return Object.keys(TARGET_FIELD_WHITELIST) as RepairKind[];
}

export const SAMPLES = {
	create_moc: {
		id: "I01",
		action: "create_moc",
		source: "100 Inbox/Kanban.md",
		destination: "Atlas/200 Maps/Systems (MOC).md",
		title: "Systems",
	},
	move_note: {
		id: "I02",
		action: "move_note",
		source: "100 Inbox/Kanban.md",
		destination: "Atlas/202 Notes/Kanban.md",
		title: "Kanban",
	},
	move_asset: {
		id: "I15",
		action: "move_asset",
		source: "100 Inbox/kanban-board.png",
		destination: "Atlas/900 Assets/kanban-board.png",
	},
	edit_frontmatter: {
		id: "I16",
		action: "edit_frontmatter",
		path: "Atlas/202 Notes/Existing.md",
		property: "up",
		operation: "set",
		value: ["[[Systems (MOC)]]"],
		expected: ["[[Old Parent]]"],
	},
	link_to_moc: {
		id: "I03",
		action: "link_to_moc",
		target_moc: "Systems (MOC)",
		target_moc_path: "Atlas/200 Maps/Systems (MOC).md",
		anchor: { type: "heading", value: "Tools" },
		placement: "after",
		line_to_add: "- [[Kanban]]",
		source_note_title: "Kanban",
	},
	insert_under_marker: {
		id: "I04",
		action: "insert_under_marker",
		target_path: "Atlas/202 Notes/Board.md",
		anchor: { type: "callout", value: "[!blocks] Key concepts" },
		placement: "inside",
		content: "- [[Kanban]]",
	},
	replace_section: {
		id: "I05",
		action: "replace_section",
		target_path: "Atlas/202 Notes/Board.md",
		anchor: { type: "heading", value: "Summary" },
		content: "Rewritten body",
	},
	add_relationship: {
		id: "I06",
		action: "add_relationship",
		target_moc_path: "Atlas/200 Maps/Systems (MOC).md",
		marker: "down::",
		line: "- [[Kanban]]",
	},
	edit_note_text: {
		id: "I07",
		action: "edit_note_text",
		path: "Atlas/202 Notes/Existing.md",
		match: "[[Missing Note]]",
		replace: "",
		occurrence: "first",
	},
	remove_up_link: {
		id: "I08",
		action: "remove_up_link",
		path: "Atlas/202 Notes/Existing.md",
		link: "Gone (MOC)",
	},
	resolve_dead_link: {
		id: "I09",
		action: "resolve_dead_link",
		path: "Atlas/202 Notes/Existing.md",
		target: "Dead Note",
		replace: "",
	},
	update_tracker: {
		id: "I10",
		action: "update_tracker",
		daily_note_path: "300 Journal/2026-07-26.md",
		date: "2026-07-26",
		field: "notes-processed",
		value: 3,
		syntax: "inline_field",
	},
	update_log_entry: {
		id: "I11",
		action: "update_log_entry",
		daily_note_path: "300 Journal/2026-07-26.md",
		date: "2026-07-26",
		section: "Log",
		position: "after_last_line",
		content: "Processed the inbox",
	},
	update_log_link: {
		id: "I12",
		action: "update_log_link",
		daily_note_path: "300 Journal/2026-07-26.md",
		date: "2026-07-26",
		section: "Log",
		position: "after_last_line",
		target_stem: "Kanban",
	},
	delete_source: {
		id: "I13",
		action: "delete_source",
		source_path: "100 Inbox/Kanban.md",
		reason: "moved",
	},
	skip: {
		id: "I14",
		action: "skip",
		source_path: "100 Inbox/Unclear.md",
		reason: "ambiguous",
	},
} as const satisfies Record<ActionKind, Action>;

/** Every kind that carries no repairable target field (ADR-5's complement). */
export const VIEW_ONLY_KINDS: readonly ActionKind[] = (
	Object.keys(SAMPLES) as ActionKind[]
).filter((kind) => !(kind in TARGET_FIELD_WHITELIST));

/** Wraps actions in a minimal schema-valid set. */
export function makeSet(actions: readonly Action[]): InstructionSet {
	return {
		schema_version: "2",
		type: "tomo-instructions",
		generated: "2026-07-26T10:15:00Z",
		profile: "default",
		actions,
	};
}
