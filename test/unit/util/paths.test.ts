import { describe, expect, it, vi } from "vitest";

import {
	VALIDATION_ORDER,
	denyListMatch,
	normalizeAndContain,
	verifyRealpathContainment,
} from "../../../src/util/paths";

// ---------------------------------------------------------------------------
// normalizeAndContain
// ---------------------------------------------------------------------------

describe("normalizeAndContain", () => {
	describe("accepts vault-relative paths", () => {
		it("accepts a simple vault-relative path", () => {
			const result = normalizeAndContain("Atlas/foo.md");
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.vaultRelativePath).toBe("Atlas/foo.md");
		});

		it("accepts a nested vault-relative path", () => {
			const result = normalizeAndContain("a/b/c.md");
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.vaultRelativePath).toBe("a/b/c.md");
		});

		it("normalizes backslashes to forward slashes", () => {
			const result = normalizeAndContain("a\\b\\c.md");
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.vaultRelativePath).toBe("a/b/c.md");
		});

		it("accepts empty string as sentinel for unconfigured paths", () => {
			const result = normalizeAndContain("");
			expect(result.ok).toBe(true);
		});
	});

	describe("rejects absolute paths", () => {
		it("rejects POSIX absolute path /foo", () => {
			const result = normalizeAndContain("/foo");
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.reason).toBe("Path escapes vault root");
		});

		it("rejects Windows drive letter C:\\foo", () => {
			const result = normalizeAndContain("C:\\foo");
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.reason).toBe("Path escapes vault root");
		});

		it("rejects Windows drive letter D:foo (no separator)", () => {
			const result = normalizeAndContain("D:foo");
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.reason).toBe("Path escapes vault root");
		});
	});

	describe("rejects traversal paths", () => {
		it("rejects a/../b (traversal that stays relative)", () => {
			const result = normalizeAndContain("a/../b");
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.reason).toBe("Path escapes vault root");
		});

		it("rejects ../etc (direct parent escape)", () => {
			const result = normalizeAndContain("../etc");
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.reason).toBe("Path escapes vault root");
		});

		it("rejects a/b/../../etc (double traversal)", () => {
			const result = normalizeAndContain("a/b/../../etc");
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.reason).toBe("Path escapes vault root");
		});
	});

	describe("rejects empty segments", () => {
		it("rejects a//b (double separator / empty segment)", () => {
			const result = normalizeAndContain("a//b");
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.reason).toBe("Path escapes vault root");
		});
	});
});

// ---------------------------------------------------------------------------
// denyListMatch
// ---------------------------------------------------------------------------

describe("denyListMatch", () => {
	const hooksDir = ".tomo-hashi/hooks";

	describe("matches denied paths", () => {
		it("matches .obsidian/foo", () => {
			expect(denyListMatch(".obsidian/foo", hooksDir)).toBe(true);
		});

		it("matches .git/bar", () => {
			expect(denyListMatch(".git/bar", hooksDir)).toBe(true);
		});

		it("matches .trash/baz", () => {
			expect(denyListMatch(".trash/baz", hooksDir)).toBe(true);
		});

		it("matches exactly .obsidian (directory itself)", () => {
			expect(denyListMatch(".obsidian", hooksDir)).toBe(true);
		});

		it("matches hooksDir prefix", () => {
			expect(denyListMatch(".tomo-hashi/hooks/myhook.js", hooksDir)).toBe(true);
		});

		it("matches hooksDir itself", () => {
			expect(denyListMatch(".tomo-hashi/hooks", hooksDir)).toBe(true);
		});
	});

	describe("does NOT match similarly-prefixed paths", () => {
		it("does NOT match my.obsidiania/foo", () => {
			expect(denyListMatch("my.obsidiania/foo", hooksDir)).toBe(false);
		});

		it("does NOT match git-stuff/bar", () => {
			expect(denyListMatch("git-stuff/bar", hooksDir)).toBe(false);
		});

		it("does NOT match trashcan/baz", () => {
			expect(denyListMatch("trashcan/baz", hooksDir)).toBe(false);
		});

		it("does NOT match normal/path.md", () => {
			expect(denyListMatch("normal/path.md", hooksDir)).toBe(false);
		});
	});

	describe("hooksDir normalization (defensive)", () => {
		it("matches when hooksDir has a trailing slash", () => {
			expect(denyListMatch(".tomo-hashi/hooks/evil.js", ".tomo-hashi/hooks/")).toBe(true);
		});

		it("matches when hooksDir has a leading ./", () => {
			expect(denyListMatch(".tomo-hashi/hooks/evil.js", "./.tomo-hashi/hooks")).toBe(true);
		});

		it("matches when hooksDir has both ./ prefix and trailing slash", () => {
			expect(denyListMatch(".tomo-hashi/hooks/evil.js", "./.tomo-hashi/hooks/")).toBe(true);
		});
	});
});

// ---------------------------------------------------------------------------
// verifyRealpathContainment
// ---------------------------------------------------------------------------

describe("verifyRealpathContainment", () => {
	it("returns ok when realpath is inside vault root", async () => {
		const vaultRoot = "/Users/marcus/vault";
		const realpathStub = vi
			.fn()
			.mockResolvedValue("/Users/marcus/vault/Atlas/foo.md");

		const result = await verifyRealpathContainment(
			vaultRoot,
			"Atlas/foo.md",
			realpathStub,
		);

		expect(result.ok).toBe(true);
	});

	it("returns path-symlink-escape when realpath is outside vault root", async () => {
		const vaultRoot = "/Users/marcus/vault";
		const realpathStub = vi
			.fn()
			.mockResolvedValue("/some/path/outside/vault/secret.txt");

		const result = await verifyRealpathContainment(
			vaultRoot,
			"symlink-to-outside.md",
			realpathStub,
		);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("path-symlink-escape");
	});

	it("rejects sibling-vault realpath (defends startsWith without separator)", async () => {
		// Without the trailing-separator check, "/Users/marcus/vault-evil/..."
		// would falsely pass startsWith("/Users/marcus/vault") — a real escape.
		const vaultRoot = "/Users/marcus/vault";
		const realpathStub = vi
			.fn()
			.mockResolvedValue("/Users/marcus/vault-evil/secret.txt");

		const result = await verifyRealpathContainment(
			vaultRoot,
			"symlink-to-sibling.md",
			realpathStub,
		);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("path-symlink-escape");
	});

	it("normalizes vaultRoot trailing slash before resolving", async () => {
		// vaultRoot with trailing slash must not produce // in the joined path,
		// and the resolved-prefix check must still recognize containment.
		const realpathStub = vi
			.fn()
			.mockResolvedValue("/Users/marcus/vault/Atlas/foo.md");

		const result = await verifyRealpathContainment(
			"/Users/marcus/vault/",
			"Atlas/foo.md",
			realpathStub,
		);

		expect(result.ok).toBe(true);
		// Confirm the join did not produce a double-slash. The stub captured the
		// invocation arg; it should be the single-slash form.
		expect(realpathStub).toHaveBeenCalledWith("/Users/marcus/vault/Atlas/foo.md");
	});

	it("returns ok on ENOENT (a not-yet-existing path cannot symlink-escape)", async () => {
		const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		const realpathStub = vi.fn().mockRejectedValue(enoent);

		const result = await verifyRealpathContainment(
			"/Users/marcus/vault",
			"will-be-created.md",
			realpathStub,
		);

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.vaultRelativePath).toBe("will-be-created.md");
	});

	it("rethrows non-ENOENT realpath errors (EPERM, ELOOP, etc.)", async () => {
		const eperm = Object.assign(new Error("EPERM"), { code: "EPERM" });
		const realpathStub = vi.fn().mockRejectedValue(eperm);

		await expect(
			verifyRealpathContainment("/Users/marcus/vault", "foo.md", realpathStub),
		).rejects.toThrow("EPERM");
	});

	it("uses the injected realpath function (does not call real fs)", async () => {
		const realpathStub = vi
			.fn()
			.mockResolvedValue("/Users/marcus/vault/Atlas/foo.md");

		await verifyRealpathContainment(
			"/Users/marcus/vault",
			"Atlas/foo.md",
			realpathStub,
		);

		expect(realpathStub).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// VALIDATION_ORDER
// ---------------------------------------------------------------------------

describe("VALIDATION_ORDER", () => {
	it("is the exact 6-element tuple in documented order (PRD F9)", () => {
		expect(VALIDATION_ORDER).toEqual([
			"schema",
			"normalize",
			"contain",
			"denyList",
			"payloadGuard",
			"execute",
		]);
	});

	it("exports the three path-safety function names from the module", () => {
		expect(typeof normalizeAndContain).toBe("function");
		expect(typeof denyListMatch).toBe("function");
		expect(typeof verifyRealpathContainment).toBe("function");
	});
});
