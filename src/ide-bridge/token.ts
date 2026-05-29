/**
 * Auth token lifecycle for the IDE Bridge — pure helpers that mint and validate
 * the bearer token Claude Code presents on the localhost WebSocket handshake.
 *
 * Persistence is NOT done here: the orchestrator (T3.2) owns saving/loading the
 * token. These functions are pure so the format and the "keep-or-mint" rule can
 * be unit-tested without Obsidian or any I/O. Token format is `hashi_<UUID>`
 * (precedent: Kado uses `kado_<UUID>`).
 *
 * Spec: docs/XDD/specs/003-ide-bridge — ADR-4.
 */

import { randomUUID } from "node:crypto";

/** Mint a fresh bearer token in the `hashi_<UUID>` format. */
export function generateToken(): string {
	return `hashi_${randomUUID()}`;
}

/**
 * Return `current` when it is a non-empty token; otherwise mint a fresh one.
 * Used to lazily initialise the token on first run without clobbering an
 * already-persisted value.
 */
export function ensureToken(current: string): string {
	return current ? current : generateToken();
}
