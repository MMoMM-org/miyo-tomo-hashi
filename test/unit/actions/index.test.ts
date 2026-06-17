/**
 * HANDLERS dispatch registry tests.
 *
 * T3.6 — verifies:
 *   1. Key coverage: HANDLERS has exactly 8 keys matching all ActionKind values.
 *   2. Identity: each registry entry points to the canonical handler function.
 *   3. Dispatch smoke: HANDLERS[action.action](action, ctx) routes to the correct handler.
 *
 * Note: Action discriminant is `action`, not `kind`. See plan/README.md deviation 2026-04-28 (T3.6).
 *
 * [ref: PRD/F4; SDD/Action Handler Contract; SDD/ADR-4]
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import {
	HANDLERS,
	addRelationship,
	createMoc,
	moveNote,
	linkToMoc,
	updateTracker,
	updateLogEntry,
	updateLogLink,
	deleteSource,
	skip,
} from "../../../src/actions/index.js";
import type {
	ActionKind,
	CreateMocAction,
	MoveNoteAction,
} from "../../../src/schema/types.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const makeCtx = (vault: FakeVaultFS) => ({
	vault,
	clock: { now: () => new Date("2026-04-28T10:00:00Z") },
});

// ---------------------------------------------------------------------------
// 1. Key coverage
// ---------------------------------------------------------------------------

describe("HANDLERS — key coverage", () => {
	it("has exactly the 9 ActionKind keys", () => {
		const expectedKeys: ActionKind[] = [
			"create_moc",
			"move_note",
			"link_to_moc",
			"add_relationship",
			"update_tracker",
			"update_log_entry",
			"update_log_link",
			"delete_source",
			"skip",
		];
		expect(Object.keys(HANDLERS).sort()).toEqual([...expectedKeys].sort());
	});
});

// ---------------------------------------------------------------------------
// 2. Identity — each registry entry is the canonical handler
// ---------------------------------------------------------------------------

describe("HANDLERS — identity", () => {
	it("HANDLERS.create_moc === createMoc", () => {
		expect(HANDLERS.create_moc).toBe(createMoc);
	});

	it("HANDLERS.move_note === moveNote", () => {
		expect(HANDLERS.move_note).toBe(moveNote);
	});

	it("HANDLERS.link_to_moc === linkToMoc", () => {
		expect(HANDLERS.link_to_moc).toBe(linkToMoc);
	});

	it("HANDLERS.update_tracker === updateTracker", () => {
		expect(HANDLERS.update_tracker).toBe(updateTracker);
	});

	it("HANDLERS.update_log_entry === updateLogEntry", () => {
		expect(HANDLERS.update_log_entry).toBe(updateLogEntry);
	});

	it("HANDLERS.update_log_link === updateLogLink", () => {
		expect(HANDLERS.update_log_link).toBe(updateLogLink);
	});

	it("HANDLERS.delete_source === deleteSource", () => {
		expect(HANDLERS.delete_source).toBe(deleteSource);
	});

	// M20: add_relationship was missing from the identity table even
	// though behavior coverage in addRelationship.test.ts is solid. This
	// closes the registration-completeness gap.
	it("HANDLERS.add_relationship === addRelationship (M20)", () => {
		expect(HANDLERS.add_relationship).toBe(addRelationship);
	});

	it("HANDLERS.skip === skip", () => {
		expect(HANDLERS.skip).toBe(skip);
	});
});

// ---------------------------------------------------------------------------
// 3. Dispatch smoke — HANDLERS[action.action](action, ctx) routes correctly
// ---------------------------------------------------------------------------

describe("HANDLERS — dispatch smoke", () => {
	it("create_moc: dispatches and returns applied", async () => {
		const vault = new FakeVaultFS();
		await vault.create("Inbox/note.md", "# content");
		const action: CreateMocAction = {
			action: "create_moc",
			id: "smoke-cm",
			source: "Inbox/note.md",
			destination: "Atlas/MOC/note.md",
			title: "Note",
		};
		const handler = HANDLERS[action.action];
		const outcome = await handler(action, makeCtx(vault));
		expect(outcome.kind).toBe("applied");
	});

	it("move_note: dispatches and returns applied", async () => {
		const vault = new FakeVaultFS();
		await vault.create("Inbox/raw.md", "# content");
		const action: MoveNoteAction = {
			action: "move_note",
			id: "smoke-mn",
			source: "Inbox/raw.md",
			destination: "Notes/raw.md",
			title: "Raw",
		};
		const handler = HANDLERS[action.action];
		const outcome = await handler(action, makeCtx(vault));
		expect(outcome.kind).toBe("applied");
	});

	it("link_to_moc: dispatches and returns applied", async () => {
		const mocPath = "MOCs/projects.md";
		const vault = new FakeVaultFS();
		await vault.create(mocPath, "# MOC\n## Projects\n");
		const action = {
			action: "link_to_moc" as const,
			id: "smoke-ltm",
			target_moc: mocPath,
			line_to_add: "- [[Notes/x|X]]",
			anchor: { type: "heading" as const, value: "Projects" },
			placement: "after" as const,
		};
		const handler = HANDLERS[action.action];
		const outcome = await handler(action, makeCtx(vault));
		expect(outcome.kind).toBe("applied");
	});

	it("update_tracker: dispatches and returns skipped-already (field at target)", async () => {
		const notePath = "daily/2026-04-28.md";
		const vault = new FakeVaultFS();
		await vault.create(notePath, "mood:: good\n");
		const action = {
			action: "update_tracker" as const,
			id: "smoke-ut",
			daily_note_path: notePath,
			date: "2026-04-28",
			field: "mood",
			value: "good",
			syntax: "inline_field" as const,
		};
		const handler = HANDLERS[action.action];
		const outcome = await handler(action, makeCtx(vault));
		expect(outcome.kind).toBe("skipped-already");
	});

	it("update_log_entry: dispatches and returns applied", async () => {
		const notePath = "daily/2026-04-28.md";
		const vault = new FakeVaultFS();
		await vault.create(notePath, "# Daily Note\n## Log\n");
		const action = {
			action: "update_log_entry" as const,
			id: "smoke-ule",
			daily_note_path: notePath,
			date: "2026-04-28",
			section: "Log",
			position: "after_last_line" as const,
			content: "Did a thing",
		};
		const handler = HANDLERS[action.action];
		const outcome = await handler(action, makeCtx(vault));
		expect(outcome.kind).toBe("applied");
	});

	it("update_log_link: dispatches and returns applied", async () => {
		const notePath = "daily/2026-04-28.md";
		const vault = new FakeVaultFS();
		await vault.create(notePath, "# Daily Note\n## Log\n");
		const action = {
			action: "update_log_link" as const,
			id: "smoke-ull",
			daily_note_path: notePath,
			date: "2026-04-28",
			section: "Log",
			position: "after_last_line" as const,
			target_stem: "SomeNote",
		};
		const handler = HANDLERS[action.action];
		const outcome = await handler(action, makeCtx(vault));
		expect(outcome.kind).toBe("applied");
	});

	// M20: dispatch smoke for add_relationship — closes the registration
	// gap. Behavioral coverage lives in addRelationship.test.ts.
	it("add_relationship: dispatches and returns applied (M20)", async () => {
		const mocPath = "MOCs/projects.md";
		const vault = new FakeVaultFS();
		await vault.create(mocPath, "# MOC\nrelated:: [[old]]\n");
		const action = {
			action: "add_relationship" as const,
			id: "smoke-ar",
			target_moc_path: mocPath,
			marker: "related::",
			line: "related:: [[NewNote]]",
		};
		const handler = HANDLERS[action.action];
		const outcome = await handler(action, makeCtx(vault));
		expect(outcome.kind).toBe("applied");
	});

	it("delete_source: dispatches and returns applied", async () => {
		const vault = new FakeVaultFS();
		await vault.create("Inbox/old.md", "# old");
		const action = {
			action: "delete_source" as const,
			id: "smoke-ds",
			source_path: "Inbox/old.md",
			reason: "processed",
		};
		const handler = HANDLERS[action.action];
		const outcome = await handler(action, makeCtx(vault));
		expect(outcome.kind).toBe("applied");
		expect(await vault.exists("Inbox/old.md")).toBe(false);
	});

	it("skip: dispatches and returns applied", async () => {
		const vault = new FakeVaultFS();
		const action = {
			action: "skip" as const,
			id: "smoke-sk",
			source_path: null,
		};
		const handler = HANDLERS[action.action];
		const outcome = await handler(action, makeCtx(vault));
		expect(outcome.kind).toBe("applied");
	});
});

// ---------------------------------------------------------------------------
// 4. Type-narrowing — compile-time check via expectTypeOf
// ---------------------------------------------------------------------------

describe("HANDLERS — type narrowing", () => {
	it("HANDLERS['create_moc'] parameter type is CreateMocAction", () => {
		expectTypeOf<Parameters<typeof HANDLERS["create_moc"]>[0]>().toExtend<CreateMocAction>();
	});

	it("HANDLERS['move_note'] parameter type is MoveNoteAction", () => {
		expectTypeOf<Parameters<typeof HANDLERS["move_note"]>[0]>().toExtend<MoveNoteAction>();
	});
});
