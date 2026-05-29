import { describe, expect, it } from "vitest";

import { describeIdeBridgeState } from "../../../src/ide-bridge/state";
import type { IdeBridgeState } from "../../../src/ide-bridge/state";

describe("describeIdeBridgeState", () => {
	it("maps the 'stopped' variant to a label and color", () => {
		const state: IdeBridgeState = { kind: "stopped" };
		const result = describeIdeBridgeState(state);
		expect(result.label).toBe("Stopped");
		expect(result.color).toBe("var(--text-muted)");
	});

	it("maps the 'listening' variant to a label and color", () => {
		const state: IdeBridgeState = { kind: "listening", port: 23027 };
		const result = describeIdeBridgeState(state);
		expect(result.label).toBe("Listening");
		expect(result.color).toBe("var(--text-accent)");
	});

	it("maps the 'connected' variant to a label and color", () => {
		const state: IdeBridgeState = {
			kind: "connected",
			port: 23027,
			clientCount: 1,
		};
		const result = describeIdeBridgeState(state);
		expect(result.label).toBe("Connected");
		expect(result.color).toBe("var(--text-success)");
	});

	it("maps the 'error' variant to a label and color", () => {
		const state: IdeBridgeState = {
			kind: "error",
			reason: "port 23027 in use",
		};
		const result = describeIdeBridgeState(state);
		expect(result.label).toBe("Error");
		expect(result.color).toBe("var(--text-error)");
	});

	it("distinguishes all four variants by their (label, color) pair", () => {
		// Proves the switch handles every variant distinctly. Combined with the
		// `never` exhaustiveness check in state.ts, this guards against a new
		// variant being added without updating describeIdeBridgeState.
		const variants: IdeBridgeState[] = [
			{ kind: "stopped" },
			{ kind: "listening", port: 23027 },
			{ kind: "connected", port: 23027, clientCount: 1 },
			{ kind: "error", reason: "boom" },
		];
		const keys = variants.map((s) => {
			const { label, color } = describeIdeBridgeState(s);
			return `${label}:${color}`;
		});
		expect(new Set(keys).size).toBe(4);
	});
});
