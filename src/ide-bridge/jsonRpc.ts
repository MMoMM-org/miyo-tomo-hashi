/**
 * JSON-RPC 2.0 parsing & dispatch for the IDE Bridge — the message loop's pure
 * core. It turns raw socket text into a validated request (or a parse/validity
 * error) and routes a request to an injected handler registry, wrapping every
 * outcome in a JSON-RPC envelope.
 *
 * Spec: docs/XDD/specs/003-ide-bridge — SDD "Error Handling". The cardinal rule
 * is that nothing thrown by a handler (or by JSON.parse) may escape this module:
 * the frame loop above must never see an exception, only an envelope or null.
 * The real tool registry is assembled in Phase 2; here the registry is injected
 * so this layer stays Obsidian-free and unit-testable with stubs.
 */

import type { RpcError, RpcRequest, RpcResponse } from "./protocol";

/**
 * A single JSON-RPC method handler. May return a value or a promise; dispatch
 * `await`s the result either way, so the return type is just `unknown`.
 */
export type Handler = (params: unknown) => unknown;

/** Injected map of method name → handler. Built for real in Phase 2. */
export type HandlerRegistry = Record<string, Handler>;

/** Authoritative JSON-RPC error codes (SDD §Error Handling). */
const ERROR_CODES = {
	parse: -32700,
	invalidRequest: -32600,
	methodNotFound: -32601,
	invalidParams: -32602,
	internal: -32603,
} as const;

/** Build a JSON-RPC error response envelope. */
function errorEnvelope(
	id: RpcResponse["id"],
	code: number,
	message: string,
): RpcResponse {
	return { jsonrpc: "2.0", id, error: { code, message } };
}

/** Build a standalone RpcError (no envelope) for the parse stage. */
function rpcError(code: number, message: string): RpcError {
	return { code, message };
}

/** Type guard: does an arbitrary value look like a JSON object? */
function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse raw wire text into a JSON-RPC request.
 *
 * Returns an {@link RpcError} (not an envelope) when the text is not valid JSON
 * (`-32700`) or is valid JSON but not a well-formed request envelope —
 * `jsonrpc !== "2.0"` or a missing/non-string `method` (`-32600`).
 */
export function parseMessage(raw: string): RpcRequest | RpcError {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return rpcError(ERROR_CODES.parse, "Parse error");
	}

	if (!isObject(parsed)) {
		return rpcError(ERROR_CODES.invalidRequest, "Invalid Request");
	}
	if (parsed.jsonrpc !== "2.0" || typeof parsed.method !== "string") {
		return rpcError(ERROR_CODES.invalidRequest, "Invalid Request");
	}

	return parsed as unknown as RpcRequest;
}

/** A request without an `id` is a notification — it never gets a response. */
function isNotification(req: RpcRequest): boolean {
	return req.id === undefined;
}

/**
 * Map a caught throw to an error envelope. A handler may signal a specific
 * JSON-RPC code by throwing a value carrying a numeric `code` (e.g.
 * `throw { code: -32602, message: "bad params" }`, or an Error with a numeric
 * `.code`); that code and message win. Everything else is an uncaught internal
 * error (`-32603`). This lets Phase 2 tool handlers flag bad params without a
 * dedicated sentinel class.
 */
function thrownToEnvelope(id: RpcResponse["id"], thrown: unknown): RpcResponse {
	if (isObject(thrown) && typeof thrown.code === "number") {
		const message =
			typeof thrown.message === "string" ? thrown.message : "Internal error";
		return errorEnvelope(id, thrown.code, message);
	}
	return errorEnvelope(id, ERROR_CODES.internal, "Internal error");
}

/**
 * Route a request to its handler and produce a response envelope.
 *
 * - Unknown method → `-32601` error envelope.
 * - Registered method → `{ jsonrpc, id, result }` wrapping the handler's return.
 * - Notification (no `id`) → `null` (no response), even when the handler throws.
 * - Handler throw → caught and mapped to an error envelope: a thrown value with
 *   a numeric `code` (e.g. `-32602` bad params) keeps that code; anything else
 *   maps to `-32603` internal error.
 *
 * Nothing thrown by a handler ever propagates out of this function.
 */
export async function dispatch(
	req: RpcRequest,
	registry: HandlerRegistry,
): Promise<RpcResponse | null> {
	const notification = isNotification(req);
	const handler = registry[req.method];
	// Notifications never get a response; for requests `id` is present, so this
	// `?? null` only narrows the type and is never actually reached with undefined.
	const id: RpcResponse["id"] = req.id ?? null;

	if (handler === undefined) {
		return notification
			? null
			: errorEnvelope(id, ERROR_CODES.methodNotFound, "Method not found");
	}

	try {
		const result = await handler(req.params);
		return notification ? null : { jsonrpc: "2.0", id, result };
	} catch (thrown) {
		return notification ? null : thrownToEnvelope(id, thrown);
	}
}
