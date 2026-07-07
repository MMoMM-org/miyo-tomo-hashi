/**
 * Unit tests for the folder-scoping helper shared by the Template and
 * Location pickers. Covers the containment edge cases: exact match, nested,
 * trailing-slash normalization, the vault root, and the sibling-prefix
 * false-positive guard (e.g. "Atlas2" must not match scope "Atlas").
 */

import { describe, expect, it } from "vitest";

import { isUnderAnyFolder, isUnderFolder } from "../../../../../src/ui/suggestions-view/pickers/folderScope";

describe("isUnderFolder", () => {
	it("matches the folder itself and any descendant", () => {
		expect(isUnderFolder("Atlas", "Atlas")).toBe(true);
		expect(isUnderFolder("Atlas/202 Notes", "Atlas")).toBe(true);
		expect(isUnderFolder("Atlas/a/b/c.md", "Atlas")).toBe(true);
	});

	it("normalizes a trailing slash on the scope", () => {
		expect(isUnderFolder("Atlas/x.md", "Atlas/")).toBe(true);
		expect(isUnderFolder("Atlas", "Atlas/")).toBe(true);
	});

	it("does NOT match a sibling that merely shares the name prefix", () => {
		expect(isUnderFolder("Atlas2", "Atlas")).toBe(false);
		expect(isUnderFolder("AtlasNotes/x.md", "Atlas")).toBe(false);
	});

	it("treats the empty (root) scope as containing everything", () => {
		expect(isUnderFolder("anything/at/all.md", "")).toBe(true);
	});

	it("rejects a path outside the scope", () => {
		expect(isUnderFolder("Inbox/n.md", "Atlas")).toBe(false);
	});
});

describe("isUnderAnyFolder", () => {
	it("is true when the path is under at least one configured folder", () => {
		expect(isUnderAnyFolder("Inbox/n.md", ["Atlas", "Inbox"])).toBe(true);
	});

	it("is false when the path is under none of them", () => {
		expect(isUnderAnyFolder("Efforts/x.md", ["Atlas", "Inbox"])).toBe(false);
	});

	it("is false for an empty folder list (caller treats [] as no limit, not match-none-here)", () => {
		expect(isUnderAnyFolder("Atlas/x.md", [])).toBe(false);
	});
});
