import { describe, expect, it } from "vitest";

import { ensureToken, generateToken } from "../../../src/ide-bridge/token";

const TOKEN_PATTERN =
	/^hashi_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("generateToken", () => {
	it("returns a hashi_-prefixed string whose body is a valid UUID", () => {
		expect(generateToken()).toMatch(TOKEN_PATTERN);
	});

	it("returns a different token on each call", () => {
		expect(generateToken()).not.toBe(generateToken());
	});
});

describe("ensureToken", () => {
	it("returns the existing token unchanged when non-empty", () => {
		const existing = "hashi_existing-token-value";
		expect(ensureToken(existing)).toBe(existing);
	});

	it("returns a freshly generated hashi_-prefixed token when empty", () => {
		const result = ensureToken("");
		expect(result).not.toBe("");
		expect(result).toMatch(TOKEN_PATTERN);
	});
});
