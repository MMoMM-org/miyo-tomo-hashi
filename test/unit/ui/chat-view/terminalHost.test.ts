/**
 * Unit tests for src/ui/chat-view/terminalHost.ts.
 *
 * Two-tier coverage:
 *
 *   1. **Source-regex tests** read terminalHost.ts directly and pin the
 *      security- and accessibility-relevant configuration flags
 *      (allowProposedApi:false, screenReaderMode:true, scrollback:5000).
 *      A unit test that mocks xterm.js wholesale would short-circuit the
 *      `new Terminal({...})` call we want to verify; the source scan is the
 *      simplest mechanism that survives a future refactor.
 *
 *   2. **Behavioral coalescing test** uses vitest fake timers (faking
 *      `requestAnimationFrame`) to verify multiple `writeChunk` calls
 *      within a single frame produce exactly one `terminal.write` call.
 *
 * Spec refs: spec 001-session-view requirements.md F4/AC8 (xterm trust
 * boundary), F4/AC9 (xterm a11y mode); SDD §System-Wide Patterns / Security
 * + §Cross-Cutting Concepts / Accessibility + §Performance / Streaming
 * Coalescing; traceability.md §F4.8 + §"2026-04-28 review-fix follow-ups".
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SOURCE_PATH = resolve(
	__dirname,
	"../../../../src/ui/chat-view/terminalHost.ts",
);

describe("terminalHost source — security & accessibility flags pinned", () => {
	const source = readFileSync(SOURCE_PATH, "utf-8");

	it("constructs xterm.js with allowProposedApi:false (PRD F4/AC8)", () => {
		// Match `allowProposedApi: false` allowing arbitrary whitespace.
		expect(source).toMatch(/allowProposedApi\s*:\s*false/);
		// Defense: no allowProposedApi:true anywhere (would override).
		expect(source).not.toMatch(/allowProposedApi\s*:\s*true/);
	});

	it("constructs xterm.js with screenReaderMode:true (PRD F4/AC9)", () => {
		expect(source).toMatch(/screenReaderMode\s*:\s*true/);
		expect(source).not.toMatch(/screenReaderMode\s*:\s*false/);
	});

	it("configures a bounded scrollback buffer (5000 lines) — prevents unbounded memory growth on log floods", () => {
		// Either a literal 5000 in the options object, or a const reference
		// alongside the constant definition. Accept both.
		expect(source).toMatch(/scrollback\s*:\s*(?:5000|SCROLLBACK_LINES)/);
		expect(source).toMatch(/SCROLLBACK_LINES\s*=\s*5000/);
	});

	it("does not import or reference OSC 8 / OSC 52 link/clipboard handlers (PRD F4/AC8)", () => {
		// xterm-addon-web-links and xterm-addon-clipboard are the addons that
		// would activate OSC 8 / OSC 52 respectively. Either would defeat the
		// trust boundary AC.
		expect(source).not.toContain("@xterm/addon-web-links");
		expect(source).not.toContain("@xterm/addon-clipboard");
		expect(source).not.toContain("xterm-addon-web-links");
		expect(source).not.toContain("xterm-addon-clipboard");
	});

	it("the writeChunk function uses requestAnimationFrame for coalescing (CRITICAL — main-thread protection under load)", () => {
		// We don't assert per-byte; we assert the structural commitment that
		// writeChunk does NOT directly call terminal.write on every chunk.
		// The function body must reference requestAnimationFrame, and the
		// flushPending function must exist for synchronous drain on dispose.
		expect(source).toMatch(/requestAnimationFrame/);
		expect(source).toMatch(/export function flushPending/);
		// dispose() drains pending before tearing down — protects against
		// queued bytes outliving the view.
		expect(source).toMatch(/flushPending\(session\)\s*[;\n]/);
	});
});

describe("writeChunk — RAF coalescing behavior", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("multiple writeChunk calls within a single frame produce one terminal.write call", async () => {
		const { writeChunk, flushPending } = await import(
			"../../../../src/ui/chat-view/terminalHost"
		);

		const writeSpy = vi.fn();
		const fakeSession = {
			// Only the methods writeChunk reaches into are needed here.
			terminal: { write: writeSpy } as unknown,
			fitAddon: {} as unknown,
		} as unknown as Parameters<typeof writeChunk>[0];

		writeChunk(fakeSession, "first ");
		writeChunk(fakeSession, "second ");
		writeChunk(fakeSession, "third");

		// Before the frame, no write has been issued — chunks are queued.
		expect(writeSpy).not.toHaveBeenCalled();

		// Run the scheduled RAF — vitest fake timers expose this via runAllTimers.
		vi.runAllTimers();

		expect(writeSpy).toHaveBeenCalledTimes(1);
		expect(writeSpy).toHaveBeenCalledWith("first second third");

		// Flush is idempotent on an empty buffer.
		flushPending(fakeSession);
		expect(writeSpy).toHaveBeenCalledTimes(1);
	});

	it("subsequent writes after a flush schedule a new frame", async () => {
		const { writeChunk } = await import(
			"../../../../src/ui/chat-view/terminalHost"
		);

		const writeSpy = vi.fn();
		const fakeSession = {
			terminal: { write: writeSpy } as unknown,
			fitAddon: {} as unknown,
		} as unknown as Parameters<typeof writeChunk>[0];

		writeChunk(fakeSession, "frame-1");
		vi.runAllTimers();
		expect(writeSpy).toHaveBeenCalledTimes(1);
		expect(writeSpy).toHaveBeenLastCalledWith("frame-1");

		writeChunk(fakeSession, "frame-2-a");
		writeChunk(fakeSession, "frame-2-b");
		vi.runAllTimers();
		expect(writeSpy).toHaveBeenCalledTimes(2);
		expect(writeSpy).toHaveBeenLastCalledWith("frame-2-aframe-2-b");
	});

	it("dispose() drains pending bytes synchronously — protects against orphaned writes", async () => {
		const { writeChunk, dispose } = await import(
			"../../../../src/ui/chat-view/terminalHost"
		);

		const writeSpy = vi.fn();
		const disposeSpy = vi.fn();
		const fakeSession = {
			terminal: { write: writeSpy, dispose: disposeSpy } as unknown,
			fitAddon: {} as unknown,
		} as unknown as Parameters<typeof writeChunk>[0];

		writeChunk(fakeSession, "queued before dispose");
		// Note: no vi.runAllTimers() — dispose is supposed to flush itself.
		dispose(fakeSession);

		expect(writeSpy).toHaveBeenCalledTimes(1);
		expect(writeSpy).toHaveBeenCalledWith("queued before dispose");
		expect(disposeSpy).toHaveBeenCalledTimes(1);
	});

	it("mixed string + Uint8Array chunks concatenate into a single Uint8Array", async () => {
		const { writeChunk } = await import(
			"../../../../src/ui/chat-view/terminalHost"
		);

		const writeSpy = vi.fn();
		const fakeSession = {
			terminal: { write: writeSpy } as unknown,
			fitAddon: {} as unknown,
		} as unknown as Parameters<typeof writeChunk>[0];

		writeChunk(fakeSession, "ABC");
		writeChunk(fakeSession, new Uint8Array([0x44, 0x45]));
		vi.runAllTimers();

		expect(writeSpy).toHaveBeenCalledTimes(1);
		const arg = writeSpy.mock.calls[0]?.[0];
		expect(arg).toBeInstanceOf(Uint8Array);
		// "ABC" + 0x44 0x45 = 0x41 0x42 0x43 0x44 0x45
		expect(Array.from(arg as Uint8Array)).toEqual([0x41, 0x42, 0x43, 0x44, 0x45]);
	});
});
