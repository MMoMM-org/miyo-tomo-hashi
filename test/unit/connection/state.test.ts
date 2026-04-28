import { describe, expect, it } from "vitest";

import type { ConnectionState } from "../../../src/connection/state";
import type { ConnectionError, TomoInstance } from "../../../src/connection/types";

// Helper: exhaustive-switch enforcer using `never`.
function assertExhaustive(_v: never): never {
	throw new Error("non-exhaustive");
}

describe("ConnectionState", () => {
	it("compiles with exhaustive switch over .kind", () => {
		const inspect = (s: ConnectionState): string => {
			switch (s.kind) {
				case "disconnected":
					return "d";
				case "attaching":
					return s.target.shortId;
				case "connected":
					return s.instance.shortId;
				case "reconnecting":
					return `${s.target.shortId}@${s.attempt}`;
				case "error":
					return s.error.code;
				default:
					return assertExhaustive(s);
			}
		};
		const sample: ConnectionState = { kind: "disconnected" };
		expect(inspect(sample)).toBe("d");
	});

	it("narrows to TomoInstance when kind==='connected'", () => {
		const instance: TomoInstance = {
			containerId: "abc".padEnd(64, "0"),
			shortId: "abcdef012345",
			name: "Tomo One",
			startedAt: new Date("2026-04-28T07:00:00Z"),
			image: "miyo/tomo:0.7.0",
		};
		const s: ConnectionState = { kind: "connected", instance };
		if (s.kind === "connected") {
			// Type-checked: s.instance is TomoInstance, non-null.
			expect(s.instance.containerId).toBe(instance.containerId);
			expect(s.instance.shortId).toBe("abcdef012345");
		}
	});

	it("carries reconnect metadata when kind==='reconnecting'", () => {
		const target: TomoInstance = {
			containerId: "f".padEnd(64, "0"),
			shortId: "ffffffffffff",
			name: null,
			startedAt: new Date("2026-04-28T07:00:00Z"),
			image: "miyo/tomo:0.7.0",
		};
		const s: ConnectionState = {
			kind: "reconnecting",
			target,
			attempt: 2,
			nextDelayMs: 1500,
		};
		if (s.kind === "reconnecting") {
			expect(s.attempt).toBe(2);
			expect(s.nextDelayMs).toBe(1500);
			expect(s.target.name).toBeNull();
		}
	});
});

describe("ConnectionError", () => {
	it("compiles with exhaustive switch over all codes", () => {
		const describeError = (e: ConnectionError): string => {
			switch (e.code) {
				case "daemon-unreachable":
					return "down";
				case "socket-permission-denied":
					return "perms";
				case "no-instances":
					return "none";
				case "attach-failed":
					return "attach";
				default:
					return assertExhaustive(e);
			}
		};
		const e: ConnectionError = {
			code: "daemon-unreachable",
			detail: "ECONNREFUSED",
		};
		expect(describeError(e)).toBe("down");
	});

	it("locks the no-instances detail to the user-facing copy", () => {
		const e: ConnectionError = {
			code: "no-instances",
			detail: "No Tomo instance seems to be running — start one and try again.",
		};
		expect(e.detail).toMatch(/No Tomo instance seems to be running/);
	});
});
