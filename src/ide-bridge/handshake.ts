/**
 * WebSocket handshake & auth primitives for the IDE Bridge — pure functions with
 * no socket I/O. The actual 401-before-upgrade response and the upgrade write
 * live in wsServer (a later phase); this file only computes the values they need.
 *
 * Spec: docs/XDD/specs/003-ide-bridge — PRD F4. The handshake accept value is the
 * RFC 6455 §1.3 ritual (SHA-1 of key + magic GUID, base64-encoded); auth checks an
 * opaque bearer token presented in the `x-claude-code-ide-authorization` header.
 */

import { createHash } from "node:crypto";

/** RFC 6455 §1.3 magic GUID appended to the client key before hashing. */
const WS_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/**
 * Compute the `Sec-WebSocket-Accept` response header value for a client's
 * `Sec-WebSocket-Key`: base64(SHA-1(key + magic GUID)).
 */
export function secWebSocketAccept(key: string): string {
	return createHash("sha1").update(key + WS_MAGIC_GUID).digest("base64");
}

/**
 * Validate the `x-claude-code-ide-authorization` header value against the stored
 * token. Returns true only for an exact string match to a non-empty token; an
 * empty stored token never authorizes, and non-string header values are rejected.
 */
export function isAuthorized(headerValue: unknown, token: string): boolean {
	if (token.length === 0) {
		return false;
	}
	if (typeof headerValue !== "string") {
		return false;
	}
	return headerValue === token;
}
