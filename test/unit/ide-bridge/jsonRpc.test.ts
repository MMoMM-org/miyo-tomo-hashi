import { describe, expect, it } from "vitest";

import { dispatch, parseMessage } from "../../../src/ide-bridge/jsonRpc";
import type { HandlerRegistry } from "../../../src/ide-bridge/jsonRpc";
import type { RpcError, RpcRequest } from "../../../src/ide-bridge/protocol";

/** Narrowing helper: assert a parse result is an error and return it. */
function asError(value: RpcRequest | RpcError): RpcError {
	if (!("code" in value)) {
		throw new Error("expected an RpcError");
	}
	return value;
}

describe("parseMessage", () => {
	it("returns -32700 parse error for malformed JSON", () => {
		const result = parseMessage("{ not json");
		expect(asError(result).code).toBe(-32700);
	});

	it("returns -32600 invalid request for valid JSON that is not a request envelope", () => {
		const result = parseMessage('{"foo":1}');
		expect(asError(result).code).toBe(-32600);
	});

	it("returns -32600 invalid request for the wrong jsonrpc version", () => {
		const result = parseMessage('{"jsonrpc":"1.0","method":"x","id":1}');
		expect(asError(result).code).toBe(-32600);
	});

	it("returns -32600 invalid request when method is not a string", () => {
		const result = parseMessage('{"jsonrpc":"2.0","method":42,"id":1}');
		expect(asError(result).code).toBe(-32600);
	});

	it("returns the parsed request for a valid envelope", () => {
		const result = parseMessage('{"jsonrpc":"2.0","method":"ping","id":7}');
		expect(result).toEqual({ jsonrpc: "2.0", method: "ping", id: 7 });
	});
});

describe("dispatch", () => {
	const okRegistry: HandlerRegistry = {
		echo: (params) => params,
	};

	it("returns -32601 method not found for an unknown method, echoing the id", async () => {
		const req: RpcRequest = { jsonrpc: "2.0", method: "nope", id: 9 };
		const res = await dispatch(req, okRegistry);
		expect(res).toEqual({
			jsonrpc: "2.0",
			id: 9,
			error: { code: -32601, message: "Method not found" },
		});
	});

	it("wraps a registered handler's return value in a result envelope", async () => {
		const req: RpcRequest = { jsonrpc: "2.0", method: "echo", id: 3, params: { a: 1 } };
		const res = await dispatch(req, okRegistry);
		expect(res).toEqual({ jsonrpc: "2.0", id: 3, result: { a: 1 } });
	});

	it("awaits an async handler result", async () => {
		const registry: HandlerRegistry = {
			delayed: async () => "value",
		};
		const req: RpcRequest = { jsonrpc: "2.0", method: "delayed", id: 4 };
		const res = await dispatch(req, registry);
		expect(res).toEqual({ jsonrpc: "2.0", id: 4, result: "value" });
	});

	it("returns null (no response) for a notification with a successful handler", async () => {
		const req: RpcRequest = { jsonrpc: "2.0", method: "echo", params: {} };
		const res = await dispatch(req, okRegistry);
		expect(res).toBeNull();
	});

	it("returns null (no response) for a notification whose handler throws", async () => {
		const registry: HandlerRegistry = {
			boom: () => {
				throw new Error("kaboom");
			},
		};
		const req: RpcRequest = { jsonrpc: "2.0", method: "boom", params: {} };
		const res = await dispatch(req, registry);
		expect(res).toBeNull();
	});

	it("maps a throwing handler to a -32603 internal error and never throws out of dispatch", async () => {
		const registry: HandlerRegistry = {
			boom: () => {
				throw new Error("kaboom");
			},
		};
		const req: RpcRequest = { jsonrpc: "2.0", method: "boom", id: 5 };
		const res = await dispatch(req, registry);
		expect(res).toEqual({
			jsonrpc: "2.0",
			id: 5,
			error: { code: -32603, message: "Internal error" },
		});
	});

	it("maps a coded throw to that code (e.g. -32602 bad params) and echoes the id", async () => {
		const registry: HandlerRegistry = {
			badParams: () => {
				throw { code: -32602, message: "bad params" };
			},
		};
		const req: RpcRequest = { jsonrpc: "2.0", method: "badParams", id: 6 };
		const res = await dispatch(req, registry);
		expect(res).toEqual({
			jsonrpc: "2.0",
			id: 6,
			error: { code: -32602, message: "bad params" },
		});
	});

	it("treats id:null as a real request, not a notification, and returns a response envelope", async () => {
		const req: RpcRequest = { jsonrpc: "2.0", method: "echo", id: null, params: { ok: true } };
		const res = await dispatch(req, okRegistry);
		expect(res).toEqual({ jsonrpc: "2.0", id: null, result: { ok: true } });
	});

	it("returns null for a notification whose async handler rejects", async () => {
		const registry: HandlerRegistry = {
			boom: async () => {
				throw new Error("async boom");
			},
		};
		const req: RpcRequest = { jsonrpc: "2.0", method: "boom", params: {} };
		const res = await dispatch(req, registry);
		expect(res).toBeNull();
	});
});
