import { describe, expect, expectTypeOf, it } from "vitest";

import type {
	Action,
	ActionKind,
	CreateMocAction,
	DeleteSourceAction,
	InstructionSet,
	LinkToMocAction,
	MoveNoteAction,
	SkipAction,
	UpdateLogEntryAction,
	UpdateLogLinkAction,
	UpdateTrackerAction,
} from "../../../src/schema/types";

// ---------------------------------------------------------------------------
// ActionKind — 8-literal union
// ---------------------------------------------------------------------------

describe("ActionKind", () => {
	it("is the exact 8-element string-literal union", () => {
		expectTypeOf<ActionKind>().toEqualTypeOf<
			| "create_moc"
			| "move_note"
			| "link_to_moc"
			| "update_tracker"
			| "update_log_entry"
			| "update_log_link"
			| "delete_source"
			| "skip"
		>();
	});

	it("all 8 literals are assignable to ActionKind", () => {
		const allKinds: ActionKind[] = [
			"create_moc",
			"move_note",
			"link_to_moc",
			"update_tracker",
			"update_log_entry",
			"update_log_link",
			"delete_source",
			"skip",
		];
		// Runtime check: exactly 8
		expect(allKinds).toHaveLength(8);
	});
});

// ---------------------------------------------------------------------------
// InstructionSet — schema_version must be string "1"
// ---------------------------------------------------------------------------

describe("InstructionSet", () => {
	it("accepts a valid instruction set with schema_version '1'", () => {
		const is: InstructionSet = {
			schema_version: "1",
			type: "tomo-instructions",
			generated: "2026-04-28T00:00:00Z",
			profile: null,
			actions: [],
		};
		expect(is.schema_version).toBe("1");
	});

	it("schema_version is typed as string literal '1', not number 1", () => {
		// Type-level: schema_version must be "1" (string), not 1 (number).
		expectTypeOf<InstructionSet["schema_version"]>().toEqualTypeOf<"1">();
	});

	it("actions field is a readonly array of Action", () => {
		expectTypeOf<InstructionSet["actions"]>().toEqualTypeOf<readonly Action[]>();
	});
});

// ---------------------------------------------------------------------------
// Action discriminated union — discriminant field is `action`
// ---------------------------------------------------------------------------

describe("Action discriminated union", () => {
	it("narrows to MoveNoteAction on action === 'move_note'", () => {
		const a: Action = {
			id: "I01",
			action: "move_note",
			source: "100 Inbox/note.md",
			destination: "Atlas/note.md",
			title: "Note",
		};
		if (a.action === "move_note") {
			// Narrowed — source, destination, title accessible without error
			const _src: string = a.source;
			const _dst: string = a.destination;
			const _title: string = a.title;
			expect(_src).toBe("100 Inbox/note.md");
			expect(_dst).toBe("Atlas/note.md");
			expect(_title).toBe("Note");
		}
	});

	it("narrows to CreateMocAction on action === 'create_moc'", () => {
		const a: Action = {
			id: "I02",
			action: "create_moc",
			source: "100 Inbox/moc.md",
			destination: "Atlas/200 Maps/moc.md",
			title: "My MOC",
		};
		if (a.action === "create_moc") {
			const _src: string = a.source;
			const _dst: string = a.destination;
			expect(_src).toBeDefined();
			expect(_dst).toBeDefined();
		}
	});

	it("narrows to LinkToMocAction on action === 'link_to_moc'", () => {
		const a: Action = {
			id: "I03",
			action: "link_to_moc",
			target_moc: "Brettspiele (MOC)",
			line_to_add: "- [[Some Note]]",
		};
		if (a.action === "link_to_moc") {
			const _moc: string = a.target_moc;
			const _line: string = a.line_to_add;
			expect(_moc).toBeDefined();
			expect(_line).toBeDefined();
		}
	});

	it("narrows to UpdateTrackerAction on action === 'update_tracker'", () => {
		const a: Action = {
			id: "I04",
			action: "update_tracker",
			daily_note_path: "Daily/2026-04-28.md",
			date: "2026-04-28",
			field: "mood",
			value: "good",
			syntax: "inline_field",
		};
		if (a.action === "update_tracker") {
			const _field: string = a.field;
			const _syntax: string = a.syntax;
			expect(_field).toBe("mood");
			expect(_syntax).toBe("inline_field");
		}
	});

	it("narrows to UpdateLogEntryAction on action === 'update_log_entry'", () => {
		const a: Action = {
			id: "I05",
			action: "update_log_entry",
			daily_note_path: "Daily/2026-04-28.md",
			date: "2026-04-28",
			section: "Daily Log",
			position: "after_last_line",
			content: "- did a thing",
		};
		if (a.action === "update_log_entry") {
			const _section: string = a.section;
			const _content: string = a.content;
			expect(_section).toBe("Daily Log");
			expect(_content).toBe("- did a thing");
		}
	});

	it("narrows to UpdateLogLinkAction on action === 'update_log_link'", () => {
		const a: Action = {
			id: "I06",
			action: "update_log_link",
			daily_note_path: "Daily/2026-04-28.md",
			date: "2026-04-28",
			section: "Daily Log",
			position: "after_last_line",
			target_stem: "Asahikawa",
		};
		if (a.action === "update_log_link") {
			const _stem: string = a.target_stem;
			expect(_stem).toBe("Asahikawa");
		}
	});

	it("narrows to DeleteSourceAction on action === 'delete_source'", () => {
		const a: Action = {
			id: "I07",
			action: "delete_source",
			source_path: "100 Inbox/voice.m4a",
			reason: "processed",
		};
		if (a.action === "delete_source") {
			const _path: string = a.source_path;
			const _reason: string = a.reason;
			expect(_path).toBeDefined();
			expect(_reason).toBeDefined();
		}
	});

	it("narrows to SkipAction on action === 'skip'", () => {
		const a: Action = {
			id: "I08",
			action: "skip",
			source_path: null,
		};
		if (a.action === "skip") {
			const _path: string | null = a.source_path;
			expect(_path).toBeNull();
		}
	});

	it("exhaustive switch compiles over all Action variants", () => {
		// This function compiles only if all 8 variants are handled.
		function describeAction(a: Action): string {
			switch (a.action) {
				case "create_moc":
					return `create_moc:${a.title}`;
				case "move_note":
					return `move_note:${a.title}`;
				case "link_to_moc":
					return `link_to_moc:${a.target_moc}`;
				case "update_tracker":
					return `update_tracker:${a.field}`;
				case "update_log_entry":
					return `update_log_entry:${a.section}`;
				case "update_log_link":
					return `update_log_link:${a.target_stem}`;
				case "delete_source":
					return `delete_source:${a.source_path}`;
				case "skip":
					return `skip:${String(a.source_path)}`;
				default: {
					const _exhaustive: never = a;
					return _exhaustive;
				}
			}
		}
		const a: MoveNoteAction = {
			id: "I01",
			action: "move_note",
			source: "100 Inbox/note.md",
			destination: "Atlas/note.md",
			title: "Note",
		};
		expect(describeAction(a)).toBe("move_note:Note");
	});

	it("optional fields are typed correctly — applied is boolean | undefined", () => {
		// applied is optional; undefined when absent, boolean when present
		const withApplied: MoveNoteAction = {
			id: "I01",
			action: "move_note",
			source: "s",
			destination: "d",
			title: "t",
			applied: true,
		};
		const withoutApplied: MoveNoteAction = {
			id: "I01",
			action: "move_note",
			source: "s",
			destination: "d",
			title: "t",
		};
		expect(withApplied.applied).toBe(true);
		expect(withoutApplied.applied).toBeUndefined();
	});

	it("nullable fields are typed as T | null", () => {
		const a: LinkToMocAction = {
			id: "I01",
			action: "link_to_moc",
			target_moc: "MOC",
			line_to_add: "- [[x]]",
			target_moc_path: null,
			section_name: null,
			source_note_title: null,
		};
		expectTypeOf(a.target_moc_path).toEqualTypeOf<string | null | undefined>();
		expect(a.target_moc_path).toBeNull();
	});

	it("value field in UpdateTrackerAction is string | number | boolean", () => {
		const a: UpdateTrackerAction = {
			id: "I01",
			action: "update_tracker",
			daily_note_path: "d",
			date: "2026-04-28",
			field: "f",
			value: 42,
			syntax: "callout_body",
		};
		expectTypeOf(a.value).toEqualTypeOf<string | number | boolean>();
		expect(a.value).toBe(42);
	});

	it("CreateMocAction has nullable parent_moc and template", () => {
		const a: CreateMocAction = {
			id: "I01",
			action: "create_moc",
			source: "s",
			destination: "d",
			title: "t",
			parent_moc: null,
			template: null,
		};
		expectTypeOf(a.parent_moc).toEqualTypeOf<string | null | undefined>();
		expectTypeOf(a.template).toEqualTypeOf<string | null | undefined>();
	});

	it("DeleteSourceAction requires reason as non-nullable string", () => {
		const a: DeleteSourceAction = {
			id: "I01",
			action: "delete_source",
			source_path: "path",
			reason: "processed",
		};
		expectTypeOf(a.reason).toEqualTypeOf<string>();
	});

	it("SkipAction has nullable source_path and optional nullable reason", () => {
		const a: SkipAction = {
			id: "I01",
			action: "skip",
			source_path: null,
		};
		expectTypeOf(a.source_path).toEqualTypeOf<string | null>();
		expectTypeOf(a.reason).toEqualTypeOf<string | null | undefined>();
	});
});
