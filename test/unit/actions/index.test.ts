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
import type { FileMetadata } from "../../../src/vault/VaultFS.js";

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
	it("has exactly the 8 ActionKind keys", () => {
		const expectedKeys: ActionKind[] = [
			"create_moc",
			"move_note",
			"link_to_moc",
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
		const metadata: FileMetadata = {
			headings: [{ heading: "Projects", level: 2, line: 1 }],
			sections: [{ type: "heading", line: 1, endLine: -1 }],
		};
		const vault = new FakeVaultFS(new Map([[mocPath, metadata]]));
		await vault.create(mocPath, "# MOC\n## Projects\n");
		const action = {
			action: "link_to_moc" as const,
			id: "smoke-ltm",
			target_moc: mocPath,
			line_to_add: "- [[Notes/x|X]]",
			section_name: "Projects",
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
		const metadata: FileMetadata = {
			headings: [
				{ heading: "Daily Note", level: 1, line: 0 },
				{ heading: "Log", level: 2, line: 1 },
			],
			sections: [
				{ type: "heading", line: 0, endLine: 0 },
				{ type: "heading", line: 1, endLine: -1 },
			],
		};
		const vault = new FakeVaultFS(new Map([[notePath, metadata]]));
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
		const metadata: FileMetadata = {
			headings: [
				{ heading: "Daily Note", level: 1, line: 0 },
				{ heading: "Log", level: 2, line: 1 },
			],
			sections: [
				{ type: "heading", line: 0, endLine: 0 },
				{ type: "heading", line: 1, endLine: -1 },
			],
		};
		const vault = new FakeVaultFS(new Map([[notePath, metadata]]));
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
		expectTypeOf<Parameters<typeof HANDLERS["create_moc"]>[0]>().toMatchTypeOf<CreateMocAction>();
	});

	it("HANDLERS['move_note'] parameter type is MoveNoteAction", () => {
		expectTypeOf<Parameters<typeof HANDLERS["move_note"]>[0]>().toMatchTypeOf<MoveNoteAction>();
	});
});
