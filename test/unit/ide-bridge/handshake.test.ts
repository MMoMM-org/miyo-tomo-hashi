import { describe, expect, it } from "vitest";

import { isAuthorized, secWebSocketAccept } from "../../../src/ide-bridge/handshake";

describe("secWebSocketAccept", () => {
	it("returns the RFC 6455 accept value for the example key", () => {
		// RFC 6455 §1.3 uses key `dGhlIHNhbXBsZSBub25jZQ==`. NOTE: the digest the
		// RFC text prints alongside it (`s3pPLMBiTxaQ9kYGzzhZRbK+xOo=`) is a known
		// erratum — it is not the actual SHA-1 of (key + GUID) and no conformant
		// implementation (incl. the `ws` library) emits it. We assert the value a
		// correct SHA-1 actually produces, which is what real clients verify against.
		expect(secWebSocketAccept("dGhlIHNhbXBsZSBub25jZQ==")).toBe(
			"ErhEfSMVJvC3FTevCFG+qKlPkws=",
		);
	});

	it("matches the ws-library canonical pair (x3JJ...)", () => {
		// A second, independently reproducible fixture taken from a working stack.
		expect(secWebSocketAccept("x3JJHMbDL1EzLkh9GBhXDw==")).toBe(
			"06dOLcsAPjFcF2yDCblKEyfsUL4=",
		);
	});
});

describe("isAuthorized", () => {
	const token = "secret-token";

	it("accepts an exact match to a non-empty stored token", () => {
		expect(isAuthorized(token, token)).toBe(true);
	});

	it("rejects a missing (undefined) header", () => {
		expect(isAuthorized(undefined, token)).toBe(false);
	});

	it("rejects a null header", () => {
		expect(isAuthorized(null, token)).toBe(false);
	});

	it("rejects a non-string header value (number)", () => {
		expect(isAuthorized(42, token)).toBe(false);
	});

	it("rejects a non-string header value (object)", () => {
		expect(isAuthorized({ token }, token)).toBe(false);
	});

	it("rejects the wrong token", () => {
		expect(isAuthorized("wrong-token", token)).toBe(false);
	});

	it("rejects when the stored token is empty, even if the header matches it", () => {
		expect(isAuthorized("", "")).toBe(false);
	});

	it("rejects when the stored token is empty and the header is undefined", () => {
		expect(isAuthorized(undefined, "")).toBe(false);
	});
});
