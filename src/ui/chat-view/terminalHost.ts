/**
 * Thin wrapper around `@xterm/xterm` and `@xterm/addon-fit`. The xterm
 * surface is encapsulated here so TomoChatView can be unit-tested without
 * driving real xterm under jsdom (which has Canvas/WebGL gaps and
 * measurement quirks). Tests mock this module wholesale; a separate source-
 * regex test (`terminalHost.test.ts`) pins the security-relevant
 * configuration flags so a refactor cannot silently re-enable them.
 *
 * xterm's stylesheet is concatenated into the plugin's emitted
 * `styles.css` at build time (see `esbuild.config.mjs` /
 * `bundleStylesCss`). Obsidian loads `styles.css` automatically, so this
 * module performs no runtime `<style>` injection — that would violate
 * `obsidianmd/no-forbidden-elements`.
 *
 * Coalescing: streamed bytes are batched per requestAnimationFrame. A burst
 * of N chunks within a single frame produces exactly one `terminal.write`,
 * regardless of N. Without this, a `cargo build` flood would queue N
 * microtasks per frame on Obsidian's main thread (each `xterm.write`
 * accumulates internal queue depth even though xterm batches its renderer).
 * `flushPending` is exposed for tests and is invoked synchronously on
 * `dispose()` so no queued bytes leak past view close.
 *
 * Spec refs: spec 001-session-view phase-4 T4.3; SDD ADR-2 (xterm.js
 * via Docker stream); SDD §System-Wide Patterns / Security
 * (allowProposedApi:false, no OSC 8/52); SDD §Cross-Cutting Concepts /
 * Accessibility (screenReaderMode:true); SDD §Performance / Streaming
 * Coalescing (added 2026-04-28 review-fix).
 */

import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

export interface TerminalSession {
	readonly terminal: Terminal;
	readonly fitAddon: FitAddon;
}

// Hard cap on the xterm scrollback buffer. The default in xterm 5.x is 1000
// lines, which is fine for typical sessions but can grow unbounded under a
// log-heavy command (e.g. `cargo build` floods 60k+ lines on a medium Rust
// project). 5000 lines × ~80 cols ≈ 400 KB resident, well under any
// realistic memory pressure on Electron, and the user can always re-run a
// command if older output is needed.
const SCROLLBACK_LINES = 5000;

interface CoalescerState {
	pending: (Uint8Array | string)[];
	scheduled: boolean;
	// review round 2 / L31: track whether a binary chunk has ever been
	// pushed to this coalescer in the current frame. The all-string
	// fast-path branch in `joinChunks` was previously a `chunks.every`
	// scan + closure allocation per multi-chunk frame. Tracking it as a
	// boolean during enqueue is O(1) and avoids the per-flush O(N) scan.
	hasBinary: boolean;
}

const coalescers = new WeakMap<TerminalSession, CoalescerState>();

// review round 2 / L32: TextEncoder is stateless per the Web spec —
// hoist to module scope so the mixed-chunks branch in `joinChunks` does
// not allocate a fresh encoder on every flush. Constructed exactly once
// per module load.
const sharedEncoder = new TextEncoder();

export function createTerminal(
	container: HTMLElement,
	theme?: ITheme,
): TerminalSession {
	const terminal = new Terminal({
		convertEol: true,
		cursorBlink: true,
		disableStdin: false,
		// SDD §System-Wide Patterns / Security — no OSC 52 / OSC 8 / other
		// proposed APIs. Source-regex pinned in `terminalHost.test.ts`.
		allowProposedApi: false,
		// SDD §Cross-Cutting Concepts / Accessibility — keep xterm.js's
		// screen-reader rendering on. Default in xterm 5.x is false; we make
		// the dependency explicit so a version bump cannot silently drop AT
		// support. Source-regex pinned in `terminalHost.test.ts`.
		screenReaderMode: true,
		// Bounded scrollback — see SCROLLBACK_LINES rationale above. Source-
		// regex pinned in `terminalHost.test.ts`.
		scrollback: SCROLLBACK_LINES,
		theme,
	});
	const fitAddon = new FitAddon();
	terminal.loadAddon(fitAddon);
	terminal.open(container);
	return { terminal, fitAddon };
}

/**
 * Enqueue bytes for the next animation frame. Within a single frame, all
 * accumulated chunks are concatenated and forwarded to xterm in a single
 * `terminal.write` call. Outside an active session (or after `dispose()`)
 * this is a no-op for the disposed session — the WeakMap entry is dropped
 * when the session is garbage-collected.
 */
export function writeChunk(
	session: TerminalSession,
	bytes: Uint8Array | string,
): void {
	let state = coalescers.get(session);
	if (state === undefined) {
		state = { pending: [], scheduled: false, hasBinary: false };
		coalescers.set(session, state);
	}
	state.pending.push(bytes);
	if (typeof bytes !== "string") state.hasBinary = true;
	if (state.scheduled) return;
	state.scheduled = true;
	requestAnimationFrame(() => {
		flushPending(session);
	});
}

/**
 * Drains the per-session coalescer buffer synchronously. Exposed for tests
 * and called from `dispose()` so a final batch cannot be orphaned.
 */
export function flushPending(session: TerminalSession): void {
	const state = coalescers.get(session);
	if (state === undefined) return;
	state.scheduled = false;
	if (state.pending.length === 0) return;
	const drain = state.pending;
	state.pending = [];
	const wasAllStrings = !state.hasBinary;
	state.hasBinary = false;
	session.terminal.write(joinChunks(drain, wasAllStrings));
}

function joinChunks(
	chunks: (Uint8Array | string)[],
	allStrings: boolean,
): string | Uint8Array {
	// M11 (review/spec-001): single-chunk fast path. The dominant frame on
	// a steady chat-output stream is one chunk; pre-fix code still
	// allocated a fresh Uint8Array(total) and copied bytes into it. xterm's
	// terminal.write accepts a single chunk directly. Zero-cost early
	// return removes the wasted copy.
	if (chunks.length === 1) return chunks[0]!;
	// All-string fast path — common for terminal escape sequences and ASCII
	// chat output, avoids a TextEncoder round-trip. The `allStrings` flag is
	// tracked during writeChunk so this branch does not need an O(N) scan
	// (review round 2 / L31).
	if (allStrings) {
		return chunks.join("");
	}
	// Mixed or all-binary — concatenate into a single Uint8Array so xterm's
	// renderer sees one operation per frame. Uses the module-scope
	// sharedEncoder (review round 2 / L32) instead of a per-flush new
	// TextEncoder allocation.
	const arrs: Uint8Array[] = [];
	let total = 0;
	for (const c of chunks) {
		const arr = typeof c === "string" ? sharedEncoder.encode(c) : c;
		arrs.push(arr);
		total += arr.length;
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const arr of arrs) {
		out.set(arr, offset);
		offset += arr.length;
	}
	return out;
}

export function fit(session: TerminalSession): void {
	session.fitAddon.fit();
}

export function dispose(session: TerminalSession): void {
	// Drain any queued bytes synchronously so a write made in the same frame
	// as a dispose is not silently lost. After this, the WeakMap entry is
	// dropped naturally when the caller releases the session reference.
	flushPending(session);
	coalescers.delete(session);
	// FitAddon is owned by the terminal and disposed transitively.
	session.terminal.dispose();
}
