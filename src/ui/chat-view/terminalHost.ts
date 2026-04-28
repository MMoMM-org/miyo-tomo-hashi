/**
 * Thin wrapper around `@xterm/xterm` and `@xterm/addon-fit`. The xterm
 * surface is encapsulated here so TomoChatView can be unit-tested without
 * driving real xterm under jsdom (which has Canvas/WebGL gaps and
 * measurement quirks). Tests mock this module wholesale; a smoke test
 * verifies the four exported functions exist.
 *
 * xterm's stylesheet is concatenated into the plugin's emitted
 * `styles.css` at build time (see `esbuild.config.mjs` /
 * `bundleStylesCss`). Obsidian loads `styles.css` automatically, so this
 * module performs no runtime `<style>` injection — that would violate
 * `obsidianmd/no-forbidden-elements`.
 *
 * Spec refs: spec 001-session-view phase-4 T4.3; SDD ADR-2 (xterm.js
 * via Docker stream), CON-2 (no proposed APIs — no OSC 52, no OSC 8),
 * CON-8 (no allowProposedApi).
 */

import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

export interface TerminalSession {
	readonly terminal: Terminal;
	readonly fitAddon: FitAddon;
}

export function createTerminal(
	container: HTMLElement,
	theme?: ITheme,
): TerminalSession {
	const terminal = new Terminal({
		convertEol: true,
		cursorBlink: true,
		disableStdin: false,
		// SDD CON-8 — no OSC 52 / OSC 8 / other proposed APIs.
		allowProposedApi: false,
		theme,
	});
	const fitAddon = new FitAddon();
	terminal.loadAddon(fitAddon);
	terminal.open(container);
	return { terminal, fitAddon };
}

export function writeChunk(
	session: TerminalSession,
	bytes: Uint8Array | string,
): void {
	session.terminal.write(bytes);
}

export function fit(session: TerminalSession): void {
	session.fitAddon.fit();
}

export function dispose(session: TerminalSession): void {
	// FitAddon is owned by the terminal and disposed transitively.
	session.terminal.dispose();
}
